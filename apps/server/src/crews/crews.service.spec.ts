/**
 * CrewsService ↔ crew group chat.
 *
 * Two things are under test and neither is about Prisma:
 *   1. The chat sync happens INSIDE the membership transaction. Every
 *      assertion checks the tx client was the one handed to the
 *      conversations service — if the sync ran on the outer client, a
 *      failure would commit the roster change and lose the chat.
 *   2. Ownership transfer maps membership moves — not crew roles — onto
 *      participants. Participant.role is flat `member`; only rows that
 *      actually enter or leave `crew_members` move the chat.
 */
import { CrewRoleService } from './crew-role.service';
import { CrewsService } from './crews.service';

const CREW_ID = 'crew-1';
const CONVERSATION_ID = 'conv-crew-1';
const FOUNDER = 'u-founder';
const SUCCESSOR = 'u-successor';

const CREATE_INPUT = {
  name: 'Night Shift',
  description: 'We animate after dark.',
  logo: 'https://cdn.example/logo.png',
  genres: ['scifi'],
  styles: ['2d'],
  socialLinks: [],
  showcaseWorks: [],
};

interface SyncCall {
  crewId: string;
  userId: string;
  action: 'join' | 'leave';
  tx: unknown;
}

function build(
  opts: {
    /** Existing active membership rows, keyed by userId. */
    members?: Record<string, { id: string }>;
    founderId?: string;
  } = {},
) {
  const members = opts.members ?? {};
  const founderId = opts.founderId ?? FOUNDER;
  const conversation = { id: CONVERSATION_ID };

  /** Everything toCrewDTO() dereferences. */
  const crewRow = {
    id: CREW_ID,
    name: CREATE_INPUT.name,
    description: CREATE_INPUT.description,
    logo: CREATE_INPUT.logo,
    tagline: null,
    genres: CREATE_INPUT.genres,
    styles: CREATE_INPUT.styles,
    socialLinks: null,
    showcaseWorks: null,
    founderId,
    listingStatus: 'listed',
    listedAt: new Date('2026-07-01T00:00:00.000Z'),
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    version: 1,
    deletedAt: null,
  };

  const tx = {
    crew: {
      create: jest.fn().mockResolvedValue(crewRow),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue({ version: 2, deletedAt: null }),
    },
    crewMember: {
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn(({ where }: { where: { userId: string } }) =>
        Promise.resolve(members[where.userId] ?? null),
      ),
    },
  };

  const prisma = {
    crew: {
      findFirst: jest.fn().mockResolvedValue({ founderId, deletedAt: null }),
      findUnique: jest.fn().mockResolvedValue({ ...crewRow, version: 2 }),
    },
    crewMember: {
      findFirst: jest.fn(({ where }: { where: { userId: string } }) =>
        Promise.resolve(members[where.userId] ?? null),
      ),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    crewPosition: {
      groupBy: jest.fn().mockResolvedValue([]),
      findMany: jest.fn().mockResolvedValue([]),
    },
    crewApplication: { count: jest.fn().mockResolvedValue(0) },
    $transaction: jest.fn((cb: (client: unknown) => unknown) => cb(tx)),
  };

  const syncCalls: SyncCall[] = [];
  const systemCalls: Array<{ kind: string; params: unknown; tx: unknown }> = [];
  const conversations = {
    openCrewConversation: jest.fn().mockResolvedValue(conversation),
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
        _conversationId: string,
        kind: string,
        params: unknown,
        txArg: unknown,
      ) => {
        systemCalls.push({ kind, params, tx: txArg });
        return Promise.resolve({ id: `msg-${systemCalls.length}` });
      },
    ),
    broadcastMessage: jest.fn().mockResolvedValue(undefined),
  };

  return {
    prisma,
    tx,
    conversations,
    syncCalls,
    systemCalls,
    // The real role resolver over the same prisma double — the crew
    // chat resolver gates on it, and a stub would be a second, laxer
    // copy of the predicate these tests care about.
    service: new CrewsService(
      prisma as never,
      conversations as never,
      new CrewRoleService(prisma as never),
    ),
  };
}

