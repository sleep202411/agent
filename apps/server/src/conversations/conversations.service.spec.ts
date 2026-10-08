/**
 * ConversationsService — crew group chat, broadcast scoping, read
 * cursor and send idempotency.
 *
 * These cases are about the SHAPE of what the service asks Postgres
 * for: which participants a fan-out addresses, whether the crew gate
 * runs, whether the advisory lock precedes the create. The SEMANTICS
 * that only Postgres can settle — tie-aware cursor pagination, NULL
 * author unread counting, the partial unique index — live in
 * `conversations.postgres.integration.spec.ts`, which runs against a
 * real server.
 *
 * The mock's `tx` object has a distinct identity from the root client,
 * which is how the Prisma-7-safe `isTx()` check distinguishes them.
 * Both share the same jest.fn instances, so an assertion doesn't care
 * which handle the call arrived on.
 *
 * The `crew` / `crewMember` delegates HONOUR their `where` clause
 * against the `world` fixture instead of answering a fixed value.
 * They stand in for the crew gate's `deletedAt: null` / `status: active`
 * filters, and a mock that answers the same thing
 * whatever it is asked keeps passing when the filter it represents is
 * deleted — which is worse than having no test.
 */
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../infra/db/db.module';
import type { NotificationService } from '../notification';
import { ConversationsService, crewLookupKey } from './conversations.service';
import { SendAttachmentsSchema, SendMessageSchema } from './dto';

const CREW_ID = 'crew-1';
const CONV_ID = 'conv-1';
const FOUNDER = 'u-founder';
const MEMBER = 'u-member';
const LEAVER = 'u-leaver';
const OUTSIDER = 'u-outsider';

const AT = new Date('2026-07-28T10:00:00.000Z');

function participant(userId: string, over: Record<string, unknown> = {}) {
  return {
    conversationId: CONV_ID,
    userId,
    role: 'member',
    lastReadMessageId: null,
    lastReadAt: null,
    mutedUntil: null,
    joinedAt: AT,
    leftAt: null,
    ...over,
  };
}

function crewConversation(over: Record<string, unknown> = {}) {
  return {
    id: CONV_ID,
    contextType: 'crew',
    contextId: CREW_ID,
    lookupKey: crewLookupKey(CREW_ID),
    lastMessageAt: AT,
    createdAt: AT,
    ...over,
  };
}

function message(over: Record<string, unknown> = {}) {
  return {
    id: 'm-1',
    conversationId: CONV_ID,
    authorId: MEMBER,
    type: 'text',
    body: 'hi',
    payload: null,
    clientKey: null,
    createdAt: AT,
    deletedAt: null,
    ...over,
  };
}

/**
 * The crew-side facts the gate queries. Mutable so a test can soft-delete
 * the crew or move someone out of it, rather than stubbing the answer and
 * leaving the filter untested.
 */
interface CrewWorld {
  deletedAt: Date | null;
  /** Active `crew_members` rows, including the owner membership. */
  memberUserIds: Set<string>;
}

