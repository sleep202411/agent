/**
 * AssignmentsService — authorization edges and the notification fan-out.
 *
 * Role resolution runs through the REAL CrewRoleService against a mocked
 * Prisma: the founder short-circuit is exactly what several of these cases
 * turn on, so stubbing it out would test the stub instead of the policy.
 *
 * Revenue amounts pass `currency: 'CNY'` explicitly — it is the one code
 * allowed in both cells, so these tests don't depend on CURRENT_CELL.
 */
import { Prisma } from '@prisma/client';
import { CrewRoleService } from '../crew-role.service';
import { AssignmentsService } from './assignments.service';
import { SubmitAssignmentSchema } from './dto';

const CREW_ID = 'crew-1';
const CREW_NAME = 'Night Shift';
const CONVERSATION_ID = 'conv-crew-1';
const EPISODE_ID = 'ep-1';
const ASSIGNMENT_ID = 'as-1';

const FOUNDER = 'u-founder';
const ASSIGNEE = 'u-assignee';
const FINANCE = 'u-finance';
const OUTSIDER = 'u-outsider';

const EPISODE_LINK = `/crews/${CREW_ID}/workspace?tab=episodes&episode=${EPISODE_ID}`;
const ASSIGNMENT_LINK = `${EPISODE_LINK}&assignment=${ASSIGNMENT_ID}`;

type Membership = Record<string, { isFinance: boolean }>;

/** Active members of the crew, minus the founder — who short-circuits to
 *  'admin' before the membership lookup ever runs. */
const DEFAULT_MEMBERS: Membership = {
  [ASSIGNEE]: { isFinance: false },
  [FINANCE]: { isFinance: true },
};

function build(
  opts: {
    members?: Membership;
    crewDeleted?: boolean;
    assignment?: Record<string, unknown>;
    episode?: Record<string, unknown>;
    lockedAssignment?: Record<string, unknown>;
    lockedEpisode?: Record<string, unknown>;
  } = {},
) {
  const members = opts.members ?? DEFAULT_MEMBERS;

  const episodeRow = {
    id: EPISODE_ID,
    number: 3,
    status: 'in_production',
    crewId: CREW_ID,
    crew: { founderId: FOUNDER, name: CREW_NAME, deletedAt: null },
    ...opts.episode,
  };
  const lockedEpisodeRow = {
    ...episodeRow,
    ...opts.lockedEpisode,
  };

  const assignmentRow = {
    id: ASSIGNMENT_ID,
    crewId: CREW_ID,
    episodeId: EPISODE_ID,
    userId: ASSIGNEE,
    positionId: null,
    roleName: 'Storyboard',
    status: 'in_progress',
    submissionUrl: null,
    submissionNote: null,
    submittedAt: null,
    rejectReason: null,
    rejectSuggestion: null,
    rejectedAt: null,
    revenueAmount: null,
    revenueCurrency: null,
    revenueSetAt: null,
    revenueSetById: null,
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    episode: episodeRow,
    ...opts.assignment,
  };
  const lockedAssignmentRow = {
    ...assignmentRow,
    episode: lockedEpisodeRow,
    ...opts.lockedAssignment,
  };

  const update = jest.fn(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ ...lockedAssignmentRow, ...data }),
  );
  const created = { ...assignmentRow, id: 'as-new' };
  const findCrew = jest
    .fn()
    .mockResolvedValue(opts.crewDeleted ? null : { founderId: FOUNDER });
  const findMember = jest.fn(({ where }: { where: { userId: string } }) =>
    Promise.resolve(members[where.userId] ?? null),
  );
  const tx = {
    $queryRaw: jest
      .fn()
      .mockResolvedValue([{ id: EPISODE_ID }, { id: ASSIGNMENT_ID }]),
    crew: { findFirst: findCrew },
    crewMember: { findFirst: findMember },
    episodeAssignment: {
      findUnique: jest.fn().mockResolvedValue(lockedAssignmentRow),
      update,
      create: jest.fn().mockResolvedValue(created),
      delete: jest.fn().mockResolvedValue({}),
    },
    episode: {
      findUnique: jest.fn().mockResolvedValue(lockedEpisodeRow),
      update: jest.fn().mockResolvedValue({}),
    },
    episodeActivity: { create: jest.fn().mockResolvedValue({}) },
  };

  const prisma = {
    // Read by the real CrewRoleService.
    crew: { findFirst: findCrew },
    // Serves both the role lookup and add()'s "is the assignee a member"
    // check; both only care whether a row comes back.
    crewMember: { findFirst: findMember },
    episode: { findUnique: jest.fn().mockResolvedValue(episodeRow) },
    episodeAssignment: {
      // Lookup by id resolves the assignment; the compound-key lookup is
      // add()'s duplicate probe and must come back empty.
      findUnique: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(where.id ? assignmentRow : null),
      ),
      findMany: jest.fn().mockResolvedValue([assignmentRow]),
    },
    $transaction: jest.fn((cb: (client: unknown) => unknown) => cb(tx)),
  };

  const notifications = { send: jest.fn().mockResolvedValue({}) };

  const systemCalls: SystemCall[] = [];
  const conversations = {
    openCrewConversation: jest.fn().mockResolvedValue({ id: CONVERSATION_ID }),
    persistSystem: jest.fn(
      (
        conversationId: string,
        kind: string,
        params: Record<string, string | number>,
        txArg: unknown,
      ) => {
        systemCalls.push({ conversationId, kind, params, tx: txArg });
        return Promise.resolve({ id: `msg-${systemCalls.length}` });
      },
    ),
    broadcastMessage: jest.fn().mockResolvedValue(undefined),
  };

  return {
    prisma,
    tx,
    notifications,
    conversations,
    systemCalls,
    update,
    service: new AssignmentsService(
      prisma as never,
      new CrewRoleService(prisma as never),
      notifications as never,
      conversations as never,
    ),
  };
}

