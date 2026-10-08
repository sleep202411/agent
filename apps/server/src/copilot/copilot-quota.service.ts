import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  CopilotConversationStatus,
  CopilotQuotaChargeStatus,
  Prisma,
} from '@prisma/client';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import { backgroundTasksEnabled } from '../common/background-tasks';
import { QuotaService } from '../quota/quota.service';
import type {
  QuotaDebitReceipt,
  QuotaLimits,
  QuotaWindow,
} from '../quota/quota.types';
import { EntitlementService } from '../entitlements';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CONVERSATION_PATTERN =
  /^(?:canvas|story-canvas):[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RECONCILE_INTERVAL_MS = 5_000;
const RECONCILE_BATCH_SIZE = 32;

export interface CopilotQuotaReceipt extends QuotaDebitReceipt {
  chargeAttemptId: string;
}

interface CopilotQuotaReconcileAction {
  kind: 'refund' | 'settle' | 'finalize-refund' | 'finalize-settle';
  attemptId: string;
  userId: string;
  refundReason: 'failed' | 'aborted';
  window: QuotaWindow;
}

/**
 * PostgreSQL-coordinated Copilot quota charging.
 *
 * `billingOperationId` identifies the logical creator turn. Every retry after
 * a durable refund receives a distinct `chargeAttemptId`, which is also the
 * Redis idempotency identity. PG never opens the next attempt until the prior
 * attempt is durably `refunded`, so a late refund cannot reverse a newer
 * charge. In-flight Redis keys remain persistent and are bounded only after a
 * strict Redis terminal action returns; PostgreSQL then CAS-acknowledges it.
 */
@Injectable()
export class CopilotQuotaService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(CopilotQuotaService.name);
  private reconcileTimer: NodeJS.Timeout | null = null;
  private draining: Promise<void> | null = null;
  private stopping = false;
  // Independent keysets let bounded sweeps advance past failed attempts.
  // Reset at the end so failures and newly eligible lower IDs are retried.
  private terminalCursor?: string;
  private chargedCursor?: string;
  private consumeCursor?: string;

  constructor(
    private readonly quota: QuotaService,
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementService,
  ) {}

  onModuleInit(): void {
    if (!backgroundTasksEnabled()) return;
    if (this.stopping || this.reconcileTimer) return;
    this.reconcileTimer = setInterval(() => {
      this.runDrainSafely();
    }, RECONCILE_INTERVAL_MS);
    this.reconcileTimer.unref();
    this.runDrainSafely();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    this.reconcileTimer = null;
    await this.draining;
  }

  /** Run before claiming a turn so rate-limit rejection never mutates chat. */
  async assertRateLimit(
    user: AuthUser,
    options: { workspaceId: string | null },
  ): Promise<void> {
    assertCanonicalUserId(user.userId);
    const profile = await this.entitlements.quotaProfileForUser(user, options);
    let result: Awaited<ReturnType<QuotaService['checkChatRate']>>;
    try {
      result = await this.quota.checkChatRate(user.userId, profile, {
        failureMode: 'closed',
      });
    } catch (error) {
      throw new ServiceUnavailableException({
        code: 'COPILOT_QUOTA_UNAVAILABLE',
        message: 'Copilot quota admission is temporarily unavailable.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
    if (result.ok) return;
    this.logger.warn(
      `quota.reject userId=${user.userId} tier=${profile.tier} dim=chat reason=rate_limited limit=${result.limit}/min resetAt=${result.resetAt}`,
    );
    throw new HttpException(
      {
        code: 429,
        error: 'rate_limited',
        dimension: 'chat',
        limit: result.limit,
        resetAt: result.resetAt,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  async consumeTurn(input: {
    user: AuthUser;
    workspaceId: string | null;
    conversationId: string;
    sessionId: string;
    billingOperationId: string;
    chargeAttemptId: string;
    turnId: string;
    turnKind: 'user' | 'tool-continuation';
  }): Promise<CopilotQuotaReceipt> {
    assertCanonicalTurnIdentity(input);
    const profile = await this.entitlements.quotaProfileForUser(input.user, {
      workspaceId: input.workspaceId,
    });
    const prepared = await this.prepareAttempt(input, profile.tier);
    const operationKey = chargeAttemptOperationKey(input.chargeAttemptId);
    if (prepared.status === CopilotQuotaChargeStatus.charged) {
      return {
        userId: input.user.userId,
        profile: {
          planKey: profile.planKey,
          tier: prepared.tier,
          limits: profile.limits,
        },
        dimension: 'chat',
        cost: 1,
        idempotencyKey: operationKey,
        chargeAttemptId: input.chargeAttemptId,
        debited: false,
      };
    }

    let result: Awaited<ReturnType<QuotaService['consume']>>;
    try {
      result = await this.quota.consume({
        userId: input.user.userId,
        profile,
        dimension: 'chat',
        cost: 1,
        idempotencyKey: operationKey,
        idempotencyTtlSeconds: 'persistent',
        failureMode: 'closed',
        reason: 'copilot_stream',
        metadata: {
          conversationId: input.conversationId,
          sessionId: input.sessionId,
          billingOperationId: input.billingOperationId,
          chargeAttemptId: input.chargeAttemptId,
          turnId: input.turnId,
          turnKind: input.turnKind,
          dayBucket: prepared.window.dayBucket,
          monthBucket: prepared.window.monthBucket,
        },
        window: prepared.window,
      });
    } catch (error) {
      throw new ServiceUnavailableException({
        code: 'COPILOT_QUOTA_UNAVAILABLE',
        message: 'Copilot quota admission is temporarily unavailable.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
    if (!result.ok) {
      this.logger.warn(
        `quota.reject userId=${input.user.userId} tier=${prepared.tier} dim=chat reason=quota_exceeded used=${result.used} limit=${result.limit} nextPlan=${result.nextPlanKey ?? 'none'}`,
      );
      throw new HttpException(
        {
          code: 429,
          error: 'quota_exceeded',
          dimension: result.dimension,
          used: result.used,
          limit: result.limit,
          resetAt: result.resetAt,
          nextTier: result.nextTier,
          nextPlanKey: result.nextPlanKey,
          nextTierLimit: result.nextTierLimit,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const acknowledged = await this.acknowledgeConsume(input);
    if (!acknowledged) {
      await this.reconcileChargeAttempt(input.chargeAttemptId).catch(
        () => undefined,
      );
      throw quotaSettlementPending();
    }
    return {
      userId: input.user.userId,
      profile: {
        planKey: profile.planKey,
        tier: prepared.tier,
        limits: profile.limits,
      },
      dimension: 'chat',
      cost: 1,
      idempotencyKey: operationKey,
      chargeAttemptId: input.chargeAttemptId,
      debited: !result.deduped,
    };
  }

  /**
   * Reconcile one durable outbox row without holding PostgreSQL locks across a
   * Redis network call: short locked decision -> idempotent Lua -> short CAS.
   * Multiple workers may execute the same Lua action; the attempt-specific key
   * makes that safe while avoiding a cross-system head-of-line lock.
   */
  async reconcileChargeAttempt(attemptId: string): Promise<boolean> {
    if (!UUID_PATTERN.test(attemptId)) {
      throw new Error('Invalid Copilot quota charge attempt identity.');
    }
    const action = await this.prepareReconcileAction(attemptId);
    if (!action) return false;
    const idempotencyKey = chargeAttemptOperationKey(action.attemptId);

    if (action.kind === 'refund' || action.kind === 'finalize-refund') {
      const limits = await this.refundDisplayLimits(action.userId);
      const refund = await this.quota.refundFor({
        userId: action.userId,
        ...(limits ? { limits } : {}),
        dimension: 'chat',
        cost: 1,
        idempotencyKey,
        reason: `copilot_stream_${action.refundReason}`,
        window: action.window,
        terminalFence: true,
      });
      if (refund.status === 'failed') {
        throw new Error('Copilot quota refund is temporarily unavailable.');
      }
    }

    const terminalKind =
      action.kind === 'refund' || action.kind === 'finalize-refund'
        ? 'refund'
        : 'settle';
    if (action.kind === 'refund' || action.kind === 'settle') {
      const acknowledged = await this.acknowledgeTerminalAction(
        action,
        terminalKind,
      );
      if (!acknowledged) return false;
    }

    // PostgreSQL is terminal before the Redis record receives a bounded TTL.
    // `redisFinalizedAt` keeps a failed post-ack EXPIRE durably retryable.
    const finalized = await this.quota.finalizeIdempotencyFor({
      userId: action.userId,
      dimension: 'chat',
      idempotencyKey,
    });
    if (
      finalized.status === 'failed' ||
      (terminalKind === 'refund' && finalized.status === 'missing')
    ) {
      throw new Error(
        'Copilot quota idempotency finalization is temporarily unavailable.',
      );
    }
    return this.acknowledgeRedisFinalization(action, terminalKind);
  }

  async drainPendingAttempts(): Promise<void> {
    if (!backgroundTasksEnabled()) return;
    if (this.stopping) return;
    if (this.draining) return this.draining;
    this.draining = this.reconcilePendingAttempts().finally(() => {
      this.draining = null;
    });
    return this.draining;
  }

  private async reconcilePendingAttempts(): Promise<void> {
    const terminalAttempts =
      await this.prisma.copilotQuotaChargeAttempt.findMany({
        where: {
          ...(this.terminalCursor ? { id: { gt: this.terminalCursor } } : {}),
          OR: [
            {
              status: {
                in: [
                  CopilotQuotaChargeStatus.refund_pending,
                  CopilotQuotaChargeStatus.settle_pending,
                ],
              },
            },
            {
              status: {
                in: [
                  CopilotQuotaChargeStatus.refunded,
                  CopilotQuotaChargeStatus.settled,
                ],
              },
              redisFinalizedAt: null,
            },
          ],
        },
        orderBy: { id: 'asc' },
        take: RECONCILE_BATCH_SIZE,
        select: { id: true },
      });
    if (this.stopping) return;
    this.terminalCursor =
      terminalAttempts.length === RECONCILE_BATCH_SIZE
        ? terminalAttempts[terminalAttempts.length - 1].id
        : undefined;
    const remaining = RECONCILE_BATCH_SIZE - terminalAttempts.length;
    const recoverableChargedAttempts =
      remaining > 0
        ? await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
              SELECT attempt."id"
              FROM "copilot_quota_charge_attempts" AS attempt
              LEFT JOIN "copilot_conversations" AS conversation
                ON conversation."billing_charge_attempt_id" = attempt."id"
              WHERE attempt."status" = 'charged'
                ${this.chargedCursor ? Prisma.sql`AND attempt."id" > ${this.chargedCursor}::uuid` : Prisma.empty}
                AND (
                  (attempt."client_tool_expires_at" IS NOT NULL AND
                   attempt."client_tool_expires_at" <= clock_timestamp()) OR
                  (attempt."client_tool_expires_at" IS NULL AND (
                    conversation."id" IS NULL OR
                    conversation."status" <> 'streaming' OR
                    conversation."active_turn_id" IS DISTINCT FROM attempt."owner_turn_id" OR
                    conversation."active_expires_at" IS NULL OR
                    conversation."active_expires_at" <= clock_timestamp()
                  ))
                )
              ORDER BY attempt."id" ASC
              LIMIT ${remaining}
            `)
        : [];
    if (this.stopping) return;
    if (remaining > 0)
      this.chargedCursor =
        recoverableChargedAttempts.length === remaining
          ? recoverableChargedAttempts[recoverableChargedAttempts.length - 1].id
          : undefined;
    const consumeRemaining = remaining - recoverableChargedAttempts.length;
    const abandonedConsumeAttempts =
      consumeRemaining > 0
        ? await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
              SELECT attempt."id"
              FROM "copilot_quota_charge_attempts" AS attempt
              LEFT JOIN "copilot_conversations" AS conversation
                ON conversation."billing_charge_attempt_id" = attempt."id"
              WHERE attempt."status" = 'consume_pending'
                ${this.consumeCursor ? Prisma.sql`AND attempt."id" > ${this.consumeCursor}::uuid` : Prisma.empty}
                AND (
                  conversation."id" IS NULL OR
                  conversation."status" <> 'streaming' OR
                  conversation."active_turn_id" IS DISTINCT FROM attempt."owner_turn_id" OR
                  conversation."active_expires_at" IS NULL OR
                  conversation."active_expires_at" <= clock_timestamp()
                )
              ORDER BY attempt."id" ASC
              LIMIT ${consumeRemaining}
            `)
        : [];
    if (this.stopping) return;
    if (consumeRemaining > 0)
      this.consumeCursor =
        abandonedConsumeAttempts.length === consumeRemaining
          ? abandonedConsumeAttempts[abandonedConsumeAttempts.length - 1].id
          : undefined;
    for (const attempt of [
      ...terminalAttempts,
      ...recoverableChargedAttempts,
      ...abandonedConsumeAttempts,
    ]) {
      if (this.stopping) return;
      try {
        await this.reconcileChargeAttempt(attempt.id);
      } catch (error) {
        this.logger.error(
          `copilot.quota_reconcile_failed attemptId=${attempt.id} error=${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /**
   * Current chat limits for the refund's WS badge snapshot — display
   * only. The refund itself must never depend on entitlement
   * resolution, so any failure here degrades to "no badge push".
   */
  private async refundDisplayLimits(
    userId: string,
  ): Promise<QuotaLimits | undefined> {
    try {
      const profile = await this.entitlements.quotaProfileForUser({ userId });
      return profile.limits;
    } catch (error) {
      this.logger.warn(
        `copilot.refund_limits_unresolved userId=${userId} error=${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }

  private runDrainSafely(): void {
    void this.drainPendingAttempts().catch((error) => {
      this.logger.error(
        `copilot.quota_drain_failed error=${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  private async prepareAttempt(
    input: {
      user: AuthUser;
      conversationId: string;
      sessionId: string;
      billingOperationId: string;
      chargeAttemptId: string;
      turnId: string;
    },
    requestedTier: string,
  ): Promise<{
    status: 'consume_pending' | 'charged';
    tier: string;
    window: QuotaWindow;
  }> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT 1 FROM "copilot_quota_charge_attempts" WHERE "id" = ${input.chargeAttemptId}::uuid FOR UPDATE`,
      );
      const attempt = await tx.copilotQuotaChargeAttempt.findUnique({
        where: { id: input.chargeAttemptId },
      });
      assertAttemptMatches(attempt, input);
      if (attempt.status === CopilotQuotaChargeStatus.charged) {
        if (!attempt.tier) {
          throw new Error('Charged Copilot quota attempt has no tier.');
        }
        return {
          status: 'charged',
          tier: attempt.tier,
          window: attemptWindow(attempt),
        };
      }
      if (attempt.status !== CopilotQuotaChargeStatus.consume_pending) {
        throw quotaSettlementPending();
      }
      if (attempt.tier && attempt.tier !== requestedTier) {
        throw new Error('Copilot quota attempt tier changed before consume.');
      }
      if (!attempt.tier) {
        await tx.copilotQuotaChargeAttempt.update({
          where: { id: attempt.id },
          data: { tier: requestedTier, updatedAt: await databaseNow(tx) },
        });
      }
      return {
        status: 'consume_pending',
        tier: requestedTier,
        window: attemptWindow(attempt),
      };
    });
  }

  private async prepareReconcileAction(
    attemptId: string,
  ): Promise<CopilotQuotaReconcileAction | null> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await lockAttemptInCanonicalOrder(tx, attemptId);
      if (!locked) return null;
      let { attempt } = locked;
      const { conversation } = locked;
      const now = await databaseNow(tx);
      let shouldRefund = false;

      if (attempt.status === CopilotQuotaChargeStatus.consume_pending) {
        const liveOwner =
          conversation?.status === CopilotConversationStatus.streaming &&
          conversation.activeTurnId === attempt.ownerTurnId &&
          conversation.activeExpiresAt !== null &&
          conversation.activeExpiresAt.getTime() > now.getTime();
        if (liveOwner) return null;
        shouldRefund = true;
      } else if (attempt.status === CopilotQuotaChargeStatus.charged) {
        if (attempt.clientToolExpiresAt) {
          if (attempt.clientToolExpiresAt.getTime() > now.getTime()) {
            return null;
          }
          shouldRefund = true;
        } else {
          const liveProvider =
            conversation?.status === CopilotConversationStatus.streaming &&
            conversation.activeTurnId === attempt.ownerTurnId &&
            conversation.activeExpiresAt !== null &&
            conversation.activeExpiresAt.getTime() > now.getTime();
          if (liveProvider) return null;
          // No client-tool expiry means this was provider-active. A missing,
          // non-streaming, mismatched, or lease-expired owner is a safe orphan.
          shouldRefund = true;
        }
      }

      if (shouldRefund) {
        if (conversation) {
          if (conversation.status === CopilotConversationStatus.streaming) {
            await tx.copilotConversation.update({
              where: { id: conversation.id },
              data: {
                revision: { increment: 1 },
                status: CopilotConversationStatus.failed,
                activeTurnId: null,
                activeTurnKind: null,
                activeClaimToken: null,
                activeRevision: null,
                activeUserMessageId: null,
                activeAdmissionToken: null,
                activeAdmissionRevision: null,
                activeStartedAt: null,
                activeExpiresAt: null,
                updatedAt: now,
              },
            });
            await tx.copilotUserStreamState.updateMany({
              where: {
                userId: attempt.userId,
                conversationId: attempt.conversationId,
                claimToken: conversation.activeAdmissionToken,
                fencingRevision: conversation.activeAdmissionRevision ?? -1,
              },
              data: {
                claimToken: null,
                conversationId: null,
                leaseExpiresAt: null,
                updatedAt: now,
              },
            });
          } else if (conversation.status === CopilotConversationStatus.ready) {
            await tx.copilotConversation.update({
              where: { id: conversation.id },
              data: {
                revision: { increment: 1 },
                status: CopilotConversationStatus.failed,
                updatedAt: now,
              },
            });
          }
        }
        attempt = await tx.copilotQuotaChargeAttempt.update({
          where: { id: attempt.id },
          data: {
            status: CopilotQuotaChargeStatus.refund_pending,
            refundReason: 'failed',
            clientToolExpiresAt: null,
            updatedAt: now,
          },
        });
      }

      if (attempt.status === CopilotQuotaChargeStatus.refund_pending) {
        return reconcileAction(attempt, 'refund');
      }
      if (attempt.status === CopilotQuotaChargeStatus.settle_pending) {
        return reconcileAction(attempt, 'settle');
      }
      if (
        attempt.status === CopilotQuotaChargeStatus.refunded &&
        attempt.redisFinalizedAt === null
      ) {
        return reconcileAction(attempt, 'finalize-refund');
      }
      if (
        attempt.status === CopilotQuotaChargeStatus.settled &&
        attempt.redisFinalizedAt === null
      ) {
        return reconcileAction(attempt, 'finalize-settle');
      }
      return null;
    });
  }

  private async acknowledgeTerminalAction(
    action: CopilotQuotaReconcileAction,
    terminalKind: 'refund' | 'settle',
  ): Promise<boolean> {
    const updated = await this.prisma.copilotQuotaChargeAttempt.updateMany({
      where: {
        id: action.attemptId,
        userId: action.userId,
        dayBucket: action.window.dayBucket,
        monthBucket: action.window.monthBucket,
        status:
          terminalKind === 'refund'
            ? CopilotQuotaChargeStatus.refund_pending
            : CopilotQuotaChargeStatus.settle_pending,
      },
      data: {
        status:
          terminalKind === 'refund'
            ? CopilotQuotaChargeStatus.refunded
            : CopilotQuotaChargeStatus.settled,
        updatedAt: new Date(),
      },
    });
    return updated.count === 1;
  }

  private async acknowledgeRedisFinalization(
    action: CopilotQuotaReconcileAction,
    terminalKind: 'refund' | 'settle',
  ): Promise<boolean> {
    const updated = await this.prisma.copilotQuotaChargeAttempt.updateMany({
      where: {
        id: action.attemptId,
        userId: action.userId,
        dayBucket: action.window.dayBucket,
        monthBucket: action.window.monthBucket,
        status:
          terminalKind === 'refund'
            ? CopilotQuotaChargeStatus.refunded
            : CopilotQuotaChargeStatus.settled,
        redisFinalizedAt: null,
      },
      data: { redisFinalizedAt: new Date(), updatedAt: new Date() },
    });
    return updated.count === 1;
  }

  private async acknowledgeConsume(input: {
    user: AuthUser;
    conversationId: string;
    sessionId: string;
    billingOperationId: string;
    chargeAttemptId: string;
    turnId: string;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT 1 FROM "copilot_quota_charge_attempts" WHERE "id" = ${input.chargeAttemptId}::uuid FOR UPDATE`,
      );
      const attempt = await tx.copilotQuotaChargeAttempt.findUnique({
        where: { id: input.chargeAttemptId },
      });
      assertAttemptMatches(attempt, input);
      if (attempt.status === CopilotQuotaChargeStatus.charged) return true;
      if (attempt.status !== CopilotQuotaChargeStatus.consume_pending) {
        return false;
      }
      const updated = await tx.copilotQuotaChargeAttempt.updateMany({
        where: {
          id: attempt.id,
          ownerTurnId: input.turnId,
          status: CopilotQuotaChargeStatus.consume_pending,
        },
        data: {
          status: CopilotQuotaChargeStatus.charged,
          updatedAt: await databaseNow(tx),
        },
      });
      return updated.count === 1;
    });
  }
}

function assertAttemptMatches(
  attempt: {
    id: string;
    billingOperationId: string;
    userId: string;
    conversationId: string;
    sessionId: string;
    ownerTurnId: string;
    tier: string | null;
    status: CopilotQuotaChargeStatus;
  } | null,
  input: {
    user: AuthUser;
    conversationId: string;
    sessionId: string;
    billingOperationId: string;
    chargeAttemptId: string;
    turnId: string;
  },
): asserts attempt is NonNullable<typeof attempt> {
  if (
    !attempt ||
    attempt.id !== input.chargeAttemptId ||
    attempt.billingOperationId !== input.billingOperationId ||
    attempt.userId !== input.user.userId ||
    attempt.conversationId !== input.conversationId ||
    attempt.sessionId !== input.sessionId ||
    attempt.ownerTurnId !== input.turnId
  ) {
    throw quotaSettlementPending();
  }
}

function reconcileAction(
  attempt: {
    id: string;
    userId: string;
    tier: string | null;
    status: CopilotQuotaChargeStatus;
    refundReason: string | null;
    dayBucket: string;
    monthBucket: string;
    redisFinalizedAt: Date | null;
  },
  kind: CopilotQuotaReconcileAction['kind'],
): CopilotQuotaReconcileAction {
  const refundReason =
    kind === 'refund' || kind === 'finalize-refund'
      ? attempt.refundReason === 'failed' || attempt.refundReason === 'aborted'
        ? attempt.refundReason
        : null
      : 'failed';
  if (!refundReason) {
    throw new Error('Invalid Copilot quota refund reason.');
  }
  return {
    kind,
    attemptId: attempt.id,
    userId: attempt.userId,
    refundReason,
    window: attemptWindow(attempt),
  };
}

function attemptWindow(attempt: {
  dayBucket: string;
  monthBucket: string;
}): QuotaWindow {
  const window = {
    dayBucket: attempt.dayBucket,
    monthBucket: attempt.monthBucket,
  };
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(window.dayBucket) ||
    !/^\d{4}-\d{2}$/.test(window.monthBucket) ||
    window.dayBucket.slice(0, 7) !== window.monthBucket ||
    new Date(`${window.dayBucket}T00:00:00.000Z`).toISOString().slice(0, 10) !==
      window.dayBucket
  ) {
    throw new Error('Invalid persisted Copilot quota window.');
  }
  return window;
}

function chargeAttemptOperationKey(attemptId: string): string {
  return `copilot-charge-attempt:v1:${attemptId}`;
}

function quotaSettlementPending(): HttpException {
  return new HttpException(
    {
      code: 'COPILOT_QUOTA_SETTLEMENT_PENDING',
      message:
        'The previous Copilot charge is still being reconciled. Retry shortly.',
    },
    HttpStatus.CONFLICT,
  );
}

function assertCanonicalTurnIdentity(input: {
  user: AuthUser;
  conversationId: string;
  sessionId: string;
  billingOperationId: string;
  chargeAttemptId: string;
  turnId: string;
  turnKind: 'user' | 'tool-continuation';
}): void {
  if (
    !isCanonicalUserId(input.user.userId) ||
    !CONVERSATION_PATTERN.test(input.conversationId) ||
    !UUID_PATTERN.test(input.sessionId) ||
    !UUID_PATTERN.test(input.billingOperationId) ||
    !UUID_PATTERN.test(input.chargeAttemptId) ||
    !UUID_PATTERN.test(input.turnId) ||
    (input.turnKind !== 'user' && input.turnKind !== 'tool-continuation')
  ) {
    throw new Error('Invalid canonical Copilot quota identity.');
  }
}

function assertCanonicalUserId(userId: string): void {
  if (!isCanonicalUserId(userId)) {
    throw new Error('Invalid authenticated Copilot quota identity.');
  }
}

function isCanonicalUserId(userId: unknown): userId is string {
  return (
    typeof userId === 'string' &&
    userId.length > 0 &&
    Buffer.byteLength(userId, 'utf8') <= 180 &&
    !containsControlCharacter(userId)
  );
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) {
      return true;
    }
  }
  return false;
}

/**
 * Match CopilotStore's global lock order: user admission, conversation, then
 * physical charge attempt. The initial unlocked identity read is safe because
 * all scope columns are immutable; the row is re-read after its mutex is held.
 */
async function lockAttemptInCanonicalOrder(
  tx: Prisma.TransactionClient,
  attemptId: string,
) {
  const identity = await tx.copilotQuotaChargeAttempt.findUnique({
    where: { id: attemptId },
    select: { userId: true, conversationId: true },
  });
  if (!identity) return null;

  const userLockKey = `copilot-user-stream:${identity.userId}`;
  await tx.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${userLockKey}, 0))`,
  );
  await tx.$executeRaw(Prisma.sql`
    SELECT 1
    FROM "copilot_user_stream_states"
    WHERE "user_id" = ${identity.userId}
    FOR UPDATE
  `);

  const conversationLockKey = `copilot:${identity.userId}:${identity.conversationId}`;
  await tx.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${conversationLockKey}, 0))`,
  );
  await tx.$executeRaw(Prisma.sql`
    SELECT 1
    FROM "copilot_conversations"
    WHERE "user_id" = ${identity.userId}
      AND "conversation_id" = ${identity.conversationId}
    FOR UPDATE
  `);
  await tx.$executeRaw(
    Prisma.sql`SELECT 1 FROM "copilot_quota_charge_attempts" WHERE "id" = ${attemptId}::uuid FOR UPDATE`,
  );

  const attempt = await tx.copilotQuotaChargeAttempt.findUnique({
    where: { id: attemptId },
  });
  if (!attempt) return null;
  if (
    attempt.userId !== identity.userId ||
    attempt.conversationId !== identity.conversationId
  ) {
    throw new Error('Copilot quota charge attempt identity changed.');
  }
  const conversation = await tx.copilotConversation.findFirst({
    where: {
      userId: identity.userId,
      conversationId: identity.conversationId,
      billingChargeAttemptId: attempt.id,
    },
  });
  return { attempt, conversation };
}

async function databaseNow(tx: Prisma.TransactionClient): Promise<Date> {
  const rows = await tx.$queryRaw<Array<{ now: Date }>>(
    Prisma.sql`SELECT clock_timestamp() AS "now"`,
  );
  const now = rows[0]?.now;
  if (!(now instanceof Date)) throw new Error('Database clock unavailable.');
  return now;
}
