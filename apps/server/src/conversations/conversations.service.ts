/**
 * ConversationsService — persistence + WS publish for conversations,
 * messages, and read-cursor advancement.
 *
 * Realtime model:
 *   - DB is authoritative; every message persists first.
 *   - Then publish to `conversation:user:{userId}` on Redis pub/sub,
 *     one publish per recipient (gateway fans out to all of that
 *     user's connected tabs).
 *   - WS push is best-effort. Clients reconnect → REST cursor
 *     refetches messages since their last-seen, so no message ever
 *     "disappears" because a WS was down.
 *
 * Transaction boundary (important):
 *   Persist methods accept an optional `db?: DbClient` last arg.
 *   When called WITH a tx (inside another module's
 *   `prisma.$transaction((tx) => …)`), they persist using that tx
 *   and DO NOT broadcast — the caller is responsible for invoking
 *   `broadcastMessage(...)` / `broadcastContextChange(...)` AFTER
 *   the outer tx commits. This avoids the "ghost message" bug where
 *   we'd publish a WS frame before the row was actually committed.
 *
 *   Convenience wrappers (`sendText`, `sendProposal`, `postSystem`,
 *   `evolveToOrderContext`, `patchProposalStatus`) call the persist
 *   methods without a tx and then immediately broadcast — these are
 *   the right entry points for controllers that have no
 *   surrounding business transaction.
 *
 * Conversation identity:
 *   - service inquiry: lookup key `service:<serviceId>:<buyerId>:<creatorId>`
 *     — (buyer, creator, service) triple resumes the same row.
 *   - order: lookup key `order:<orderId>`. Rewritten in
 *     `persistEvolveToOrder()` inside the proposal-accept tx so the
 *     UNIQUE constraint shifts atomically.
 *
 * Authorization (controllers re-check; service is the last line):
 *   - Read / send: caller must be a participant (and not `leftAt`-set).
 *   - System messages: only callable from within other services
 *     (no public REST), authorId=null.
 *   - Proposal post: only the `creator` role can post; service
 *     enforces.
 *
 * Read cursor:
 *   - `lastReadMessageId` + denormalized `lastReadAt` per
 *     participant. `markRead()` only advances forward (idempotent
 *     against double-clicks / stale clients).
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
  type Conversation as PrismaConversation,
  type ConversationParticipant as PrismaConversationParticipant,
  type Message as PrismaMessage,
  Prisma,
} from '@prisma/client';
import Redis from 'ioredis';
import {
  conversationChannel,
  type ConversationFrame,
  type ConversationMessageType,
  type MessagePayload,
  type ProposalPayload,
  type SystemMessageKind,
  type SystemMessagePayload,
} from '@repo/shared/conversation';
import { newShortId } from '../common/id';
import { PrismaService } from '../infra/db/db.module';
import { REDIS } from '../infra/redis/redis.module';
import type { SendProposalInput } from './dto';

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

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
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

  // ─── Read ────────────────────────────────────────────────

  async listInbox(
    userId: string,
    opts: {
      limit: number;
      cursor?: string;
      contextType?: ConversationContextType;
    },
  ) {
    const rows = await this.prisma.conversation.findMany({
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
    const hydrated = await Promise.all(
      page.map((c) => this.hydrate(c, userId)),
    );
    return {
      items: hydrated,
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  async detail(
    conversationId: string,
    viewerId: string,
  ): Promise<ConversationRowHydrated> {
    const row = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { participants: true },
    });
    if (!row) throw new NotFoundException('Conversation not found');
    if (!row.participants.some((p) => p.userId === viewerId && !p.leftAt)) {
      throw new NotFoundException('Conversation not found');
    }
    return this.hydrate(row, viewerId);
  }

  async listMessages(
    conversationId: string,
    viewerId: string,
    opts: { limit: number; cursor?: string },
  ) {
    await this.assertParticipant(conversationId, viewerId);
    const rows = await this.prisma.message.findMany({
      where: { conversationId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: opts.limit + 1,
      ...(opts.cursor ? { skip: 1, cursor: { id: opts.cursor } } : {}),
    });
    const hasMore = rows.length > opts.limit;
    const items = hasMore ? rows.slice(0, opts.limit) : rows;
    return {
      items,
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  }

  // ─── Persist (no broadcast) ──────────────────────────────

  async persistText(
    conversationId: string,
    authorId: string,
    body: string,
    db: DbClient = this.prisma,
  ): Promise<PrismaMessage> {
    return this.persist(conversationId, authorId, 'text', body, null, db);
  }

  async persistProposal(
    conversationId: string,
    authorId: string,
    input: SendProposalInput,
    db: DbClient = this.prisma,
  ): Promise<PrismaMessage> {
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
    if (!conv || conv.contextType !== 'service') {
      throw new ConflictException('Proposals only valid on service inquiries');
    }
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
    return this.persist(
      conversationId,
      authorId,
      'proposal',
      input.note,
      payload,
      db,
    );
  }

  async persistSystem(
    conversationId: string,
    kind: SystemMessageKind,
    params: Record<string, string | number> = {},
    db: DbClient = this.prisma,
  ): Promise<PrismaMessage> {
    const system: SystemMessagePayload = { kind, params };
    const payload: MessagePayload = { kind: 'system', system };
    return this.persist(conversationId, null, 'system', '', payload, db);
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
   * Push a `message.created` frame to every participant. Safe to
   * call from outside the persisting tx — pulls fresh
   * conversation/participants from the DB.
   *
   * Send failures are logged but never throw: WS is best-effort and
   * the client will reconnect → REST-recover. Don't break a
   * successful write because of a pub/sub blip.
   */
  async broadcastMessage(message: PrismaMessage): Promise<void> {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: message.conversationId },
      include: { participants: true },
    });
    if (!conv) return;
    for (const p of conv.participants) {
      const unread = await this.unreadCountFor(conv.id, p);
      const frame: ConversationFrame = {
        event: 'message.created',
        data: {
          conversationId: conv.id,
          message: {
            id: message.id,
            conversationId: message.conversationId,
            authorId: message.authorId,
            type: message.type as ConversationMessageType,
            body: message.body,
            payload: (message.payload ?? null) as MessagePayload | null,
            createdAt: message.createdAt.toISOString(),
          },
          lastMessageAt: conv.lastMessageAt.toISOString(),
          unreadCount: unread,
        },
      };
      await this.publishToUser(p.userId, frame);
    }
  }

  async broadcastContextChange(change: PendingContextChange): Promise<void> {
    const participants = await this.prisma.conversationParticipant.findMany({
      where: { conversationId: change.conversation.id },
    });
    const frame: ConversationFrame = {
      event: 'context.changed',
      data: {
        conversationId: change.conversation.id,
        from: change.from,
        to: change.to,
        contextId: change.conversation.contextId,
      },
    };
    for (const p of participants) {
      await this.publishToUser(p.userId, frame);
    }
  }

  // ─── Convenience wrappers (persist + broadcast) ──────────
  //
  // These call the persist methods without a tx, then immediately
  // broadcast. Use from controllers / direct call sites that have
  // no surrounding business transaction.

  async sendText(
    conversationId: string,
    authorId: string,
    body: string,
  ): Promise<PrismaMessage> {
    const msg = await this.persistText(conversationId, authorId, body);
    await this.broadcastMessage(msg);
    return msg;
  }

  async sendProposal(
    conversationId: string,
    authorId: string,
    input: SendProposalInput,
  ): Promise<PrismaMessage> {
    const msg = await this.persistProposal(conversationId, authorId, input);
    await this.broadcastMessage(msg);
    return msg;
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

  async markRead(
    conversationId: string,
    userId: string,
    lastReadMessageId: string,
  ) {
    const message = await this.prisma.message.findUnique({
      where: { id: lastReadMessageId },
    });
    if (!message || message.conversationId !== conversationId) {
      throw new NotFoundException('Message not found in this conversation');
    }
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    if (!participant) throw new NotFoundException('Conversation not found');

    if (participant.lastReadAt && participant.lastReadAt >= message.createdAt) {
      return participant;
    }
    const updated = await this.prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: {
        lastReadMessageId: message.id,
        lastReadAt: message.createdAt,
      },
    });

    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { participants: true },
    });
    if (conv) {
      const frame: ConversationFrame = {
        event: 'read.advanced',
        data: {
          conversationId,
          userId,
          lastReadMessageId: message.id,
        },
      };
      for (const p of conv.participants) {
        await this.publishToUser(p.userId, frame);
      }
    }
    return updated;
  }

  // ─── Internals ───────────────────────────────────────────

  private async persist(
    conversationId: string,
    authorId: string | null,
    type: 'text' | 'proposal' | 'system' | 'image' | 'file',
    body: string,
    payload: MessagePayload | null,
    db: DbClient = this.prisma,
  ): Promise<PrismaMessage> {
    if (authorId !== null) {
      await this.assertParticipant(conversationId, authorId, db);
    }
    return this.runInTx(db, async (tx) => {
      const created = await tx.message.create({
        data: {
          id: newShortId(),
          conversationId,
          authorId,
          type,
          body,
          payload: payload as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: created.createdAt },
      });
      return created;
    });
  }

  private async publishToUser(userId: string, frame: ConversationFrame) {
    try {
      await this.redis.publish(
        conversationChannel(userId),
        JSON.stringify(frame),
      );
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
  ): Promise<ConversationRowHydrated> {
    const me = conv.participants.find((p) => p.userId === viewerId);
    const [lastMessage, unread] = await Promise.all([
      this.prisma.message.findFirst({
        where: { conversationId: conv.id, deletedAt: null },
        orderBy: { createdAt: 'desc' },
      }),
      me ? this.unreadCountFor(conv.id, me) : Promise.resolve(0),
    ]);
    return Object.assign(conv, {
      _lastMessage: lastMessage,
      _unreadCount: unread,
    });
  }

  private async unreadCountFor(
    conversationId: string,
    participant: PrismaConversationParticipant,
  ): Promise<number> {
    return this.prisma.message.count({
      where: {
        conversationId,
        deletedAt: null,
        NOT: { authorId: participant.userId },
        ...(participant.lastReadAt
          ? { createdAt: { gt: participant.lastReadAt } }
          : {}),
      },
    });
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

  private runInTx<T>(
    db: DbClient,
    fn: (tx: TxClient) => Promise<T>,
  ): Promise<T> {
    if (isTx(db)) return fn(db);
    return this.prisma.$transaction((tx) => fn(tx));
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

function isTx(db: DbClient): db is TxClient {
  return !('$transaction' in db);
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