describe('AssignmentsService.listMine', () => {
  it("returns only the authenticated member's crew assignments", async () => {
    const t = build();

    const rows = await t.service.listMine(CREW_ID, ASSIGNEE);

    expect(t.prisma.episodeAssignment.findMany).toHaveBeenCalledWith({
      where: { crewId: CREW_ID, userId: ASSIGNEE },
      orderBy: [{ episode: { number: 'asc' } }, { id: 'asc' }],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: ASSIGNMENT_ID,
      episodeId: EPISODE_ID,
      userId: ASSIGNEE,
    });
  });

  it('rejects a removed member before reading task rows', async () => {
    const t = build({ members: {} });

    await expect(t.service.listMine(CREW_ID, ASSIGNEE)).rejects.toMatchObject({
      response: { message: 'Insufficient role', actualRole: 'outsider' },
    });
    expect(t.prisma.episodeAssignment.findMany).not.toHaveBeenCalled();
  });
});

/** One `persistSystem(conversationId, kind, params, tx)` call. */
interface SystemCall {
  conversationId: string;
  kind: string;
  params: Record<string, string | number>;
  tx: unknown;
}

interface SentNotification {
  userId: string;
  type: string;
  title: string;
  body: string;
  meta: Record<string, unknown>;
  idempotencyKey: string;
}
/** `send(args, tx)` — the tx client is the second argument. */
type SendCall = [SentNotification, unknown];

function sendCalls(notifications: { send: jest.Mock }): SendCall[] {
  return notifications.send.mock.calls as SendCall[];
}

/** The single notification argument object handed to NotificationService. */
function sentNotification(notifications: { send: jest.Mock }) {
  expect(notifications.send).toHaveBeenCalledTimes(1);
  return sendCalls(notifications)[0][0];
}

