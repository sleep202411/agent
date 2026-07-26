import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import {
  Prisma,
  StudioAgentQuotaChargeStatus,
  type StudioAgentQuotaChargeAttempt,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AuthUser } from '../auth';
import { EntitlementService } from '../entitlements';
import { PrismaService } from '../infra/db/db.module';
import { utcDayKey, utcMonthKey } from '../quota/quota-keys';
import { QuotaService } from '../quota/quota.service';
import type {
  QuotaLimits,
  QuotaProfile,
  QuotaWindow,
} from '../quota/quota.types';
import { StudioAgentConfigService } from './studio-agent.config';

type TransactionClient = Prisma.TransactionClient;

const ACTIVE_RUN_STATUSES = [
  'queued',
  'running',
  'waiting_for_approval',
  'waiting_for_input',
  'cancelling',
] as const;
const RESERVING_CHARGE_STATUSES = [
  StudioAgentQuotaChargeStatus.consume_pending,
  StudioAgentQuotaChargeStatus.charged,
] as const;
const TERMINAL_CHARGE_STATUSES = new Set<StudioAgentQuotaChargeStatus>([
  StudioAgentQuotaChargeStatus.rejected,
  StudioAgentQuotaChargeStatus.refunded,
  StudioAgentQuotaChargeStatus.settled,
]);
const STORED_LIMIT_SCHEMA = z.union([
  z.number().int().nonnegative(),
  z.literal(-1),
]);
const StoredQuotaPlanSchema = z
  .object({
    planKey: z.string().min(1).max(160),
    // Plan key, not a tier enum: the coarse Java-era enum it used to validate
    // is gone, and a persisted value only ever needs to be a plan key string.
    tier: z.string().trim().min(1).max(64),
    limits: z
      .object({
        imageDaily: STORED_LIMIT_SCHEMA,
        videoDaily: STORED_LIMIT_SCHEMA,
        chatDaily: STORED_LIMIT_SCHEMA,
        workflowDaily: STORED_LIMIT_SCHEMA,
        uploadMB: STORED_LIMIT_SCHEMA,
        chatPerMinute: STORED_LIMIT_SCHEMA,
      })
      .strict(),
  })
  .strict();
const StoredQuotaProfileSchema = StoredQuotaPlanSchema.extend({
  upgrade: StoredQuotaPlanSchema.nullable(),
}).strict();

type StoredQuotaProfile = z.infer<typeof StoredQuotaProfileSchema>;

interface AdmissionCapacity {
  activeRootRuns: number;
  reservedTokenUnits: bigint;
}

type ReconcileAction =
  | {
      kind: 'recover-and-refund';
      attempt: StudioAgentQuotaChargeAttempt;
    }
  | {
      kind: 'refund' | 'settle' | 'finalize-refund' | 'finalize-settle';
      attempt: StudioAgentQuotaChargeAttempt;
    };

/**
 * Fail-closed Studio Agent admission and durable chat-quota coordinator.
 *
 * PostgreSQL owns the admission slot, cost reservation, and terminal state;
 * Redis owns the hot daily/minute counters. The two systems are never held in
 * one lock scope: every cross-system operation follows short PG decision ->
 * idempotent Redis command -> short PG CAS.
 */
