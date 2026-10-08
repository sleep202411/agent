import { backgroundTasksEnabled } from '../common/background-tasks';
import { hostname } from 'node:os';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  Prisma,
  StoryGenerationBatchItemStatus,
  StoryGenerationBatchStatus,
  StoryProductionGenerationTargetKind,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../infra/db/db.module';
import { StoryGenerationOptionsSchema } from './story-production-generation.schema';
import { StoryProductionGenerationService } from './story-production-generation.service';

const DEFAULT_INTERVAL_MS = 1_000;
const DEFAULT_ACTORS_PER_SWEEP = 25;
const LEASE_MS = 60_000;
/** Per-attempt backoff for transient item requeues (attempt N waits N×this). */
const ITEM_RETRY_BACKOFF_MS = 15_000;

function itemMaxAttempts(): number {
  const raw = Number.parseInt(
    process.env.STORY_GENERATION_ITEM_MAX_ATTEMPTS ?? '',
    10,
  );
  return Number.isFinite(raw) && raw >= 1 ? raw : 3;
}
const QUEUE_BACKOFF_MS = 2_000;

/**
 * Fair admission controller in front of the provider queues. Each sweep claims
 * at most one item per actor, ordered by the batch least recently dispatched.
 * A 100-item batch therefore progresses, but can never occupy the entire
 * admission stream ahead of another creator's one-item batch.
 */