describe('AssignmentsService.submit — who is allowed to submit', () => {
  const input = { url: 'https://cdn.example/cut-03.mp4' };

  it('lets the assignee submit while they are still a member', async () => {
    const t = build();

    const dto = await t.service.submit(ASSIGNMENT_ID, ASSIGNEE, 'Ada', input);

    expect(dto).toMatchObject({ id: ASSIGNMENT_ID, status: 'submitted' });
    expect(t.update).toHaveBeenCalledTimes(1);
  });

  it('refuses a member who was removed from the crew', async () => {
    // The assignment row outlives the membership that created it — the hole.
    const t = build({ members: {} });

    await expect(
      t.service.submit(ASSIGNMENT_ID, ASSIGNEE, 'Ada', input),
    ).rejects.toMatchObject({
      response: { message: 'Insufficient role', actualRole: 'outsider' },
    });
    expect(t.update).not.toHaveBeenCalled();
    expect(t.notifications.send).not.toHaveBeenCalled();
  });

  it('refuses an outsider without leaking that the assignment exists', async () => {
    const t = build();

    // 'Insufficient role', NOT 'Only the assignee can submit' — the latter
    // confirms the id resolves to a real row.
    await expect(
      t.service.submit(ASSIGNMENT_ID, OUTSIDER, 'Mallory', input),
    ).rejects.toMatchObject({ response: { message: 'Insufficient role' } });
  });

  it('still refuses a member submitting somebody else’s assignment', async () => {
    const t = build();

    await expect(
      t.service.submit(ASSIGNMENT_ID, FINANCE, 'Fin', input),
    ).rejects.toMatchObject({
      response: {
        message: 'Only the assignee can submit',
        requiredRole: 'self',
      },
    });
  });

  /**
   * Deliberate consequence of routing submit through CrewRoleService: a
   * legitimately-assigned user whose crew was soft-deleted now gets 404
   * from resolve() instead of reaching the self-check. Pinned so the
   * behaviour is a decision, not a surprise.
   */
  it('answers 404 Crew not found once the crew is soft-deleted', async () => {
    const t = build({ crewDeleted: true });

    await expect(
      t.service.submit(ASSIGNMENT_ID, ASSIGNEE, 'Ada', input),
    ).rejects.toMatchObject({
      response: { statusCode: 404, message: 'Crew not found' },
    });
    expect(t.update).not.toHaveBeenCalled();
  });
});

describe('SubmitAssignmentSchema — a submission must carry content', () => {
  it('rejects an empty body', () => {
    const r = SubmitAssignmentSchema.safeParse({});

    expect(r.success).toBe(false);
    expect(r.error?.issues[0]).toMatchObject({
      path: ['url'],
      message: 'A submission needs a url or a note',
    });
  });

  it('rejects whitespace-only content', () => {
    expect(
      SubmitAssignmentSchema.safeParse({ url: '   ', note: '  ' }).success,
    ).toBe(false);
  });

  it('rejects explicit nulls', () => {
    expect(
      SubmitAssignmentSchema.safeParse({ url: null, note: null }).success,
    ).toBe(false);
  });

  it('accepts a url alone or a note alone', () => {
    expect(
      SubmitAssignmentSchema.safeParse({ url: 'https://a.example/x' }).success,
    ).toBe(true);
    expect(SubmitAssignmentSchema.safeParse({ note: 'done' }).success).toBe(
      true,
    );
  });
});

describe('AssignmentsService.submit — the founder gets told', () => {
  it('notifies the crew founder with a deeplink to the assignment', async () => {
    const t = build();

    await t.service.submit(ASSIGNMENT_ID, ASSIGNEE, 'Ada', { note: 'done' });

    const n = sentNotification(t.notifications);
    expect(n).toMatchObject({
      userId: FOUNDER,
      type: 'crew.episode.submitted',
      title: 'New submission on episode 3',
      body: `Ada submitted work in "${CREW_NAME}" for review.`,
      meta: {
        deeplink: ASSIGNMENT_LINK,
        crewId: CREW_ID,
        episodeId: EPISODE_ID,
        assignmentId: ASSIGNMENT_ID,
      },
    });
    // Keyed on this submission's timestamp so a resubmit after a rejection
    // is a fresh notification rather than a dedup hit.
    expect(n.idempotencyKey).toMatch(
      new RegExp(`^crew\\.episode\\.submitted:${ASSIGNMENT_ID}:.+`),
    );
  });

  it('writes the notification in the same transaction as the status flip', async () => {
    const t = build();

    await t.service.submit(ASSIGNMENT_ID, ASSIGNEE, 'Ada', { note: 'done' });

    expect(t.prisma.$transaction).toHaveBeenCalledTimes(1);
    // Second arg is the tx client, so a rolled-back submit sends nothing.
    expect(sendCalls(t.notifications)[0][1]).toBe(t.tx);
  });

  it('stays quiet when the founder submits their own assignment', async () => {
    const t = build({ assignment: { userId: FOUNDER } });

    await t.service.submit(ASSIGNMENT_ID, FOUNDER, 'Owner', { note: 'done' });

    expect(t.update).toHaveBeenCalledTimes(1);
    expect(t.notifications.send).not.toHaveBeenCalled();
  });
});