function buildHarness() {
  const world: CrewWorld = {
    deletedAt: null,
    memberUserIds: new Set([FOUNDER, MEMBER]),
  };
  const crewVisible = (where: { deletedAt?: Date | null }) =>
    !(where.deletedAt === null && world.deletedAt !== null);

  const delegates = {
    conversation: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    conversationParticipant: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      upsert: jest.fn().mockResolvedValue({}),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    message: {
      findUnique: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    conversationRealtimeOutbox: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    crewAssetNode: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
    },
    mediaAsset: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    crewTask: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    crew: {
      findFirst: jest.fn(
        ({ where }: { where: { id: string; deletedAt?: Date | null } }) =>
          Promise.resolve(
            where.id === CREW_ID && crewVisible(where) ? { id: CREW_ID } : null,
          ),
      ),
      findMany: jest.fn(
        ({
          where,
        }: {
          where: { id: { in: string[] }; deletedAt?: Date | null };
        }) =>
          Promise.resolve(
            where.id.in.includes(CREW_ID) && crewVisible(where)
              ? [{ id: CREW_ID }]
              : [],
          ),
      ),
    },
    crewMember: {
      findFirst: jest.fn(
        ({
          where,
        }: {
          where: { crewId: string; userId: string; status?: string };
        }) =>
          Promise.resolve(
            where.crewId === CREW_ID && world.memberUserIds.has(where.userId)
              ? { id: `cm-${where.userId}` }
              : null,
          ),
      ),
      // Two callers, two mirrored shapes. `filterLiveCrewRows` asks
      // "which of these crews is this ONE user in" (crewId: {in},
      // scalar userId); `liveCrewRecipients` asks "which of these
      // users is in this ONE crew" (scalar crewId, userId: {in}).
      // Answering only one of them would let the other silently pass
      // a query this double never inspected.
      findMany: jest.fn(
        ({
          where,
        }: {
          where: {
            crewId: string | { in: string[] };
            userId?: string | { in: string[] };
            status?: string;
          };
        }) => {
          if (typeof where.crewId === 'string') {
            // `openCrewConversation` seeds the whole roster and asks
            // only by crewId. The live-recipient gate narrows by a
            // user-id set. Honour both shapes.
            if (where.userId === undefined) {
              return Promise.resolve(
                where.crewId === CREW_ID
                  ? [...world.memberUserIds].map((userId) => ({ userId }))
                  : [],
              );
            }
            const asked =
              typeof where.userId === 'string'
                ? [where.userId]
                : where.userId.in;
            return Promise.resolve(
              where.crewId === CREW_ID
                ? asked
                    .filter((u) => world.memberUserIds.has(u))
                    .map((userId) => ({ userId }))
                : [],
            );
          }
          return Promise.resolve(
            where.crewId.in.includes(CREW_ID) &&
              typeof where.userId === 'string' &&
              world.memberUserIds.has(where.userId)
              ? [{ crewId: CREW_ID }]
              : [],
          );
        },
      ),
    },
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  // A distinct object from the injected root client represents the
  // interactive transaction callback client.
  const tx = { ...delegates };
  const prisma = {
    ...delegates,
    $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
  };
  const realtime = {
    publishUserFrame: jest.fn().mockResolvedValue(undefined),
    publishCrewMessage: jest.fn().mockResolvedValue(undefined),
    issueUserGrant: jest.fn(),
    issueCrewGrant: jest.fn(),
  };
  const notifications = { send: jest.fn().mockResolvedValue({}) };
  const service = new ConversationsService(
    prisma as unknown as PrismaService,
    realtime,
    notifications as unknown as NotificationService,
  );
  return { service, prisma, tx, delegates, realtime, notifications, world };
}

/** `jest.Mock.mock.calls` is `any[][]`; restate the arguments we passed. */
function callsOf<A extends unknown[]>(fn: jest.Mock): A[] {
  return fn.mock.calls as A[];
}

/** User channels the service published to, in call order. */
function publishedChannels(realtime: {
  publishUserFrame: jest.Mock;
}): string[] {
  return callsOf<[string, unknown, string]>(realtime.publishUserFrame).map(
    (c) => `conversation:user:${c[0]}`,
  );
}

describe('crewLookupKey', () => {
  it('is the crew-scoped lookup token the whole platform agrees on', () => {
    expect(crewLookupKey('abc')).toBe('crew:abc');
  });
});

describe('openCrewConversation', () => {
  it('creates the chat under an advisory lock taken BEFORE the insert', async () => {
    const { service, prisma, delegates } = buildHarness();
    delegates.conversation.findUnique.mockResolvedValue(null);
    delegates.conversation.create.mockResolvedValue(crewConversation());

    const order: string[] = [];
    delegates.$executeRaw.mockImplementation(() => {
      order.push('lock');
      return Promise.resolve(1);
    });
    delegates.conversation.create.mockImplementation(() => {
      order.push('create');
      return Promise.resolve(crewConversation());
    });

    const conv = await service.openCrewConversation(CREW_ID);

    expect(conv.id).toBe(CONV_ID);
    expect(order).toEqual(['lock', 'create']);
    const lockSql = callsOf<[Prisma.Sql]>(delegates.$executeRaw)[0][0];
    expect(lockSql.sql).toContain('pg_advisory_xact_lock');
    expect(lockSql.sql).toContain('hashtextextended');
    expect(lockSql.values).toEqual([crewLookupKey(CREW_ID)]);
    const createArgs = callsOf<
      [
        {
          data: {
            contextType: string;
            contextId: string;
            lookupKey: string;
          };
        },
      ]
    >(delegates.conversation.create)[0][0];
    expect(createArgs.data).toMatchObject({
      contextType: 'crew',
      contextId: CREW_ID,
      lookupKey: crewLookupKey(CREW_ID),
    });
    const createManyArgs = callsOf<
      [
        {
          data: Array<{
            conversationId: string;
            userId: string;
            role: string;
          }>;
          skipDuplicates: boolean;
        },
      ]
    >(delegates.conversationParticipant.createMany)[0][0];
    expect(createManyArgs.data).toEqual(
      expect.arrayContaining([
        {
          conversationId: CONV_ID,
          userId: FOUNDER,
          role: 'member',
        },
        {
          conversationId: CONV_ID,
          userId: MEMBER,
          role: 'member',
        },
      ]),
    );
    expect(createManyArgs.skipDuplicates).toBe(true);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('seeds every active member when a pre-chat crew opens its first conversation', async () => {
    const { service, delegates, world } = buildHarness();
    world.memberUserIds.add(LEAVER);
    delegates.conversation.findUnique.mockResolvedValue(null);
    delegates.conversation.create.mockResolvedValue(crewConversation());

    await service.openCrewConversation(CREW_ID);

    const createManyArgs = callsOf<
      [
        {
          data: Array<{
            conversationId: string;
            userId: string;
            role: string;
          }>;
          skipDuplicates: boolean;
        },
      ]
    >(delegates.conversationParticipant.createMany)[0][0];
    expect(createManyArgs.data).toEqual(
      expect.arrayContaining(
        [FOUNDER, MEMBER, LEAVER].map((userId) => ({
          conversationId: CONV_ID,
          userId,
          role: 'member',
        })),
      ),
    );
    expect(createManyArgs.skipDuplicates).toBe(true);
  });

  it('returns the existing chat without locking or inserting', async () => {
    const { service, prisma, delegates } = buildHarness();
    delegates.conversation.findUnique.mockResolvedValue(crewConversation());

    await expect(service.openCrewConversation(CREW_ID)).resolves.toMatchObject({
      id: CONV_ID,
    });
    expect(delegates.$executeRaw).not.toHaveBeenCalled();
    expect(delegates.conversation.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('yields to the racing creator found under the lock instead of inserting a second row', async () => {
    const { service, delegates } = buildHarness();
    delegates.conversation.findUnique
      .mockResolvedValueOnce(null) // unlocked fast path
      .mockResolvedValueOnce(crewConversation({ id: 'conv-winner' })); // under lock

    await expect(service.openCrewConversation(CREW_ID)).resolves.toMatchObject({
      id: 'conv-winner',
    });
    expect(delegates.$executeRaw).toHaveBeenCalledTimes(1);
    expect(delegates.conversation.create).not.toHaveBeenCalled();
  });
});

describe('syncCrewParticipant', () => {
  it('joins with a parameterized SQL upsert whose conflict branch only clears leftAt', async () => {
    const { service, delegates, tx } = buildHarness();
    delegates.conversation.findUnique.mockResolvedValue(crewConversation());

    await service.syncCrewParticipant(CREW_ID, MEMBER, 'join', tx as never);

    const insert = callsOf<[Prisma.Sql]>(delegates.$executeRaw)
      .map(([sql]) => sql)
      .find((sql) => sql.sql.includes('INSERT INTO conversation_participants'));
    expect(insert).toBeDefined();
    expect(insert?.sql).toContain('ON CONFLICT (conversation_id, user_id)');
    expect(insert?.sql).toContain('DO UPDATE SET left_at = NULL');
    expect(insert?.values).toEqual([CONV_ID, MEMBER, 'member', CONV_ID]);
    expect(delegates.conversationParticipant.upsert).not.toHaveBeenCalled();
  });

  it('copies the newest pre-join cursor inside PostgreSQL in the same total order as history', async () => {
    const { service, delegates, tx } = buildHarness();
    delegates.conversation.findUnique.mockResolvedValue(crewConversation());

    await service.syncCrewParticipant(CREW_ID, MEMBER, 'join', tx as never);

    const insert = callsOf<[Prisma.Sql]>(delegates.$executeRaw)
      .map(([sql]) => sql)
      .find((sql) => sql.sql.includes('INSERT INTO conversation_participants'));
    expect(insert?.sql).toContain('latest.id');
    expect(insert?.sql).toContain('latest.created_at');
    expect(insert?.sql).toContain('ORDER BY m.created_at DESC, m.id DESC');
    expect(delegates.message.findFirst).not.toHaveBeenCalled();
  });

  it('does not resurrect a removed member when a stale join wins the advisory lock late', async () => {
    const { service, delegates, tx, world } = buildHarness();
    world.memberUserIds.delete(MEMBER);
    delegates.conversation.findUnique.mockResolvedValue({ id: CONV_ID });

    await service.syncCrewParticipant(CREW_ID, MEMBER, 'join', tx as never);

    const updateArgs = callsOf<
      [
        {
          where: {
            conversationId: string;
            userId: string;
            leftAt: Date | null;
          };
          data: { leftAt: Date };
        },
      ]
    >(delegates.conversationParticipant.updateMany)[0][0];
    expect(updateArgs.where).toEqual({
      conversationId: CONV_ID,
      userId: MEMBER,
      leftAt: null,
    });
    expect(updateArgs.data.leftAt).toBeInstanceOf(Date);
    expect(delegates.conversation.create).not.toHaveBeenCalled();
    expect(
      callsOf<[Prisma.Sql]>(delegates.$executeRaw).some(([sql]) =>
        sql.sql.includes('INSERT INTO conversation_participants'),
      ),
    ).toBe(false);
  });

  it('leaves by stamping leftAt — the row and its read cursor survive', async () => {
    const { service, delegates, tx } = buildHarness();
    delegates.conversation.findUnique.mockResolvedValue({ id: CONV_ID });

    await service.syncCrewParticipant(CREW_ID, LEAVER, 'leave', tx as never);

    const updateArgs = callsOf<
      [
        {
          where: {
            conversationId: string;
            userId: string;
            leftAt: Date | null;
          };
          data: { leftAt: Date };
        },
      ]
    >(delegates.conversationParticipant.updateMany)[0][0];
    expect(updateArgs.where).toEqual({
      conversationId: CONV_ID,
      userId: LEAVER,
      leftAt: null,
    });
    expect(updateArgs.data.leftAt).toBeInstanceOf(Date);
    expect(delegates.conversationParticipant.delete).not.toHaveBeenCalled();
    expect(delegates.conversationParticipant.deleteMany).not.toHaveBeenCalled();
  });

  it('does not conjure a chat for a crew that never had one when someone leaves', async () => {
    const { service, delegates, tx } = buildHarness();
    delegates.conversation.findUnique.mockResolvedValue(null);

    await service.syncCrewParticipant(CREW_ID, LEAVER, 'leave', tx as never);

    expect(delegates.conversation.create).not.toHaveBeenCalled();
    expect(delegates.$executeRaw).toHaveBeenCalledTimes(1);
    expect(delegates.conversationParticipant.updateMany).not.toHaveBeenCalled();
  });
});

describe('broadcast fan-out', () => {
  it('never addresses a departed participant on message.created', async () => {
    const { service, delegates, realtime } = buildHarness();
    delegates.conversation.findUnique.mockImplementation(
      ({ include }: { include?: { participants?: { where?: unknown } } }) => {
        expect(include?.participants).toEqual({ where: { leftAt: null } });
        return Promise.resolve({
          ...crewConversation(),
          participants: [participant(FOUNDER), participant(MEMBER)],
        });
      },
    );
    delegates.$queryRaw.mockResolvedValue([
      { userId: FOUNDER, unread: 3 },
      { userId: MEMBER, unread: 0 },
    ]);

    await service.broadcastMessage(message() as never);

    expect(publishedChannels(realtime).sort()).toEqual([
      `conversation:user:${FOUNDER}`,
      `conversation:user:${MEMBER}`,
    ]);
  });

  it('costs ONE grouped unread query regardless of crew size, and keeps unreadCount per recipient', async () => {
    const { service, delegates, realtime, world } = buildHarness();
    const members = Array.from({ length: 30 }, (_, i) => `u-${i}`);
    // All 30 are really in the crew — this test is about the shape of
    // the fan-out, not about who is entitled to it.
    members.forEach((u) => world.memberUserIds.add(u));
    delegates.conversation.findUnique.mockResolvedValue({
      ...crewConversation(),
      participants: members.map((u) => participant(u)),
    });
    delegates.$queryRaw.mockResolvedValue(
      members.map((u, i) => ({ userId: u, unread: i })),
    );

    await service.broadcastMessage(message() as never);

    expect(delegates.$queryRaw).toHaveBeenCalledTimes(1);
    expect(delegates.message.count).not.toHaveBeenCalled();
    expect(realtime.publishUserFrame).toHaveBeenCalledTimes(30);
    const frames = callsOf<[string, { data: { unreadCount: number } }, string]>(
      realtime.publishUserFrame,
    ).map((c) => c[1]);
    expect(frames.map((f) => f.data.unreadCount)).toEqual(
      members.map((_, i) => i),
    );
  });

  it('does not fan out to someone the crew removed, even while their projection still looks active', async () => {
    // The projection is what goes stale — a missed sync, or a crew
    // soft-deleted with no `leftAt` written anywhere. `leftAt: null`
    // alone would hand this frame, message body and all, to someone
    // who is no longer in the crew.
    const { service, delegates, realtime, world } = buildHarness();
    world.memberUserIds.delete(MEMBER);
    delegates.conversation.findUnique.mockResolvedValue({
      ...crewConversation(),
      participants: [participant(FOUNDER), participant(MEMBER)],
    });

    await service.broadcastMessage(message() as never);

    expect(publishedChannels(realtime)).toEqual([
      `conversation:user:${FOUNDER}`,
    ]);
  });

  it('publishes to nobody once the crew is soft-deleted', async () => {
    const { service, delegates, realtime, world } = buildHarness();
    world.deletedAt = AT;
    delegates.conversation.findUnique.mockResolvedValue({
      ...crewConversation(),
      participants: [participant(FOUNDER), participant(MEMBER)],
    });

    await service.broadcastMessage(message() as never);

    expect(realtime.publishUserFrame).not.toHaveBeenCalled();
    // And no unread work was done for a thread nobody may receive.
    expect(delegates.$queryRaw).not.toHaveBeenCalled();
  });

  it('leaves service and order fan-out on the projection alone — no crew queries', async () => {
    const { service, delegates, realtime } = buildHarness();
    delegates.conversation.findUnique.mockResolvedValue({
      ...crewConversation({ contextType: 'service', contextId: 'svc-1' }),
      participants: [participant(FOUNDER), participant(MEMBER)],
    });

    await service.broadcastMessage(message() as never);

    expect(delegates.crew.findFirst).not.toHaveBeenCalled();
    expect(realtime.publishUserFrame).toHaveBeenCalledTimes(2);
  });

  it('publishes asset invalidations only to the live crew roster', async () => {
    const { service, realtime } = buildHarness();

    await service.broadcastCrewAssetChange(
      CREW_ID,
      '01910d50-4c88-7c78-92d4-16892c06a001',
      'updated',
      MEMBER,
    );

    expect(publishedChannels(realtime).sort()).toEqual([
      `conversation:user:${FOUNDER}`,
      `conversation:user:${MEMBER}`,
    ]);
    const frames = callsOf<
      [
        string,
        {
          event: string;
          data: {
            crewId: string;
            nodeId: string;
            action: string;
            actorUserId: string;
          };
        },
        string,
      ]
    >(realtime.publishUserFrame);
    expect(frames[0][1]).toEqual({
      event: 'crew.asset.changed',
      data: {
        crewId: CREW_ID,
        nodeId: '01910d50-4c88-7c78-92d4-16892c06a001',
        action: 'updated',
        actorUserId: MEMBER,
      },
    });
  });

  it('never addresses a departed participant on context.changed', async () => {
    const { service, delegates } = buildHarness();
    delegates.conversationParticipant.findMany.mockResolvedValue([
      { userId: FOUNDER },
    ]);

    await service.broadcastContextChange({
      conversation: crewConversation() as never,
      from: 'service' as never,
      to: 'order' as never,
    });

    const findManyArgs = callsOf<[{ where: { leftAt: Date | null } }]>(
      delegates.conversationParticipant.findMany,
    )[0][0];
    expect(findManyArgs.where.leftAt).toBeNull();
  });
});

describe('markRead', () => {
  /**
   * A plain service thread — the cursor mechanics below are not about
   * crews, but markRead resolves the conversation now (the crew gate),
   * so it has to exist.
   */
  function serviceThread(
    delegates: ReturnType<typeof buildHarness>['delegates'],
  ) {
    delegates.conversation.findUnique.mockResolvedValue({
      contextType: 'service',
      contextId: 'svc-1',
    });
  }

  function cursorAdvanced(
    delegates: ReturnType<typeof buildHarness>['delegates'],
    userId: string,
    messageId: string,
  ) {
    delegates.$queryRaw.mockResolvedValue([
      participant(userId, {
        lastReadMessageId: messageId,
        lastReadAt: AT,
      }),
    ]);
  }

  it('refuses a removed participant before revealing whether the message exists', async () => {
    const { service, delegates, realtime } = buildHarness();
    delegates.conversationParticipant.findUnique.mockResolvedValue(
      participant(LEAVER, { leftAt: AT }),
    );

    await expect(service.markRead(CONV_ID, LEAVER, 'm-1')).rejects.toThrow(
      NotFoundException,
    );
    expect(delegates.message.findUnique).not.toHaveBeenCalled();
    expect(delegates.$executeRaw).not.toHaveBeenCalled();
    expect(realtime.publishUserFrame).not.toHaveBeenCalled();
  });

  it('advances on a (createdAt, id) tuple so a message sharing the cursor millisecond still counts', async () => {
    const { service, delegates } = buildHarness();
    serviceThread(delegates);
    delegates.conversationParticipant.findUnique.mockResolvedValue(
      participant(MEMBER, { lastReadAt: AT, lastReadMessageId: 'm-aaa' }),
    );
    delegates.message.findUnique.mockResolvedValue(
      message({ id: 'm-bbb', createdAt: AT }),
    );
    cursorAdvanced(delegates, MEMBER, 'm-bbb');

    await service.markRead(CONV_ID, MEMBER, 'm-bbb');

    const [[sql]] = callsOf<[Prisma.Sql]>(delegates.$queryRaw);
    expect(sql.sql).toContain('last_read_at = m.created_at');
    expect(sql.sql).toContain(
      "(p.last_read_at, COALESCE(p.last_read_message_id, ''))",
    );
    expect(sql.sql).toContain('(m.created_at, m.id)');
    expect(sql.sql).toContain('RETURNING');
    expect(sql.values).toEqual([CONV_ID, MEMBER, 'm-bbb', CONV_ID]);
  });

  it('publishes read receipts to active participants only', async () => {
    const { service, delegates, realtime } = buildHarness();
    serviceThread(delegates);
    delegates.conversationParticipant.findUnique.mockResolvedValue(
      participant(MEMBER),
    );
    delegates.message.findUnique.mockResolvedValue(message());
    delegates.conversationParticipant.findMany.mockResolvedValue([
      { userId: MEMBER },
      { userId: FOUNDER },
    ]);
    cursorAdvanced(delegates, MEMBER, 'm-1');

    await service.markRead(CONV_ID, MEMBER, 'm-1');

    expect(delegates.conversationParticipant.findMany).toHaveBeenCalledWith({
      where: { conversationId: CONV_ID, leftAt: null },
      select: { userId: true },
    });
    expect(publishedChannels(realtime)).toHaveLength(2);
  });

  it('does not publish a crew read receipt to a stale projected outsider', async () => {
    const { service, delegates, realtime } = buildHarness();
    delegates.conversationParticipant.findUnique.mockResolvedValue(
      participant(MEMBER),
    );
    delegates.conversation.findUnique.mockResolvedValue({
      ...crewConversation(),
      participants: [participant(MEMBER)],
    });
    delegates.message.findUnique.mockResolvedValue(message());
    delegates.conversationParticipant.findMany.mockResolvedValue([
      { userId: MEMBER },
      { userId: OUTSIDER },
    ]);
    cursorAdvanced(delegates, MEMBER, 'm-1');

    await service.markRead(CONV_ID, MEMBER, 'm-1');

    expect(publishedChannels(realtime)).toEqual([
      `conversation:user:${MEMBER}`,
    ]);
  });

  /**
   * markRead was the one content-adjacent entry point still gated on
   * `assertParticipant` alone. A crew outsider whose participant row
   * had not been cleaned up could advance a cursor the whole crew
   * sees, push a `read.advanced` receipt into the thread, and — from
   * "message not found" vs "conversation not found" — tell an existing
   * thread from a missing one.
   */
  it('404s a crew outsider whose participant row still looks active', async () => {
    const { service, delegates, realtime, world } = buildHarness();
    delegates.conversationParticipant.findUnique.mockResolvedValue(
      participant(OUTSIDER),
    );
    delegates.conversation.findUnique.mockResolvedValue({
      contextType: 'crew',
      contextId: CREW_ID,
    });
    // The message is real and in this thread, and there are receipts to
    // send: without the crew gate this call SUCCEEDS, which is what
    // makes the failure below mean what it says.
    delegates.message.findUnique.mockResolvedValue(message());
    delegates.conversationParticipant.findMany.mockResolvedValue([
      { userId: FOUNDER },
      { userId: OUTSIDER },
    ]);
    world.memberUserIds.clear();

    await expect(service.markRead(CONV_ID, OUTSIDER, 'm-1')).rejects.toThrow(
      NotFoundException,
    );
    expect(delegates.$executeRaw).not.toHaveBeenCalled();
    expect(realtime.publishUserFrame).not.toHaveBeenCalled();
  });

  it('404s once the crew is soft-deleted, for the founder too', async () => {
    const { service, delegates, world } = buildHarness();
    delegates.conversationParticipant.findUnique.mockResolvedValue(
      participant(FOUNDER),
    );
    delegates.conversation.findUnique.mockResolvedValue({
      contextType: 'crew',
      contextId: CREW_ID,
    });
    delegates.message.findUnique.mockResolvedValue(message());
    world.deletedAt = new Date('2026-07-27T00:00:00.000Z');

    await expect(service.markRead(CONV_ID, FOUNDER, 'm-1')).rejects.toThrow(
      NotFoundException,
    );
    expect(delegates.$executeRaw).not.toHaveBeenCalled();
  });

  it('still advances for an active crew member — the gate is not a wall', async () => {
    const { service, delegates } = buildHarness();
    delegates.conversationParticipant.findUnique.mockResolvedValue(
      participant(MEMBER),
    );
    delegates.conversation.findUnique.mockResolvedValue({
      contextType: 'crew',
      contextId: CREW_ID,
    });
    delegates.message.findUnique.mockResolvedValue(message());
    cursorAdvanced(delegates, MEMBER, 'm-1');

    await expect(
      service.markRead(CONV_ID, MEMBER, 'm-1'),
    ).resolves.toMatchObject({ lastReadMessageId: 'm-1' });
  });

  it('stays silent when the cursor was already at or past the target', async () => {
    const { service, delegates, realtime } = buildHarness();
    serviceThread(delegates);
    delegates.conversationParticipant.findUnique.mockResolvedValue(
      participant(MEMBER, { lastReadAt: AT, lastReadMessageId: 'm-1' }),
    );
    delegates.message.findUnique.mockResolvedValue(message());
    delegates.$queryRaw.mockResolvedValue([]);

    await service.markRead(CONV_ID, MEMBER, 'm-1');

    expect(realtime.publishUserFrame).not.toHaveBeenCalled();
  });

  it('returns the current database cursor when a lagging concurrent request advances zero rows', async () => {
    const { service, delegates, realtime } = buildHarness();
    serviceThread(delegates);
    delegates.conversationParticipant.findUnique
      .mockResolvedValueOnce(participant(MEMBER))
      .mockResolvedValueOnce(
        participant(MEMBER, {
          lastReadAt: new Date('2026-07-28T10:00:01.000Z'),
          lastReadMessageId: 'm-newer',
        }),
      );
    delegates.message.findUnique.mockResolvedValue(message({ id: 'm-older' }));
    delegates.$queryRaw.mockResolvedValue([]);

    await expect(
      service.markRead(CONV_ID, MEMBER, 'm-older'),
    ).resolves.toMatchObject({
      lastReadMessageId: 'm-newer',
    });
    expect(delegates.conversationParticipant.findUnique).toHaveBeenCalledTimes(
      2,
    );
    expect(realtime.publishUserFrame).not.toHaveBeenCalled();
  });
});

/**
 * The inbox is a crew read like any other. Its rows carry the crew's
 * name and the last message's preview, so a stale participant
 * projection leaks there exactly what it would leak in the thread —
 * and the thread's own gate never runs on this path.
 */
describe('listInbox — crew rows are re-checked against live membership', () => {
  function inboxRow(over: Record<string, unknown> = {}) {
    return {
      ...crewConversation(),
      participants: [participant(MEMBER)],
      ...over,
    };
  }

  it('drops a crew row once the crew has removed the viewer', async () => {
    const { service, delegates, world } = buildHarness();
    delegates.conversation.findMany.mockResolvedValue([inboxRow()]);
    world.memberUserIds.clear(); // removed from the crew, still projected

    const { items } = await service.listInbox(OUTSIDER, { limit: 24 });

    expect(items).toEqual([]);
  });

  it('drops a soft-deleted crew even though the viewer is still a member of it', async () => {
    const { service, delegates, world } = buildHarness();
    delegates.conversation.findMany.mockResolvedValue([inboxRow()]);
    world.deletedAt = new Date('2026-07-27T00:00:00.000Z');

    const { items } = await service.listInbox(MEMBER, { limit: 24 });

    // A leftover `crew_members` row must not resurrect a deleted crew:
    // its thread 404s on open, so a named, previewed row for it is a
    // row the reader cannot act on.
    expect(items).toEqual([]);
  });

  it('drops the owner row when the canonical membership is absent', async () => {
    const { service, delegates, world } = buildHarness();
    delegates.conversation.findMany.mockResolvedValue([inboxRow()]);
    world.memberUserIds.clear();

    const { items } = await service.listInbox(FOUNDER, { limit: 24 });

    expect(items).toEqual([]);
  });

  it('keeps an active member’s row', async () => {
    const { service, delegates, prisma } = buildHarness();
    delegates.conversation.findMany.mockResolvedValue([inboxRow()]);

    const { items } = await service.listInbox(MEMBER, { limit: 24 });

    expect(items).toHaveLength(1);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  });

  it('costs no crew queries at all on a page with no crew rows', async () => {
    const { service, delegates } = buildHarness();
    delegates.conversation.findMany.mockResolvedValue([
      inboxRow({ contextType: 'service', contextId: 'svc-1' }),
    ]);

    const { items } = await service.listInbox(MEMBER, { limit: 24 });

    expect(items).toHaveLength(1);
    expect(delegates.crew.findMany).not.toHaveBeenCalled();
    expect(delegates.crewMember.findMany).not.toHaveBeenCalled();
  });

  it('costs ONE crew query for a page however many crew rows it holds', async () => {
    const { service, delegates } = buildHarness();
    delegates.conversation.findMany.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => inboxRow({ id: `conv-${i}` })),
    );

    await service.listInbox(MEMBER, { limit: 24 });

    expect(delegates.crew.findMany).toHaveBeenCalledTimes(1);
    expect(delegates.crewMember.findMany).toHaveBeenCalledTimes(1);
  });

  it('takes the cursor from the RAW page, so a dropped row never skips the next one', async () => {
    const { service, delegates, world } = buildHarness();
    delegates.conversation.findMany.mockResolvedValue([
      inboxRow({ id: 'conv-hidden' }), // crew row the viewer lost access to
      inboxRow({ id: 'conv-keep', contextType: 'service', contextId: 'svc-1' }),
      inboxRow({ id: 'conv-next', contextType: 'service', contextId: 'svc-2' }),
    ]);
    world.memberUserIds.clear();

    const page = await service.listInbox(OUTSIDER, { limit: 2 });

    // Filtering shortens the page; it must not move the cursor, or the
    // next page would start past `conv-keep`.
    expect(page.items.map((c) => c.id)).toEqual(['conv-keep']);
    expect(page.nextCursor).toBe('conv-keep');
  });

  it('hydrates the last message with the same total order as history pagination', async () => {
    const { service, delegates } = buildHarness();
    delegates.conversation.findMany.mockResolvedValue([
      inboxRow({ participants: [participant(MEMBER)] }),
    ]);

    await service.listInbox(MEMBER, { limit: 24 });

    expect(delegates.message.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
  });
});

describe('listMessages ordering', () => {
  it('sorts on a TOTAL order — createdAt alone is not unique enough to page by', async () => {
    const { service, delegates, prisma } = buildHarness();
    delegates.conversationParticipant.findUnique.mockResolvedValue(
      participant(MEMBER),
    );
    delegates.conversation.findUnique.mockResolvedValue({
      contextType: 'service',
      contextId: 'svc-1',
    });

    await service.listMessages(CONV_ID, MEMBER, { limit: 3, cursor: 'm-9' });

    expect(delegates.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: 1,
        cursor: { id: 'm-9' },
      }),
    );
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  });
});

describe('crew membership re-check', () => {
  function arrangeCrewConversation(
    delegates: ReturnType<typeof buildHarness>['delegates'],
    viewerId: string,
  ) {
    delegates.conversationParticipant.findUnique.mockResolvedValue(
      participant(viewerId),
    );
    delegates.conversation.findUnique.mockResolvedValue({
      contextType: 'crew',
      contextId: CREW_ID,
    });
  }

  it('404s a read from someone the crew has removed, even while their participant row looks active', async () => {
    const { service, delegates } = buildHarness();
    arrangeCrewConversation(delegates, OUTSIDER);
    delegates.crewMember.findFirst.mockResolvedValue(null);

    await expect(
      service.listMessages(CONV_ID, OUTSIDER, { limit: 20 }),
    ).rejects.toThrow(NotFoundException);
    expect(delegates.message.findMany).not.toHaveBeenCalled();
  });

  it('404s a SEND from someone the crew has removed', async () => {
    const { service, delegates } = buildHarness();
    arrangeCrewConversation(delegates, OUTSIDER);
    delegates.crewMember.findFirst.mockResolvedValue(null);

    await expect(
      service.persistText(CONV_ID, OUTSIDER, 'still here?'),
    ).rejects.toThrow(NotFoundException);
    expect(delegates.message.create).not.toHaveBeenCalled();
  });

  it('404s detail for a crew outsider', async () => {
    const { service, delegates } = buildHarness();
    delegates.conversation.findUnique.mockResolvedValue({
      ...crewConversation(),
      participants: [participant(OUTSIDER)],
    });
    delegates.crewMember.findFirst.mockResolvedValue(null);

    await expect(service.detail(CONV_ID, OUTSIDER)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('returns only active participants in conversation detail', async () => {
    const { service, delegates, prisma } = buildHarness();
    delegates.conversation.findUnique.mockImplementation(
      ({ include }: { include?: unknown }) => {
        expect(include).toEqual({
          participants: { where: { leftAt: null } },
        });
        return Promise.resolve({
          ...crewConversation(),
          participants: [participant(MEMBER)],
        });
      },
    );

    await expect(service.detail(CONV_ID, MEMBER)).resolves.toBeDefined();
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  });

  it('filters a stale active participant out of crew detail using the live roster', async () => {
    const { service, delegates } = buildHarness();
    delegates.conversation.findUnique.mockResolvedValue({
      ...crewConversation(),
      participants: [
        participant(FOUNDER),
        participant(MEMBER),
        participant(OUTSIDER),
      ],
    });

    const detail = await service.detail(CONV_ID, MEMBER);

    expect(detail.participants.map((p) => p.userId).sort()).toEqual(
      [FOUNDER, MEMBER].sort(),
    );
  });

  it('revokes owner chat access when the canonical membership is absent', async () => {
    const { service, delegates, world } = buildHarness();
    arrangeCrewConversation(delegates, FOUNDER);
    world.memberUserIds.clear();

    await expect(
      service.listMessages(CONV_ID, FOUNDER, { limit: 20 }),
    ).rejects.toThrow(NotFoundException);
    expect(delegates.crewMember.findFirst).toHaveBeenCalled();
  });

  it('404s everyone once the crew is soft-deleted', async () => {
    const { service, delegates, world } = buildHarness();
    arrangeCrewConversation(delegates, FOUNDER);
    // Soft-delete the crew in the fixture rather than stubbing the
    // lookup's answer: the claim under test is that the gate filters
    // `deletedAt: null`, and a mock that returns null however it is
    // queried would keep this green with the filter deleted.
    world.deletedAt = new Date('2026-07-27T00:00:00.000Z');

    await expect(
      service.listMessages(CONV_ID, FOUNDER, { limit: 20 }),
    ).rejects.toThrow(NotFoundException);
  });

  it('skips the crew gate entirely on a service conversation', async () => {
    const { service, delegates } = buildHarness();
    delegates.conversationParticipant.findUnique.mockResolvedValue(
      participant(MEMBER, { role: 'buyer' }),
    );
    delegates.conversation.findUnique.mockResolvedValue({
      contextType: 'service',
      contextId: 'svc-1',
    });

    await service.listMessages(CONV_ID, MEMBER, { limit: 20 });

    expect(delegates.crew.findFirst).not.toHaveBeenCalled();
    expect(delegates.crewMember.findFirst).not.toHaveBeenCalled();
  });
});

describe('SendMessageSchema', () => {
  it('carries the client idempotency token across the REST boundary', () => {
    expect(SendMessageSchema.parse({ body: 'hi', clientKey: 'k1' })).toEqual({
      body: 'hi',
      clientKey: 'k1',
      mentions: [],
      tasks: [],
    });
  });

  it('rejects a token longer than the column rather than letting Postgres truncate it into a collision', () => {
    expect(() =>
      SendMessageSchema.parse({ body: 'hi', clientKey: 'x'.repeat(65) }),
    ).toThrow();
  });

  it('requires durable ids for structured crew messages', () => {
    expect(
      SendAttachmentsSchema.parse({
        attachments: [
          {
            source: 'asset',
            assetNodeId: '01910d50-4c88-7c78-92d4-16892c06a010',
          },
        ],
      }),
    ).toEqual({
      attachments: [
        {
          source: 'asset',
          assetNodeId: '01910d50-4c88-7c78-92d4-16892c06a010',
        },
      ],
      body: '',
      mentions: [],
      tasks: [],
    });
    expect(
      SendMessageSchema.parse({
        body: '#TASK-7 Storyboard',
        tasks: [
          {
            taskId: '01910d50-4c88-7c78-92d4-16892c06a011',
            label: 'TASK-7 Storyboard',
          },
        ],
      }),
    ).toEqual({
      body: '#TASK-7 Storyboard',
      mentions: [],
      tasks: [
        {
          taskId: '01910d50-4c88-7c78-92d4-16892c06a011',
          label: 'TASK-7 Storyboard',
        },
      ],
    });
  });
});

describe('clientKey dedupe', () => {
  function arrangeSendable(
    delegates: ReturnType<typeof buildHarness>['delegates'],
  ) {
    delegates.conversationParticipant.findUnique.mockResolvedValue(
      participant(MEMBER),
    );
    delegates.conversation.findUnique.mockResolvedValue({
      ...crewConversation(),
      participants: [participant(MEMBER)],
    });
    delegates.crewMember.findFirst.mockResolvedValue({ id: 'cm-1' });
  }

  describe('background task isolation', () => {
    let previous: string | undefined;

    beforeEach(() => {
      previous = process.env.BACKGROUND_TASKS_ENABLED;
      process.env.BACKGROUND_TASKS_ENABLED = 'false';
    });

    afterEach(() => {
      if (previous === undefined) delete process.env.BACKGROUND_TASKS_ENABLED;
      else process.env.BACKGROUND_TASKS_ENABLED = previous;
    });

    it('persists a sent message and outbox without immediate delivery or acknowledgement', async () => {
      const { service, prisma, delegates, realtime } = buildHarness();
      arrangeSendable(delegates);
      delegates.message.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve(message({ ...data })),
      );

      const sent = await service.sendText(CONV_ID, MEMBER, 'hello', 'key-1');
      await service.deliverMessageRealtime(sent);

      expect(sent.body).toBe('hello');
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(delegates.message.create).toHaveBeenCalledTimes(1);
      const statements = callsOf<[Prisma.Sql | TemplateStringsArray]>(
        delegates.$executeRaw,
      ).map(([sql]) => ('sql' in sql ? sql.sql : sql.join('?')));
      expect(
        statements.some((sql) =>
          sql.includes('INSERT INTO conversation_realtime_outbox'),
        ),
      ).toBe(true);
      expect(realtime.publishCrewMessage).not.toHaveBeenCalled();
      expect(realtime.publishUserFrame).not.toHaveBeenCalled();
      expect(
        delegates.conversationRealtimeOutbox.updateMany,
      ).not.toHaveBeenCalled();
    });

    it('preserves ordinary request-driven business broadcasts outside the outbox gate', async () => {
      const { service, realtime } = buildHarness();

      await service.broadcastCrewTaskChange(
        CREW_ID,
        'task-1',
        'updated',
        MEMBER,
      );

      expect(realtime.publishUserFrame).toHaveBeenCalledTimes(2);
      expect(realtime.publishUserFrame).toHaveBeenCalledWith(
        MEMBER,
        expect.objectContaining({ event: 'crew.task.changed' }),
        expect.any(String),
      );
    });
  });

  it('returns the row the first attempt wrote instead of appending a duplicate', async () => {
    const { service, delegates } = buildHarness();
    arrangeSendable(delegates);
    delegates.message.findFirst.mockResolvedValue(
      message({ id: 'm-first', body: 'hello', clientKey: 'k1' }),
    );

    const msg = await service.persistText(
      CONV_ID,
      MEMBER,
      'hello',
      undefined,
      'k1',
    );

    expect(msg.id).toBe('m-first');
    expect(delegates.message.create).not.toHaveBeenCalled();
  });

  it('does not broadcast an idempotent replay to every recipient again', async () => {
    const { service, delegates, realtime } = buildHarness();
    arrangeSendable(delegates);
    delegates.message.findFirst.mockResolvedValue(
      message({ id: 'm-first', body: 'hello', clientKey: 'k1' }),
    );

    const msg = await service.sendText(CONV_ID, MEMBER, 'hello', 'k1');

    expect(msg.id).toBe('m-first');
    expect(realtime.publishUserFrame).not.toHaveBeenCalled();
  });

  it('persists a structured mention only for a live member named in the body', async () => {
    const { service, delegates, notifications, world } = buildHarness();
    arrangeSendable(delegates);
    world.memberUserIds.add('u-mentioned');
    delegates.message.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(message({ id: 'm-mentioned', ...data })),
    );

    await service.sendText(CONV_ID, MEMBER, '@Ada please review', 'mention-1', [
      { userId: 'u-mentioned', label: 'Ada' },
    ]);

    const create = callsOf<[{ data: Record<string, unknown> }]>(
      delegates.message.create,
    )[0][0].data;
    expect(create.payload).toEqual({
      kind: 'text',
      mentions: [{ userId: 'u-mentioned', label: 'Ada' }],
    });
    const messageId = String(create.id);
    expect(notifications.send).toHaveBeenCalledWith({
      userId: 'u-mentioned',
      type: 'crew.chat.mentioned',
      title: 'You were mentioned in crew chat',
      body: '@Ada please review',
      meta: {
        crewId: CREW_ID,
        conversationId: CONV_ID,
        messageId,
        authorId: MEMBER,
        deeplink: `/crews/${CREW_ID}/workspace?tab=chat`,
      },
      idempotencyKey: `crew.chat.mentioned:${messageId}:u-mentioned`,
    });
  });

  it('rejects a mention whose identity is no longer in the live crew roster', async () => {
    const { service, delegates } = buildHarness();
    arrangeSendable(delegates);

    await expect(
      service.sendText(CONV_ID, MEMBER, '@Former please review', 'mention-2', [
        { userId: 'u-former', label: 'Former' },
      ]),
    ).rejects.toThrow('no longer active crew members');
    expect(delegates.message.create).not.toHaveBeenCalled();
  });

  it('rejects a self mention before writing a message or notification', async () => {
    const { service, delegates, notifications } = buildHarness();
    arrangeSendable(delegates);

    await expect(
      service.sendText(CONV_ID, MEMBER, '@Me please review', 'mention-self', [
        { userId: MEMBER, label: 'Me' },
      ]),
    ).rejects.toThrow('You cannot mention yourself');
    expect(delegates.message.create).not.toHaveBeenCalled();
    expect(notifications.send).not.toHaveBeenCalled();
  });

  it('resolves attachment metadata from crew assets without persisting storage keys', async () => {
    const { service, delegates } = buildHarness();
    arrangeSendable(delegates);
    delegates.crewAssetNode.findMany.mockResolvedValue([
      {
        id: '01910d50-4c88-7c78-92d4-16892c06a010',
        name: 'animatic.mp4',
        mediaAssetId: '01910d50-4c88-7c78-92d4-16892c06a011',
        mediaAsset: {
          id: '01910d50-4c88-7c78-92d4-16892c06a011',
          kind: 'video',
          contentType: 'video/mp4',
          sizeBytes: 1024n,
          storageKey: 'private/do-not-leak.mp4',
        },
      },
    ]);
    delegates.message.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(message({ id: 'm-file', ...data })),
    );

    const result = await service.sendAttachments(CONV_ID, MEMBER, {
      attachments: [
        {
          source: 'asset',
          assetNodeId: '01910d50-4c88-7c78-92d4-16892c06a010',
        },
      ],
      body: '',
      clientKey: 'asset-send-1',
      mentions: [],
      tasks: [],
    });

    expect(result.type).toBe('file');
    const create = callsOf<[{ data: Record<string, unknown> }]>(
      delegates.message.create,
    )[0][0].data;
    expect(create.payload).toMatchObject({
      kind: 'attachments',
      attachments: [
        {
          name: 'animatic.mp4',
          mediaAssetId: '01910d50-4c88-7c78-92d4-16892c06a011',
        },
      ],
    });
    expect(JSON.stringify(create.payload)).not.toContain('storageKey');
  });

  it('atomically promotes a fresh chat upload into assets while creating the message', async () => {
    const { service, delegates, prisma } = buildHarness();
    arrangeSendable(delegates);
    const order: string[] = [];
    delegates.mediaAsset.findMany.mockResolvedValue([
      {
        id: '01910d50-4c88-7c78-92d4-16892c06a011',
        kind: 'image',
        contentType: 'image/png',
        sizeBytes: 2048n,
        createdByUserId: MEMBER,
        metadata: {
          uploadKind: 'crew_asset_file',
          crewId: CREW_ID,
        },
      },
    ]);
    delegates.crewAssetNode.findMany.mockImplementation(
      ({ select }: { select?: { name?: boolean } }) =>
        Promise.resolve(select?.name ? [{ name: 'concept.png' }] : []),
    );
    delegates.crewAssetNode.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => {
        order.push(`asset:${String(data.name)}`);
        return Promise.resolve({ id: '01910d50-4c88-7c78-92d4-16892c06a099' });
      },
    );
    delegates.message.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => {
        order.push('message');
        return Promise.resolve(message({ id: 'm-upload', ...data }));
      },
    );

    const result = await service.sendAttachments(CONV_ID, MEMBER, {
      attachments: [
        {
          source: 'upload',
          mediaAssetId: '01910d50-4c88-7c78-92d4-16892c06a011',
          name: 'concept.png',
        },
      ],
      body: 'New concept',
      clientKey: 'upload-send-1',
      mentions: [],
      tasks: [],
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const uploadLock = callsOf<[Prisma.Sql]>(delegates.$executeRaw).find(
      ([sql]) =>
        sql.values[0] ===
        'crew-asset-upload:01910d50-4c88-7c78-92d4-16892c06a011',
    );
    expect(uploadLock?.[0].sql).toContain('pg_advisory_xact_lock');
    expect(order).toEqual(['asset:concept (2).png', 'message']);
    expect(result.payload).toMatchObject({
      kind: 'attachments',
      attachments: [
        {
          assetNodeId: '01910d50-4c88-7c78-92d4-16892c06a099',
          mediaAssetId: '01910d50-4c88-7c78-92d4-16892c06a011',
          name: 'concept (2).png',
        },
      ],
    });
  });

  it('returns an idempotent attachment replay without creating a second asset node', async () => {
    const { service, delegates } = buildHarness();
    arrangeSendable(delegates);
    delegates.message.findFirst.mockResolvedValue(
      message({
        id: 'm-upload',
        type: 'image',
        body: '',
        clientKey: 'upload-send-retry',
        payload: {
          kind: 'attachments',
          attachments: [
            {
              assetNodeId: '01910d50-4c88-7c78-92d4-16892c06a099',
              mediaAssetId: '01910d50-4c88-7c78-92d4-16892c06a011',
              name: 'concept.png',
              mediaKind: 'image',
              contentType: 'image/png',
              sizeBytes: 2048,
            },
          ],
        },
      }),
    );

    await service.sendAttachments(CONV_ID, MEMBER, {
      attachments: [
        {
          source: 'upload',
          mediaAssetId: '01910d50-4c88-7c78-92d4-16892c06a011',
          name: 'concept.png',
        },
      ],
      body: '',
      clientKey: 'upload-send-retry',
      mentions: [],
      tasks: [],
    });

    expect(delegates.crewAssetNode.create).not.toHaveBeenCalled();
    expect(delegates.message.create).not.toHaveBeenCalled();
  });

  it('resolves inline task references against the conversation crew', async () => {
    const { service, delegates } = buildHarness();
    arrangeSendable(delegates);
    delegates.crewTask.findMany.mockResolvedValue([
      {
        id: '01910d50-4c88-7c78-92d4-16892c06a011',
        crewId: CREW_ID,
        number: 12,
        title: 'SC.010 storyboard',
      },
    ]);
    delegates.message.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(message({ id: 'm-task', ...data })),
    );

    const result = await service.sendText(
      CONV_ID,
      MEMBER,
      'Please review #TASK-12 SC.010 storyboard',
      'task-send-1',
      [],
      [
        {
          taskId: '01910d50-4c88-7c78-92d4-16892c06a011',
          label: 'TASK-12 SC.010 storyboard',
        },
      ],
    );

    expect(result.type).toBe('text');
    expect(delegates.crewTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          crewId: CREW_ID,
          id: { in: ['01910d50-4c88-7c78-92d4-16892c06a011'] },
          deletedAt: null,
        },
      }),
    );
    const taskCreate = callsOf<
      [{ data: { payload: Record<string, unknown> } }]
    >(delegates.message.create)[0][0].data;
    expect(taskCreate.payload).toMatchObject({
      kind: 'text',
      tasks: [
        {
          taskId: '01910d50-4c88-7c78-92d4-16892c06a011',
          crewId: CREW_ID,
          number: 12,
          label: 'TASK-12 SC.010 storyboard',
        },
      ],
    });
  });

  it('recovers from the racing insert by resolving P2002 to the winner', async () => {
    const { service, delegates } = buildHarness();
    arrangeSendable(delegates);
    delegates.message.findFirst
      .mockResolvedValueOnce(null) // pre-check misses
      .mockResolvedValueOnce(
        message({ id: 'm-winner', body: 'hello', clientKey: 'k1' }),
      );
    delegates.message.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    const msg = await service.persistText(
      CONV_ID,
      MEMBER,
      'hello',
      undefined,
      'k1',
    );

    expect(msg.id).toBe('m-winner');
  });

  it('409s when a key is reused for different text instead of silently dropping it', async () => {
    const { service, delegates } = buildHarness();
    arrangeSendable(delegates);
    delegates.message.findFirst.mockResolvedValue(
      message({ id: 'm-first', body: 'the first draft', clientKey: 'k1' }),
    );

    await expect(
      service.persistText(CONV_ID, MEMBER, 'the edited draft', undefined, 'k1'),
    ).rejects.toMatchObject({
      response: {
        message: 'Idempotency key was already used for a different message',
        existingMessageId: 'm-first',
      },
    });
    expect(delegates.message.create).not.toHaveBeenCalled();
  });

  it('refuses to run inside a caller transaction rather than poisoning it', async () => {
    const { service, delegates, tx } = buildHarness();
    arrangeSendable(delegates);

    await expect(
      service.persistText(CONV_ID, MEMBER, 'hello', tx as never, 'k1'),
    ).rejects.toThrow(/caller transaction/);
    expect(delegates.message.create).not.toHaveBeenCalled();
  });

  it('writes clientKey=null for system messages so they stay out of the partial unique index', async () => {
    const { service, delegates } = buildHarness();
    delegates.message.create.mockResolvedValue(
      message({ type: 'system', authorId: null }),
    );

    await service.persistSystem(CONV_ID, 'order.completed', {});

    const createArgs = callsOf<
      [{ data: { authorId: string | null; clientKey: string | null } }]
    >(delegates.message.create)[0][0];
    expect(createArgs.data).toMatchObject({
      authorId: null,
      clientKey: null,
    });
    const [[sql]] = callsOf<[Prisma.Sql]>(delegates.$executeRaw);
    expect(sql.sql).toContain(
      'last_message_at = GREATEST(c.last_message_at, m.created_at)',
    );
  });
});
