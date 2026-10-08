/**
 * ConversationsService — persistence + durable Ably delivery for
 * conversations, messages, and read-cursor advancement.
 *
 * Realtime model:
 *   - DB is authoritative; every message and its realtime outbox row commit
 *     atomically.
 *   - The request path publishes immediately to minimize latency, then marks
 *     the outbox row dispatched. A dispatcher retries anything left pending.
 *   - Every Ably publish has a deterministic idempotency key, so recovery
 *     after a crash can safely replay a partially-completed fan-out.
 *   - Crew messages are also copied once to the crew's Ably Chat room,
 *     which owns room continuity, presence, reactions and 30-day history.
 *   - REST cursor recovery remains the final source-of-truth repair path.
 *
 * Transaction boundary (important):
 *   Persist methods accept an optional `db?: DbClient` last arg.
 *   When called WITH a tx (inside another module's
 *   `prisma.$transaction((tx) => …)`), they persist using that tx
 *   and DO NOT take the realtime fast path — the caller may invoke
 *   `broadcastMessage(...)` AFTER the outer tx commits to reduce latency,
 *   but delivery correctness no longer depends on it because the outbox row
 *   was committed with the message. Publishing before commit remains
 *   forbidden because it creates ghost messages.
 *
 *   Convenience wrappers (`sendText`, `sendAttachments`, `sendProposal`,
 *   `postSystem`, `evolveToOrderContext`,
 *   `patchProposalStatus`) call the persist methods without a tx and
 *   then immediately broadcast — these are the right entry points for
 *   controllers that have no surrounding business transaction.
 *
 * Conversation identity:
 *   - service inquiry: lookup key `service:<serviceId>:<buyerId>:<creatorId>`
 *     — (buyer, creator, service) triple resumes the same row.
 *   - order: lookup key `order:<orderId>`. Rewritten in
 *     `persistEvolveToOrder()` inside the proposal-accept tx so the
 *     UNIQUE constraint shifts atomically.
 *   - crew team channel: lookup key `crew:<crewId>`.
 *   - crew community channel: lookup key `crew:<crewId>:community`.
 *
 * Crew team conversations (internal group chat):
 *   `ConversationParticipant` is a *projection* of crew membership,
 *   kept in step by `syncCrewParticipant()`. Community-channel participants are
 *   explicit subscribers and are never projected into `crew_members`. A
 *   team-channel projection can go
 *   stale (a missed sync, a crew soft-deleted out from under it), so
 *   every crew read, every crew send and every crew read-cursor
 *   advance re-checks live crew membership against `crews` /
 *   `crew_members` before serving — the inbox included, because a
 *   crew row there carries the crew's NAME and the last message's
 *   preview and so leaks as much as opening the thread would. The
 *   re-check queries Prisma directly instead of importing
 *   the crew authorization service: module direction is one-way
 *   (CrewsModule → ConversationsModule) and reaching back would need
 *   a forwardRef. Crew ownership always points to an active member, so
 *   the chat boundary only needs the canonical active-membership predicate.
 *
 * Authorization (controllers re-check; service is the last line):
 *   - Read / send / mark-read: caller must be a participant (and not
 *     `leftAt`-set). The internal crew channel additionally requires an
 *     active crew membership; the community channel requires a live crew plus an
 *     active community subscription. An outsider gets 404, never 403:
 *     `assertParticipant`'s posture is deliberately non-probeable and the
 *     crew gate matches it. Everything that touches thread content, or
 *     emits a frame into the thread, goes through
 *     `assertConversationAccess` — never `assertParticipant` alone, which
 *     a stale team projection satisfies.
 *   - System messages: only callable from within other services
 *     (no public REST), authorId=null.
 *   - Proposal post: only the `creator` role can post; service
 *     enforces.
 *
 * Read cursor:
 *   - `lastReadMessageId` + denormalized `lastReadAt` per
 *     participant. `markRead()` only advances forward (idempotent
 *     against double-clicks / stale clients).
 *   - "Forward" is the `(createdAt, id)` tuple, not `createdAt`
 *     alone. `createdAt` is generated client-side by Prisma at
 *     millisecond precision, so two messages sharing a timestamp is
 *     ordinary, not exotic — a bare timestamp compare silently
 *     swallowed every tied message. Both the advance guard and the
 *     unread count are evaluated in Postgres so the id half of the
 *     tuple is compared under one collation; JS string order and
 *     `en_US.utf8` disagree on case, and a cursor that means
 *     different things on either side of the wire is a bug factory.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ConversationContextType,
  ConversationParticipantRole,
  CrewConversationChannel,
  CrewAssetNodeKind,
  CrewAssetNodeStatus,
  MediaAssetStatus,
  type Conversation as PrismaConversation,
  type ConversationParticipant as PrismaConversationParticipant,
  type Message as PrismaMessage,
  Prisma,
} from '@prisma/client';
import {
  type ConversationAttachmentPayload,
  type ConversationFrame,
  type ConversationMentionPayload,
  type ConversationMessageType,
  type ConversationTaskReferencePayload,
  type MessagePayload,
  type ProposalPayload,
  type SystemMessageKind,
  type SystemMessagePayload,
} from '@repo/shared/conversation';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { newShortId } from '../common/id';
import { conversationUnreadCounts } from './unread-counts';
import { PrismaService } from '../infra/db/db.module';
import { backgroundTasksEnabled } from '../common/background-tasks';
import { NotificationService } from '../notification';
import { lockCrewAssetUploads } from '../crews/assets/upload-lock';
import { availableCrewAssetName } from '../crews/assets/asset-name';
import {
  CONVERSATION_REALTIME,
  type ConversationRealtimePublisher,
} from './conversation-realtime.service';
import type {
  SendAttachmentsInput,
  SendProposalInput,
  TaskReferenceInput,
} from './dto';

type TxClient = Prisma.TransactionClient;
type DbClient = TxClient | PrismaService;

/**
 * Input shape for `openServiceConversation`. Caller resolves
 * participants up front from the domain context.
 */
export interface OpenConversationArgs {
  serviceId: string;
  buyerId: string;
  creatorId: string;
}

export type ConversationRowHydrated = PrismaConversation & {
  participants: PrismaConversationParticipant[];
  _unreadCount?: number;
  _lastMessage?: PrismaMessage | null;
};

/** Captured context-change side-effect for deferred broadcast. */
export interface PendingContextChange {
  conversation: PrismaConversation;
  from: ConversationContextType;
  to: ConversationContextType;
}