describe('AssignmentsService — notification deeplinks carry the ids', () => {
  it('add() points at the new assignment', async () => {
    const t = build();

    await t.service.add(EPISODE_ID, FOUNDER, 'Owner', { userId: ASSIGNEE });

    expect(sentNotification(t.notifications).meta.deeplink).toBe(
      `${EPISODE_LINK}&assignment=as-new`,
    );
  });

  it('remove() omits the assignment id because the row is gone', async () => {
    const t = build();

    await t.service.remove(ASSIGNMENT_ID, FOUNDER, 'Owner');

    expect(sentNotification(t.notifications).meta.deeplink).toBe(EPISODE_LINK);
  });

  it('approve() points at the reviewed assignment', async () => {
    const t = build({ assignment: { status: 'submitted' } });

    await t.service.approve(ASSIGNMENT_ID, FOUNDER, 'Owner');

    expect(sentNotification(t.notifications).meta.deeplink).toBe(
      ASSIGNMENT_LINK,
    );
  });

  it('reject() points at the reviewed assignment', async () => {
    const t = build({ assignment: { status: 'submitted' } });

    await t.service.reject(ASSIGNMENT_ID, FOUNDER, 'Owner', {
      reason: 'Needs a wider shot',
    });

    expect(sentNotification(t.notifications).meta.deeplink).toBe(
      ASSIGNMENT_LINK,
    );
  });

  it('setRevenue() points at the paid assignment', async () => {
    const t = build();

    await t.service.setRevenue(ASSIGNMENT_ID, FINANCE, 'Fin', {
      amount: 220000,
      currency: 'CNY',
    });

    expect(sentNotification(t.notifications).meta.deeplink).toBe(
      ASSIGNMENT_LINK,
    );
  });
});

describe('AssignmentsService.setRevenue — who may touch money', () => {
  const input = { amount: 220000, currency: 'CNY' };

  /**
   * The founder resolves to 'admin' and never to 'finance', so `['finance']`
   * alone locked every crew without a finance-flagged member out of its own
   * revenue — and the founder cannot flag themselves.
   */
  it('lets the founder record revenue', async () => {
    const t = build();

    const dto = await t.service.setRevenue(
      ASSIGNMENT_ID,
      FOUNDER,
      'Owner',
      input,
    );

    expect(dto.revenue).toMatchObject({
      amount: 220000,
      currency: 'CNY',
      setByUserId: FOUNDER,
    });
  });

  it('lets a finance member record revenue', async () => {
    const t = build();

    const dto = await t.service.setRevenue(
      ASSIGNMENT_ID,
      FINANCE,
      'Fin',
      input,
    );

    expect(dto.revenue).toMatchObject({
      amount: 220000,
      setByUserId: FINANCE,
    });
  });

  it('refuses a plain member', async () => {
    const t = build();

    await expect(
      t.service.setRevenue(ASSIGNMENT_ID, ASSIGNEE, 'Ada', input),
    ).rejects.toMatchObject({
      response: {
        message: 'Insufficient role',
        requiredRoles: ['admin', 'finance'],
        actualRole: 'member',
      },
    });
    expect(t.update).not.toHaveBeenCalled();
  });
});

describe('AssignmentsService — concurrent state changes are serialized', () => {
  it('maps a concurrent duplicate assignment to the public 409 contract', async () => {
    const t = build();
    t.tx.episodeAssignment.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('unique violation', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    t.prisma.episodeAssignment.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'as-winner' } as never);

    await expect(
      t.service.add(EPISODE_ID, FOUNDER, 'Owner', {
        userId: ASSIGNEE,
      }),
    ).rejects.toMatchObject({
      response: {
        message: 'User is already assigned to this episode',
        existingAssignmentId: 'as-winner',
      },
    });

    expect(t.notifications.send).not.toHaveBeenCalled();
    expect(t.conversations.persistSystem).not.toHaveBeenCalled();
  });

  it('rechecks the locked assignment before a second review writes effects', async () => {
    const t = build({
      assignment: { status: 'submitted' },
      // Another request completed its review after our preflight read but
      // before this transaction acquired the episode + assignment locks.
      lockedAssignment: { status: 'approved' },
    });

    await expect(
      t.service.approve(ASSIGNMENT_ID, FOUNDER, 'Owner'),
    ).rejects.toMatchObject({
      response: {
        message: 'Assignment is not in submitted state',
        currentStatus: 'approved',
      },
    });

    expect(t.update).not.toHaveBeenCalled();
    expect(t.notifications.send).not.toHaveBeenCalled();
    expect(t.conversations.persistSystem).not.toHaveBeenCalled();
  });
});

/**
 * Doc §6.1 — "成员加入、退出和任务状态系统消息". The four assignment
 * transitions surface in the crew group chat; doc §5.3 step 7 forbids
 * the chat from carrying the money.
 */
