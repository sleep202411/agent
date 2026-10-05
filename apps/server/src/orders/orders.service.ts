/**
 * OrdersService — submit + state machine for ServiceOrder.
 *
 * Order creation paths:
 *
 *   1. Questionnaire-first (`submit`):
 *      Buyer fills the service's requirement questions → server
 *      snapshots package + questionnaire + creates/resumes the
 *      service-context conversation → posts an optional buyer note
 *      as a text message → posts an `order.submitted` system
 *      message → flips conversation context service→order.
 *      Resulting status: `pending_creator`.
 *
 *   2. Proposal-first (`acceptProposal`):
 *      Creator already sent a `proposal` message in the existing
 *      service-context conversation. Buyer accepts → server
 *      snapshots from the proposal payload → creates order in
 *      `in_progress` directly (proposal was the offer; accept ack's
 *      it, no further pending-creator step) → flips conversation
 *      context → patches the proposal message's status to
 *      `accepted` with orderId set → posts an `order.accepted`
 *      system message.
 *
 * State transitions (server-enforced via @repo/shared/order):
 *   pending_creator ─accept→ in_progress
 *                   ─decline→ cancelled
 *   in_progress     ─deliver→ delivered
 *   delivered       ─accept_delivery→ completed
 *                   ─request_revision→ revision_requested
 *   revision_requested ─deliver→ delivered
 *   non-terminal    ─cancel→ cancelled
 *
 * Every transition emits a corresponding `order.*` system message
 * in the order's conversation so both parties have a single source
 * of truth timeline.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type ServiceOrder, type ServicePackage } from '@prisma/client';
import { ZERO_DECIMAL_CURRENCIES, type CurrencyCode } from '@repo/shared/crew';
import {
  canTransition,
  nextStatus,
  type OrderAction,
  type OrderBindings,
  type OrderCancelInfo,
  type OrderPackageSnapshot,
  type OrderParticipantRole,
  type OrderQuestionnaireEntry,
  type OrderStatus,
} from '@repo/shared/order';
import type {
  MessagePayload,
  ProposalPayload,
  SystemMessageKind,
} from '@repo/shared/conversation';
import { newShortId } from '../common/id';
import { conversationUnreadCounts } from '../conversations/unread-counts';
import { PrismaService } from '../infra/db/db.module';
import {
  ConversationsService,
  lockProposalsAndAssertOpen,
  serviceLookupKey,
  type PendingContextChange,
} from '../conversations/conversations.service';
import type { Message as PrismaMessage } from '@prisma/client';
import type {
  CancelOrderInput,
  DeclineOrderInput,
  ListOrdersQuery,
  RequestRevisionInput,
  SubmitOrderInput,
} from './dto';

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationsService,
  ) {}

  // ─── Submit (questionnaire-first) ────────────────────────

  async submit(
    buyerId: string,
    input: SubmitOrderInput,
  ): Promise<ServiceOrder> {
    const orderId = newShortId();

    // Collect WS broadcasts to fire AFTER $transaction commits so a
    // rollback never leaves clients with a ghost message / phantom
    // context change.
    const pendingMessages: PrismaMessage[] = [];
    const pendingContextChanges: PendingContextChange[] = [];

    const order = await this.prisma
      .$transaction(async (tx) => {
        // One buyer/service inquiry becomes one order at a time. Subsequent
        // deliberate orders open a fresh inquiry after the first one evolves.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`service-order:${buyerId}:${input.serviceId}`}, 0))`;
        // Owner edits take FOR UPDATE on this row. Read availability, package
        // and questionnaire only after admission, preserving one coherent offer.
        await tx.$queryRaw`SELECT id FROM creator_services WHERE id = ${input.serviceId} FOR SHARE`;
        // Idempotent retry: if (buyer, idempotencyKey) already maps to
        // an order, return it without re-creating. The partial-unique
        // index in the migration also gives us DB-level protection
        // against a race that beats this check.
        if (input.idempotencyKey) {
          const existing = await tx.serviceOrder.findFirst({
            where: { buyerId, idempotencyKey: input.idempotencyKey },
          });
          if (existing) {
            this.assertOrderReceiptService(existing, input.serviceId);
            return existing;
          }
        }

        const service = await tx.creatorService.findUnique({
          where: { id: input.serviceId },
          select: {
            id: true,
            creatorId: true,
            status: true,
            deletedAt: true,
            title: true,
            version: true,
          },
        });
        if (!service || service.deletedAt) {
          throw new NotFoundException('Service not found');
        }
        if (service.status !== 'listed') {
          throw new ConflictException(
            'Service is not currently accepting orders',
          );
        }
        if (service.creatorId === buyerId) {
          throw new BadRequestException('Cannot order your own service');
        }

        if (
          input.expectedServiceVersion !== undefined &&
          service.version !== input.expectedServiceVersion
        ) {
          throw new ConflictException({
            message:
              'The service offer has changed. Reload it and review the package and questions before submitting.',
            field: 'expectedServiceVersion',
            actual: service.version,
          });
        }

        const pkg = await tx.servicePackage.findFirst({
          where: { serviceId: service.id, tier: input.packageTier },
        });
        if (!pkg) {
          throw new BadRequestException(
            `Package tier '${input.packageTier}' not offered for this service`,
          );
        }

        // Materialize the questionnaire snapshot from current service
        // questions + buyer answers.
        const questions = await tx.serviceRequirementQuestion.findMany({
          where: { serviceId: service.id },
          orderBy: { displayOrder: 'asc' },
        });
        const answerById = new Map(
          input.answers.map((a) => [a.questionId, a.answer]),
        );
        const questionnaire: OrderQuestionnaireEntry[] = questions.map((q) => ({
          prompt: q.prompt,
          required: q.required,
          answer: (answerById.get(q.id) ?? '').trim(),
        }));
        for (const entry of questionnaire) {
          if (entry.required && entry.answer.length === 0) {
            throw new BadRequestException({
              message: `Required answer missing: ${entry.prompt}`,
              field: 'answers',
            });
          }
        }

        this.assertBindingsBelongToBuyer(buyerId, input.bindings);

        const snapshot = packageToSnapshot(pkg);

        // 1. Open the inquiry conversation (or resume an existing one
        //    for this triple — likely cold but allow warm).
        const conv = await this.conversations.openServiceConversation(
          { serviceId: service.id, buyerId, creatorId: service.creatorId },
          tx,
        );

        // 2. Post the buyer's optional note as a leading text message
        //    so the creator opens the order convo and sees the
        //    buyer's voice + their structured answers below. Use
        //    persist*-no-broadcast inside the tx; defer broadcast.
        if (input.note) {
          pendingMessages.push(
            await this.conversations.persistText(
              conv.id,
              buyerId,
              input.note,
              tx,
            ),
          );
        }

        // 3. Insert the order. conversationId is unique, so this also
        //    blocks any concurrent attempt to bind another order to
        //    the same conversation row. The partial UNIQUE on
        //    (buyer_id, idempotency_key) similarly catches a
        //    concurrent double-submit that beat the pre-check above.
        const row = await tx.serviceOrder.create({
          data: {
            id: orderId,
            buyerId,
            creatorId: service.creatorId,
            serviceId: service.id,
            packageSnapshot: snapshot as unknown as Prisma.InputJsonValue,
            status: 'pending_creator',
            questionnaire: questionnaire as unknown as Prisma.InputJsonValue,
            conversationId: conv.id,
            idempotencyKey: input.idempotencyKey ?? null,
            ipId: input.bindings.ipId ?? null,
            episodeId: input.bindings.episodeId ?? null,
            crewId: input.bindings.crewId ?? null,
            crewPositionId: input.bindings.crewPositionId ?? null,
          },
        });

        // 4. Evolve conversation context service → order.
        pendingContextChanges.push(
          await this.conversations.persistEvolveToOrder(conv.id, row.id, tx),
        );

        // 5. System message announcing the order.
        pendingMessages.push(
          await this.conversations.persistSystem(
            conv.id,
            'order.submitted',
            {
              orderId: row.id,
              tier: snapshot.tier,
              serviceTitle: service.title,
            },
            tx,
          ),
        );

        return row;
      })
      .catch(async (err: unknown) => {
        // Idempotency-key race loser: pre-check found nothing, but a
        // concurrent tx committed first → partial UNIQUE violation
        // (`P2002` on idempotency_key index). Return the now-existing
        // order so the client sees a single canonical row.
        if (
          input.idempotencyKey &&
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          const existing = await this.prisma.serviceOrder.findFirst({
            where: { buyerId, idempotencyKey: input.idempotencyKey },
          });
          if (existing) {
            this.assertOrderReceiptService(existing, input.serviceId);
            // These arrays belong to the failed transaction, not the winning
            // order. Its rolled-back messages must never reach realtime clients.
            pendingMessages.length = 0;
            pendingContextChanges.length = 0;
            return existing;
          }
        }
        throw err;
      });

    // Post-commit broadcasts. Failures are logged inside the
    // service but never propagate — WS is best-effort.
    for (const change of pendingContextChanges) {
      await this.conversations.broadcastContextChange(change);
    }
    for (const m of pendingMessages) {
      await this.conversations.broadcastMessage(m);
    }
    return order;
  }

  // ─── Accept proposal (proposal-first) ────────────────────

  async acceptProposal(
    buyerId: string,
    conversationId: string,
    proposalMessageId: string,
    bindings: OrderBindings = {},
  ): Promise<ServiceOrder> {
    // Validate participant + role.
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId: buyerId } },
    });
    if (!participant || participant.leftAt)
      throw new NotFoundException('Conversation not found');
    if (participant.role !== 'buyer') {
      throw new ForbiddenException('Only the buyer can accept a proposal');
    }

    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { participants: true },
    });
    if (!conv || conv.contextType !== 'service') {
      throw new ConflictException(
        'Conversation is not a service inquiry — cannot accept proposal here',
      );
    }
    const creatorPart = conv.participants.find(
      (p) => p.role === 'creator' && !p.leftAt,
    );
    if (!creatorPart) {
      throw new ConflictException('Conversation has no creator participant');
    }

    // Pre-tx sanity (cheap UX-facing 404/422); the authoritative
    // open-status check happens inside the tx under FOR UPDATE so a
    // concurrent decline / second-tab accept can't race through.
    const proposal = await this.prisma.message.findUnique({
      where: { id: proposalMessageId },
    });
    if (!proposal || proposal.conversationId !== conversationId) {
      throw new NotFoundException('Proposal not found in this conversation');
    }
    if (proposal.type !== 'proposal') {
      throw new BadRequestException('Message is not a proposal');
    }
    const payload = (proposal.payload ?? null) as MessagePayload | null;
    if (!payload || payload.kind !== 'proposal') {
      throw new BadRequestException('Proposal payload missing');
    }

    this.assertBindingsBelongToBuyer(buyerId, bindings);

    const orderId = newShortId();

    const pendingMessages: PrismaMessage[] = [];
    const pendingContextChanges: PendingContextChange[] = [];

    const order = await this.prisma.$transaction(async (tx) => {
      // Share admission with questionnaire orders for this buyer/service pair.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`service-order:${buyerId}:${conv.contextId}`}, 0))`;
      await tx.$queryRaw`SELECT user_id FROM conversation_participants WHERE conversation_id = ${conversationId} ORDER BY user_id FOR SHARE`;
      // Lock EVERY proposal row in this conversation (ASC by id)
      // and re-check the target's status. Same-order locking
      // serializes concurrent accept/decline txns even when they
      // target different proposals — without this, the
      // cancel-siblings sweep below could deadlock against a
      // sibling tx holding the other proposal's lock.
      await lockProposalsAndAssertOpen(tx, conversationId, proposalMessageId);
      await tx.$queryRaw`SELECT id FROM conversations WHERE id = ${conversationId} FOR UPDATE`;
      const current = await tx.conversation.findUnique({
        where: { id: conversationId },
        include: { participants: { where: { leftAt: null } } },
      });
      if (
        !current ||
        current.contextType !== 'service' ||
        current.contextId !== conv.contextId
      ) {
        throw new ConflictException(
          'Conversation is no longer a service inquiry',
        );
      }
      const currentBuyer = current.participants.find(
        (p) => p.userId === buyerId,
      );
      if (!currentBuyer) throw new NotFoundException('Conversation not found');
      if (currentBuyer.role !== 'buyer')
        throw new ForbiddenException('Only the buyer can accept a proposal');
      const currentCreator = current.participants.find(
        (p) => p.role === 'creator',
      );
      if (!currentCreator)
        throw new ConflictException('Conversation has no creator participant');
      const lockedProposal = await tx.message.findUniqueOrThrow({
        where: { id: proposalMessageId },
      });
      const currentPayload = lockedProposal.payload as MessagePayload | null;
      if (!currentPayload || currentPayload.kind !== 'proposal')
        throw new BadRequestException('Proposal payload missing');
      const snapshot = proposalToSnapshot(currentPayload.proposal);

      const row = await tx.serviceOrder.create({
        data: {
          id: orderId,
          buyerId,
          creatorId: currentCreator.userId,
          serviceId: conv.contextId, // service id while still in service ctx
          packageSnapshot: snapshot as unknown as Prisma.InputJsonValue,
          // Proposal-accept skips pending_creator — the creator
          // already made the offer; accept is the buyer's
          // confirmation.
          status: 'in_progress',
          questionnaire: [] as unknown as Prisma.InputJsonValue,
          conversationId: conv.id,
          ipId: bindings.ipId ?? null,
          episodeId: bindings.episodeId ?? null,
          crewId: bindings.crewId ?? null,
          crewPositionId: bindings.crewPositionId ?? null,
          acceptedAt: new Date(),
        },
      });

      // Flip the original proposal message's status so the timeline
      // entry reflects the accept (no duplicate proposal row).
      pendingMessages.push(
        await this.conversations.persistProposalStatusPatch(
          conv.id,
          proposal.id,
          {
            status: 'accepted',
            orderId: row.id,
            acceptedAt: new Date().toISOString(),
          },
          tx,
        ),
      );

      // Cancel any OTHER currently-open proposals in this
      // conversation. After the context flips to order, those
      // siblings would be unreachable anyway; explicit cancel keeps
      // the timeline honest and prevents stale Accept buttons.
      pendingMessages.push(
        ...(await this.conversations.persistCancelOtherOpenProposals(
          conv.id,
          proposal.id,
          tx,
        )),
      );

      pendingContextChanges.push(
        await this.conversations.persistEvolveToOrder(conv.id, row.id, tx),
      );

      pendingMessages.push(
        await this.conversations.persistSystem(
          conv.id,
          'order.accepted',
          { orderId: row.id, tier: snapshot.tier },
          tx,
        ),
      );

      return row;
    });

    for (const change of pendingContextChanges) {
      await this.conversations.broadcastContextChange(change);
    }
    for (const m of pendingMessages) {
      await this.conversations.broadcastMessage(m);
    }
    return order;
  }

  // ─── State transitions ───────────────────────────────────

  async accept(orderId: string, actorId: string): Promise<ServiceOrder> {
    return this.transition(orderId, actorId, 'accept', 'creator', {
      systemKind: 'order.accepted',
      timestampField: 'acceptedAt',
    });
  }

  async decline(
    orderId: string,
    actorId: string,
    input: DeclineOrderInput,
  ): Promise<ServiceOrder> {
    return this.transition(orderId, actorId, 'decline', 'creator', {
      systemKind: 'order.declined',
      cancelInfo: { by: 'creator', reason: input.reason },
    });
  }

  async deliver(orderId: string, actorId: string): Promise<ServiceOrder> {
    return this.transition(orderId, actorId, 'deliver', 'creator', {
      systemKind: 'order.delivered',
      timestampField: 'deliveredAt',
    });
  }

  async acceptDelivery(
    orderId: string,
    actorId: string,
  ): Promise<ServiceOrder> {
    return this.transition(orderId, actorId, 'accept_delivery', 'buyer', {
      systemKind: 'order.completed',
      timestampField: 'completedAt',
    });
  }

  async requestRevision(
    orderId: string,
    actorId: string,
    input: RequestRevisionInput,
  ): Promise<ServiceOrder> {
    return this.transition(orderId, actorId, 'request_revision', 'buyer', {
      systemKind: 'order.revision_requested',
      systemParams: { reason: input.reason },
    });
  }

  async cancel(
    orderId: string,
    actorId: string,
    input: CancelOrderInput,
  ): Promise<ServiceOrder> {
    const order = await this.requireOrder(orderId);
    const role = this.roleOf(order, actorId);
    return this.transition(orderId, actorId, 'cancel', role, {
      systemKind: 'order.cancelled',
      cancelInfo: { by: role, reason: input.reason },
    });
  }

  // ─── Read ────────────────────────────────────────────────

  async detail(orderId: string, viewerId: string): Promise<ServiceOrder> {
    const order = await this.requireOrder(orderId);
    this.assertParticipant(order, viewerId);
    return order;
  }

  async list(viewerId: string, opts: ListOrdersQuery) {
    const roleFilter =
      opts.role === 'buyer'
        ? { buyerId: viewerId }
        : opts.role === 'creator'
          ? { creatorId: viewerId }
          : {
              OR: [{ buyerId: viewerId }, { creatorId: viewerId }],
            };
    const where: Prisma.ServiceOrderWhereInput = {
      ...roleFilter,
      ...(opts.status ? { status: opts.status } : {}),
    };
    const rows = await this.prisma.serviceOrder.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: opts.limit + 1,
      ...(opts.cursor ? { skip: 1, cursor: { id: opts.cursor } } : {}),
      include: {
        service: { select: { title: true } },
        conversation: { select: { lastMessageAt: true } },
      },
    });
    const hasMore = rows.length > opts.limit;
    const page = hasMore ? rows.slice(0, opts.limit) : rows;

    // Share the inbox's null-author and full read-cursor semantics, in one
    // grouped query for the already authorized order page.
    const counts = await conversationUnreadCounts(
      this.prisma,
      page.map((r) => r.conversationId),
      [viewerId],
    );
    const unread = new Map(counts.map((r) => [r.conversationId, r.unread]));
    const hydrated = page.map((r) =>
      Object.assign(r, {
        _lastActivityAt: r.conversation.lastMessageAt,
        _unreadCount: unread.get(r.conversationId) ?? 0,
      }),
    );
    return {
      items: hydrated,
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  // ─── Internals ───────────────────────────────────────────

  /**
   * Generic transition helper — validates role + status, applies
   * status + timestamp + cancelInfo, bumps version, emits system
   * message in the order's conversation.
   */
  private async transition(
    orderId: string,
    actorId: string,
    action: OrderAction,
    requiredRole: OrderParticipantRole,
    opts: {
      systemKind: SystemMessageKind;
      systemParams?: Record<string, string | number>;
      timestampField?: 'acceptedAt' | 'deliveredAt' | 'completedAt';
      cancelInfo?: { by: OrderParticipantRole; reason: string };
    },
  ): Promise<ServiceOrder> {
    const order = await this.requireOrder(orderId);
    const role = this.roleOf(order, actorId);
    if (role !== requiredRole) {
      throw new ForbiddenException(
        `Only the ${requiredRole} can perform this action`,
      );
    }
    if (!canTransition(order.status as OrderStatus, action)) {
      throw new ConflictException(
        `Cannot ${action} an order in status '${order.status}'`,
      );
    }
    const newStatus = nextStatus(order.status as OrderStatus, action);
    if (!newStatus) {
      throw new ConflictException('Invalid transition');
    }

    const now = new Date();
    const cancelInfo: OrderCancelInfo | null = opts.cancelInfo
      ? {
          by: opts.cancelInfo.by,
          reason: opts.cancelInfo.reason,
          at: now.toISOString(),
        }
      : null;

    const pendingMessages: PrismaMessage[] = [];

    const updated = await this.prisma.$transaction(async (tx) => {
      // CAS update: only apply when the row's status is still what
      // we read above. Concurrent transitions (accept + cancel on
      // two tabs; double-deliver) lose this race and surface as
      // 409 rather than silently overwriting each other.
      const data: Prisma.ServiceOrderUpdateManyMutationInput = {
        status: newStatus,
        version: { increment: 1 },
      };
      if (opts.timestampField) {
        (data as Record<string, unknown>)[opts.timestampField] = now;
      }
      if (newStatus === 'cancelled') {
        data.cancelledAt = now;
        data.cancelInfo = cancelInfo as unknown as Prisma.InputJsonValue;
      }
      const result = await tx.serviceOrder.updateMany({
        where: { id: orderId, status: order.status, version: order.version },
        data,
      });
      if (result.count === 0) {
        throw new ConflictException({
          message:
            'Order was modified by someone else (or another tab). Reload and retry.',
          field: 'status',
        });
      }
      const row = await tx.serviceOrder.findUniqueOrThrow({
        where: { id: orderId },
      });
      pendingMessages.push(
        await this.conversations.persistSystem(
          order.conversationId,
          opts.systemKind,
          {
            orderId,
            ...(opts.systemParams ?? {}),
          },
          tx,
        ),
      );
      return row;
    });

    for (const m of pendingMessages) {
      await this.conversations.broadcastMessage(m);
    }
    return updated;
  }

  private assertOrderReceiptService(order: ServiceOrder, serviceId: string) {
    if (order.serviceId !== serviceId) {
      throw new ConflictException(
        'Order retry key was already used for a different service',
      );
    }
  }

  private async requireOrder(orderId: string): Promise<ServiceOrder> {
    const order = await this.prisma.serviceOrder.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  private roleOf(order: ServiceOrder, userId: string): OrderParticipantRole {
    if (order.buyerId === userId) return 'buyer';
    if (order.creatorId === userId) return 'creator';
    throw new NotFoundException('Order not found');
  }

  private assertParticipant(order: ServiceOrder, userId: string) {
    if (order.buyerId !== userId && order.creatorId !== userId) {
      throw new NotFoundException('Order not found');
    }
  }

  /**
   * Phase 1b: bindings are rejected at the Zod layer via
   * `BindingsSchema.refine` in dto.ts, so by the time we reach
   * this helper there's nothing to validate. The method is kept
   * as a one-line shim so Phase 1c's real implementation (look up
   * the IP / episode / crew and check the buyer's permission) can
   * land without touching the two call sites.
   */
  private assertBindingsBelongToBuyer(
    buyerId: string,
    bindings: OrderBindings,
  ): void {
    // Touch params to keep TS / lint quiet under the no-op
    // contract. Replaced wholesale when 1c lands (will likely
    // become async to do per-entity lookups).
    void buyerId;
    void bindings;
  }
}

