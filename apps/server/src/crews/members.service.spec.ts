/**
 * MembersService ↔ crew group chat.
 *
 * Invitation acceptance and removal are the membership edges. This suite
 * protects the removal half; invitation acceptance has its own service suite.
 *
 * The `tx` identity assertions are the point of these tests. Asserting
 * only "sync was called" would pass even if the sync ran on the outer
 * Prisma client, which is precisely the bug being guarded against.
 */
import { ListCrewMembersQuerySchema } from './dto';
import { MembersService } from './members.service';

const CREW_ID = 'crew-1';
const CREW_NAME = 'Night Shift';
const CONVERSATION_ID = 'conv-crew-1';
const OWNER = 'u-owner';
const NEWCOMER = 'u-newcomer';
const MEMBER_ROW_ID = 'm-1';

interface SyncCall {
  crewId: string;
  userId: string;
  action: 'join' | 'leave';
  tx: unknown;
}

function build(
  opts: {
    /** The member row remove() will act on. */
    member?: Record<string, unknown>;
  } = {},
) {
  const memberRow = {
    id: MEMBER_ROW_ID,
    crewId: CREW_ID,
    userId: NEWCOMER,
    status: 'active',
    joinedVia: 'invitation',
    joinedAt: new Date('2026-07-01T00:00:00.000Z'),
    suspendedAt: null,
    removedAt: null,
    version: 1,
    ownership: null,
    positions: [],
    policies: [],
    permissionOverrides: [],
    ...opts.member,
  };

  const tx = {
    crew: {
      findFirst: jest.fn().mockResolvedValue({ id: CREW_ID, name: CREW_NAME }),
    },
    $executeRaw: jest.fn().mockResolvedValue(1),
    crewMemberPosition: { deleteMany: jest.fn(), createMany: jest.fn() },
    crewMemberPolicy: { deleteMany: jest.fn(), createMany: jest.fn() },
    crewMemberPermissionOverride: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    crewMember: {
      findFirst: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    crewPosition: {
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
    },
    crewAuthorizationEvent: { create: jest.fn().mockResolvedValue({}) },
  };

  const prisma = {
    crew: {
      findFirst: jest.fn().mockResolvedValue({ id: CREW_ID, name: CREW_NAME }),
    },
    crewMember: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(memberRow),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(1),
      update: jest.fn().mockResolvedValue(memberRow),
    },
    $transaction: jest.fn((cb: (client: unknown) => unknown) => cb(tx)),
  };

  tx.crewMember.findFirst = prisma.crewMember.findFirst;

  const notifications = { send: jest.fn().mockResolvedValue({}) };
  const syncCalls: SyncCall[] = [];
  const systemCalls: Array<{
    conversationId: string;
    kind: string;
    params: unknown;
    tx: unknown;
  }> = [];
  const broadcast: string[] = [];
  const conversations = {
    openCrewConversation: jest.fn().mockResolvedValue({ id: CONVERSATION_ID }),
    syncCrewParticipant: jest.fn(
      (
        crewId: string,
        userId: string,
        action: 'join' | 'leave',
        txArg: unknown,
      ) => {
        syncCalls.push({ crewId, userId, action, tx: txArg });
        return Promise.resolve();
      },
    ),
    persistSystem: jest.fn(
      (
        conversationId: string,
        kind: string,
        params: unknown,
        txArg: unknown,
      ) => {
        systemCalls.push({ conversationId, kind, params, tx: txArg });
        return Promise.resolve({ id: `msg-${systemCalls.length}` });
      },
    ),
    broadcastMessage: jest.fn((m: { id: string }) => {
      broadcast.push(m.id);
      return Promise.resolve();
    }),
  };
  const collaboration = {
    addCrewMemberAccess: jest.fn(() => Promise.resolve()),
    removeCrewMemberAccess: jest.fn(() => Promise.resolve()),
  };
  const authorization = {
    require: jest.fn().mockResolvedValue({ memberId: 'member-owner' }),
    requireMembership: jest
      .fn()
      .mockResolvedValue({ memberId: MEMBER_ROW_ID, permissions: [] }),
  };

  return {
    prisma,
    tx,
    memberRow,
    conversations,
    syncCalls,
    systemCalls,
    broadcast,
    authorization,
    service: new MembersService(
      prisma as never,
      notifications as never,
      conversations as never,
      collaboration as never,
      authorization as never,
    ),
  };
}