describe('AssignmentsService — crew chat sees task status, never money', () => {
  const EXPECTED_PARAMS = {
    episodeId: EPISODE_ID,
    episodeNumber: 3,
    assignmentId: ASSIGNMENT_ID,
    userId: ASSIGNEE,
  };

  it('add() posts crew.episode.assigned inside the assignment tx', async () => {
    const t = build();

    await t.service.add(EPISODE_ID, FOUNDER, 'Fo', { userId: ASSIGNEE });

    expect(t.systemCalls).toEqual([
      {
        conversationId: CONVERSATION_ID,
        kind: 'crew.episode.assigned',
        // add() creates a fresh row, so the id is the created one.
        params: { ...EXPECTED_PARAMS, assignmentId: 'as-new' },
        tx: t.tx,
      },
    ]);
  });

  it('submit() posts crew.episode.submitted inside the submission tx', async () => {
    const t = build();

    await t.service.submit(ASSIGNMENT_ID, ASSIGNEE, 'Ada', {
      url: 'https://cdn.example/cut-03.mp4',
    });

    expect(t.systemCalls).toEqual([
      {
        conversationId: CONVERSATION_ID,
        kind: 'crew.episode.submitted',
        params: EXPECTED_PARAMS,
        tx: t.tx,
      },
    ]);
  });

  it('posts submitted even when the founder submits their own work', async () => {
    // The founder-submits case skips the NOTIFICATION (no self-pings)
    // but the crew timeline is shared — the rest of the crew still
    // needs the event.
    const t = build({
      assignment: { userId: FOUNDER, status: 'in_progress' },
    });

    await t.service.submit(ASSIGNMENT_ID, FOUNDER, 'Fo', {});

    expect(t.notifications.send).not.toHaveBeenCalled();
    expect(t.systemCalls.map((c) => c.kind)).toEqual([
      'crew.episode.submitted',
    ]);
  });

  it('approve() posts crew.episode.approved', async () => {
    const t = build({ assignment: { status: 'submitted' } });

    await t.service.approve(ASSIGNMENT_ID, FOUNDER, 'Fo');

    expect(t.systemCalls.map((c) => c.kind)).toEqual(['crew.episode.approved']);
  });

  it('reject() posts crew.episode.rejected and keeps the critique out of the chat', async () => {
    const t = build({ assignment: { status: 'submitted' } });

    await t.service.reject(ASSIGNMENT_ID, FOUNDER, 'Fo', {
      reason: 'Lip sync drifts after 00:12 and the palette is off-model.',
    });

    expect(t.systemCalls).toEqual([
      {
        conversationId: CONVERSATION_ID,
        kind: 'crew.episode.rejected',
        params: EXPECTED_PARAMS,
        tx: t.tx,
      },
    ]);
    // The reason rides the private notification only.
    expect(JSON.stringify(t.systemCalls)).not.toContain('Lip sync drifts');
  });

  it('setRevenue() posts NOTHING — the chat never publishes earnings', async () => {
    const t = build();

    await t.service.setRevenue(ASSIGNMENT_ID, FINANCE, 'Fin', {
      amount: 220000,
      currency: 'CNY',
    });

    expect(t.systemCalls).toEqual([]);
    expect(t.conversations.openCrewConversation).not.toHaveBeenCalled();
  });

  it('never puts an amount or currency in any status message', async () => {
    const t = build({ assignment: { status: 'submitted' } });

    await t.service.approve(ASSIGNMENT_ID, FOUNDER, 'Fo');

    for (const call of t.systemCalls) {
      expect(Object.keys(call.params)).toEqual([
        'episodeId',
        'episodeNumber',
        'assignmentId',
        'userId',
      ]);
    }
  });

  it('broadcasts the status message only after the tx commits', async () => {
    const order: string[] = [];
    const t = build({ assignment: { status: 'submitted' } });
    t.prisma.$transaction.mockImplementationOnce(
      async (cb: (client: unknown) => Promise<unknown>) => {
        const r = await cb(t.tx);
        order.push('commit');
        return r;
      },
    );
    t.conversations.broadcastMessage.mockImplementation(() => {
      order.push('broadcast');
      return Promise.resolve();
    });

    await t.service.approve(ASSIGNMENT_ID, FOUNDER, 'Fo');

    expect(order).toEqual(['commit', 'broadcast']);
  });
});