// ─── Pure helpers ──────────────────────────────────────────

function packageToSnapshot(pkg: ServicePackage): OrderPackageSnapshot {
  const isZero = ZERO_DECIMAL_CURRENCIES.has(pkg.currency as CurrencyCode);
  // priceAmount is BigInt smallest-unit; convert to display unit so
  // the snapshot is in the same shape ServicePackageDTO uses
  // everywhere on the wire.
  const price = isZero
    ? Number(pkg.priceAmount)
    : Number(pkg.priceAmount) / 100;
  return {
    packageId: pkg.id,
    tier: pkg.tier,
    title: pkg.title,
    description: pkg.description,
    price,
    currency: pkg.currency as CurrencyCode,
    deliveryDays: pkg.deliveryDays,
    revisions: pkg.revisions,
    scope: Array.isArray(pkg.scope) ? [...pkg.scope] : [],
  };
}

function proposalToSnapshot(p: ProposalPayload): OrderPackageSnapshot {
  return {
    // Proposals don't reference a stored ServicePackage id — the
    // creator built the offer ad-hoc in the conversation. Use a
    // synthetic id so the snapshot shape stays uniform.
    packageId: `proposal:${newShortId()}`,
    tier: p.packageTier,
    title: '', // proposals don't carry a separate title beyond the note
    description: p.note,
    price: p.price,
    currency: p.currency,
    deliveryDays: p.deliveryDays,
    revisions: p.revisions,
    scope: [...p.scope],
  };
}

// Re-export for callers that need to compute a conversation lookup
// key without depending on the conversations module directly.
export { serviceLookupKey };