interface PersistResult {
  message: PrismaMessage;
  /** False when `clientKey` resolved this call to an earlier write. */
  created: boolean;
}

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONVERSATION_REALTIME)
    private readonly realtime: ConversationRealtimePublisher,
    private readonly notifications: NotificationService,
  ) {}

  // ─── Find / create ────────────────────────────────────────

  /**
   * Idempotent "open inquiry conversation". Buyer + creator are
   * fixed by the triple; lookup key gives O(1) dedup.
   *
   * Does NOT broadcast — no message is created here.
   *
   * Concurrency model — why an advisory lock, not P2002 recovery:
   *   When this runs inside an outer transaction (`db` is a tx),
   *   a UNIQUE-violation on `lookupKey` would put the outer tx into
   *   the Postgres "aborted" state — any subsequent statement on
   *   the same tx (including the fallback `findUnique`) would fail
   *   with 25P02. So we cannot rely on catching P2002 inside a tx.
   *
   *   Instead we take a transaction-scoped advisory lock keyed on
   *   `hashtextextended(lookupKey, 0)` BEFORE the find→create. Two
   *   racing callers serialize on the lock; the second wakes up
   *   after the first commits and the under-lock `findUnique`
   *   returns the existing row. No constraint violation is ever
   *   provoked, so the outer tx stays clean. The lock auto-releases
   *   on tx end (commit or rollback), so an outer rollback correctly
   *   un-claims the lookupKey.
   *
   *   The UNIQUE index stays as a defense-in-depth invariant for
   *   any future call path that bypasses this helper.
   */
  async openServiceConversation(
    args: OpenConversationArgs,
    db: DbClient = this.prisma,
  ): Promise<PrismaConversation> {
    if (args.buyerId === args.creatorId) {
      throw new BadRequestException(
        'Cannot start a conversation with yourself',
      );
    }
    const lookupKey = serviceLookupKey(
      args.serviceId,
      args.buyerId,
      args.creatorId,
    );

    // Fast path — already exists, no need to lock. Safe to read
    // outside the tx because conversations are append-only on
    // lookupKey (only `persistEvolveToOrder` rewrites it, and that
    // path swaps to an order-scoped key, never collides with the
    // service-scoped key we're checking here).
    const existing = await db.conversation.findUnique({
      where: { lookupKey },
    });
    if (existing) return existing;

    return await this.runInTx(db, async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lookupKey}, 0))`,
      );
      // Re-check under lock. If a concurrent creator won the race
      // while we waited for the advisory lock, return their row.
      const winner = await tx.conversation.findUnique({
        where: { lookupKey },
      });
      if (winner) return winner;

      const id = newShortId();
      const conv = await tx.conversation.create({
        data: {
          id,
          contextType: ConversationContextType.service,
          contextId: args.serviceId,
          lookupKey,
        },
      });
      await tx.conversationParticipant.createMany({
        data: [
          { conversationId: id, userId: args.buyerId, role: 'buyer' },
          { conversationId: id, userId: args.creatorId, role: 'creator' },
        ],
        skipDuplicates: true,
      });
      return conv;
    });
  }

  /** Keep a retried inquiry in its original thread, including after order promotion. */
  async openServiceInquiry(
    args: OpenConversationArgs,
    firstMessage?: string,
    requestKey?: string,
  ) {
    const clientKey =
      firstMessage && requestKey
        ? `inq:${createHash('sha256')
            .update(JSON.stringify([args.serviceId, requestKey]))
            .digest('hex')
            .slice(0, 60)}`
        : null;
    return this.prisma.$transaction(async (tx) => {
      if (clientKey) {
        // Unlike the conversation lookup lock, this survives inquiry -> order promotion.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`service-inquiry:${args.buyerId}:${clientKey}`}, 0))`;
        const existing = await tx.message.findFirst({
          where: {
            authorId: args.buyerId,
            clientKey,
            conversation: {
              OR: [
                { contextType: 'service', contextId: args.serviceId },
                {
                  contextType: 'order',
                  order: { serviceId: args.serviceId, buyerId: args.buyerId },
                },
              ],
            },
          },
        });
        if (existing) {
          await this.assertConversationAccess(
            existing.conversationId,
            args.buyerId,
            tx,
          );
          if (existing.deletedAt)
            throw new ConflictException(
              'The original inquiry message is no longer available.',
            );
          this.assertIdempotentReplay(existing, 'text', firstMessage!, null);
          return {
            conv: { id: existing.conversationId },
            first: existing,
            created: false,
          };
        }
      }
      const conv = await this.openServiceConversation(args, tx);
      if (!firstMessage) return { conv, first: null, created: false };
      // Only this path may use a key in a caller transaction: admission is locked above.
      const result = await this.persist(
        conv.id,
        args.buyerId,
        'text',
        firstMessage,
        null,
        tx,
        clientKey,
        true,
      );
      return { conv, first: result.message, created: result.created };
    });
  }

  /**
   * Idempotent "open the crew's group chat". One crew, one row,
   * keyed `crew:<crewId>`.
   *
   * Concurrency is handled exactly as in `openServiceConversation` —
   * a transaction-scoped advisory lock on the lookup key, NOT P2002
   * recovery. Read that method's docstring for the full reasoning;
   * the short version is that this is routinely called with a
   * caller-supplied tx (adding the first member, posting the "crew
   * created" system message) and a unique violation inside someone
   * else's transaction poisons it with 25P02, taking the fallback
   * `findUnique` down with it.
   *
   * When the row is created, it seeds the WHOLE active crew roster
   * (founder included) into ConversationParticipant in the same
   * transaction. This is load-bearing for crews that predate group
   * chat: their first chat-producing event may be an assignment status
   * change or one newly-approved member, and projecting only that one
   * actor would create a "group" the rest of the crew cannot receive.
   *
   * Existing rows return through the fast path. Later roster changes
   * remain the caller's job via `syncCrewParticipant`, paired with the
   * membership write in the crews module's transaction.
   */
  async openCrewConversation(
    crewId: string,
    db: DbClient = this.prisma,
  ): Promise<PrismaConversation> {
    return this.openCrewChannel(crewId, CrewConversationChannel.team, db);
  }

  /** The crew's separate community room. It never grants crew membership. */
  async openCrewCommunityConversation(
    crewId: string,
    db: DbClient = this.prisma,
  ): Promise<PrismaConversation> {
    return this.openCrewChannel(crewId, CrewConversationChannel.community, db);
  }

  private async openCrewChannel(
    crewId: string,
    channel: CrewConversationChannel,
    db: DbClient,
  ): Promise<PrismaConversation> {
    const lookupKey = crewChannelLookupKey(crewId, channel);

    // Fast path — same argument as the service variant: a crew
    // conversation's lookupKey is written once and never rewritten
    // (only the service→order promotion rewrites keys), so an
    // unlocked read cannot observe a key mid-flight.
    const existing = await db.conversation.findUnique({
      where: { lookupKey },
    });
    if (existing) return existing;

    return await this.runInTx(db, async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lookupKey}, 0))`,
      );
      const winner = await tx.conversation.findUnique({
        where: { lookupKey },
      });
      if (winner) return winner;

      const crew = await tx.crew.findFirst({
        where: { id: crewId, deletedAt: null },
        select: { id: true },
      });
      if (!crew) throw new NotFoundException('Crew not found');

      const members = await tx.crewMember.findMany({
        where: { crewId, status: 'active' },
        select: { userId: true },
      });
      const conversation = await tx.conversation.create({
        data: {
          id: newShortId(),
          contextType: ConversationContextType.crew,
          contextId: crewId,
          crewChannel: channel,
          lookupKey,
        },
      });
      const userIds = new Set(members.map((member) => member.userId));
      await tx.conversationParticipant.createMany({
        data: [...userIds].map((userId) => ({
          conversationId: conversation.id,
          userId,
          role: ConversationParticipantRole.member,
        })),
        skipDuplicates: true,
      });
      return conversation;
    });
  }

  /**
   * Add one account to the community channel without adding it to `crew_members`.
   * The participant role describes room membership only; workspace authority
   * still comes exclusively from `crew_members`. Re-entry is idempotent.
   */
  async joinCrewCommunityConversation(
    crewId: string,
    userId: string,
    db: DbClient = this.prisma,
  ): Promise<PrismaConversation> {
    return this.runInTx(db, async (tx) => {
      const crew = await tx.crew.findFirst({
        where: { id: crewId, deletedAt: null },
        select: { id: true },
      });
      if (!crew) throw new NotFoundException('Crew not found');

      const conversation = await this.openCrewCommunityConversation(crewId, tx);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO conversation_participants (
          conversation_id,
          user_id,
          role,
          last_read_message_id,
          last_read_at
        )
        SELECT
          ${conversation.id},
          ${userId},
          ${ConversationParticipantRole.member}::conversation_participant_role,
          latest.id,
          latest.created_at
        FROM (SELECT 1) AS seed
        LEFT JOIN LATERAL (
          SELECT m.id, m.created_at
          FROM messages AS m
          WHERE m.conversation_id = ${conversation.id}
            AND m.deleted_at IS NULL
          ORDER BY m.created_at DESC, m.id DESC
          LIMIT 1
        ) AS latest ON TRUE
        ON CONFLICT (conversation_id, user_id)
        DO UPDATE SET left_at = NULL, role = EXCLUDED.role
      `);
      return conversation;
    });
  }

  /**
   * Project a crew membership change onto the crew's group chat.
   * Call from inside the transaction that adds or removes the
   * member, so the chat can never disagree with `crew_members`.
   *
   * `leave` sets `leftAt` instead of deleting the row. The read
   * cursor (`lastReadAt` / `lastReadMessageId`) survives, which buys
   * two things: an audit trail of what a departed member had already
   * seen, and a re-add that resumes their unread badge where they
   * left it rather than at "everything since the dawn of the crew".
   * `join` therefore clears `leftAt` on the existing row instead of
   * recreating it. A genuinely new participant starts at the latest
   * pre-join message: they may browse full history, but history from
   * before they belonged to the crew does not arrive as a giant unread
   * backlog. The member-joined system line is posted after this sync,
   * so it remains the first unread event.
   *
   * `leave` does NOT open the conversation. Someone leaving a crew
   * that never had a chat should not conjure one; there is nothing
   * to mark them absent from.
   */
  async syncCrewParticipant(
    crewId: string,
    userId: string,
    action: 'join' | 'leave',
    tx: TxClient,
  ): Promise<void> {
    // Membership changes and authored crew-message writes share this
    // lock. Whichever transaction acquires it first is the operation
    // that happened first: a send can no longer pass the membership
    // check, pause, then commit after a removal has completed.
    await this.lockCrewMembership(crewId, userId, tx);

    // A delayed roster-heal "join" may acquire the lock after a real
    // removal. The lock orders the operations, but only a fresh roster
    // read tells us which one won. Never clear `leftAt` from stale input.
    const mayJoin =
      action === 'join' && (await this.isActiveCrewMember(crewId, userId, tx));
    if (!mayJoin) {
      const conv = await tx.conversation.findUnique({
        where: { lookupKey: crewLookupKey(crewId) },
        select: { id: true },
      });
      if (!conv) return;
      await tx.conversationParticipant.updateMany({
        where: { conversationId: conv.id, userId, leftAt: null },
        data: { leftAt: new Date() },
      });
      return;
    }

    const conv = await this.openCrewConversation(crewId, tx);
    // Copy the pre-join baseline inside PostgreSQL. Prisma materializes
    // TIMESTAMPTZ as JavaScript Date, which would truncate a database
    // microsecond and leave the baseline message falsely unread.
    //
    // The conflict branch changes ONLY left_at: a returning member
    // resumes their old cursor instead of skipping messages posted
    // while they were away.
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO conversation_participants (
        conversation_id,
        user_id,
        role,
        last_read_message_id,
        last_read_at
      )
      SELECT
        ${conv.id},
        ${userId},
        ${ConversationParticipantRole.member}::conversation_participant_role,
        latest.id,
        latest.created_at
      FROM (SELECT 1) AS seed
      LEFT JOIN LATERAL (
        SELECT m.id, m.created_at
        FROM messages AS m
        WHERE m.conversation_id = ${conv.id}
          AND m.deleted_at IS NULL
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT 1
      ) AS latest ON TRUE
      ON CONFLICT (conversation_id, user_id)
      DO UPDATE SET left_at = NULL
    `);
  }

  // ─── Read ────────────────────────────────────────────────

  /**
   * Inbox feed. The participant projection selects the page; live crew
   * membership then filters it.
   *
   * The re-check is not belt-and-braces here. An inbox row carries the
   * crew's name, its logo and the last message's preview text, so a
   * stale `ConversationParticipant` row leaks the same content the
   * thread does. Someone the crew removed — or whose crew was
   * soft-deleted — has to stop seeing the row at the same moment they
   * stop being able to open it, not one missed sync later.
   *
   * Two batched queries for the whole page however many crew rows it
   * holds, and none at all for a page with none.
   *
   * Filtering happens AFTER the page is sliced and AFTER `nextCursor`
   * is taken, so the cursor keeps walking the raw DB order: dropping a
   * row shortens a page, it never skips the row behind it. A short page
   * with a non-null `nextCursor` is therefore correct and expected —
   * clients page on the cursor, not on `items.length`.
   */
  async listInbox(
    userId: string,
    opts: {
      limit: number;
      cursor?: string;
      contextType?: ConversationContextType;
    },
  ) {
    return this.readSnapshot(async (db) => {
      const rows = await db.conversation.findMany({
        where: {
          participants: { some: { userId, leftAt: null } },
          ...(opts.contextType ? { contextType: opts.contextType } : {}),
        },
        orderBy: [{ lastMessageAt: 'desc' }, { id: 'asc' }],
        take: opts.limit + 1,
        ...(opts.cursor ? { skip: 1, cursor: { id: opts.cursor } } : {}),
        include: { participants: true },
      });
      const hasMore = rows.length > opts.limit;
      const page = hasMore ? rows.slice(0, opts.limit) : rows;
      const nextCursor = hasMore ? page[page.length - 1].id : null;
      const visible = await this.filterLiveCrewRows(page, userId, db);
      const hydrated = await Promise.all(
        visible.map((c) => this.hydrate(c, userId, db)),
      );
      return { items: hydrated, nextCursor };
    });
  }

  /**
   * Drop the crew rows of a page the viewer is no longer entitled to:
   * crew soft-deleted, or membership ended while the participant
   * projection still says otherwise. Non-crew rows pass straight
   * through — a service / order thread has no crew to check.
   *
   * The set-shaped mirror of `isActiveCrewMember`. A crew absent from
   * `crews` (soft-deleted)
   * fails for everyone, so `founderOf.has()` is tested before the
   * membership set: a leftover `crew_members` row must not resurrect a
   * deleted crew's inbox row.
   */
  private async filterLiveCrewRows<
    T extends {
      contextType: ConversationContextType;
      contextId: string;
      crewChannel?: CrewConversationChannel | null;
    },
  >(rows: T[], userId: string, db: DbClient = this.prisma): Promise<T[]> {
    const crewIds = [
      ...new Set(
        rows
          .filter((r) => r.contextType === ConversationContextType.crew)
          .map((r) => r.contextId),
      ),
    ];
    if (crewIds.length === 0) return rows;

    const [crews, memberships] = await Promise.all([
      db.crew.findMany({
        where: { id: { in: crewIds }, deletedAt: null },
        select: { id: true },
      }),
      db.crewMember.findMany({
        where: { crewId: { in: crewIds }, userId, status: 'active' },
        select: { crewId: true },
      }),
    ]);
    const liveCrews = new Set(crews.map((crew) => crew.id));
    const memberOf = new Set(memberships.map((m) => m.crewId));

    return rows.filter((r) => {
      if (r.contextType !== ConversationContextType.crew) return true;
      if (!liveCrews.has(r.contextId)) return false;
      if (r.crewChannel === CrewConversationChannel.community) return true;
      return memberOf.has(r.contextId);
    });
  }

  /**
   * A detail row's participant projection can also be stale. Intersect
   * it with the live crew roster before returning the member list (and
   * before admitting the viewer), so a missed leave sync cannot inflate
   * the header count or expose a departed member's read cursor.
   */
  private async filterLiveCrewParticipants(
    conv: PrismaConversation & {
      participants: PrismaConversationParticipant[];
    },
    db: DbClient = this.prisma,
  ): Promise<
    PrismaConversation & {
      participants: PrismaConversationParticipant[];
    }
  > {
    if (conv.contextType !== ConversationContextType.crew) return conv;

    const crew = await db.crew.findFirst({
      where: { id: conv.contextId, deletedAt: null },
      select: { id: true },
    });
    if (!crew) return { ...conv, participants: [] };
    if (conv.crewChannel === CrewConversationChannel.community) return conv;

    const projectedUserIds = conv.participants.map((p) => p.userId);
    const memberships =
      projectedUserIds.length === 0
        ? []
        : await db.crewMember.findMany({
            where: {
              crewId: conv.contextId,
              userId: { in: projectedUserIds },
              status: 'active',
            },
            select: { userId: true },
          });
    const liveUserIds = new Set(memberships.map((m) => m.userId));
    return {
      ...conv,
      participants: conv.participants.filter((p) => liveUserIds.has(p.userId)),
    };
  }

  /**
   * The recipient-shaped mirror of `filterLiveCrewRows`: one channel,
   * many users, rather than one user, many channels.
   *
   * Fan-out is content-bearing — a frame carries the message body —
   * so it owes the same distrust of the participant projection that
   * read, send and mark-read already pay. `leftAt: null` alone is not
   * that: it is exactly the projection, and the module header claims
   * we do not trust it. A crew soft-deleted out from under an open
   * socket writes no `leftAt` at all, so without this the whole
   * roster keeps receiving from a crew that no longer exists.
   *
   * Two batched queries per crew broadcast, regardless of roster
   * size, and none at all for service/order threads.
   */
  private async liveCrewRecipients(
    crewId: string,
    channel: CrewConversationChannel | null,
    userIds: string[],
  ): Promise<Set<string>> {
    const crew = await this.prisma.crew.findFirst({
      where: { id: crewId, deletedAt: null },
      select: { id: true },
    });
    if (!crew) return new Set();
    if (channel === CrewConversationChannel.community) return new Set(userIds);
    const memberships = await this.prisma.crewMember.findMany({
      where: { crewId, userId: { in: userIds }, status: 'active' },
      select: { userId: true },
    });
    return new Set(memberships.map((m) => m.userId));
  }

  async detail(
    conversationId: string,
    viewerId: string,
  ): Promise<ConversationRowHydrated> {
    return this.readSnapshot(async (db) => {
      const row = await db.conversation.findUnique({
        where: { id: conversationId },
        // A left participant is retained as audit/read-cursor history,
        // not as a current member of the thread. Returning it here made
        // the crew header's member count grow forever and exposed stale
        // roster entries to every client.
        include: { participants: { where: { leftAt: null } } },
      });
      if (!row) throw new NotFoundException('Conversation not found');
      const visible = await this.filterLiveCrewParticipants(row, db);
      if (
        !visible.participants.some((p) => p.userId === viewerId && !p.leftAt)
      ) {
        throw new NotFoundException('Conversation not found');
      }
      return this.hydrate(visible, viewerId, db);
    });
  }

  async listMessages(
    conversationId: string,
    viewerId: string,
    opts: { limit: number; cursor?: string },
  ) {
    return this.readSnapshot(async (db) => {
      await this.assertConversationAccess(conversationId, viewerId, db);
      const rows = await db.message.findMany({
        where: { conversationId, deletedAt: null },
        // The `id` tiebreaker is load-bearing, not decoration.
        // `createdAt` is generated client-side by Prisma at millisecond
        // precision, so ties are ordinary. With a one-column,
        // non-unique orderBy the sort is only PARTIAL: Postgres is free
        // to return tied rows in any order, and in practice returns
        // them in physical heap order, which changes as rows are
        // updated. `cursor` + `skip: 1` then pages through an order
        // that is not stable between queries, so a tied burst both
        // repeats and silently drops messages. Making the sort TOTAL is
        // what fixes it — the fix is the uniqueness of the sort key,
        // not any particular thing Prisma emits.
        // `listInbox` above already does this.
        // Pinned by conversations.postgres.integration.spec.ts, which
        // forces the heap order to disagree with the logical order so
        // that dropping this line actually fails.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: opts.limit + 1,
        ...(opts.cursor ? { skip: 1, cursor: { id: opts.cursor } } : {}),
      });
      const hasMore = rows.length > opts.limit;
      const items = hasMore ? rows.slice(0, opts.limit) : rows;
      return {
        items,
        nextCursor: hasMore ? items[items.length - 1].id : null,
      };
    });
  }

  // ─── Persist (no broadcast) ──────────────────────────────

  /**
   * `clientKey` is the caller-supplied idempotency token from the
   * authenticated send path. Only legal when `db` is NOT a
   * caller-supplied transaction — see `persist`.
   */
  async persistText(
    conversationId: string,
    authorId: string,
    body: string,
    db: DbClient = this.prisma,
    clientKey: string | null = null,
  ): Promise<PrismaMessage> {
    return (
      await this.persist(
        conversationId,
        authorId,
        'text',
        body,
        null,
        db,
        clientKey,
      )
    ).message;
  }

  private persistTextResult(
    conversationId: string,
    authorId: string,
    body: string,
    clientKey: string | null,
    mentions: ConversationMentionPayload[] = [],
    tasks: ConversationTaskReferencePayload[] = [],
  ): Promise<PersistResult> {
    const payload: MessagePayload | null =
      mentions.length > 0 || tasks.length > 0
        ? {
            kind: 'text',
            ...(mentions.length > 0 ? { mentions } : {}),
            ...(tasks.length > 0 ? { tasks } : {}),
          }
        : null;
    return this.persist(
      conversationId,
      authorId,
      'text',
      body,
      payload,
      this.prisma,
      clientKey,
    );
  }

  async persistProposal(
    conversationId: string,
    authorId: string,
    input: SendProposalInput,
    db: DbClient = this.prisma,
  ): Promise<PrismaMessage> {
    return (
      await this.persistProposalResult(conversationId, authorId, input, db)
    ).message;
  }

  private async persistProposalResult(
    conversationId: string,
    authorId: string,
    input: SendProposalInput,
    db: DbClient = this.prisma,
  ): Promise<PersistResult> {
    await this.assertProposalContext(
      conversationId,
      authorId,
      db,
      !!input.clientKey,
    );
    const proposal: ProposalPayload = {
      status: 'open',
      packageTier: input.packageTier,
      price: input.price,
      currency: input.currency,
      deliveryDays: input.deliveryDays,
      revisions: input.revisions,
      scope: input.scope,
      note: input.note,
    };
    const payload: MessagePayload = { kind: 'proposal', proposal };
    return this.runInTx(db, async (tx) => {
      if (input.clientKey)
        await this.lockMessageKey(
          tx,
          conversationId,
          authorId,
          input.clientKey,
        );
      // Match order admission's participant-before-conversation lock order.
      // Hold both through persistence so departure, role changes and inquiry
      // conversion cannot slip between the eligibility check and the write.
      await tx.$queryRaw`SELECT user_id FROM conversation_participants WHERE conversation_id = ${conversationId} AND user_id = ${authorId} FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM conversations WHERE id = ${conversationId} FOR UPDATE`;
      await this.assertProposalContext(
        conversationId,
        authorId,
        tx,
        !!input.clientKey,
      );
      if (input.clientKey) {
        const existing = await tx.message.findFirst({
          where: { conversationId, authorId, clientKey: input.clientKey },
        });
        if (existing) {
          this.assertProposalReplay(existing, input);
          return { message: existing, created: false };
        }
      }
      // An existing receipt may be read after conversion; a new offer may not.
      await this.assertProposalContext(conversationId, authorId, tx);
      return this.persist(
        conversationId,
        authorId,
        'proposal',
        input.note,
        payload,
        tx,
        input.clientKey ?? null,
        true,
      );
    });
  }

  private async assertProposalContext(
    conversationId: string,
    authorId: string,
    db: DbClient,
    allowOrderReceipt = false,
  ) {
    const participant = await this.assertParticipant(
      conversationId,
      authorId,
      db,
    );
    if (participant.role !== 'creator') {
      throw new ForbiddenException('Only the creator can send a proposal');
    }
    const conv = await db.conversation.findUnique({
      where: { id: conversationId },
      select: { contextType: true },
    });
    if (
      !conv ||
      (conv.contextType !== 'service' &&
        !(allowOrderReceipt && conv.contextType === 'order'))
    ) {
      throw new ConflictException('Proposals only valid on service inquiries');
    }
  }

  /**
   * Deliberately takes NO `clientKey`. This runs inside other
   * modules' transactions (orders.service.ts), where provoking a
   * P2002 to detect a duplicate would abort the outer tx and turn
   * every later statement into a 25P02. System messages are emitted
   * by server-side state machines that already own their own
   * idempotency, so there is nothing to dedupe here anyway.
   */
  async persistSystem(
    conversationId: string,
    kind: SystemMessageKind,
    params: Record<string, string | number> = {},
    db: DbClient = this.prisma,
  ): Promise<PrismaMessage> {
    const system: SystemMessagePayload = { kind, params };
    const payload: MessagePayload = { kind: 'system', system };
    return (await this.persist(conversationId, null, 'system', '', payload, db))
      .message;
  }

  async persistProposalStatusPatch(
    conversationId: string,
    messageId: string,
    patch: {
      status: ProposalPayload['status'];
      orderId?: string | null;
      acceptedAt?: string | null;
      declinedAt?: string | null;
    },
    db: DbClient = this.prisma,
  ): Promise<PrismaMessage> {
    const message = await db.message.findUnique({ where: { id: messageId } });
    if (!message || message.conversationId !== conversationId) {
      throw new NotFoundException('Proposal not found in this conversation');
    }
    if (message.type !== 'proposal') {
      throw new BadRequestException('Message is not a proposal');
    }
    const current = (message.payload ?? null) as MessagePayload | null;
    if (!current || current.kind !== 'proposal') {
      throw new BadRequestException('Proposal payload missing');
    }
    const updated: ProposalPayload = {
      ...current.proposal,
      status: patch.status,
      orderId: patch.orderId ?? current.proposal.orderId ?? null,
      acceptedAt: patch.acceptedAt ?? current.proposal.acceptedAt ?? null,
      declinedAt: patch.declinedAt ?? current.proposal.declinedAt ?? null,
    };
    const newPayload: MessagePayload = { kind: 'proposal', proposal: updated };
    return db.message.update({
      where: { id: messageId },
      data: { payload: newPayload as unknown as Prisma.InputJsonValue },
    });
  }

  async persistEvolveToOrder(
    conversationId: string,
    orderId: string,
    db: DbClient = this.prisma,
  ): Promise<PendingContextChange> {
    const conv = await db.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conv) throw new NotFoundException('Conversation not found');
    if (conv.contextType !== 'service') {
      throw new ConflictException('Conversation is not in service context');
    }
    const newKey = orderLookupKey(orderId);
    const updated = await db.conversation.update({
      where: { id: conversationId },
      data: {
        contextType: ConversationContextType.order,
        contextId: orderId,
        lookupKey: newKey,
      },
    });
    return {
      conversation: updated,
      from: ConversationContextType.service,
      to: ConversationContextType.order,
    };
  }

  // ─── Public broadcast helpers ────────────────────────────

  /**
   * Push a `message.created` frame to every ACTIVE participant. Safe
   * to call from outside the persisting tx — pulls fresh
   * conversation/participants from the DB.
   *
   * `leftAt: null` is a security filter, not a tidiness one: a
   * removed member's socket stays open until they close the tab, so
   * fanning out to departed participants kept streaming a crew's
   * messages to someone who had been kicked out of it.
   *
   * Shape of the work: 1 conversation load + 1 grouped unread query +
   * N publishes issued concurrently. It used to be 1 load + N
   * sequential COUNT(*) + N sequentially awaited publishes, all on
   * the sender's request path — a 30-member crew paid ~61 serial
   * round-trips per message.
   *
   * `unreadCount` stays in the frame; it is part of the wire contract
   * (packages/shared/src/conversation.ts) and drives the nav bell
   * badge without a follow-up request.
   *
   * This wrapper is the request-path fast path. It never turns a committed
   * message into an HTTP failure: on success it acknowledges the durable
   * outbox row, and on failure it leaves that row pending for the dispatcher.
   */
  async broadcastMessage(message: PrismaMessage): Promise<void> {
    if (!backgroundTasksEnabled()) return;
    try {
      await this.deliverMessageRealtime(message);
      await this.prisma.conversationRealtimeOutbox.updateMany({
        where: {
          messageId: message.id,
          dispatchedAt: null,
          deadAt: null,
          lockedAt: null,
        },
        data: {
          dispatchedAt: new Date(),
          lockedAt: null,
          lockedBy: null,
          lastError: null,
          nextAttemptAt: null,
        },
      });
    } catch (err) {
      this.logger.warn(
        `conversation realtime fast-path failed conversationId=${message.conversationId} messageId=${message.id}; durable outbox will retry: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Deliver one committed message to Ably. Unlike `broadcastMessage`, this
   * method deliberately throws on any room or user-channel failure so the
   * durable dispatcher can retry the whole idempotent fan-out.
   */
  async deliverMessageRealtime(message: PrismaMessage): Promise<void> {
    if (!backgroundTasksEnabled()) return;
    const conv = await this.prisma.conversation.findUnique({
      where: { id: message.conversationId },
      include: { participants: { where: { leftAt: null } } },
    });
    if (!conv || conv.participants.length === 0) return;

    // `leftAt: null` is the projection, and the projection is exactly
    // what this module does not trust for crew threads — see
    // `liveCrewRecipients`.
    const participants =
      conv.contextType === ConversationContextType.crew
        ? await this.liveCrewRecipients(
            conv.contextId,
            conv.crewChannel,
            conv.participants.map((p) => p.userId),
          ).then((live) => conv.participants.filter((p) => live.has(p.userId)))
        : conv.participants;
    if (participants.length === 0) return;

    const unread = await this.unreadCountsFor(
      conv.id,
      participants.map((p) => p.userId),
    );
    const dto = {
      id: message.id,
      conversationId: message.conversationId,
      authorId: message.authorId,
      type: message.type as ConversationMessageType,
      body: message.body,
      payload: (message.payload ?? null) as MessagePayload | null,
      createdAt: message.createdAt.toISOString(),
    };
    const lastMessageAt = conv.lastMessageAt.toISOString();

    if (conv.contextType === ConversationContextType.crew) {
      const roomFrame: ConversationFrame = {
        event: 'message.created',
        data: {
          conversationId: conv.id,
          message: dto,
          lastMessageAt,
          // Shared room signal; the private user channel carries the
          // personalized unread count.
          unreadCount: 0,
        },
      };
      await this.realtime.publishCrewMessage(
        conv.id,
        roomFrame,
        `conversation:${conv.id}:message:${message.id}`,
      );
    }

    await Promise.all(
      participants.map((p) => {
        const frame: ConversationFrame = {
          event: 'message.created',
          data: {
            conversationId: conv.id,
            message: dto,
            lastMessageAt,
            unreadCount: unread.get(p.userId) ?? 0,
          },
        };
        return this.realtime.publishUserFrame(
          p.userId,
          frame,
          `conversation:${conv.id}:message:${message.id}:user:${p.userId}`,
        );
      }),
    );
  }

  async broadcastContextChange(change: PendingContextChange): Promise<void> {
    // Active participants only, and for a crew only those still
    // actually in it — see `liveCrewRecipients` in broadcastMessage.
    const projected = await this.prisma.conversationParticipant.findMany({
      where: { conversationId: change.conversation.id, leftAt: null },
      select: { userId: true },
    });
    const participants =
      change.conversation.contextType === ConversationContextType.crew
        ? await this.liveCrewRecipients(
            change.conversation.contextId,
            change.conversation.crewChannel,
            projected.map((p) => p.userId),
          ).then((live) => projected.filter((p) => live.has(p.userId)))
        : projected;
    const frame: ConversationFrame = {
      event: 'context.changed',
      data: {
        conversationId: change.conversation.id,
        from: change.from,
        to: change.to,
        contextId: change.conversation.contextId,
      },
    };
    await Promise.all(
      participants.map((p) =>
        this.publishToUser(
          p.userId,
          frame,
          `conversation:${change.conversation.id}:context:${change.to}:user:${p.userId}`,
        ),
      ),
    );
  }

  /**
   * Domain invalidation frame for the Issue-style crew task surface.
   * Carries no protected task content: clients refetch the authoritative
   * permission-filtered REST resource. Recipients come from the live crew
   * roster rather than the chat participant projection.
   */
  async broadcastCrewTaskChange(
    crewId: string,
    taskId: string,
    action: 'created' | 'updated' | 'commented' | 'submitted' | 'reviewed',
    actorUserId: string | null,
  ): Promise<void> {
    try {
      const [crew, members] = await Promise.all([
        this.prisma.crew.findFirst({
          where: { id: crewId, deletedAt: null },
          select: { id: true },
        }),
        this.prisma.crewMember.findMany({
          where: { crewId, status: 'active' },
          select: { userId: true },
        }),
      ]);
      if (!crew) return;
      const recipientIds = new Set(members.map((member) => member.userId));
      const frame: ConversationFrame = {
        event: 'crew.task.changed',
        data: { crewId, taskId, action, actorUserId },
      };
      const eventId = newShortId();
      await Promise.all(
        [...recipientIds].map((recipientId) =>
          this.publishToUser(
            recipientId,
            frame,
            `crew:${crewId}:task:${taskId}:${action}:event:${eventId}:user:${recipientId}`,
          ),
        ),
      );
    } catch (err) {
      this.logger.warn(
        `crew task publish failed crewId=${crewId} taskId=${taskId} err=${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Shared planning configuration invalidation. Project settings are
   * collaborative state too: another open browser must not keep stale labels,
   * cycles, workflow columns, fields, or saved views after an admin changes
   * them. The frame carries identifiers only; every client refetches the
   * permission-filtered project and task views from PostgreSQL.
   */
  async broadcastCrewTaskProjectChange(
    crewId: string,
    resource:
      | 'view'
      | 'workflow'
      | 'cycle'
      | 'label'
      | 'field'
      | 'production_document'
      | 'production_project'
      | 'production_resource'
      | 'production_activity'
      | 'episode'
      | 'delivery',
    resourceId: string,
    action: 'created' | 'updated' | 'deleted' | 'reordered',
    actorUserId: string | null,
  ): Promise<void> {
    try {
      const [crew, members] = await Promise.all([
        this.prisma.crew.findFirst({
          where: { id: crewId, deletedAt: null },
          select: { id: true },
        }),
        this.prisma.crewMember.findMany({
          where: { crewId, status: 'active' },
          select: { userId: true },
        }),
      ]);
      if (!crew) return;
      const recipientIds = new Set(members.map((member) => member.userId));
      const frame: ConversationFrame = {
        event: 'crew.task.project.changed',
        data: { crewId, resource, resourceId, action, actorUserId },
      };
      const eventId = newShortId();
      await Promise.all(
        [...recipientIds].map((recipientId) =>
          this.publishToUser(
            recipientId,
            frame,
            `crew:${crewId}:task-project:${resource}:${resourceId}:${action}:event:${eventId}:user:${recipientId}`,
          ),
        ),
      );
    } catch (err) {
      this.logger.warn(
        `crew task project publish failed crewId=${crewId} resource=${resource} resourceId=${resourceId} err=${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Crew asset metadata and access changes are collaborative state. The
   * payload intentionally contains no file metadata or signed URL: recipients
   * invalidate their permission-filtered asset queries and refetch from
   * PostgreSQL.
   */
  async broadcastCrewAssetChange(
    crewId: string,
    nodeId: string,
    action:
      | 'created'
      | 'updated'
      | 'trashed'
      | 'restored'
      | 'deleted'
      | 'permissions_updated',
    actorUserId: string | null,
  ): Promise<void> {
    try {
      const [crew, members] = await Promise.all([
        this.prisma.crew.findFirst({
          where: { id: crewId, deletedAt: null },
          select: { id: true },
        }),
        this.prisma.crewMember.findMany({
          where: { crewId, status: 'active' },
          select: { userId: true },
        }),
      ]);
      if (!crew) return;
      const recipientIds = new Set(members.map((member) => member.userId));
      const frame: ConversationFrame = {
        event: 'crew.asset.changed',
        data: { crewId, nodeId, action, actorUserId },
      };
      const eventId = newShortId();
      await Promise.all(
        [...recipientIds].map((recipientId) =>
          this.publishToUser(
            recipientId,
            frame,
            `crew:${crewId}:asset:${nodeId}:${action}:event:${eventId}:user:${recipientId}`,
          ),
        ),
      );
    } catch (err) {
      this.logger.warn(
        `crew asset publish failed crewId=${crewId} nodeId=${nodeId} action=${action} err=${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // ─── Convenience wrappers (persist + broadcast) ──────────
  //
  // These call the persist methods without a tx, then immediately
  // broadcast. Use from controllers / direct call sites that have
  // no surrounding business transaction.

  /**
   * `clientKey` — optional idempotency token from the client. A
   * retried send resolves to the row the first attempt created without
   * broadcasting it again. The HTTP response repairs the sender's local
   * cache; every other recipient already received (or can REST-recover)
   * the original persisted row. Re-broadcasting a replay made every
   * recipient process duplicate frames and could produce duplicate
   * desktop toasts despite the message-id cache dedupe.
   */
  async sendText(
    conversationId: string,
    authorId: string,
    body: string,
    clientKey: string | null = null,
    mentions: ConversationMentionPayload[] = [],
    tasks: TaskReferenceInput[] = [],
  ): Promise<PrismaMessage> {
    const [validatedMentions, validatedTasks] = await Promise.all([
      this.validateMentions(conversationId, authorId, body, mentions),
      this.validateTaskReferences(conversationId, authorId, body, tasks),
    ]);
    const result = await this.persistTextResult(
      conversationId,
      authorId,
      body,
      clientKey,
      validatedMentions,
      validatedTasks,
    );
    await this.notifyMentions(result.message, authorId, validatedMentions);
    if (result.created) {
      await this.broadcastMessage(result.message);
    }
    return result.message;
  }

  async sendAttachments(
    conversationId: string,
    authorId: string,
    input: SendAttachmentsInput,
  ): Promise<PrismaMessage> {
    const access = await this.assertConversationAccess(
      conversationId,
      authorId,
    );
    if (
      access.conversation.contextType !== ConversationContextType.crew ||
      access.conversation.crewChannel === CrewConversationChannel.community
    ) {
      throw new BadRequestException(
        'Attachments are currently available in crew conversations only',
      );
    }
    const mentions = await this.validateMentions(
      conversationId,
      authorId,
      input.body,
      input.mentions,
    );
    const crewId = access.conversation.contextId;
    const tasks = await this.validateTaskReferencesForCrew(
      crewId,
      input.body,
      input.tasks,
    );
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockCrewMembership(crewId, authorId, tx);
      await this.assertConversationAccess(conversationId, authorId, tx);

      if (input.clientKey) {
        // Unlike the generic message path, attachment sends also create asset
        // nodes. Serialize one logical send before checking the message row so
        // two in-flight retries cannot each create a visible copy.
        await tx.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(
            hashtextextended(
              ${`conversation-attachment-send:${conversationId}:${authorId}:${input.clientKey}`},
              0
            )
          )`,
        );
        const existing = await tx.message.findFirst({
          where: {
            conversationId,
            authorId,
            clientKey: input.clientKey,
          },
        });
        if (existing) {
          this.assertAttachmentReplay(existing, input, mentions, tasks);
          return { message: existing, created: false };
        }
      }

      const existingIds = input.attachments
        .filter(
          (
            item,
          ): item is Extract<
            SendAttachmentsInput['attachments'][number],
            { source: 'asset' }
          > => item.source === 'asset',
        )
        .map((item) => item.assetNodeId);
      const uploadIds = input.attachments
        .filter(
          (
            item,
          ): item is Extract<
            SendAttachmentsInput['attachments'][number],
            { source: 'upload' }
          > => item.source === 'upload',
        )
        .map((item) => item.mediaAssetId);

      await lockCrewAssetUploads(tx, uploadIds);
      const [nodes, uploadedMedia] = [
        await tx.crewAssetNode.findMany({
          where: {
            id: { in: existingIds },
            crewId,
            kind: CrewAssetNodeKind.file,
            status: CrewAssetNodeStatus.active,
            mediaAssetId: { not: null },
            mediaAsset: { status: MediaAssetStatus.ready },
          },
          include: { mediaAsset: true },
        }),
        await tx.mediaAsset.findMany({
          where: {
            id: { in: uploadIds },
            status: MediaAssetStatus.ready,
            deletedAt: null,
          },
          select: {
            id: true,
            kind: true,
            contentType: true,
            sizeBytes: true,
            createdByUserId: true,
            metadata: true,
          },
        }),
      ];
      if (nodes.length !== existingIds.length) {
        throw new BadRequestException({
          message: 'One or more attached crew assets are unavailable.',
        });
      }
      if (uploadedMedia.length !== uploadIds.length) {
        throw new BadRequestException({
          message: 'One or more uploaded files are unavailable.',
        });
      }

      const nodeById = new Map(nodes.map((node) => [node.id, node]));
      const uploadById = new Map(
        uploadedMedia.map((media) => [media.id, media]),
      );
      for (const media of uploadedMedia) {
        const metadata =
          media.metadata &&
          typeof media.metadata === 'object' &&
          !Array.isArray(media.metadata)
            ? media.metadata
            : {};
        if (
          media.createdByUserId !== authorId ||
          metadata.crewId !== crewId ||
          metadata.uploadKind !== 'crew_asset_file'
        ) {
          throw new ForbiddenException({
            code: 'CREW_CHAT_UPLOAD_SCOPE_MISMATCH',
            message:
              'One or more uploaded files do not belong to this crew and user.',
          });
        }
      }

      const requestedUploads = input.attachments.filter(
        (item) => item.source === 'upload',
      );
      const usedNames = new Set<string>();
      if (requestedUploads.length > 0) {
        // Root naming is a shared namespace. Lock it before choosing suffixes
        // so simultaneous "shot.png" sends converge to shot.png / shot (2).png
        // instead of racing the partial unique index.
        await tx.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(
            hashtextextended(${`crew-asset-root-names:${crewId}`}, 0)
          )`,
        );
        const rootNodes = await tx.crewAssetNode.findMany({
          where: {
            crewId,
            parentId: null,
            status: CrewAssetNodeStatus.active,
          },
          select: { name: true },
        });
        rootNodes.forEach((node) => usedNames.add(node.name.toLowerCase()));
      }

      const attachments: ConversationAttachmentPayload[] = [];
      for (const item of input.attachments) {
        if (item.source === 'asset') {
          const node = nodeById.get(item.assetNodeId)!;
          const media = node.mediaAsset!;
          attachments.push({
            assetNodeId: node.id,
            mediaAssetId: media.id,
            name: node.name,
            mediaKind: media.kind,
            contentType: media.contentType,
            sizeBytes: media.sizeBytes == null ? null : Number(media.sizeBytes),
          });
          continue;
        }

        const media = uploadById.get(item.mediaAssetId)!;
        const name = availableCrewAssetName(item.name, usedNames);
        usedNames.add(name.toLowerCase());
        const node = await tx.crewAssetNode.create({
          data: {
            crewId,
            parentId: null,
            kind: CrewAssetNodeKind.file,
            name,
            mediaAssetId: media.id,
            createdByUserId: authorId,
            updatedByUserId: authorId,
          },
          select: { id: true },
        });
        attachments.push({
          assetNodeId: node.id,
          mediaAssetId: media.id,
          name,
          mediaKind: media.kind,
          contentType: media.contentType,
          sizeBytes: media.sizeBytes == null ? null : Number(media.sizeBytes),
        });
      }

      const payload: MessagePayload = {
        kind: 'attachments',
        attachments,
        ...(mentions.length > 0 ? { mentions } : {}),
        ...(tasks.length > 0 ? { tasks } : {}),
      };
      const type = attachments.every((item) => item.mediaKind === 'image')
        ? 'image'
        : 'file';
      const created = await tx.message.create({
        data: {
          id: newShortId(),
          conversationId,
          authorId,
          type,
          body: input.body,
          payload: payload as unknown as Prisma.InputJsonValue,
          clientKey: input.clientKey ?? null,
        },
      });
      await tx.$executeRaw(Prisma.sql`
        UPDATE conversations AS c
        SET last_message_at = GREATEST(c.last_message_at, m.created_at)
        FROM messages AS m
        WHERE c.id = ${conversationId}
          AND m.id = ${created.id}
          AND m.conversation_id = c.id
      `);
      await this.enqueueMessageRealtime(tx, created);
      return { message: created, created: true };
    });
    await this.notifyMentions(result.message, authorId, mentions, crewId);
    if (result.created) await this.broadcastMessage(result.message);
    return result.message;
  }

  private assertAttachmentReplay(
    existing: PrismaMessage,
    input: SendAttachmentsInput,
    mentions: ConversationMentionPayload[],
    tasks: ConversationTaskReferencePayload[],
  ): void {
    if (existing.deletedAt)
      throw new ConflictException(
        'The original message is no longer available',
      );
    const payload = (existing.payload ?? null) as MessagePayload | null;
    const sameAttachments =
      payload?.kind === 'attachments' &&
      payload.attachments.length === input.attachments.length &&
      input.attachments.every((item, index) => {
        const persisted = payload.attachments[index];
        return item.source === 'asset'
          ? persisted?.assetNodeId === item.assetNodeId
          : persisted?.mediaAssetId === item.mediaAssetId;
      });
    const persistedMentions =
      payload?.kind === 'attachments' ? (payload.mentions ?? []) : [];
    const persistedTasks =
      payload?.kind === 'attachments' ? (payload.tasks ?? []) : [];
    if (
      (existing.type === 'image' || existing.type === 'file') &&
      existing.body === input.body &&
      sameAttachments &&
      isDeepStrictEqual(persistedMentions, mentions) &&
      isDeepStrictEqual(persistedTasks, tasks)
    ) {
      return;
    }
    throw new ConflictException({
      message: 'Idempotency key was already used for a different message',
      existingMessageId: existing.id,
    });
  }

  async sendProposal(
    conversationId: string,
    authorId: string,
    input: SendProposalInput,
  ): Promise<PrismaMessage> {
    const result = await this.persistProposalResult(
      conversationId,
      authorId,
      input,
    );
    if (result.created) await this.broadcastMessage(result.message);
    return result.message;
  }

  async postSystem(
    conversationId: string,
    kind: SystemMessageKind,
    params: Record<string, string | number> = {},
  ): Promise<PrismaMessage> {
    const msg = await this.persistSystem(conversationId, kind, params);
    await this.broadcastMessage(msg);
    return msg;
  }

  async patchProposalStatus(
    conversationId: string,
    messageId: string,
    patch: {
      status: ProposalPayload['status'];
      orderId?: string | null;
      acceptedAt?: string | null;
      declinedAt?: string | null;
    },
  ): Promise<PrismaMessage> {
    const msg = await this.persistProposalStatusPatch(
      conversationId,
      messageId,
      patch,
    );
    await this.broadcastMessage(msg);
    return msg;
  }

  /**
   * Buyer-initiated proposal decline. Atomic — locks the proposal
   * row inside the tx, asserts current status is `open`, patches
   * to `declined`, posts a `proposal.declined` system message, all
   * in one transaction. Broadcasts after commit.
   *
   * Throws 409 if the proposal is no longer open (e.g. the buyer
   * accepted it on another tab, or the creator's already
   * superseded it).
   */
  /**
   * Inside the proposal-accept tx: flip every OTHER currently-open
   * proposal in the conversation to `cancelled`. Without this, the
   * timeline keeps stale "open" siblings after accept — the
   * conversation has already evolved to order-context so those
   * proposals are unreachable, but a stale render might still let
   * the buyer click Accept (which then 409s on context check).
   *
   * Returns the list of patched messages so the caller can
   * broadcast them after their outer tx commits.
   */
  async persistCancelOtherOpenProposals(
    conversationId: string,
    exceptMessageId: string,
    db: DbClient = this.prisma,
  ): Promise<PrismaMessage[]> {
    const siblings = await db.message.findMany({
      where: {
        conversationId,
        type: 'proposal',
        id: { not: exceptMessageId },
        deletedAt: null,
      },
    });
    const patched: PrismaMessage[] = [];
    for (const sibling of siblings) {
      const payload = (sibling.payload ?? null) as MessagePayload | null;
      if (!payload || payload.kind !== 'proposal') continue;
      if (payload.proposal.status !== 'open') continue;
      patched.push(
        await this.persistProposalStatusPatch(
          conversationId,
          sibling.id,
          {
            status: 'cancelled',
            declinedAt: new Date().toISOString(),
          },
          db,
        ),
      );
    }
    return patched;
  }

  async declineProposal(
    conversationId: string,
    buyerId: string,
    proposalMessageId: string,
  ): Promise<PrismaMessage> {
    const participant = await this.assertParticipant(conversationId, buyerId);
    if (participant.role !== 'buyer') {
      throw new ForbiddenException('Only the buyer can decline a proposal');
    }

    const pendingMessages: PrismaMessage[] = [];
    const patched = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT user_id FROM conversation_participants WHERE conversation_id = ${conversationId} AND user_id = ${buyerId} FOR SHARE`;
      const current = await this.assertParticipant(conversationId, buyerId, tx);
      if (current.role !== 'buyer')
        throw new ForbiddenException('Only the buyer can decline a proposal');
      await lockProposalsAndAssertOpen(tx, conversationId, proposalMessageId);
      const updated = await this.persistProposalStatusPatch(
        conversationId,
        proposalMessageId,
        {
          status: 'declined',
          declinedAt: new Date().toISOString(),
        },
        tx,
      );
      pendingMessages.push(updated);
      const sys = await this.persistSystem(
        conversationId,
        'proposal.declined',
        { proposalId: proposalMessageId },
        tx,
      );
      pendingMessages.push(sys);
      return updated;
    });
    for (const m of pendingMessages) await this.broadcastMessage(m);
    return patched;
  }

  async evolveToOrderContext(
    conversationId: string,
    orderId: string,
  ): Promise<PrismaConversation> {
    const change = await this.persistEvolveToOrder(conversationId, orderId);
    await this.broadcastContextChange(change);
    return change.conversation;
  }

  // ─── Read cursor ─────────────────────────────────────────

  /**
   * Advance the caller's read cursor to `lastReadMessageId`.
   *
   * The gate is `assertConversationAccess`, not `assertParticipant`:
   * marking read is content-adjacent, not bookkeeping. It reveals
   * whether a given message id lives in this thread, it moves a cursor
   * every other member can see, and it publishes a `read.advanced`
   * frame into the thread. A crew outsider holding a stale-but-active
   * participant row could do all three — and that stale row is exactly
   * what the crew gate exists to distrust.
   *
   * Access is asserted BEFORE the message is looked up. The old
   * order let a removed participant probe which message ids exist in
   * a conversation they had been ejected from ("message not found"
   * vs "conversation not found"), and — because the participant row
   * was fetched with a bare `findUnique` that ignored `leftAt` —
   * actually let them advance their cursor and broadcast a
   * read-receipt into a thread they were no longer in.
   *
   * The advance itself is one SQL UPDATE joined to the Message row, so
   * the monotonicity check and write are atomic and `last_read_at`
   * receives Postgres' original microsecond timestamp. Routing that
   * value through JavaScript `Date` would truncate it to milliseconds;
   * the just-read message would then still compare newer than its own
   * cursor and remain unread forever.
   */
  async markRead(
    conversationId: string,
    userId: string,
    lastReadMessageId: string,
  ) {
    const { conversation } = await this.assertConversationAccess(
      conversationId,
      userId,
    );

    const message = await this.prisma.message.findUnique({
      where: { id: lastReadMessageId },
    });
    if (!message || message.conversationId !== conversationId) {
      throw new NotFoundException('Message not found in this conversation');
    }

    const [advanced] = await this.prisma.$queryRaw<
      PrismaConversationParticipant[]
    >(Prisma.sql`
      UPDATE conversation_participants AS p
      SET last_read_message_id = m.id,
          last_read_at = m.created_at
      FROM messages AS m
      WHERE p.conversation_id = ${conversationId}
        AND p.user_id = ${userId}
        AND p.left_at IS NULL
        AND m.id = ${lastReadMessageId}
        AND m.conversation_id = ${conversationId}
        AND (
          p.last_read_at IS NULL
          OR (p.last_read_at, COALESCE(p.last_read_message_id, ''))
             < (m.created_at, m.id)
        )
      RETURNING
        p.conversation_id AS "conversationId",
        p.user_id AS "userId",
        p.role,
        p.last_read_message_id AS "lastReadMessageId",
        p.last_read_at AS "lastReadAt",
        p.muted_until AS "mutedUntil",
        p.joined_at AS "joinedAt",
        p.left_at AS "leftAt"
    `);
    if (!advanced) {
      // Another request may already have advanced beyond this target.
      // Return the database's current cursor, not the participant row
      // captured by the access check before that concurrent update.
      const current = await this.prisma.conversationParticipant.findUnique({
        where: { conversationId_userId: { conversationId, userId } },
      });
      if (!current || current.leftAt) {
        throw new NotFoundException('Conversation not found');
      }
      return current;
    }

    // Read receipts go to active participants only — a departed
    // member's open socket is not entitled to the thread's activity.
    const projected = await this.prisma.conversationParticipant.findMany({
      where: { conversationId, leftAt: null },
      select: { userId: true },
    });
    const recipients =
      conversation.contextType === ConversationContextType.crew
        ? await this.liveCrewRecipients(
            conversation.contextId,
            conversation.crewChannel,
            projected.map((p) => p.userId),
          ).then((live) => projected.filter((p) => live.has(p.userId)))
        : projected;
    const frame: ConversationFrame = {
      event: 'read.advanced',
      data: {
        conversationId,
        userId,
        lastReadMessageId: message.id,
      },
    };
    await Promise.all(
      recipients.map((p) =>
        this.publishToUser(
          p.userId,
          frame,
          `conversation:${conversationId}:read:${userId}:${message.id}:user:${p.userId}`,
        ),
      ),
    );
    return advanced;
  }

  // ─── Internals ───────────────────────────────────────────

  /**
   * Resolve the structured identities behind inline @labels.
   *
   * Mentions are crew-only today: two-party service/order threads do
   * not need a picker, while crew notifications must never target an
   * id that is outside the live roster. The human-readable label must
   * also still exist in the submitted body; this keeps the payload and
   * what readers actually see from drifting apart after an edited draft.
   */
  private async validateMentions(
    conversationId: string,
    authorId: string,
    body: string,
    mentions: ConversationMentionPayload[],
  ): Promise<ConversationMentionPayload[]> {
    if (mentions.length === 0) return [];

    const { conversation } = await this.assertConversationAccess(
      conversationId,
      authorId,
    );
    if (
      conversation.contextType !== ConversationContextType.crew ||
      conversation.crewChannel === CrewConversationChannel.community
    ) {
      throw new BadRequestException(
        'Mentions are currently available in crew conversations only',
      );
    }

    const unique = new Map<string, ConversationMentionPayload>();
    for (const mention of mentions) {
      if (mention.userId === authorId) {
        throw new BadRequestException('You cannot mention yourself');
      }
      if (!body.includes(`@${mention.label}`)) {
        throw new BadRequestException(
          `Mention @${mention.label} is not present in the message body`,
        );
      }
      const prior = unique.get(mention.userId);
      if (prior && prior.label !== mention.label) {
        throw new BadRequestException(
          'A mentioned member cannot carry multiple display labels',
        );
      }
      unique.set(mention.userId, mention);
    }

    const normalized = [...unique.values()];
    const live = await this.liveCrewRecipients(
      conversation.contextId,
      conversation.crewChannel,
      normalized.map((mention) => mention.userId),
    );
    if (live.size !== normalized.length) {
      throw new BadRequestException(
        'One or more mentioned users are no longer active crew members',
      );
    }
    return normalized;
  }

  /**
   * Resolve the stable task identities behind inline #labels.
   *
   * The client submits only an id plus the exact label it inserted. The
   * server reloads every task from the crew and rejects a stale label instead
   * of silently linking visible text to a different title. This leaves one
   * canonical message body while preserving durable navigation metadata.
   */
  private async validateTaskReferences(
    conversationId: string,
    authorId: string,
    body: string,
    tasks: TaskReferenceInput[],
  ): Promise<ConversationTaskReferencePayload[]> {
    if (tasks.length === 0) return [];

    const { conversation } = await this.assertConversationAccess(
      conversationId,
      authorId,
    );
    if (
      conversation.contextType !== ConversationContextType.crew ||
      conversation.crewChannel === CrewConversationChannel.community
    ) {
      throw new BadRequestException(
        'Task references are currently available in crew conversations only',
      );
    }
    return this.validateTaskReferencesForCrew(
      conversation.contextId,
      body,
      tasks,
    );
  }

  private async validateTaskReferencesForCrew(
    crewId: string,
    body: string,
    tasks: TaskReferenceInput[],
  ): Promise<ConversationTaskReferencePayload[]> {
    if (tasks.length === 0) return [];

    const unique = new Map<string, TaskReferenceInput>();
    for (const task of tasks) {
      if (!body.includes(`#${task.label}`)) {
        throw new BadRequestException(
          `Task reference #${task.label} is not present in the message body`,
        );
      }
      const prior = unique.get(task.taskId);
      if (prior && prior.label !== task.label) {
        throw new BadRequestException(
          'A referenced task cannot carry multiple display labels',
        );
      }
      unique.set(task.taskId, task);
    }

    const rows = await this.prisma.crewTask.findMany({
      where: { deletedAt: null, crewId, id: { in: [...unique.keys()] } },
      select: {
        id: true,
        crewId: true,
        number: true,
        title: true,
      },
    });
    if (rows.length !== unique.size) {
      throw new BadRequestException(
        'One or more referenced tasks are unavailable in this crew',
      );
    }

    const byId = new Map(rows.map((task) => [task.id, task]));
    return [...unique.values()].map((input) => {
      const task = byId.get(input.taskId)!;
      const label = `TASK-${task.number} ${task.title}`;
      if (input.label !== label) {
        throw new BadRequestException(
          `Task reference #${input.label} is stale; select it again`,
        );
      }
      return {
        taskId: task.id,
        crewId: task.crewId,
        number: task.number,
        label,
      };
    });
  }

  /**
   * Mentions are durable product events, not a transient WebSocket hint.
   * The notification service writes an inbox row and outbox record; its
   * deterministic key means retries repair a failed notification attempt
   * without creating a second bell item.
   */
  private async notifyMentions(
    message: PrismaMessage,
    authorId: string,
    mentions: ConversationMentionPayload[],
    knownCrewId?: string,
  ): Promise<void> {
    const recipients = mentions.filter(
      (mention) => mention.userId !== authorId,
    );
    if (recipients.length === 0) return;

    const crewId =
      knownCrewId ??
      (
        await this.prisma.conversation.findUnique({
          where: { id: message.conversationId },
          select: { contextType: true, contextId: true },
        })
      )?.contextId;
    if (!crewId) return;

    await Promise.all(
      recipients.map((mention) =>
        this.notifications.send({
          userId: mention.userId,
          type: 'crew.chat.mentioned',
          title: 'You were mentioned in crew chat',
          body: message.body,
          meta: {
            crewId,
            conversationId: message.conversationId,
            messageId: message.id,
            authorId,
            deeplink: `/crews/${crewId}/workspace?tab=chat`,
          },
          idempotencyKey: `crew.chat.mentioned:${message.id}:${mention.userId}`,
        }),
      ),
    );
  }

  /**
   * `clientKey` dedupe: pre-check, then treat the unique violation
   * as "somebody else already wrote this one". The pre-check wins the
   * common case (a retry seconds later); the P2002 catch wins the
   * genuine race (two in-flight retries of the same send).
   *
   * Arbitrary caller transactions cannot opt into key recovery. Internal
   * inquiry/proposal paths explicitly own their serialization before calling
   * this primitive; other combinations are rejected. The P2002 recovery re-reads the row, and inside
   * someone else's tx that read would hit 25P02 on an already-aborted
   * transaction — a silent corruption of an unrelated business
   * operation. Fail loudly at the call site instead.
   */
  private async persist(
    conversationId: string,
    authorId: string | null,
    type: 'text' | 'proposal' | 'system' | 'image' | 'file',
    body: string,
    payload: MessagePayload | null,
    db: DbClient = this.prisma,
    clientKey: string | null = null,
    lockedMessageKey = false,
  ): Promise<PersistResult> {
    if (clientKey !== null) {
      if (authorId === null) {
        throw new Error(
          'clientKey requires an authorId — the dedupe index is scoped to (conversation, author, key)',
        );
      }
      if (this.isTx(db) && !lockedMessageKey) {
        throw new Error(
          'clientKey dedupe cannot run inside a caller transaction — a unique violation would abort it (25P02)',
        );
      }
    }

    try {
      return await this.runInTx(db, async (tx) => {
        if (authorId !== null) {
          const context = await tx.conversation.findUnique({
            where: { id: conversationId },
            select: {
              contextType: true,
              contextId: true,
              crewChannel: true,
            },
          });
          if (!context) throw new NotFoundException('Conversation not found');
          if (
            context.contextType === ConversationContextType.crew &&
            context.crewChannel !== CrewConversationChannel.community
          ) {
            await this.lockCrewMembership(context.contextId, authorId, tx);
          }
          // Re-check after taking the membership lock. A concurrent
          // remove either finished first (this now 404s) or waits until
          // this message commits (the send linearizes first).
          await this.assertConversationAccess(conversationId, authorId, tx);
        }

        if (clientKey !== null) {
          await this.lockMessageKey(tx, conversationId, authorId!, clientKey);
          const existing = await tx.message.findFirst({
            where: { conversationId, authorId, clientKey },
          });
          if (existing) {
            this.assertIdempotentReplay(existing, type, body, payload);
            return { message: existing, created: false };
          }
        }

        const created = await tx.message.create({
          data: {
            id: newShortId(),
            conversationId,
            authorId,
            type,
            body,
            payload: payload as unknown as Prisma.InputJsonValue,
            clientKey,
          },
        });
        // Preserve the DB's microsecond timestamp and never let a
        // slower transaction move the inbox clock backwards after a
        // newer message committed first.
        await tx.$executeRaw(Prisma.sql`
          UPDATE conversations AS c
          SET last_message_at = GREATEST(c.last_message_at, m.created_at)
          FROM messages AS m
          WHERE c.id = ${conversationId}
            AND m.id = ${created.id}
            AND m.conversation_id = c.id
        `);
        await this.enqueueMessageRealtime(tx, created);
        return { message: created, created: true };
      });
    } catch (err) {
      if (clientKey === null || this.isTx(db) || !isUniqueViolation(err))
        throw err;
      const winner = await this.prisma.message.findFirst({
        where: { conversationId, authorId, clientKey },
      });
      if (winner) {
        this.assertIdempotentReplay(winner, type, body, payload);
        return { message: winner, created: false };
      }
      throw err;
    }
  }

  private async lockMessageKey(
    tx: TxClient,
    conversationId: string,
    authorId: string,
    key: string,
  ) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`conversation-message:${conversationId}:${authorId}:${key}`}, 0))`;
  }

  private assertProposalReplay(
    existing: PrismaMessage,
    input: SendProposalInput,
  ) {
    const payload = existing.payload as unknown as MessagePayload | null;
    if (existing.deletedAt)
      throw new ConflictException(
        'The original proposal is no longer available',
      );
    const terms = (
      p: Pick<
        ProposalPayload,
        | 'packageTier'
        | 'price'
        | 'currency'
        | 'deliveryDays'
        | 'revisions'
        | 'scope'
        | 'note'
      >,
    ) => [
      p.packageTier,
      p.price,
      p.currency,
      p.deliveryDays,
      p.revisions,
      p.scope,
      p.note,
    ];
    if (
      existing.type !== 'proposal' ||
      payload?.kind !== 'proposal' ||
      existing.body !== input.note ||
      JSON.stringify(terms(payload.proposal)) !== JSON.stringify(terms(input))
    ) {
      throw new ConflictException({
        message: 'Idempotency key was already used for a different proposal',
        existingMessageId: existing.id,
      });
    }
  }

  /**
   * Serialize one user's membership transition with their authored
   * writes in that crew. Transaction-scoped by construction; using it
   * on the root client would release at the end of the statement and
   * provide no protection.
   */
  private async lockCrewMembership(
    crewId: string,
    userId: string,
    db: TxClient,
  ): Promise<void> {
    const key = `crew-membership:${crewId}:${userId}`;
    await db.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
    );
  }

  /**
   * Enqueue within the caller's transaction. Raw SQL keeps this primitive
   * usable with both PrismaService and TransactionClient while the unique
   * message key makes historical/idempotent replays harmless.
   */
  private async enqueueMessageRealtime(
    tx: TxClient,
    message: Pick<PrismaMessage, 'id' | 'conversationId'>,
  ): Promise<void> {
    const idempotencyKey = `conversation:${message.conversationId}:message:${message.id}`;
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO conversation_realtime_outbox (
        id,
        conversation_id,
        message_id,
        idempotency_key
      )
      VALUES (
        ${randomUUID()}::uuid,
        ${message.conversationId},
        ${message.id},
        ${idempotencyKey}
      )
      ON CONFLICT (message_id) DO NOTHING
    `);
  }

  /**
   * An idempotency key identifies one logical write, not an arbitrary
   * slot whose old response should replace new content. Returning the
   * first row for a reused key with a different body makes the caller
   * believe text was sent when it was silently discarded.
   */
  private assertIdempotentReplay(
    existing: PrismaMessage,
    type: 'text' | 'proposal' | 'system' | 'image' | 'file',
    body: string,
    payload: MessagePayload | null,
  ): void {
    if (existing.deletedAt)
      throw new ConflictException(
        'The original message is no longer available',
      );
    if (
      existing.type === type &&
      existing.body === body &&
      isDeepStrictEqual(existing.payload ?? null, payload)
    ) {
      return;
    }
    throw new ConflictException({
      message: 'Idempotency key was already used for a different message',
      existingMessageId: existing.id,
    });
  }

  private async publishToUser(
    userId: string,
    frame: ConversationFrame,
    idempotencyKey: string,
  ) {
    try {
      await this.realtime.publishUserFrame(userId, frame, idempotencyKey);
    } catch (err) {
      this.logger.warn(
        `conversation publish failed userId=${userId} err=${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async hydrate(
    conv: PrismaConversation & {
      participants: PrismaConversationParticipant[];
    },
    viewerId: string,
    db: DbClient = this.prisma,
  ): Promise<ConversationRowHydrated> {
    const me = conv.participants.find((p) => p.userId === viewerId);
    const [lastMessage, unread] = await Promise.all([
      db.message.findFirst({
        where: { conversationId: conv.id, deletedAt: null },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      me ? this.unreadCountFor(conv.id, me, db) : Promise.resolve(0),
    ]);
    return Object.assign(conv, {
      _lastMessage: lastMessage,
      _unreadCount: unread,
    });
  }

  private async unreadCountFor(
    conversationId: string,
    participant: PrismaConversationParticipant,
    db: DbClient = this.prisma,
  ): Promise<number> {
    const counts = await this.unreadCountsFor(
      conversationId,
      [participant.userId],
      db,
    );
    return counts.get(participant.userId) ?? 0;
  }

  /**
   * Unread counts for several participants of one conversation in a
   * single round-trip. The ONE definition of "unread" in this
   * service — `unreadCountFor` is a one-element call into it — so the
   * inbox badge, the detail header and the WS frame can never drift
   * apart.
   *
   * Raw SQL because each participant carries a different cursor, and
   * because two subtleties are only expressible here:
   *
   *   - `m.author_id IS NULL OR m.author_id <> p.user_id`. The old
   *     Prisma `NOT: { authorId: userId }` compiled to
   *     `NOT (author_id = $1)`, which is NULL — not TRUE — for the
   *     server-authored messages that carry no author. Every
   *     order-lifecycle system message was therefore excluded from
   *     every unread count that has ever been served.
   *
   *   - `(m.created_at, m.id) > (p.last_read_at, ...)`. A row-value
   *     comparison, so a message sharing the cursor's millisecond is
   *     unread iff it sorts after the cursor under the same total
   *     order `listMessages` pages by. `COALESCE(..., '')` handles a
   *     timestamp cursor with no message id: everything at that
   *     instant stays unread, which is the safe direction.
   */
  private async unreadCountsFor(
    conversationId: string,
    userIds: string[],
    db: DbClient = this.prisma,
  ): Promise<Map<string, number>> {
    const rows = await conversationUnreadCounts(db, [conversationId], userIds);
    return new Map(rows.map((r) => [r.userId, r.unread]));
  }

  private async assertParticipant(
    conversationId: string,
    userId: string,
    db: DbClient = this.prisma,
  ) {
    const p = await db.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    if (!p || p.leftAt) {
      throw new NotFoundException('Conversation not found');
    }
    return p;
  }

  /**
   * Full read/send gate: participant row, then — for a crew
   * conversation — live crew membership. Use this rather than
   * `assertParticipant` anywhere content crosses the boundary.
   */
  private async assertConversationAccess(
    conversationId: string,
    userId: string,
    db: DbClient = this.prisma,
  ): Promise<{
    participant: PrismaConversationParticipant;
    conversation: {
      contextType: ConversationContextType;
      contextId: string;
      crewChannel: CrewConversationChannel | null;
    };
  }> {
    const participant = await this.assertParticipant(
      conversationId,
      userId,
      db,
    );
    const conv = await db.conversation.findUnique({
      where: { id: conversationId },
      select: { contextType: true, contextId: true, crewChannel: true },
    });
    if (!conv) throw new NotFoundException('Conversation not found');
    await this.assertCrewMembership(conv, userId, db);
    return { participant, conversation: conv };
  }

  /** No-op for non-crew conversations. 404 (never 403) for outsiders. */
  private async assertCrewMembership(
    conv: {
      contextType: ConversationContextType;
      contextId: string;
      crewChannel: CrewConversationChannel | null;
    },
    userId: string,
    db: DbClient = this.prisma,
  ): Promise<void> {
    if (conv.contextType !== ConversationContextType.crew) return;
    if (conv.crewChannel === CrewConversationChannel.community) {
      const crew = await db.crew.findFirst({
        where: { id: conv.contextId, deletedAt: null },
        select: { id: true },
      });
      if (crew) return;
      throw new NotFoundException('Conversation not found');
    }
    if (await this.isActiveCrewMember(conv.contextId, userId, db)) return;
    throw new NotFoundException('Conversation not found');
  }

  /**
   * Mirror of the crew authorization boundary's membership predicate.
   * Duplicated
   * rather than imported: ConversationsModule must not depend on
   * CrewsModule (the dependency runs the other way, and closing the
   * cycle would take a forwardRef).
   *
   * Ownership is structurally attached to an active member, so there is no
   * ownership bypass: inactive membership always revokes chat access.
   */
  private async isActiveCrewMember(
    crewId: string,
    userId: string,
    db: DbClient = this.prisma,
  ): Promise<boolean> {
    const crew = await db.crew.findFirst({
      where: { id: crewId, deletedAt: null },
      select: { id: true },
    });
    if (!crew) return false;
    const member = await db.crewMember.findFirst({
      where: { crewId, userId, status: 'active' },
      select: { id: true },
    });
    return member !== null;
  }

  private runInTx<T>(
    db: DbClient,
    fn: (tx: TxClient) => Promise<T>,
  ): Promise<T> {
    if (this.isTx(db)) return fn(db);
    return this.prisma.$transaction((tx) => fn(tx));
  }

  /**
   * Authorization and the content it protects must share one database
   * snapshot. At READ COMMITTED every statement sees a fresh snapshot:
   * a member could pass the roster check, be removed, then receive a
   * message committed after that removal. REPEATABLE READ makes each
   * response linearize entirely before or entirely after the removal.
   */
  private readSnapshot<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn, {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  }

  /**
   * Prisma 7's driver-adapter transaction proxy still exposes
   * `$transaction` at runtime, even though `TransactionClient` omits it
   * from the public type. Feature-detecting that property therefore
   * misclassifies a real interactive transaction as the root client.
   *
   * Service methods accept only this injected root client or a client
   * handed to the caller by that root's `$transaction` callback, so
   * object identity is the stable discriminator.
   */
  private isTx(db: DbClient): db is TxClient {
    return db !== this.prisma;
  }
}

export function serviceLookupKey(
  serviceId: string,
  buyerId: string,
  creatorId: string,
): string {
  return `service:${serviceId}:${buyerId}:${creatorId}`;
}

export function orderLookupKey(orderId: string): string {
  return `order:${orderId}`;
}

/**
 * One crew, one group chat. Public because CrewsModule builds the
 * same token when it wants to check whether a crew already has a
 * chat without opening one.
 */
export function crewLookupKey(crewId: string): string {
  return `crew:${crewId}`;
}

/** Fixed community-room identity. The existing team-room key stays unchanged. */
export function crewCommunityLookupKey(crewId: string): string {
  return `crew:${crewId}:community`;
}

function crewChannelLookupKey(
  crewId: string,
  channel: CrewConversationChannel,
): string {
  return channel === CrewConversationChannel.team
    ? crewLookupKey(crewId)
    : crewCommunityLookupKey(crewId);
}

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

/**
 * Inside a tx, lock EVERY proposal row in this conversation in a
 * stable order (id ASC) and assert the target's current status is
 * `open`.
 *
 * The "lock all" sweep is the deadlock-avoidance trick: two
 * concurrent txns accepting different proposals in the same
 * conversation would each grab their own proposal's FOR UPDATE
 * then race to patch the other's row inside
 * `persistCancelOtherOpenProposals`. By locking the whole proposal
 * set in id order up front, both txns serialize on the first row
 * they both want — second waits for first to commit, then sees
 * the updated status and 409s.
 *
 * Raw SQL: Prisma's typed model methods can't take FOR UPDATE.
 */
export async function lockProposalsAndAssertOpen(
  tx: TxClient,
  conversationId: string,
  targetMessageId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<
    Array<{ id: string; status: string | null }>
  >(Prisma.sql`
    SELECT id, (payload->'proposal'->>'status') AS status
    FROM messages
    WHERE conversation_id = ${conversationId}
      AND type = 'proposal'
      AND deleted_at IS NULL
    ORDER BY id
    FOR UPDATE
  `);
  const target = rows.find((r) => r.id === targetMessageId);
  if (!target) {
    throw new NotFoundException('Proposal not found');
  }
  if (target.status !== 'open') {
    throw new ConflictException(
      `Proposal status is '${target.status ?? 'missing'}', not open`,
    );
  }
}
