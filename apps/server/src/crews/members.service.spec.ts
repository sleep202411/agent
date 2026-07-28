/**
 * MembersService ↔ crew group chat.
 *
 * Add and remove are the two owner-driven membership edges. Both must
 * move the ConversationParticipant inside the SAME transaction as the
 * `crew_members` write — otherwise a chat failure leaves someone who can
 * post in a crew they were never added to, or a removed member still
 * receiving broadcasts.
 *
 * The `tx` identity assertions are the point of these tests. Asserting
 * only "sync was called" would pass even if the sync ran on the outer
 * Prisma client, which is precisely the bug being guarded against.
 */
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
    roleType: 'animator',
    positionId: null,
    via: 'manual',
    isFinance: false,
    joinedAt: new Date('2026-07-01T00:00:00.000Z'),
    removedAt: null,
    ...opts.member,
  };

  const tx = {
    crewMember: {
      create: jest.fn().mockResolvedValue({ ...memberRow, id: 'm-new' }),
      update: jest.fn().mockResolvedValue(memberRow),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    crewPosition: {
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
    },
  };

  const prisma = {
    crew: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: CREW_ID, founderId: OWNER, name: CREW_NAME }),
    },
    crewMember: {
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue(memberRow),
    },
    $transaction: jest.fn((cb: (client: unknown) => unknown) => cb(tx)),
  };

  const notifications = { send: jest.fn().mockResolvedValue({}) };
  const users = {
    lookupByContact: jest.fn().mockResolvedValue({
      userId: NEWCOMER,
      isCrewMember: false,
      isCrewFounder: false,
    }),
  };

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

  return {
    prisma,
    tx,
    memberRow,
    conversations,
    syncCalls,
    systemCalls,
    broadcast,
    service: new MembersService(
      prisma as never,
      notifications as never,
      users as never,
      conversations as never,
    ),
  };
}

describe('MembersService.add — an added member joins the chat', () => {
  const input = { account: 'ada@example.com', roleType: 'animator' };

  it('syncs the participant inside the membership transaction', async () => {
    const t = build();

    await t.service.add(CREW_ID, OWNER, 'cookie', input as never);

    expect(t.syncCalls).toEqual([
      { crewId: CREW_ID, userId: NEWCOMER, action: 'join', tx: t.tx },
    ]);
  });

  it('announces the join with crew.member.joined on the same tx', async () => {
    const t = build();

    await t.service.add(CREW_ID, OWNER, 'cookie', input as never);

    expect(t.systemCalls).toEqual([
      {
        conversationId: CONVERSATION_ID,
        kind: 'crew.member.joined',
        params: { userId: NEWCOMER },
        tx: t.tx,
      },
    ]);
  });

  it('keeps membership writes available while crew-chat writes are gated', async () => {
    const previous = process.env.CREW_CHAT_WRITES_ENABLED;
    process.env.CREW_CHAT_WRITES_ENABLED = 'false';
    try {
      const t = build();

      await expect(
        t.service.add(CREW_ID, OWNER, 'cookie', input as never),
      ).resolves.toMatchObject({ userId: NEWCOMER });

      expect(t.tx.crewMember.create).toHaveBeenCalled();
      expect(t.conversations.openCrewConversation).not.toHaveBeenCalled();
      expect(t.syncCalls).toEqual([]);
      expect(t.systemCalls).toEqual([]);
    } finally {
      if (previous === undefined) {
        delete process.env.CREW_CHAT_WRITES_ENABLED;
      } else {
        process.env.CREW_CHAT_WRITES_ENABLED = previous;
      }
    }
  });

  it('rolls the membership back when the chat sync fails', async () => {
    const t = build();
    t.conversations.syncCrewParticipant.mockRejectedValueOnce(
      new Error('participant sync exploded'),
    );

    await expect(
      t.service.add(CREW_ID, OWNER, 'cookie', input as never),
    ).rejects.toThrow('participant sync exploded');
    // Nothing was broadcast — the write never committed.
    expect(t.broadcast).toEqual([]);
  });

  it('broadcasts only after the transaction commits', async () => {
    const order: string[] = [];
    const t = build();
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

    await t.service.add(CREW_ID, OWNER, 'cookie', input as never);

    expect(order).toEqual(['commit', 'broadcast']);
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
