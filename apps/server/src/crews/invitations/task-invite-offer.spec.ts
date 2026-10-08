import { CreateCrewInviteLinkSchema } from '../dto';
import { CrewInviteLinksService } from './invite-links.service';
import { lockTaskInviteTarget } from './task-invite-claim';
jest.mock('./task-invite-claim', () => ({ lockTaskInviteTarget: jest.fn() }));
const taskId = '17d4c23f-47e8-4a35-a652-778b85c567ad';
function harness() {
  const target = {
    id: taskId,
    version: 3,
    title: 'Animate scene',
    description: 'Deliver one clip',
    dueAt: new Date('2027-01-01'),
    metadata: {
      requiredSkills: ['Animation'],
      compensation: {
        rewardUsdMinor: 12000,
        profitShareBps: 250,
        paymentTerms: 'half_upfront',
      },
    },
    assignees: [],
    workflowState: { semantic: 'open' },
  };
  const link = {
    id: 'link',
    crewId: 'crew',
    taskId,
    taskVersion: 3,
    kind: 'member',
    maxUses: 1,
    useCount: 0,
    revokedAt: null,
    expiresAt: null,
    createdAt: new Date(),
    policyKeys: [],
    createdByUserId: 'owner',
  };
  const tx = {
    $executeRaw: jest.fn(),
    crewPosition: { count: jest.fn().mockResolvedValue(0) },
    crewInviteLink: { create: jest.fn().mockResolvedValue(link) },
    crewAuthorizationEvent: { create: jest.fn() },
  };
  const prisma = {
    crew: {
      findFirst: jest.fn().mockResolvedValue({ id: 'crew', name: 'Crew' }),
    },
    crewMember: {
      count: jest.fn().mockResolvedValue(1),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    crewTask: { findFirst: jest.fn().mockResolvedValue(target) },
    crewInviteLinkRedemption: { findUnique: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn(async (fn: (db: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
  };
  const auth = { require: jest.fn().mockResolvedValue({ memberId: 'owner' }) };
  jest.mocked(lockTaskInviteTarget).mockResolvedValue(target as never);
  const service = new CrewInviteLinksService(
    prisma as never,
    auth as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return {
    target,
    link,
    tx,
    prisma,
    auth,
    service,
    create: () =>
      service.create(
        'crew',
        'owner',
        CreateCrewInviteLinkSchema.parse({ taskId, taskVersion: 3 }),
      ),
  };
}
beforeEach(() => jest.resetAllMocks());
it.each([
  { taskId },
  { taskVersion: 3 },
  { taskId, taskVersion: 3, kind: 'community' },
  { taskId, taskVersion: 3, maxUses: 2 },
  { taskId, taskVersion: 0 },
])('rejects invalid binding %j', (input) => {
  expect(CreateCrewInviteLinkSchema.safeParse(input).success).toBe(false);
});
it('creates a single-use link bound to the reviewed version', async () => {
  const h = harness();
  const result = await h.create();
  expect(lockTaskInviteTarget).toHaveBeenCalledWith(h.tx, 'crew', taskId, 3);
  expect(h.auth.require).toHaveBeenCalledWith(
    'crew',
    'owner',
    'tasks.manage',
    h.tx,
  );
  expect(
    (h.tx.crewInviteLink.create.mock.calls as unknown[][])[0]?.[0],
  ).toMatchObject({
    data: {
      taskId,
      taskVersion: 3,
      maxUses: 1,
      policyKeys: [],
    },
  });
  expect(result).toMatchObject({ taskId, taskVersion: 3, maxUses: 1 });
  expect(result.token).toBeTruthy();
});
it('does not mint a direct-claim link for a recruitment task', async () => {
  const h = harness();
  h.tx.crewPosition.count.mockResolvedValue(1);
  await expect(h.create()).rejects.toThrow('uses recruitment');
  expect(h.tx.crewInviteLink.create).not.toHaveBeenCalled();
});
it('previews only current task terms', async () => {
  const h = harness();
  expect(await h.service.preview(h.link as never)).toMatchObject({
    status: 'active',
    task: {
      title: 'Animate scene',
      rewardUsdMinor: 12000,
      profitShareBps: 250,
      paymentTerms: 'half_upfront',
      requiredSkills: ['Animation'],
    },
  });
  h.target.version = 4;
  expect(await h.service.preview(h.link as never)).toMatchObject({
    status: 'expired',
    task: null,
  });
});
it('does not disclose task terms from a revoked link', async () => {
  const h = harness();
  await expect(
    h.service.preview({ ...h.link, revokedAt: new Date() } as never),
  ).resolves.toMatchObject({ status: 'revoked', task: null });
  expect(h.prisma.crewTask.findFirst).not.toHaveBeenCalled();
});
it('allows a previously accepted recipient to return after the link is exhausted', async () => {
  const h = harness();
  h.link.useCount = 1;
  h.prisma.crewInviteLinkRedemption.findUnique.mockResolvedValue({
    memberId: 'recipient',
  });
  h.prisma.crewMember.findFirst.mockResolvedValue({ id: 'recipient' });
  expect(
    await h.service.preview(h.link as never, { userId: '42' }),
  ).toMatchObject({
    status: 'exhausted',
    task: null,
    acceptedHref: `/crews/crew/workspace?tab=tasks&task=${taskId}`,
  });
});

it('previews the recorded CNY reward without converting or relabeling it', async () => {
  const h = harness();
  Object.assign(h.target.metadata.compensation, { rewardCurrency: 'CNY' });
  expect(await h.service.preview(h.link as never)).toMatchObject({
    task: { rewardCurrency: 'CNY', rewardUsdMinor: 12000 },
  });
});
