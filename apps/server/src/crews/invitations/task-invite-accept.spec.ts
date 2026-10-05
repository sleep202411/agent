import { CrewInviteLinksService } from './invite-links.service';
import { joinCrewInTransaction } from './join-crew';
import {
  claimTaskInviteTarget,
  lockTaskInviteTarget,
} from './task-invite-claim';

jest.mock('./join-crew', () => ({ joinCrewInTransaction: jest.fn() }));
jest.mock('./task-invite-claim', () => ({
  claimTaskInviteTarget: jest.fn(),
  lockTaskInviteTarget: jest.fn(),
}));

function harness() {
  const link = {
    id: 'link',
    crewId: 'crew',
    taskId: 'task',
    taskVersion: 2,
    kind: 'member',
    maxUses: 1,
    useCount: 0,
    revokedAt: null,
    expiresAt: null,
    createdByUserId: 'owner',
    policyKeys: ['administrator'],
  };
  const task = {
    id: 'task',
    crewId: 'crew',
    title: 'Animate scene',
    version: 2,
    metadata: { requiredSkills: ['Animation'] },
  };
  const tx = {
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
    crewInviteLink: {
      findUnique: jest.fn().mockResolvedValue(link),
      update: jest.fn(),
    },
    crewInviteLinkRedemption: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    },
    crewMember: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const prisma = {
    crew: {
      findFirst: jest.fn().mockResolvedValue({ id: 'crew', name: 'Crew' }),
    },
    crewTask: { findFirst: jest.fn().mockResolvedValue(task) },
    crewInviteLinkRedemption: { findUnique: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn(async (fn: (client: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
  };
  const auth = { require: jest.fn().mockResolvedValue({ memberId: 'owner' }) };
  const qualifications = {
    assertEligible: jest.fn().mockResolvedValue(undefined),
  };
  const notifications = { send: jest.fn().mockResolvedValue(undefined) };
  const conversations = {
    broadcastMessage: jest.fn().mockResolvedValue(undefined),
  };
  jest.mocked(joinCrewInTransaction).mockResolvedValue({
    memberId: 'recipient',
    systemMessage: { id: 'message' },
  } as never);
  jest.mocked(lockTaskInviteTarget).mockResolvedValue(task as never);
  jest.mocked(claimTaskInviteTarget).mockResolvedValue(undefined);
  const service = new CrewInviteLinksService(
    prisma as never,
    auth as never,
    conversations as never,
    {} as never,
    notifications as never,
    qualifications as never,
  );
  return {
    link,
    task,
    tx,
    prisma,
    auth,
    qualifications,
    notifications,
    conversations,
    accept: () =>
      service.accept(link as never, { userId: '42' }, 'session=fixture'),
  };
}

beforeEach(() => jest.resetAllMocks());

it('joins, claims, redeems and queues the alert on the same transaction', async () => {
  const h = harness();
  await expect(h.accept()).resolves.toMatchObject({
    memberId: 'recipient',
    workspaceHref: '/crews/crew/workspace?tab=tasks&task=task',
  });
  expect(h.qualifications.assertEligible).toHaveBeenCalledWith(
    '42',
    'session=fixture',
    { experienceLevel: 'any', requiredSkills: ['Animation'] },
  );
  expect(lockTaskInviteTarget).toHaveBeenCalledWith(h.tx, 'crew', 'task', 2);
  expect(joinCrewInTransaction).toHaveBeenCalledWith(
    h.tx,
    expect.anything(),
    expect.objectContaining({ userId: '42' }),
  );
  expect(claimTaskInviteTarget).toHaveBeenCalledWith(
    h.tx,
    h.task,
    'recipient',
    '42',
    'owner',
    'link',
  );
  expect(h.notifications.send).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'crew.invitation.accepted' }),
    h.tx,
  );
  expect(h.tx.crewInviteLinkRedemption.create).toHaveBeenCalledTimes(1);
  expect(h.auth.require.mock.calls.map((args: unknown[]) => args[2])).toEqual([
    'members.invite',
    'tasks.manage',
    'members.permissions.manage',
  ]);
});

it('lets an existing active member claim without changing their policies', async () => {
  const h = harness();
  h.tx.crewMember.findFirst.mockResolvedValue({
    id: 'existing',
    status: 'active',
    removedAt: null,
  });
  await expect(h.accept()).resolves.toMatchObject({ memberId: 'existing' });
  expect(joinCrewInTransaction).not.toHaveBeenCalled();
  expect(claimTaskInviteTarget).toHaveBeenCalledWith(
    h.tx,
    h.task,
    'existing',
    '42',
    'owner',
    'link',
  );
});

it('replays an accepted link without verifying or granting again', async () => {
  const h = harness();
  const prior = { memberId: 'existing' };
  h.prisma.crewInviteLinkRedemption.findUnique.mockResolvedValue(prior);
  h.tx.crewInviteLinkRedemption.findUnique.mockResolvedValue(prior);
  h.tx.crewMember.findFirst.mockResolvedValue({ id: 'existing' });
  h.link.useCount = 1;
  await h.accept();
  expect(h.qualifications.assertEligible).not.toHaveBeenCalled();
  expect(claimTaskInviteTarget).not.toHaveBeenCalled();
  expect(h.notifications.send).not.toHaveBeenCalled();
  expect(h.tx.crewInviteLink.update).not.toHaveBeenCalled();
});

it.each(['suspended', 'removed'])(
  'denies %s members without re-admission',
  async (status) => {
    const h = harness();
    h.tx.crewMember.findFirst.mockResolvedValue({ id: 'existing', status });
    await expect(h.accept()).rejects.toThrow('restore your membership');
    expect(joinCrewInTransaction).not.toHaveBeenCalled();
    expect(claimTaskInviteTarget).not.toHaveBeenCalled();
  },
);

it('fails closed when qualifications cannot be verified', async () => {
  const h = harness();
  h.qualifications.assertEligible.mockRejectedValue(
    new Error('Qualifications unavailable'),
  );
  await expect(h.accept()).rejects.toThrow('Qualifications unavailable');
  expect(h.prisma.$transaction).not.toHaveBeenCalled();
});

it('rejects task changes after qualification lookup', async () => {
  const h = harness();
  jest
    .mocked(lockTaskInviteTarget)
    .mockRejectedValue(new Error('Task changed'));
  await expect(h.accept()).rejects.toThrow('Task changed');
  expect(joinCrewInTransaction).not.toHaveBeenCalled();
});

it('rejects an inviter who has lost authority before joining', async () => {
  const h = harness();
  h.auth.require.mockRejectedValue(new Error('Permission revoked'));
  await expect(h.accept()).rejects.toThrow('Permission revoked');
  expect(joinCrewInTransaction).not.toHaveBeenCalled();
});

it('does not consume or announce an invitation when claiming fails', async () => {
  const h = harness();
  jest
    .mocked(claimTaskInviteTarget)
    .mockRejectedValue(new Error('Recruitment terms mismatch'));
  await expect(h.accept()).rejects.toThrow('Recruitment terms mismatch');
  expect(h.tx.crewInviteLinkRedemption.create).not.toHaveBeenCalled();
  expect(h.tx.crewInviteLink.update).not.toHaveBeenCalled();
  expect(h.notifications.send).not.toHaveBeenCalled();
  expect(h.conversations.broadcastMessage).not.toHaveBeenCalled();
});

it('never broadcasts before the durable notification succeeds', async () => {
  const h = harness();
  h.notifications.send.mockRejectedValue(
    new Error('Notification write failed'),
  );
  await expect(h.accept()).rejects.toThrow('Notification write failed');
  expect(h.conversations.broadcastMessage).not.toHaveBeenCalled();
});
