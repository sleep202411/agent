/**
 * ConversationsService against a real PostgreSQL server.
 *
 * Everything in here is a claim about SQL semantics that a mocked
 * Prisma client cannot settle and would happily lie about: how cursor
 * pagination behaves when the sort column has ties, what
 * `NOT (author_id = $1)` evaluates to when `author_id` is NULL, and
 * whether a partial unique index actually collapses a retried send.
 * Asserting the shape of a `where` object proves the shape; only a
 * server proves the behaviour.
 *
 * Opt-in, and restricted to the named loopback test databases:
 *
 *   docker run -d --name pg17-r1 -e POSTGRES_PASSWORD=x \
 *     -e POSTGRES_DB=fizzdragon_outbox_test -p 5433:5432 postgres:17-alpine
 *   DATABASE_URL='postgres://postgres:x@localhost:5433/fizzdragon_outbox_test' \
 *     npx prisma migrate deploy
 *   CONVERSATIONS_POSTGRES_INTEGRATION=1 \
 *     DATABASE_URL='postgres://postgres:x@localhost:5433/fizzdragon_outbox_test' \
 *     npx jest --runInBand --runTestsByPath \
 *     src/conversations/conversations.postgres.integration.spec.ts
 *   docker rm -f pg17-r1
 *
 * Every row it writes is namespaced by a per-test random suffix and
 * deleted afterwards; conversations cascade to participants and
 * messages.
 */
import { randomUUID } from 'node:crypto';
import { buildPrisma, type PrismaService } from '../infra/db/db.module';
import { ConversationsService, crewLookupKey } from './conversations.service';

const INTEGRATION_ENABLED =
  Boolean(process.env.TASK01_TEST_DATABASE_URL) ||
  process.env.CONVERSATIONS_POSTGRES_INTEGRATION === '1';
const describePostgres = INTEGRATION_ENABLED ? describe : describe.skip;

jest.setTimeout(60_000);