@Injectable()
export class StoryGenerationBatchDispatcherService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(
    StoryGenerationBatchDispatcherService.name,
  );
  private readonly workerId = `story-generation-batch:${hostname().slice(0, 48)}:${process.pid}:${randomUUID()}`;
  private timer: NodeJS.Timeout | null = null;
  private draining: Promise<void> | null = null;
  private stopping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly generations: StoryProductionGenerationService,
  ) {}

  onApplicationBootstrap(): void {
    if (!backgroundTasksEnabled()) return;
    if (this.stopping || this.timer) return;
    if (process.env.STORY_GENERATION_BATCH_DISPATCHER_ENABLED === 'false') {
      this.logger.log('Story generation batch dispatcher is disabled');
      return;
    }
    const interval = positiveInteger(
      process.env.STORY_GENERATION_BATCH_DISPATCHER_INTERVAL_MS,
      DEFAULT_INTERVAL_MS,
    );
    this.timer = setInterval(() => void this.drainOnce(), interval);
    this.timer.unref?.();
    queueMicrotask(() => void this.drainOnce());
    this.logger.log(
      `Story generation batch dispatcher polling every ${interval}ms (${this.workerId})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.draining;
  }

  async drainOnce(limit = DEFAULT_ACTORS_PER_SWEEP): Promise<void> {
    if (!backgroundTasksEnabled()) return;
    if (this.stopping) return;
    if (this.draining) return this.draining;
    this.draining = this.drain(limit).finally(() => {
      this.draining = null;
    });
    return this.draining;
  }

  private async drain(limit: number): Promise<void> {
    try {
      await this.reconcile();
      if (this.stopping) return;
      await this.stopSequentialBatchesAfterFailure();
      if (this.stopping) return;
      const claimed = await this.claim(Math.max(1, Math.min(100, limit)));
      if (this.stopping) return;
      await Promise.all(claimed.map((item) => this.dispatch(item)));
      if (this.stopping) return;
      await this.refreshBatchStatuses();
    } catch (error) {
      this.logger.warn(`Batch dispatch sweep failed: ${errorText(error)}`);
    }
  }

  private async claim(limit: number): Promise<ClaimedBatchItem[]> {
    return this.prisma.$transaction(async (tx) => {
      const [fairnessLease] = await tx.$queryRaw<Array<{ acquired: boolean }>>`
        SELECT pg_try_advisory_xact_lock(
          hashtext('story-generation-batch-global-fairness')::bigint
        ) AS "acquired"
      `;
      // Exactly one replica chooses actors at a time. Provider submissions run
      // after this short transaction, so the lock protects fairness without
      // serializing network-bound work.
      if (!fairnessLease?.acquired) return [];
      const claimed = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        WITH actors AS (
          SELECT
            batch."actor_user_id",
            MIN(
              COALESCE(batch."last_dispatched_at", batch."confirmed_at", batch."created_at")
            ) AS "fairness_at"
          FROM "story_generation_batches" AS batch
          JOIN "story_generation_batch_items" AS item
            ON item."batch_id" = batch."id"
          WHERE batch."status" IN ('queued', 'running')
            AND (
              item."status" = 'ready'
              OR (
                item."status" = 'dispatching'
                AND item."lease_expires_at" <= NOW()
              )
            )
            AND (item."next_dispatch_at" IS NULL OR item."next_dispatch_at" <= NOW())
          GROUP BY batch."actor_user_id"
          ORDER BY "fairness_at" ASC, batch."actor_user_id" ASC
          LIMIT ${limit}
        ), candidates AS (
          SELECT picked."id"
          FROM actors
          CROSS JOIN LATERAL (
            SELECT item."id"
            FROM "story_generation_batch_items" AS item
            JOIN "story_generation_batches" AS batch
              ON batch."id" = item."batch_id"
            WHERE batch."actor_user_id" = actors."actor_user_id"
              AND batch."status" IN ('queued', 'running')
              AND (
                item."status" = 'ready'
                OR (
                  item."status" = 'dispatching'
                  AND item."lease_expires_at" <= NOW()
                )
              )
              AND (item."next_dispatch_at" IS NULL OR item."next_dispatch_at" <= NOW())
              AND (
                batch."dispatch_mode" <> 'sequential'
                OR NOT EXISTS (
                  SELECT 1
                  FROM "story_generation_batch_items" AS active_item
                  WHERE active_item."batch_id" = batch."id"
                    AND active_item."id" <> item."id"
                    AND (
                      active_item."status" IN ('dispatching', 'submitted')
                      OR (
                        active_item."status" = 'failed'
                        AND active_item."ordinal" < item."ordinal"
                      )
                    )
                )
              )
            ORDER BY
              COALESCE(batch."last_dispatched_at", batch."confirmed_at", batch."created_at") ASC,
              batch."created_at" ASC,
              item."ordinal" ASC
            FOR UPDATE OF item SKIP LOCKED
            LIMIT 1
          ) AS picked
        )
        UPDATE "story_generation_batch_items" AS item
        SET
          "status" = 'dispatching',
          "dispatch_attempts" = item."dispatch_attempts" + 1,
          "lease_owner" = ${this.workerId},
          "lease_expires_at" = NOW() + (${LEASE_MS} * INTERVAL '1 millisecond'),
          "updated_at" = NOW()
        FROM candidates
        WHERE item."id" = candidates."id"
        RETURNING item."id"
      `);
      if (claimed.length === 0) return [];
      const items = await tx.storyGenerationBatchItem.findMany({
        where: { id: { in: claimed.map((item) => item.id) } },
        include: { batch: true },
      });
      await tx.storyGenerationBatch.updateMany({
        where: { id: { in: items.map((item) => item.batchId) } },
        data: {
          status: StoryGenerationBatchStatus.running,
          lastDispatchedAt: new Date(),
        },
      });
      return items;
    });
  }

  private async dispatch(item: ClaimedBatchItem): Promise<void> {
    if (!backgroundTasksEnabled()) return;
    const isAsset =
      item.targetKind === StoryProductionGenerationTargetKind.asset_spec &&
      item.sequenceId === null;
    const isStoryboardClip =
      item.targetKind === StoryProductionGenerationTargetKind.storyboard_clip &&
      item.sequenceId !== null;
    if (!isAsset && !isStoryboardClip) {
      await this.fail(
        item,
        'UNSUPPORTED_BATCH_TARGET',
        'Unsupported batch target.',
      );
      return;
    }
    try {
      const actor = { userId: item.batch.actorUserId };
      const expectedQuote = {
        pricingVersion: item.pricingVersion,
        points: item.quotedPoints,
      };
      const billingSubject = {
        type: item.batch.billingSubjectType,
        id: item.batch.billingSubjectId,
      };
      const batchAdmission = {
        itemId: item.id,
        leaseOwner: this.workerId,
      };
      const options = batchClientOptions(item.options);
      if (isAsset) {
        await this.generations.createQuotedAssetGeneration(
          actor,
          item.batch.workspaceId,
          item.batch.storyProjectId,
          item.batch.storyChapterId,
          item.targetId,
          `story-generation-batch:${item.id}:attempt:${item.dispatchAttempts}`,
          {
            expectedVersion: item.targetVersion,
            modelId: item.modelId,
            schemaVersion: item.schemaVersion,
            outputKind: item.outputKind,
            options,
          },
          expectedQuote,
          billingSubject,
          batchAdmission,
        );
      } else {
        await this.generations.createQuotedStoryboardClipGeneration(
          actor,
          item.batch.workspaceId,
          item.batch.storyProjectId,
          item.batch.storyChapterId,
          item.sequenceId!,
          item.targetId,
          `story-generation-batch:${item.id}:attempt:${item.dispatchAttempts}`,
          {
            expectedVersion: item.targetVersion,
            modelId: item.modelId,
            schemaVersion: item.schemaVersion,
            options,
          },
          expectedQuote,
          billingSubject,
          batchAdmission,
        );
      }
    } catch (error) {
      if (errorCode(error) === 'QUEUE_LIMIT_EXCEEDED') {
        await this.prisma.storyGenerationBatchItem.updateMany({
          where: {
            id: item.id,
            status: StoryGenerationBatchItemStatus.dispatching,
            leaseOwner: this.workerId,
          },
          data: {
            status: StoryGenerationBatchItemStatus.ready,
            nextDispatchAt: new Date(Date.now() + QUEUE_BACKOFF_MS),
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        });
        return;
      }
      await this.fail(
        item,
        errorCode(error) ?? 'BATCH_ITEM_DISPATCH_FAILED',
        errorText(error),
        errorDetails(error),
      );
    }
  }

  private async fail(
    item: ClaimedBatchItem,
    code: string,
    message: string,
    details: Record<string, string | number | boolean> = {},
  ): Promise<void> {
    const failedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      // Transient provider-side reference fetch failures self-heal: requeue
      // the item with a short backoff instead of failing the sequential
      // batch (one flake once failed all 47 items of a Story storyboard).
      // Budget spans resumes — dispatch_attempts never resets, so the total
      // attempt count stays bounded.
      if (
        code === 'PROVIDER_REFERENCE_DOWNLOAD' &&
        item.dispatchAttempts < itemMaxAttempts()
      ) {
        const requeued = await tx.storyGenerationBatchItem.updateMany({
          where: {
            id: item.id,
            status: StoryGenerationBatchItemStatus.dispatching,
            leaseOwner: this.workerId,
          },
          data: {
            status: StoryGenerationBatchItemStatus.ready,
            nextDispatchAt: new Date(
              Date.now() + item.dispatchAttempts * ITEM_RETRY_BACKOFF_MS,
            ),
            leaseOwner: null,
            leaseExpiresAt: null,
            error: {
              code,
              message,
              retryable: true,
              ...details,
            },
          },
        });
        if (requeued.count === 1) {
          this.logger.warn(
            `Batch item ${item.id} reference fetch failed (attempt ${item.dispatchAttempts}); requeued with backoff.`,
          );
          return;
        }
      }
      if (
        item.batch.dispatchMode === 'sequential' &&
        (code === 'INSUFFICIENT_COMPUTE_POINTS' ||
          code === 'INSUFFICIENT_UNEXPIRED_COMPUTE_POINTS')
      ) {
        const blocked = await tx.storyGenerationBatchItem.updateMany({
          where: {
            id: item.id,
            status: StoryGenerationBatchItemStatus.dispatching,
            leaseOwner: this.workerId,
          },
          data: {
            status: StoryGenerationBatchItemStatus.ready,
            nextDispatchAt: null,
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        });
        if (blocked.count !== 1) return;
        await tx.storyGenerationBatch.updateMany({
          where: {
            id: item.batchId,
            status: {
              in: [
                StoryGenerationBatchStatus.queued,
                StoryGenerationBatchStatus.running,
              ],
            },
          },
          data: {
            status: StoryGenerationBatchStatus.blocked,
            blockedAt: failedAt,
            blockReason: {
              code,
              message:
                'Not enough compute points. Recharge and continue from this item.',
              retryable: true,
              ...details,
            },
            version: { increment: 1 },
          },
        });
        return;
      }
      const failed = await tx.storyGenerationBatchItem.updateMany({
        where: {
          id: item.id,
          status: StoryGenerationBatchItemStatus.dispatching,
          leaseOwner: this.workerId,
        },
        data: {
          status: StoryGenerationBatchItemStatus.failed,
          completedAt: failedAt,
          leaseOwner: null,
          leaseExpiresAt: null,
          error: { code, message, retryable: false, ...details },
        },
      });
      if (failed.count !== 1 || item.batch.dispatchMode !== 'sequential') {
        return;
      }
      // Publish one coherent failure-stop state. Without this transaction a
      // client can briefly see item N failed while item N+1 still appears
      // active until the next one-second dispatcher sweep.
      await tx.storyGenerationBatchItem.updateMany({
        where: {
          batchId: item.batchId,
          ordinal: { gt: item.ordinal },
          status: StoryGenerationBatchItemStatus.ready,
        },
        data: {
          status: StoryGenerationBatchItemStatus.cancelled,
          completedAt: failedAt,
          leaseOwner: null,
          leaseExpiresAt: null,
          error: {
            code: 'PREVIOUS_ITEM_FAILED',
            message: 'Generation stopped because an earlier media item failed.',
            retryable: false,
          },
        },
      });
    });
  }

  private async reconcile(): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE "story_generation_batch_items" AS item
      SET
        "status" = CASE
          WHEN generation."materialized_at" IS NOT NULL THEN 'completed'::"StoryGenerationBatchItemStatus"
          WHEN job."status" = 'cancelled' THEN 'cancelled'::"StoryGenerationBatchItemStatus"
          WHEN job."status" IN ('failed', 'expired') THEN 'failed'::"StoryGenerationBatchItemStatus"
          ELSE item."status"
        END,
        "completed_at" = CASE
          WHEN generation."materialized_at" IS NOT NULL
            OR job."status" IN ('cancelled', 'failed', 'expired')
          THEN COALESCE(item."completed_at", NOW())
          ELSE item."completed_at"
        END,
        "error" = CASE
          WHEN job."status" IN ('failed', 'expired') THEN job."error"
          ELSE item."error"
        END,
        "updated_at" = NOW()
      FROM "story_production_generations" AS generation
      JOIN "ai_jobs" AS job ON job."id" = generation."ai_job_id"
      WHERE item."generation_id" = generation."id"
        AND item."status" = 'submitted'
        AND (
          generation."materialized_at" IS NOT NULL
          OR job."status" IN ('cancelled', 'failed', 'expired')
        )
    `;
    await this.prisma.storyGenerationBatch.updateMany({
      where: {
        status: StoryGenerationBatchStatus.awaiting_confirmation,
        quoteExpiresAt: { lte: new Date() },
      },
      data: {
        status: StoryGenerationBatchStatus.expired,
        completedAt: new Date(),
        version: { increment: 1 },
      },
    });
  }

  /**
   * H5 batches are a visible one-card-at-a-time workflow. Once the current
   * sequential item fails, later unstarted items must become terminal before
   * the next claim pass; otherwise the following image starts even though the
   * creator is looking at an error card.
   */
  private async stopSequentialBatchesAfterFailure(): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE "story_generation_batch_items" AS pending
      SET
        "status" = 'cancelled'::"StoryGenerationBatchItemStatus",
        "completed_at" = COALESCE(pending."completed_at", NOW()),
        "error" = jsonb_build_object(
          'code', 'PREVIOUS_ITEM_FAILED',
          'message', 'Generation stopped because an earlier media item failed.',
          'retryable', false
        ),
        "lease_owner" = NULL,
        "lease_expires_at" = NULL,
        "updated_at" = NOW()
      FROM "story_generation_batches" AS batch
      WHERE pending."batch_id" = batch."id"
        AND batch."status" IN ('queued', 'running')
        AND batch."dispatch_mode" = 'sequential'
        AND pending."status" = 'ready'
        AND EXISTS (
          SELECT 1
          FROM "story_generation_batch_items" AS failed
          WHERE failed."batch_id" = pending."batch_id"
            AND failed."status" = 'failed'
            AND failed."ordinal" < pending."ordinal"
        )
    `;
  }

  private async refreshBatchStatuses(): Promise<void> {
    // Resolve every settled batch in one statement. A hard `take` here can
    // starve terminal rows behind hundreds of long-running batches, leaving
    // clients polling forever even though every item has already settled.
    await this.prisma.$executeRaw`
      WITH settled AS (
        SELECT
          batch."id",
          batch."status" AS "batch_status",
          COUNT(*) AS "item_count",
          COUNT(*) FILTER (
            WHERE item."status" = 'completed'
          ) AS "completed_count",
          COUNT(*) FILTER (
            WHERE item."status" = 'failed'
          ) AS "failed_count",
          COUNT(*) FILTER (
            WHERE item."status" IN ('ready', 'dispatching', 'submitted')
          ) AS "active_count"
        FROM "story_generation_batches" AS batch
        JOIN "story_generation_batch_items" AS item
          ON item."batch_id" = batch."id"
        WHERE batch."status" IN ('queued', 'running', 'cancelling')
        GROUP BY batch."id", batch."status"
      ), resolved AS (
        SELECT
          "id",
          CASE
            WHEN "batch_status" = 'cancelling'
              THEN 'cancelled'::"StoryGenerationBatchStatus"
            WHEN "completed_count" = "item_count"
              THEN 'completed'::"StoryGenerationBatchStatus"
            WHEN "completed_count" > 0
              THEN 'partial_failed'::"StoryGenerationBatchStatus"
            WHEN "failed_count" > 0
              THEN 'failed'::"StoryGenerationBatchStatus"
            ELSE 'cancelled'::"StoryGenerationBatchStatus"
          END AS "next_status"
        FROM settled
        WHERE "active_count" = 0
      )
      UPDATE "story_generation_batches" AS batch
      SET
        "status" = resolved."next_status",
        "completed_at" = COALESCE(batch."completed_at", NOW()),
        "version" = batch."version" + 1,
        "updated_at" = NOW()
      FROM resolved
      WHERE batch."id" = resolved."id"
        AND batch."status" IN ('queued', 'running', 'cancelling')
    `;
  }
}