@Injectable()
export class StudioAgentQuotaService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(StudioAgentQuotaService.name);
  private reconcileTimer: NodeJS.Timeout | null = null;
  private draining = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly quota: QuotaService,
    private readonly entitlements: EntitlementService,
    private readonly config: StudioAgentConfigService,
  ) {}

  onModuleInit(): void {
    this.reconcileTimer = setInterval(() => {
      this.runDrainSafely();
    }, this.config.value.admission.reconcileIntervalMs);
    this.reconcileTimer.unref();
    this.runDrainSafely();
  }

  onApplicationShutdown(): void {
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    this.reconcileTimer = null;
  }

  /**
   * Called before any message/run/input mutation. Redis unavailability is a
   * 503, never a silent rate-limit bypass.
   */
  async assertRateLimit(
    user: AuthUser,
    workspaceId: string,
  ): Promise<QuotaProfile> {
    const profile = await this.entitlements.quotaProfileForUser(user, {
      workspaceId,
    });
    try {
      const result = await this.quota.checkChatRate(user.userId, profile, {
        failureMode: 'closed',
      });
      if (result.ok) return profile;
      throw new HttpException(
        {
          code: 'STUDIO_AGENT_RATE_LIMITED',
          message: 'Studio Agent message rate limit exceeded.',
          dimension: 'chat',
          limit: result.limit,
          resetAt: result.resetAt,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw quotaUnavailable(error);
    }
  }

  async findAttempt(
    threadId: string,
    clientMessageId: string,
    requestHash: string,
  ): Promise<StudioAgentQuotaChargeAttempt | null> {
    const attempt = await this.prisma.studioAgentQuotaChargeAttempt.findUnique({
      where: {
        threadId_clientMessageId: { threadId, clientMessageId },
      },
    });
    if (attempt && attempt.requestHash !== requestHash) {
      throw new ConflictException({
        code: 'STUDIO_AGENT_IDEMPOTENCY_KEY_REUSED',
        message:
          'This client message ID was already used for a different submission.',
      });
    }
    return attempt;
  }

  /**
   * A prior charge for this clientMessageId that was refunded without ever
   * binding to a run must not be reused: consuming it throws `settlement
   * pending` forever, so the caller reprepares a fresh coordinator instead.
   */
  isReopenableRootAttempt(attempt: StudioAgentQuotaChargeAttempt): boolean {
    return isReopenableRootAttempt(attempt);
  }

  /**
   * Reserve global/workspace/user run and token capacity. Locks are always
   * acquired in the same global -> workspace -> user order. No transcript or
   * run exists yet, so a rejected admission leaves product state untouched.
   */
  async prepareRootAttempt(input: {
    userId: string;
    workspaceId: string;
    threadId: string;
    clientMessageId: string;
    requestHash: string;
    quotaProfile: QuotaProfile;
  }): Promise<StudioAgentQuotaChargeAttempt> {
    const existing = await this.findAttempt(
      input.threadId,
      input.clientMessageId,
      input.requestHash,
    );
    // A fully-refunded, run-less attempt is reopened below (delete + recreate
    // with a fresh id): its Redis idempotency fence is terminally sealed, so a
    // new charge cannot reuse the same attempt id. Anything else — an active
    // reservation, a charged coordinator, or a quota rejection — is returned
    // as-is so retries stay idempotent.
    if (existing && !isReopenableRootAttempt(existing)) return existing;

    const now = new Date();
    const reservedTokenUnits = BigInt(
      this.config.value.budget.maxTotalTokenUnits,
    );
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await lockAdmissionScopes(transaction, input.workspaceId, input.userId);
        const raced =
          await transaction.studioAgentQuotaChargeAttempt.findUnique({
            where: {
              threadId_clientMessageId: {
                threadId: input.threadId,
                clientMessageId: input.clientMessageId,
              },
            },
          });
        if (raced) {
          if (raced.requestHash !== input.requestHash) {
            throw new ConflictException({
              code: 'STUDIO_AGENT_IDEMPOTENCY_KEY_REUSED',
              message:
                'This client message ID was already used for a different submission.',
            });
          }
          if (isReopenableRootAttempt(raced)) {
            // The prior submit for this clientMessageId released its charge
            // without producing a run (a deterministic rejection such as
            // RUN_ALREADY_ACTIVE, whose refund is fully settled). Drop the
            // sealed shell inside this admission-locked transaction so the
            // fresh coordinator created below gets a new id — and therefore a
            // new Redis fence — instead of stranding the client on a permanent
            // "settlement pending" 409.
            await transaction.studioAgentQuotaChargeAttempt.delete({
              where: { id: raced.id },
            });
          } else {
            return raced;
          }
        }

        const [thread, threadReservation] = await Promise.all([
          transaction.studioAgentThread.findUniqueOrThrow({
            where: { id: input.threadId },
            select: { activeRunId: true },
          }),
          transaction.studioAgentQuotaChargeAttempt.findFirst({
            where: {
              threadId: input.threadId,
              status: { in: [...RESERVING_CHARGE_STATUSES] },
            },
            select: { id: true },
          }),
        ]);
        if (thread.activeRunId || threadReservation) {
          throw new ConflictException({
            code: 'STUDIO_AGENT_RUN_ALREADY_ACTIVE',
            message:
              'Choose how to deliver this message to the active response.',
          });
        }

        // These reads are intentionally sequential on the transaction's one
        // PostgreSQL connection. The advisory locks already serialize all
        // competing admissions, so Promise fan-out provides no latency win.
        const global = await admissionCapacity(transaction);
        const workspace = await admissionCapacity(transaction, {
          workspaceId: input.workspaceId,
        });
        const user = await admissionCapacity(transaction, {
          userId: input.userId,
        });
        this.assertCapacity('global', global, reservedTokenUnits);
        this.assertCapacity('workspace', workspace, reservedTokenUnits);
        this.assertCapacity('user', user, reservedTokenUnits);

        return transaction.studioAgentQuotaChargeAttempt.create({
          data: {
            id: randomUUID(),
            threadId: input.threadId,
            workspaceId: input.workspaceId,
            userId: input.userId,
            clientMessageId: input.clientMessageId,
            requestHash: input.requestHash,
            dayBucket: utcDayKey(now),
            monthBucket: utcMonthKey(now),
            quotaProfile: storeQuotaProfile(
              input.quotaProfile,
            ) as unknown as Prisma.InputJsonValue,
            reservedTokenUnits,
            admissionExpiresAt: new Date(
              now.getTime() + this.config.value.admission.leaseMs,
            ),
          },
        });
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.findAttempt(
        input.threadId,
        input.clientMessageId,
        input.requestHash,
      );
      if (!raced) throw error;
      return raced;
    }
  }

  /**
   * Ensure the logical attempt has exactly one Redis debit. Retries use the
   * attempt id as their persistent Redis idempotency fence.
   */
  async consumeAttempt(
    attemptId: string,
  ): Promise<StudioAgentQuotaChargeAttempt> {
    const attempt =
      await this.prisma.studioAgentQuotaChargeAttempt.findUniqueOrThrow({
        where: { id: attemptId },
      });
    if (attempt.status === StudioAgentQuotaChargeStatus.charged) return attempt;
    if (attempt.status === StudioAgentQuotaChargeStatus.rejected) {
      throw quotaRejected(attempt.rejection);
    }
    if (attempt.status !== StudioAgentQuotaChargeStatus.consume_pending) {
      throw settlementPending();
    }

    const profile = restoreQuotaProfile(attempt.quotaProfile);
    let result: Awaited<ReturnType<QuotaService['consume']>>;
    try {
      result = await this.quota.consume({
        userId: attempt.userId,
        profile,
        dimension: 'chat',
        cost: attempt.quotaCost,
        idempotencyKey: operationKey(attempt.id),
        idempotencyTtlSeconds: 'persistent',
        failureMode: 'closed',
        reason: 'studio_agent_root_turn',
        metadata: {
          chargeAttemptId: attempt.id,
          threadId: attempt.threadId,
          workspaceId: attempt.workspaceId,
          clientMessageId: attempt.clientMessageId,
          reservedTokenUnits: attempt.reservedTokenUnits.toString(),
          dayBucket: attempt.dayBucket,
          monthBucket: attempt.monthBucket,
        },
        window: attemptWindow(attempt),
      });
    } catch (error) {
      throw quotaUnavailable(error);
    }
    if (!result.ok) {
      const rejection = {
        code: 'STUDIO_AGENT_QUOTA_EXCEEDED',
        message: 'Studio Agent daily message quota exceeded.',
        dimension: result.dimension,
        used: result.used,
        limit: result.limit,
        resetAt: result.resetAt,
        nextTier: result.nextTier,
        nextPlanKey: result.nextPlanKey,
        nextTierLimit: result.nextTierLimit,
      };
      await this.prisma.studioAgentQuotaChargeAttempt.updateMany({
        where: {
          id: attempt.id,
          status: StudioAgentQuotaChargeStatus.consume_pending,
        },
        data: {
          status: StudioAgentQuotaChargeStatus.rejected,
          rejection: rejection as Prisma.InputJsonValue,
          terminalAt: new Date(),
        },
      });
      throw quotaRejected(rejection);
    }

    await this.prisma.studioAgentQuotaChargeAttempt.updateMany({
      where: {
        id: attempt.id,
        status: StudioAgentQuotaChargeStatus.consume_pending,
      },
      data: { status: StudioAgentQuotaChargeStatus.charged },
    });
    const charged =
      await this.prisma.studioAgentQuotaChargeAttempt.findUniqueOrThrow({
        where: { id: attempt.id },
      });
    if (charged.status !== StudioAgentQuotaChargeStatus.charged) {
      throw settlementPending();
    }
    return charged;
  }

  async attachRootInTransaction(
    transaction: TransactionClient,
    attemptId: string,
    rootRunId: string,
  ): Promise<void> {
    const updated = await transaction.studioAgentQuotaChargeAttempt.updateMany({
      where: {
        id: attemptId,
        rootRunId: null,
        status: StudioAgentQuotaChargeStatus.charged,
      },
      data: { rootRunId },
    });
    if (updated.count === 1) return;
    const attempt =
      await transaction.studioAgentQuotaChargeAttempt.findUniqueOrThrow({
        where: { id: attemptId },
      });
    if (
      attempt.status === StudioAgentQuotaChargeStatus.charged &&
      attempt.rootRunId === rootRunId
    ) {
      return;
    }
    throw settlementPending();
  }

  async releaseUnattachedAttempt(
    attemptId: string,
    reason: string,
  ): Promise<void> {
    await this.prisma.studioAgentQuotaChargeAttempt.updateMany({
      where: {
        id: attemptId,
        rootRunId: null,
        status: StudioAgentQuotaChargeStatus.charged,
      },
      data: {
        status: StudioAgentQuotaChargeStatus.refund_pending,
        refundReason: truncateReason(reason),
        terminalAt: new Date(),
      },
    });
    await this.reconcileAttempt(attemptId).catch((error) => {
      this.logger.warn(
        `studio_agent.quota_release_pending attemptId=${attemptId} error=${errorMessage(error)}`,
      );
    });
  }

  /**
   * Called inside the canonical root terminal transaction. Model usage is
   * snapshotted from authoritative terminal model-attempt rows at the same
   * boundary that releases the active cost reservation.
   */
  async markRootTerminalInTransaction(
    transaction: TransactionClient,
    rootRunId: string,
    status: 'succeeded' | 'failed' | 'cancelled',
    terminalAt: Date,
  ): Promise<void> {
    const usage = await aggregateActualUsage(transaction, rootRunId);
    const nextStatus =
      status === 'succeeded'
        ? StudioAgentQuotaChargeStatus.settle_pending
        : StudioAgentQuotaChargeStatus.refund_pending;
    const updated = await transaction.studioAgentQuotaChargeAttempt.updateMany({
      where: {
        rootRunId,
        status: StudioAgentQuotaChargeStatus.charged,
      },
      data: {
        status: nextStatus,
        refundReason:
          status === 'succeeded'
            ? null
            : status === 'cancelled'
              ? 'cancelled'
              : 'failed',
        terminalAt,
        ...usage,
      },
    });
    if (updated.count === 1) return;
    const attempt = await transaction.studioAgentQuotaChargeAttempt.findFirst({
      where: { rootRunId },
    });
    if (
      attempt &&
      (attempt.status === nextStatus ||
        TERMINAL_CHARGE_STATUSES.has(attempt.status))
    ) {
      return;
    }
    throw new Error(
      `Root run ${rootRunId} has no charged Studio Agent quota coordinator.`,
    );
  }

  async drainPendingAttempts(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      const rows = await this.prisma.studioAgentQuotaChargeAttempt.findMany({
        where: {
          OR: [
            {
              status: {
                in: [
                  StudioAgentQuotaChargeStatus.refund_pending,
                  StudioAgentQuotaChargeStatus.settle_pending,
                ],
              },
            },
            {
              status: {
                in: [
                  StudioAgentQuotaChargeStatus.refunded,
                  StudioAgentQuotaChargeStatus.settled,
                ],
              },
              redisFinalizedAt: null,
            },
            {
              status: StudioAgentQuotaChargeStatus.consume_pending,
              admissionExpiresAt: { lte: new Date() },
            },
            {
              status: StudioAgentQuotaChargeStatus.charged,
              rootRunId: null,
              admissionExpiresAt: { lte: new Date() },
            },
            {
              status: StudioAgentQuotaChargeStatus.charged,
              rootRun: {
                status: { in: ['succeeded', 'failed', 'cancelled'] },
              },
            },
          ],
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: this.config.value.admission.reconcileBatchSize,
        select: { id: true },
      });
      for (const row of rows) {
        await this.reconcileAttempt(row.id).catch((error) => {
          this.logger.error(
            `studio_agent.quota_reconcile_failed attemptId=${row.id} error=${errorMessage(error)}`,
          );
        });
      }
    } finally {
      this.draining = false;
    }
  }

  async reconcileAttempt(attemptId: string): Promise<boolean> {
    let action = await this.prepareReconcileAction(attemptId);
    if (!action) return false;

    if (action.kind === 'recover-and-refund') {
      const profile = restoreQuotaProfile(action.attempt.quotaProfile);
      const result = await this.quota.consume({
        userId: action.attempt.userId,
        profile,
        dimension: 'chat',
        cost: action.attempt.quotaCost,
        idempotencyKey: operationKey(action.attempt.id),
        idempotencyTtlSeconds: 'persistent',
        failureMode: 'closed',
        reason: 'studio_agent_root_turn_recovery',
        metadata: {
          chargeAttemptId: action.attempt.id,
          recovery: true,
        },
        window: attemptWindow(action.attempt),
      });
      if (!result.ok) {
        await this.prisma.studioAgentQuotaChargeAttempt.updateMany({
          where: {
            id: action.attempt.id,
            status: StudioAgentQuotaChargeStatus.consume_pending,
          },
          data: {
            status: StudioAgentQuotaChargeStatus.rejected,
            rejection: {
              code: 'STUDIO_AGENT_QUOTA_EXCEEDED',
              dimension: result.dimension,
              used: result.used,
              limit: result.limit,
              resetAt: result.resetAt,
            },
            terminalAt: new Date(),
          },
        });
        return true;
      }
      await this.prisma.studioAgentQuotaChargeAttempt.updateMany({
        where: {
          id: action.attempt.id,
          status: StudioAgentQuotaChargeStatus.consume_pending,
          rootRunId: null,
        },
        data: {
          status: StudioAgentQuotaChargeStatus.refund_pending,
          refundReason: 'admission_expired',
          terminalAt: new Date(),
        },
      });
      action = await this.prepareReconcileAction(attemptId);
      if (!action) return true;
    }

    if (action.kind === 'refund' || action.kind === 'finalize-refund') {
      const profile = restoreQuotaProfile(action.attempt.quotaProfile);
      const refund = await this.quota.refundFor({
        userId: action.attempt.userId,
        limits: profile.limits,
        dimension: 'chat',
        cost: action.attempt.quotaCost,
        idempotencyKey: operationKey(action.attempt.id),
        reason: `studio_agent_${action.attempt.refundReason ?? 'failed'}`,
        window: attemptWindow(action.attempt),
        terminalFence: true,
      });
      if (refund.status === 'failed') {
        throw new Error('Studio Agent quota refund is unavailable.');
      }
    }

    const terminalKind =
      action.kind === 'refund' || action.kind === 'finalize-refund'
        ? 'refund'
        : 'settle';
    if (action.kind === 'refund' || action.kind === 'settle') {
      const acknowledged =
        await this.prisma.studioAgentQuotaChargeAttempt.updateMany({
          where: {
            id: action.attempt.id,
            status:
              terminalKind === 'refund'
                ? StudioAgentQuotaChargeStatus.refund_pending
                : StudioAgentQuotaChargeStatus.settle_pending,
          },
          data: {
            status:
              terminalKind === 'refund'
                ? StudioAgentQuotaChargeStatus.refunded
                : StudioAgentQuotaChargeStatus.settled,
          },
        });
      if (acknowledged.count !== 1) return false;
    }

    const finalized = await this.quota.finalizeIdempotencyFor({
      userId: action.attempt.userId,
      dimension: 'chat',
      idempotencyKey: operationKey(action.attempt.id),
    });
    if (
      finalized.status === 'failed' ||
      (terminalKind === 'refund' && finalized.status === 'missing')
    ) {
      throw new Error(
        'Studio Agent quota idempotency finalization is unavailable.',
      );
    }
    const finalizedAt =
      await this.prisma.studioAgentQuotaChargeAttempt.updateMany({
        where: {
          id: action.attempt.id,
          status:
            terminalKind === 'refund'
              ? StudioAgentQuotaChargeStatus.refunded
              : StudioAgentQuotaChargeStatus.settled,
          redisFinalizedAt: null,
        },
        data: { redisFinalizedAt: new Date() },
      });
    return finalizedAt.count === 1;
  }

  private async prepareReconcileAction(
    attemptId: string,
  ): Promise<ReconcileAction | null> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw(
        Prisma.sql`SELECT 1 FROM "studio_agent_quota_charge_attempts" WHERE "id" = ${attemptId}::uuid FOR UPDATE`,
      );
      let attempt = await transaction.studioAgentQuotaChargeAttempt.findUnique({
        where: { id: attemptId },
        include: { rootRun: true },
      });
      if (!attempt) return null;
      const now = new Date();

      if (
        attempt.status === StudioAgentQuotaChargeStatus.consume_pending &&
        attempt.rootRunId === null &&
        attempt.admissionExpiresAt <= now
      ) {
        return { kind: 'recover-and-refund', attempt };
      }

      if (attempt.status === StudioAgentQuotaChargeStatus.charged) {
        if (attempt.rootRun === null && attempt.admissionExpiresAt <= now) {
          attempt = await transaction.studioAgentQuotaChargeAttempt.update({
            where: { id: attempt.id },
            data: {
              status: StudioAgentQuotaChargeStatus.refund_pending,
              refundReason: 'admission_expired',
              terminalAt: now,
            },
            include: { rootRun: true },
          });
        } else if (
          attempt.rootRun &&
          ['succeeded', 'failed', 'cancelled'].includes(attempt.rootRun.status)
        ) {
          const usage = await aggregateActualUsage(
            transaction,
            attempt.rootRun.id,
          );
          attempt = await transaction.studioAgentQuotaChargeAttempt.update({
            where: { id: attempt.id },
            data: {
              status:
                attempt.rootRun.status === 'succeeded'
                  ? StudioAgentQuotaChargeStatus.settle_pending
                  : StudioAgentQuotaChargeStatus.refund_pending,
              refundReason:
                attempt.rootRun.status === 'succeeded'
                  ? null
                  : attempt.rootRun.status,
              terminalAt: attempt.rootRun.completedAt ?? now,
              ...usage,
            },
            include: { rootRun: true },
          });
        }
      }

      switch (attempt.status) {
        case StudioAgentQuotaChargeStatus.refund_pending:
          return { kind: 'refund', attempt };
        case StudioAgentQuotaChargeStatus.settle_pending:
          return { kind: 'settle', attempt };
        case StudioAgentQuotaChargeStatus.refunded:
          return attempt.redisFinalizedAt
            ? null
            : { kind: 'finalize-refund', attempt };
        case StudioAgentQuotaChargeStatus.settled:
          return attempt.redisFinalizedAt
            ? null
            : { kind: 'finalize-settle', attempt };
        default:
          return null;
      }
    });
  }

  private assertCapacity(
    scope: 'global' | 'workspace' | 'user',
    current: AdmissionCapacity,
    requestedTokenUnits: bigint,
  ): void {
    const runLimit =
      scope === 'global'
        ? this.config.value.admission.maxActiveRootRuns.global
        : scope === 'workspace'
          ? this.config.value.admission.maxActiveRootRuns.workspace
          : this.config.value.admission.maxActiveRootRuns.user;
    const tokenLimit = BigInt(
      scope === 'global'
        ? this.config.value.admission.maxReservedTokenUnits.global
        : scope === 'workspace'
          ? this.config.value.admission.maxReservedTokenUnits.workspace
          : this.config.value.admission.maxReservedTokenUnits.user,
    );
    if (current.activeRootRuns >= runLimit) {
      throw new HttpException(
        {
          code: 'STUDIO_AGENT_CONCURRENCY_LIMIT',
          message: `Studio Agent ${scope} active-run capacity is full.`,
          scope,
          limit: runLimit,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (current.reservedTokenUnits + requestedTokenUnits > tokenLimit) {
      throw new HttpException(
        {
          code: 'STUDIO_AGENT_COST_CAPACITY_LIMIT',
          message: `Studio Agent ${scope} compute reservation capacity is full.`,
          scope,
          limit: tokenLimit.toString(),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private runDrainSafely(): void {
    void this.drainPendingAttempts().catch((error) => {
      this.logger.error(
        `studio_agent.quota_drain_failed error=${errorMessage(error)}`,
      );
    });
  }
}

async function lockAdmissionScopes(
  transaction: TransactionClient,
  workspaceId: string,
  userId: string,
): Promise<void> {
  for (const key of [
    'studio-agent-admission:global',
    `studio-agent-admission:workspace:${workspaceId}`,
    `studio-agent-admission:user:${userId}`,
  ]) {
    await transaction.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
    );
  }
}

async function admissionCapacity(
  transaction: TransactionClient,
  scope: { workspaceId?: string; userId?: string } = {},
): Promise<AdmissionCapacity> {
  const rows = await transaction.$queryRaw<
    Array<{ activeRootRuns: bigint; reservedTokenUnits: bigint }>
  >(Prisma.sql`
    SELECT
      COUNT(*)::bigint AS "activeRootRuns",
      COALESCE(SUM(charge."reserved_token_units"), 0)::bigint AS "reservedTokenUnits"
    FROM "studio_agent_quota_charge_attempts" AS charge
    LEFT JOIN "studio_agent_runs" AS run
      ON run."id" = charge."root_run_id"
    WHERE charge."status"::text IN (${Prisma.join(
      RESERVING_CHARGE_STATUSES.map((status) => Prisma.sql`${status}::text`),
    )})
      AND (
        charge."root_run_id" IS NULL OR
        run."status"::text IN (${Prisma.join(
          ACTIVE_RUN_STATUSES.map((status) => Prisma.sql`${status}::text`),
        )})
      )
      ${scope.workspaceId ? Prisma.sql`AND charge."workspace_id" = ${scope.workspaceId}::uuid` : Prisma.empty}
      ${scope.userId ? Prisma.sql`AND charge."user_id" = ${scope.userId}` : Prisma.empty}
  `);
  const row = rows[0];
  return {
    activeRootRuns: Number(row?.activeRootRuns ?? 0n),
    reservedTokenUnits: row?.reservedTokenUnits ?? 0n,
  };
}

async function aggregateActualUsage(
  transaction: TransactionClient,
  rootRunId: string,
) {
  const aggregate = await transaction.studioAgentModelAttempt.aggregate({
    where: {
      run: { rootRunId },
      status: { in: ['succeeded', 'failed', 'cancelled'] },
    },
    _count: { _all: true },
    _sum: {
      inputTokens: true,
      outputTokens: true,
      cachedInputTokens: true,
      reasoningTokens: true,
    },
  });
  return {
    actualModelAttempts: aggregate._count._all,
    actualInputTokens: BigInt(aggregate._sum.inputTokens ?? 0),
    actualOutputTokens: BigInt(aggregate._sum.outputTokens ?? 0),
    actualCachedInputTokens: BigInt(aggregate._sum.cachedInputTokens ?? 0),
    actualReasoningTokens: BigInt(aggregate._sum.reasoningTokens ?? 0),
  };
}

function storeQuotaProfile(profile: QuotaProfile): StoredQuotaProfile {
  return StoredQuotaProfileSchema.parse({
    planKey: profile.planKey,
    tier: profile.tier,
    limits: storeLimits(profile.limits),
    upgrade: profile.upgrade
      ? {
          planKey: profile.upgrade.planKey,
          tier: profile.upgrade.tier,
          limits: storeLimits(profile.upgrade.limits),
        }
      : null,
  });
}

function restoreQuotaProfile(value: Prisma.JsonValue): QuotaProfile {
  const stored = StoredQuotaProfileSchema.parse(value);
  return {
    planKey: stored.planKey,
    tier: stored.tier,
    limits: restoreLimits(stored.limits),
    upgrade: stored.upgrade
      ? {
          planKey: stored.upgrade.planKey,
          tier: stored.upgrade.tier,
          limits: restoreLimits(stored.upgrade.limits),
        }
      : null,
  };
}

function storeLimits(limits: QuotaLimits) {
  return Object.fromEntries(
    Object.entries(limits).map(([key, value]) => [
      key,
      Number.isFinite(value) ? value : -1,
    ]),
  );
}

function restoreLimits(limits: StoredQuotaProfile['limits']): QuotaLimits {
  return Object.fromEntries(
    Object.entries(limits).map(([key, value]) => [
      key,
      value === -1 ? Number.POSITIVE_INFINITY : value,
    ]),
  ) as unknown as QuotaLimits;
}

function attemptWindow(attempt: {
  dayBucket: string;
  monthBucket: string;
}): QuotaWindow {
  return {
    dayBucket: attempt.dayBucket,
    monthBucket: attempt.monthBucket,
  };
}

function operationKey(attemptId: string): string {
  return `studio-agent-charge:v1:${attemptId}`;
}

/**
 * A root charge coordinator that was fully refunded (its Redis fence sealed via
 * finalization) without ever binding to a run. A same-clientMessageId retry is
 * a genuinely new attempt: the row must be recreated with a fresh id rather
 * than consumed (which would throw `settlement pending` forever) or reset
 * in-place (which would collide with the sealed idempotency fence).
 */
function isReopenableRootAttempt(
  attempt: StudioAgentQuotaChargeAttempt,
): boolean {
  return (
    attempt.rootRunId === null &&
    attempt.status === StudioAgentQuotaChargeStatus.refunded &&
    attempt.redisFinalizedAt !== null
  );
}

function quotaUnavailable(error: unknown): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: 'STUDIO_AGENT_QUOTA_UNAVAILABLE',
    message: 'Studio Agent quota admission is temporarily unavailable.',
    cause: errorMessage(error),
  });
}

function quotaRejected(rejection: unknown): HttpException {
  const details =
    rejection && typeof rejection === 'object' && !Array.isArray(rejection)
      ? rejection
      : {
          code: 'STUDIO_AGENT_QUOTA_EXCEEDED',
          message: 'Studio Agent daily message quota exceeded.',
        };
  return new HttpException(details, HttpStatus.TOO_MANY_REQUESTS);
}

function settlementPending(): ConflictException {
  return new ConflictException({
    code: 'STUDIO_AGENT_QUOTA_SETTLEMENT_PENDING',
    message:
      'This Studio Agent submission is still being reconciled. Retry shortly.',
  });
}

function truncateReason(reason: string): string {
  const normalized = reason.trim() || 'failed';
  return normalized.slice(0, 32);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}