describePostgres('ConversationsService PostgreSQL integration', () => {
  const databaseUrl =
    process.env.TASK01_TEST_DATABASE_URL ??
    process.env.DATABASE_URL?.trim() ??
    '';
  const createdCrewIds = new Set<string>();
  const createdConversationIds = new Set<string>();

  let prisma: ReturnType<typeof buildPrisma>;
  let realtime: {
    publishUserFrame: jest.Mock;
    publishCrewMessage: jest.Mock;
    issueUserGrant: jest.Mock;
    issueCrewGrant: jest.Mock;
  };
  let service: ConversationsService;

  beforeAll(async () => {
    assertLocalPostgres(databaseUrl);
    prisma = buildPrisma(databaseUrl);
    await prisma.$connect();
    await assertCrewChatMigrationsPresent(prisma);
  });

  beforeEach(() => {
    realtime = {
      publishUserFrame: jest.fn().mockResolvedValue(undefined),
      publishCrewMessage: jest.fn().mockResolvedValue(undefined),
      issueUserGrant: jest.fn(),
      issueCrewGrant: jest.fn(),
    };
    service = new ConversationsService(
      prisma as unknown as PrismaService,
      realtime,
      { send: jest.fn().mockResolvedValue({}) } as never,
    );
  });

  afterEach(async () => {
    if (createdConversationIds.size > 0) {
      await prisma.conversation.deleteMany({
        where: { id: { in: [...createdConversationIds] } },
      });
      createdConversationIds.clear();
    }
    if (createdCrewIds.size > 0) {
      await prisma.crew.deleteMany({
        where: { id: { in: [...createdCrewIds] } },
      });
      createdCrewIds.clear();
    }
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  // ─── fixtures ──────────────────────────────────────────────

  function scope(label: string) {
    const suffix = `${label}-${randomUUID().slice(0, 8)}`;
    return {
      crewId: `crew-it-${suffix}`,
      ownerUserId: `u-founder-it-${suffix}`,
      memberId: `u-member-it-${suffix}`,
      outsiderId: `u-outsider-it-${suffix}`,
    };
  }

  async function seedCrew(s: ReturnType<typeof scope>) {
    createdCrewIds.add(s.crewId);
    await prisma.crew.create({
      data: {
        id: s.crewId,
        name: 'Integration Crew',
        description: 'fixture',
        logo: 'https://example.invalid/logo.png',
        createdByUserId: s.ownerUserId,
      },
    });
    const ownerMember = await prisma.crewMember.create({
      data: {
        id: `cm-${s.ownerUserId}`,
        crewId: s.crewId,
        userId: s.ownerUserId,
        status: 'active',
        joinedVia: 'creation',
      },
    });
    await prisma.crewOwnership.create({
      data: { crewId: s.crewId, memberId: ownerMember.id },
    });
    await prisma.crewMember.create({
      data: {
        id: `cm-${s.memberId}`,
        crewId: s.crewId,
        userId: s.memberId,
        status: 'active',
        joinedVia: 'invitation',
      },
    });
  }

  async function openChatWith(
    s: ReturnType<typeof scope>,
    userIds: string[],
  ): Promise<string> {
    const conv = await service.openCrewConversation(s.crewId);
    createdConversationIds.add(conv.id);
    await prisma.$transaction(async (tx) => {
      for (const userId of userIds) {
        await service.syncCrewParticipant(s.crewId, userId, 'join', tx);
      }
    });
    return conv.id;
  }

  /** Messages with deliberately controlled `createdAt`, ties included. */
  async function seedMessages(
    conversationId: string,
    authorId: string,
    specs: Array<{ id: string; ms: number }>,
  ) {
    for (const spec of specs) {
      await prisma.message.create({
        data: {
          id: spec.id,
          conversationId,
          authorId,
          type: 'text',
          body: spec.id,
          createdAt: new Date(spec.ms),
        },
      });
    }
  }

  // ─── the pagination invariant ──────────────────────────────

  /**
   * Page the whole history and return every id the client would have
   * received, in order.
   */
  async function pageEverything(
    conversationId: string,
    viewerId: string,
    limit: number,
  ): Promise<string[]> {
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 60; page += 1) {
      const res = await service.listMessages(conversationId, viewerId, {
        limit,
        cursor,
      });
      seen.push(...res.items.map((m) => m.id));
      if (!res.nextCursor) break;
      cursor = res.nextCursor;
    }
    return seen;
  }

  /** One millisecond, six messages — inserted oldest-id first. */
  const TIE_MS = Date.parse('2026-07-28T10:00:00.000Z');
  const TIED = Array.from({ length: 6 }, (_, i) => ({
    id: `m-tie-${i}`,
    ms: TIE_MS,
  }));
  /** The same six under `(createdAt desc, id desc)` — insertion order reversed. */
  const TIED_ORDER = TIED.map((m) => m.id).reverse();

  /**
   * The tiebreaker's job, stated as an order rather than as a set.
   *
   * `createdAt` is generated client-side by Prisma at millisecond
   * precision, so a burst — several members reacting to the same post,
   * or a server loop emitting system messages — lands on one
   * millisecond routinely. `ORDER BY created_at DESC` on its own is
   * therefore not a total order over that history, and SQL promises
   * nothing about tied rows: the server returns them in whatever order
   * the scan and the sort happened to produce.
   *
   * The earlier version of this test asserted only the SET of ids —
   * no duplicates, nothing missing — and it passed with the tiebreaker
   * deleted, because "whatever order the scan produced" on a
   * freshly-inserted table is insertion order, which contains every id
   * exactly once. A set assertion cannot see a history served backwards.
   * So the SEQUENCE is what gets pinned here, and the ids are chosen so
   * insertion order is the exact reverse of the order the service owes:
   * `m-tie-0 … m-tie-5` in the heap, `m-tie-5 … m-tie-0` on the wire.
   *
   * The sequence is a real contract, not decoration. `_unreadCount`'s
   * raw SQL reads "unread iff it sorts after the read cursor under the
   * same total order `listMessages` pages by" (see `unreadCountsFor`),
   * and the test below it pins the tie-with-the-read-cursor case; the
   * two only agree if that order is `(created_at DESC, id DESC)` on
   * both sides.
   *
   * Both query shapes are exercised: eight messages at a page size of
   * two means one uncursored head page and three that run the cursor
   * predicate, and a single oversized read has to agree with the
   * four-page walk over the same ground.
   *
   * The one thing this test cannot assume is that the fixture is still
   * adversarial — a heap that happened to hold the tied rows in the
   * declared order would make a missing tiebreaker look correct. So it
   * checks that first, and fails saying so rather than passing for the
   * wrong reason.
   */
  it('pages a tied burst in the total order it declares, not the order the heap holds', async () => {
    const s = scope('paging-order');
    await seedCrew(s);
    const conversationId = await openChatWith(s, [s.ownerUserId, s.memberId]);

    const specs = [
      ...TIED,
      { id: 'm-later-0', ms: TIE_MS + 1_000 },
      { id: 'm-later-1', ms: TIE_MS + 2_000 },
    ];
    await seedMessages(conversationId, s.memberId, specs);

    const expected = ['m-later-1', 'm-later-0', ...TIED_ORDER];

    // Is the fixture still adversarial? See the last paragraph above.
    expect(await orderWithoutTiebreaker(prisma, conversationId)).not.toEqual(
      expected,
    );

    const seen = await pageEverything(conversationId, s.ownerUserId, 2);

    // Spelled out one failure mode at a time, worst first, so a
    // regression reports what went wrong instead of only diffing two
    // arrays.
    expect(seen.filter((id, i) => seen.indexOf(id) !== i)).toEqual([]);
    expect([...seen].sort()).toEqual([...expected].sort());
    expect(seen).toEqual(expected);

    // Paged or not, the same order.
    expect(await pageEverything(conversationId, s.ownerUserId, 100)).toEqual(
      expected,
    );
  });

  // ─── unread semantics ──────────────────────────────────────

  it('counts server-authored system messages as unread', async () => {
    const s = scope('sysunread');
    await seedCrew(s);
    const conversationId = await openChatWith(s, [s.ownerUserId, s.memberId]);

    await service.persistSystem(conversationId, 'order.completed', {});

    const detail = await service.detail(conversationId, s.ownerUserId);
    expect(detail._unreadCount).toBe(1);
  });

  it('leaves a message tied with the read cursor unread instead of swallowing it', async () => {
    const s = scope('tiecursor');
    await seedCrew(s);
    const conversationId = await openChatWith(s, [s.ownerUserId, s.memberId]);

    const tiedAt = Date.parse('2026-07-28T11:00:00.000Z');
    await seedMessages(conversationId, s.memberId, [
      { id: 'm-tie-a', ms: tiedAt },
      { id: 'm-tie-b', ms: tiedAt },
    ]);

    // Read the older half of the tie; the other one is still unread.
    const [older, newer] = await orderedIds(prisma, conversationId);
    await service.markRead(conversationId, s.ownerUserId, older);

    const detail = await service.detail(conversationId, s.ownerUserId);
    expect(detail._unreadCount).toBe(1);

    await service.markRead(conversationId, s.ownerUserId, newer);
    const cleared = await service.detail(conversationId, s.ownerUserId);
    expect(cleared._unreadCount).toBe(0);
  });

  it('stores the database microsecond on mark-read instead of truncating it through JavaScript', async () => {
    const s = scope('microsecond-cursor');
    await seedCrew(s);
    const conversationId = await openChatWith(s, [s.ownerUserId, s.memberId]);
    const messageId = `m-micro-${randomUUID().slice(0, 8)}`;
    await seedMessages(conversationId, s.memberId, [
      {
        id: messageId,
        ms: Date.parse('2026-07-28T11:30:00.000Z'),
      },
    ]);
    // Prisma/JS Date only carries milliseconds. Force a real PostgreSQL
    // microsecond so this fails if markRead round-trips `createdAt`
    // through JavaScript before writing the participant cursor.
    await prisma.$executeRawUnsafe(
      `UPDATE messages
       SET created_at = TIMESTAMPTZ '2026-07-28 11:30:00.000123+00'
       WHERE id = $1`,
      messageId,
    );

    await service.markRead(conversationId, s.ownerUserId, messageId);

    const rows = await prisma.$queryRaw<Array<{ cursor: string | null }>>`
      SELECT to_char(
        last_read_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD HH24:MI:SS.US'
      ) AS cursor
      FROM conversation_participants
      WHERE conversation_id = ${conversationId}
        AND user_id = ${s.ownerUserId}
    `;
    expect(rows[0]?.cursor).toBe('2026-07-28 11:30:00.000123');
    expect(
      (await service.detail(conversationId, s.ownerUserId))._unreadCount,
    ).toBe(0);
  });

  it('stores a new participant’s pre-join baseline with the database microsecond intact', async () => {
    const s = scope('microsecond-join-baseline');
    await seedCrew(s);
    const conversationId = await openChatWith(s, [s.ownerUserId, s.memberId]);
    const messageId = `m-join-micro-${randomUUID().slice(0, 8)}`;
    await seedMessages(conversationId, s.memberId, [
      {
        id: messageId,
        ms: Date.parse('2026-07-28T11:45:00.000Z'),
      },
    ]);
    await prisma.$executeRawUnsafe(
      `UPDATE messages
       SET created_at = TIMESTAMPTZ '2026-07-28 11:45:00.000456+00'
       WHERE id = $1`,
      messageId,
    );

    await prisma.$transaction(async (tx) => {
      await tx.crewMember.create({
        data: {
          id: `cm-${s.outsiderId}`,
          crewId: s.crewId,
          userId: s.outsiderId,
          status: 'active',
          joinedVia: 'invitation',
        },
      });
      await service.syncCrewParticipant(s.crewId, s.outsiderId, 'join', tx);
    });

    const rows = await prisma.$queryRaw<
      Array<{ messageId: string | null; cursor: string | null }>
    >`
      SELECT
        last_read_message_id AS "messageId",
        to_char(
          last_read_at AT TIME ZONE 'UTC',
          'YYYY-MM-DD HH24:MI:SS.US'
        ) AS cursor
      FROM conversation_participants
      WHERE conversation_id = ${conversationId}
        AND user_id = ${s.outsiderId}
    `;
    expect(rows[0]).toEqual({
      messageId,
      cursor: '2026-07-28 11:45:00.000456',
    });
    expect(
      (await service.detail(conversationId, s.outsiderId))._unreadCount,
    ).toBe(0);
  });

  // ─── fan-out scoping ───────────────────────────────────────

  it('stops pushing to a member the crew removed, and keeps per-member unread accurate', async () => {
    const s = scope('fanout');
    await seedCrew(s);
    const conversationId = await openChatWith(s, [s.ownerUserId, s.memberId]);

    await prisma.$transaction((tx) =>
      service.syncCrewParticipant(s.crewId, s.memberId, 'leave', tx),
    );

    const msg = await service.persistText(
      conversationId,
      s.ownerUserId,
      'members only',
    );
    await service.broadcastMessage(msg);

    const calls = realtime.publishUserFrame.mock.calls as Array<
      [string, { data: { unreadCount: number } }, string]
    >;
    expect(calls.map((c) => c[0])).toEqual([s.ownerUserId]);

    // The author's own message is not unread to them.
    const frame = calls[0][1];
    expect(frame.data.unreadCount).toBe(0);
  });

  it('keeps the read cursor across leave → rejoin', async () => {
    const s = scope('rejoin');
    await seedCrew(s);
    const conversationId = await openChatWith(s, [s.ownerUserId, s.memberId]);
    await seedMessages(conversationId, s.ownerUserId, [
      { id: 'm-rj-1', ms: Date.parse('2026-07-28T12:00:00.000Z') },
      { id: 'm-rj-2', ms: Date.parse('2026-07-28T12:00:01.000Z') },
    ]);
    await service.markRead(conversationId, s.memberId, 'm-rj-1');

    await prisma.$transaction((tx) =>
      service.syncCrewParticipant(s.crewId, s.memberId, 'leave', tx),
    );
    await prisma.$transaction((tx) =>
      service.syncCrewParticipant(s.crewId, s.memberId, 'join', tx),
    );

    const row = await prisma.conversationParticipant.findUniqueOrThrow({
      where: {
        conversationId_userId: { conversationId, userId: s.memberId },
      },
    });
    expect(row.leftAt).toBeNull();
    expect(row.lastReadMessageId).toBe('m-rj-1');

    const detail = await service.detail(conversationId, s.memberId);
    expect(detail._unreadCount).toBe(1);
  });

  // ─── idempotency ───────────────────────────────────────────

  it('collapses a retried send onto one row and lets unkeyed sends repeat freely', async () => {
    const s = scope('idem');
    await seedCrew(s);
    const conversationId = await openChatWith(s, [s.ownerUserId, s.memberId]);

    const first = await service.sendText(
      conversationId,
      s.memberId,
      'network hiccup',
      'ck-1',
    );
    const retry = await service.sendText(
      conversationId,
      s.memberId,
      'network hiccup',
      'ck-1',
    );
    expect(retry.id).toBe(first.id);

    // A different author may reuse the same token.
    const other = await service.sendText(
      conversationId,
      s.ownerUserId,
      'network hiccup',
      'ck-1',
    );
    expect(other.id).not.toBe(first.id);

    // Unkeyed sends are never deduped — the partial index excludes them.
    await service.sendText(conversationId, s.memberId, 'again');
    await service.sendText(conversationId, s.memberId, 'again');

    const total = await prisma.message.count({ where: { conversationId } });
    expect(total).toBe(4);
  });

  // ─── identity + gating ─────────────────────────────────────

  it('opens exactly one chat per crew under concurrent callers', async () => {
    const s = scope('open');
    await seedCrew(s);

    const [a, b, c] = await Promise.all([
      service.openCrewConversation(s.crewId),
      service.openCrewConversation(s.crewId),
      service.openCrewConversation(s.crewId),
    ]);
    createdConversationIds.add(a.id);
    createdConversationIds.add(b.id);
    createdConversationIds.add(c.id);

    expect(b.id).toBe(a.id);
    expect(c.id).toBe(a.id);
    expect(a.lookupKey).toBe(crewLookupKey(s.crewId));
    expect(a.contextType).toBe('crew');
    expect(
      await prisma.conversation.count({ where: { contextId: s.crewId } }),
    ).toBe(1);
  });

  it('404s a stale participant and admits the owner through canonical active membership', async () => {
    const s = scope('gate');
    await seedCrew(s);
    const conversationId = await openChatWith(s, [s.ownerUserId, s.memberId]);
    // Simulate a historical missed leave sync. The hardened join path
    // itself refuses to create this stale projection now.
    await prisma.conversationParticipant.create({
      data: {
        conversationId,
        userId: s.outsiderId,
        role: 'member',
      },
    });

    // The outsider was projected into the chat but never was (or no
    // longer is) a crew member — the participant row alone must not
    // be enough.
    await expect(
      service.listMessages(conversationId, s.outsiderId, { limit: 10 }),
    ).rejects.toThrow('Conversation not found');
    await expect(
      service.persistText(conversationId, s.outsiderId, 'hello?'),
    ).rejects.toThrow('Conversation not found');

    const detail = await service.detail(conversationId, s.ownerUserId);
    expect(detail.participants.map((p) => p.userId).sort()).toEqual(
      [s.ownerUserId, s.memberId].sort(),
    );

    // Ownership is structurally attached to the canonical active member;
    // chat access never depends on an ownership bypass.
    expect(
      await prisma.crewMember.count({
        where: { crewId: s.crewId, userId: s.ownerUserId },
      }),
    ).toBe(1);
    await expect(
      service.listMessages(conversationId, s.ownerUserId, { limit: 10 }),
    ).resolves.toMatchObject({ items: [] });
  });
});

/**
 * `listMessages`' query with the tiebreaker taken back out — i.e. what
 * the server would hand back if the sort were not total. Nothing
 * constrains this order but the physical layout of the moment, which is
 * the point: the tests below use it to prove their fixture is actually
 * adversarial before they assert anything.
 */
async function orderWithoutTiebreaker(
  prisma: ReturnType<typeof buildPrisma>,
  conversationId: string,
): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM messages
    WHERE conversation_id = ${conversationId} AND deleted_at IS NULL
    ORDER BY created_at DESC
  `;
  return rows.map((r) => r.id);
}

/** Newest-first message ids under the service's own total order. */
async function orderedIds(
  prisma: ReturnType<typeof buildPrisma>,
  conversationId: string,
): Promise<string[]> {
  const rows = await prisma.message.findMany({
    where: { conversationId, deletedAt: null },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true },
  });
  // Returned oldest-first so callers can read [older, newer].
  return rows.map((r) => r.id).reverse();
}

function assertLocalPostgres(rawUrl: string): void {
  const url = new URL(rawUrl);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !(
      (url.port === '5433' && url.pathname === '/fizzdragon_outbox_test') ||
      (url.port === '55439' && url.pathname === '/task01')
    )
  ) {
    throw new Error(
      'Explicitly selected named loopback test database required.',
    );
  }
}

async function assertCrewChatMigrationsPresent(
  prisma: ReturnType<typeof buildPrisma>,
): Promise<void> {
  const [row] = await prisma.$queryRaw<
    Array<{
      crewContext: boolean;
      memberRole: boolean;
      clientKeyIndex: boolean;
    }>
  >`
    SELECT
      EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'conversation_context_type' AND e.enumlabel = 'crew'
      ) AS "crewContext",
      EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'conversation_participant_role'
          AND e.enumlabel = 'member'
      ) AS "memberRole",
      EXISTS (
        SELECT 1
        FROM pg_index i
        WHERE i.indexrelid =
          to_regclass('public.messages_client_key_unique')
          AND i.indisvalid
          AND i.indisready
          AND i.indisunique
          AND i.indnkeyatts = 3
          AND pg_get_indexdef(i.indexrelid, 1, TRUE) = 'conversation_id'
          AND pg_get_indexdef(i.indexrelid, 2, TRUE) = 'author_id'
          AND pg_get_indexdef(i.indexrelid, 3, TRUE) = 'client_key'
          AND pg_get_expr(i.indpred, i.indrelid) =
            '(client_key IS NOT NULL)'
      ) AS "clientKeyIndex"
  `;
  if (!row?.crewContext || !row?.memberRole || !row?.clientKeyIndex) {
    throw new Error(
      'Crew-chat migrations are missing from this database. Run `prisma migrate deploy` against it first.',
    );
  }
}