function batchClientOptions(value: Prisma.JsonValue) {
  return StoryGenerationOptionsSchema.parse(jsonOptions(value));
}

type ClaimedBatchItem = Prisma.StoryGenerationBatchItemGetPayload<{
  include: { batch: true };
}>;

function jsonOptions(
  value: Prisma.JsonValue,
): Record<
  string,
  boolean | number | string | Array<boolean | number | string>
> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<
    string,
    boolean | number | string | Array<boolean | number | string>
  >;
}

function errorCode(error: unknown): string | null {
  const response = errorResponse(error);
  const code = response?.code;
  return typeof code === 'string' ? code : null;
}

function errorText(error: unknown): string {
  const response = errorResponse(error);
  const responseMessage = response?.msg ?? response?.message;
  if (typeof responseMessage === 'string' && responseMessage.trim()) {
    return responseMessage.trim();
  }
  if (Array.isArray(responseMessage)) {
    const messages = responseMessage.filter(
      (value): value is string =>
        typeof value === 'string' && Boolean(value.trim()),
    );
    if (messages.length > 0) return messages.join('; ');
  }
  return error instanceof Error ? error.message : String(error);
}

function errorDetails(
  error: unknown,
): Record<string, string | number | boolean> {
  const response = errorResponse(error);
  if (!response) return {};
  const details: Record<string, string | number | boolean> = {};
  for (const key of [
    'requiredAmount',
    'availableBalance',
    'unavailableAmount',
  ] as const) {
    const value = response[key];
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      details[key] = value;
    }
  }
  return details;
}

function errorResponse(error: unknown): Record<string, unknown> | null {
  if (!error || typeof error !== 'object') return null;
  const getResponse = (error as { getResponse?: unknown }).getResponse;
  if (typeof getResponse === 'function') {
    const response = getResponse.call(error) as unknown;
    if (response && typeof response === 'object' && !Array.isArray(response)) {
      return response as Record<string, unknown>;
    }
  }
  const response = (error as { response?: unknown }).response;
  return response && typeof response === 'object' && !Array.isArray(response)
    ? (response as Record<string, unknown>)
    : null;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      'STORY_GENERATION_BATCH_DISPATCHER_INTERVAL_MS must be a positive integer.',
    );
  }
  return parsed;
}