describe('MembersService roster reads', () => {
  it('validates bounded cursor pagination', () => {
    expect(ListCrewMembersQuerySchema.parse({})).toEqual({
      limit: 50,
    });
    expect(
      ListCrewMembersQuerySchema.parse({ limit: '100', cursor: 'member_2' }),
    ).toEqual({
      limit: 100,
      cursor: 'member_2',
    });
    expect(ListCrewMembersQuerySchema.safeParse({ limit: 1 }).success).toBe(
      false,
    );
  });

  it('returns the current owner first and paginates the remaining roster', async () => {
    const t = build();
    const ownerRow = {
      ...t.memberRow,
      id: 'member-owner',
      userId: OWNER,
      joinedVia: 'creation',
      ownership: { crewId: CREW_ID, memberId: 'member-owner' },
      joinedAt: new Date('2026-06-01T00:00:00.000Z'),
    };
    const first = {
      ...t.memberRow,
      id: 'member-1',
      joinedAt: new Date('2026-07-01T00:00:00.000Z'),
    };
    const lookahead = {
      ...t.memberRow,
      id: 'member-2',
      userId: 'u-member-2',
      joinedAt: new Date('2026-07-02T00:00:00.000Z'),
    };
    t.prisma.crewMember.findMany.mockResolvedValue([
      ownerRow,
      first,
      lookahead,
    ]);
    t.prisma.crewMember.count.mockResolvedValue(3);

    await expect(
      t.service.list(CREW_ID, OWNER, { limit: 2 }),
    ).resolves.toMatchObject({
      items: [{ id: 'member-owner', isOwner: true }, { id: 'member-1' }],
      nextCursor: 'member-1',
      total: 3,
    });
    expect(t.prisma.crewMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
        take: 3,
      }),
    );
  });

  it('resolves additive policies and effective permissions without scanning the roster', async () => {
    const t = build();
    t.prisma.crewMember.findUnique.mockResolvedValue({
      ...t.memberRow,
      policies: [{ policyKey: 'finance' }],
    });
    t.authorization.requireMembership.mockResolvedValue({
      memberId: MEMBER_ROW_ID,
      permissions: ['finance.ledger.view'],
    });

    await expect(
      t.service.membership(CREW_ID, NEWCOMER),
    ).resolves.toMatchObject({
      userId: NEWCOMER,
      permissions: ['finance.ledger.view'],
      member: { id: MEMBER_ROW_ID, policyKeys: ['finance'] },
    });
    expect(t.prisma.crewMember.findMany).not.toHaveBeenCalled();
  });
});

describe('MembersService.remove — a removed member leaves the chat', () => {
  it('syncs a leave inside the removal transaction', async () => {
    const t = build();
    t.prisma.crewMember.findFirst.mockResolvedValue(t.memberRow);

    await t.service.remove(CREW_ID, MEMBER_ROW_ID, OWNER);

    expect(t.syncCalls).toEqual([
      { crewId: CREW_ID, userId: NEWCOMER, action: 'leave', tx: t.tx },
    ]);
  });

  it('marks them gone BEFORE writing the departure notice', async () => {
    const t = build();
    t.prisma.crewMember.findFirst.mockResolvedValue(t.memberRow);
    const order: string[] = [];
    t.conversations.syncCrewParticipant.mockImplementation(() => {
      order.push('leave');
      return Promise.resolve();
    });
    t.conversations.persistSystem.mockImplementation(() => {
      order.push('system-message');
      return Promise.resolve({ id: 'msg-1' });
    });

    await t.service.remove(CREW_ID, MEMBER_ROW_ID, OWNER);

    // Reversed, the departing member would still be an active
    // participant when the message fans out and would receive the
    // announcement of their own removal.
    expect(order).toEqual(['leave', 'system-message']);
  });

  it('announces the departure with crew.member.left', async () => {
    const t = build();
    t.prisma.crewMember.findFirst.mockResolvedValue(t.memberRow);

    await t.service.remove(CREW_ID, MEMBER_ROW_ID, OWNER);

    expect(t.systemCalls).toEqual([
      {
        conversationId: CONVERSATION_ID,
        kind: 'crew.member.left',
        params: { userId: NEWCOMER },
        tx: t.tx,
      },
    ]);
  });

  it('rolls the removal back when the chat sync fails', async () => {
    const t = build();
    t.prisma.crewMember.findFirst.mockResolvedValue(t.memberRow);
    t.conversations.syncCrewParticipant.mockRejectedValueOnce(
      new Error('participant sync exploded'),
    );

    await expect(
      t.service.remove(CREW_ID, MEMBER_ROW_ID, OWNER),
    ).rejects.toThrow('participant sync exploded');
    expect(t.broadcast).toEqual([]);
  });

  it('does not duplicate leave side effects when a concurrent remove already won', async () => {
    const t = build();
    t.prisma.crewMember.findFirst.mockResolvedValue(t.memberRow);
    t.tx.crewMember.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      t.service.remove(CREW_ID, MEMBER_ROW_ID, OWNER),
    ).rejects.toMatchObject({
      response: { message: 'Member was already removed' },
    });
    expect(t.syncCalls).toEqual([]);
    expect(t.systemCalls).toEqual([]);
  });
});