describe('CrewsService.create — the crew chat is born with the crew', () => {
  it('opens the crew conversation and joins the founder inside the create tx', async () => {
    const t = build();

    await t.service.create(FOUNDER, CREATE_INPUT as never);

    expect(t.conversations.openCrewConversation).toHaveBeenCalledWith(
      CREW_ID,
      t.tx,
    );
    expect(t.syncCalls).toEqual([
      { crewId: CREW_ID, userId: FOUNDER, action: 'join', tx: t.tx },
    ]);
  });

  it('stays silent — the founder joining their own new empty chat is not an event', async () => {
    const t = build();

    await t.service.create(FOUNDER, CREATE_INPUT as never);

    expect(t.systemCalls).toEqual([]);
  });

  it('keeps core crew creation available during the production rollout gate', async () => {
    const previous = process.env.CREW_CHAT_WRITES_ENABLED;
    process.env.CREW_CHAT_WRITES_ENABLED = 'false';
    try {
      const t = build();

      await expect(
        t.service.create(FOUNDER, CREATE_INPUT as never),
      ).resolves.toMatchObject({ id: CREW_ID });

      expect(t.tx.crewMember.create).toHaveBeenCalled();
      expect(t.conversations.openCrewConversation).not.toHaveBeenCalled();
      expect(t.syncCalls).toEqual([]);
    } finally {
      if (previous === undefined) {
        delete process.env.CREW_CHAT_WRITES_ENABLED;
      } else {
        process.env.CREW_CHAT_WRITES_ENABLED = previous;
      }
    }
  });

  it('rolls the crew back when the chat sync fails', async () => {
    const t = build();
    t.conversations.syncCrewParticipant.mockRejectedValueOnce(
      new Error('redis is on fire'),
    );
    // The real $transaction propagates the rejection and rolls back; the
    // mock just has to let the error escape for that to be provable.
    t.prisma.$transaction.mockImplementationOnce(
      async (cb: (client: unknown) => Promise<unknown>) => cb(t.tx),
    );

    await expect(
      t.service.create(FOUNDER, CREATE_INPUT as never),
    ).rejects.toThrow('redis is on fire');
  });
});

describe('CrewsService.transferOwnership — which branch moves the chat', () => {
  it('demoting the outgoing owner does NOT remove them from the chat', async () => {
    const t = build({
      members: {
        [FOUNDER]: { id: 'm-founder' },
        [SUCCESSOR]: { id: 'm-succ' },
      },
    });

    await t.service.transferOwnership(CREW_ID, SUCCESSOR);

    expect(t.tx.crewMember.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'm-founder' },
        data: { roleType: 'member' },
      }),
    );
    expect(t.syncCalls).toEqual([]);
    expect(t.systemCalls).toEqual([]);
  });

  it('removing the outgoing owner takes them out of the chat and announces it', async () => {
    const t = build({
      members: {
        [FOUNDER]: { id: 'm-founder' },
        [SUCCESSOR]: { id: 'm-succ' },
      },
    });

    await t.service.transferOwnership(CREW_ID, SUCCESSOR, {
      removeOldOwner: true,
    });

    expect(t.syncCalls).toEqual([
      { crewId: CREW_ID, userId: FOUNDER, action: 'leave', tx: t.tx },
    ]);
    expect(t.systemCalls).toEqual([
      {
        kind: 'crew.member.left',
        params: { userId: FOUNDER },
        tx: t.tx,
      },
    ]);
  });

  it('promoting an existing member to owner touches nothing — they are already in the chat', async () => {
    const t = build({
      members: {
        [FOUNDER]: { id: 'm-founder' },
        [SUCCESSOR]: { id: 'm-succ' },
      },
    });

    await t.service.transferOwnership(CREW_ID, SUCCESSOR);

    expect(t.syncCalls.filter((c) => c.userId === SUCCESSOR)).toEqual([]);
  });

  it('handing the crew to an outsider joins them to the chat', async () => {
    const t = build({ members: { [FOUNDER]: { id: 'm-founder' } } });

    await t.service.transferOwnership(CREW_ID, SUCCESSOR);

    expect(t.syncCalls).toEqual([
      { crewId: CREW_ID, userId: SUCCESSOR, action: 'join', tx: t.tx },
    ]);
    expect(t.systemCalls).toEqual([
      {
        kind: 'crew.member.joined',
        params: { userId: SUCCESSOR },
        tx: t.tx,
      },
    ]);
  });

  it('broadcasts only after the transfer transaction has committed', async () => {
    const order: string[] = [];
    const t = build({ members: { [FOUNDER]: { id: 'm-founder' } } });
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

    await t.service.transferOwnership(CREW_ID, SUCCESSOR);

    expect(order).toEqual(['commit', 'broadcast']);
  });
});
