import { backgroundTasksEnabled } from '../common/background-tasks';
import {
  ConflictException,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  Prisma,
  StoryGenerationBatchStatus,
  StoryProductionGenerationTargetKind,
} from '@prisma/client';
import { StoryProductionContinuationPlanSchema } from '@repo/agent-tools';
import {
  AgentOsContinuationNotReadyError,
  AgentOsRunJournalService,
  type AgentOsJournalDispatch,
} from '../agent-os-journal/agent-os-run-journal.service';
import { PrismaService } from '../infra/db/db.module';

const DEFAULT_INTERVAL_MS = 1_000;
const DEFAULT_BATCH_SIZE = 25;
const MAX_BACKOFF_MS = 60_000;

/**
 * Journal conflicts that can never be resolved by retrying the same
 * delivery: the source run is terminal/missing/mismatched, so the handoff
 * result is undeliverable by construction. The worker marks such batches
 * durably abandoned instead of re-queueing them every sweep.
 */
const TERMINAL_HANDOFF_ERROR_CODES = new Set([
  'AGENT_OS_EXTERNAL_HANDOFF_NOT_REGISTERED',
  'AGENT_OS_EXTERNAL_HANDOFF_RUN_MISSING',
  'AGENT_OS_EXTERNAL_HANDOFF_IDENTITY_MISMATCH',
  'AGENT_OS_EXTERNAL_RESULT_CORRELATION_MISMATCH',
  'AGENT_OS_EXTERNAL_HANDOFF_AFTER_TERMINAL',
  'AGENT_OS_EXTERNAL_HANDOFF_TURN_MISSING',
]);

/**
 * Conflicts that mean somebody else already delivered (or is delivering)
 * this handoff — most often another replica winning the claim race. Skip
 * silently; the batch is already being handled.
 */
const BENIGN_HANDOFF_ERROR_CODES = new Set([
  'AGENT_OS_EXTERNAL_HANDOFF_EVENT_CONFLICT',
  'AGENT_OS_EXTERNAL_RESULT_CONFLICT',
]);

/** Local invariant violations that no retry can fix for this batch. */
class StoryHandoffPermanentlyInvalidError extends Error {}

/** Another writer delivered first; nothing left to do for this batch. */
class StoryHandoffClaimLostError extends Error {}

/**
 * Resumes the same Agent OS turn only after an H5 media batch reaches a real
 * terminal boundary. Blocked and failed batches intentionally remain paused so
 * the creator can recharge/retry the same batch without skipping a stage.
 *
 * Delivery failures are classified instead of retried blindly:
 * - terminal (run already completed, registration mismatch, …) → the batch is
 *   stamped `handoffAbandonedAt` + reason and never re-queued. Without this,
 *   a batch whose source turn ended while it was blocked would poison the
 *   candidate queue and hammer the journal once per sweep forever.
 * - benign races (another replica delivered) → skip without noise.
 * - everything else (run not ready yet, transient journal errors) →
 *   exponential backoff per batch, and the drain moves on to the next
 *   candidate instead of blocking behind the failing head.
 */
@Injectable()
export class StoryGenerationBatchContinuationWorkerService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(
    StoryGenerationBatchContinuationWorkerService.name,
  );
  private timer: NodeJS.Timeout | null = null;
  private draining = false;
  private stopping = false;
  private readonly backoffUntil = new Map<string, number>();
  private readonly backoffDelayMs = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly journal: AgentOsRunJournalService,
  ) {}

  onApplicationBootstrap(): void {
    if (!backgroundTasksEnabled()) return;
    if (this.stopping || this.timer) return;
    const intervalMs = positiveInt(
      process.env.STORY_GENERATION_CONTINUATION_WORKER_INTERVAL_MS,
      DEFAULT_INTERVAL_MS,
    );
    this.timer = setInterval(() => void this.drainOnce(), intervalMs);
    this.timer.unref?.();
    queueMicrotask(() => void this.drainOnce());
    this.logger.log(
      `Story generation continuation worker polling every ${intervalMs}ms`,
    );
  }

  onModuleDestroy(): void {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async drainOnce(limit = DEFAULT_BATCH_SIZE): Promise<void> {
    if (!backgroundTasksEnabled()) return;
    if (this.stopping || this.draining) return;
    this.draining = true;
    try {
      for (let index = 0; index < Math.max(1, Math.trunc(limit)); index += 1) {
        if (this.stopping) break;
        const candidateId = await this.pickNextCandidateId();
        if (!candidateId || this.stopping) break;

        let dispatch: AgentOsJournalDispatch | null;
        try {
          dispatch = await this.prisma.$transaction((tx) =>
            this.stopping
              ? Promise.resolve(null)
              : this.deliverCandidateInTransaction(tx, candidateId),
          );
        } catch (error) {
          this.handleDeliveryFailure(candidateId, error);
          continue;
        }

        if (!dispatch) break;
        this.clearBackoff(candidateId);
        await this.journal.publishCommitted(dispatch);
      }
    } catch (error) {
      // Scheduled drains are fire-and-forget. Contain lookup and post-commit
      // publication failures as well as the per-candidate delivery failures.
      // Committed events remain recoverable through the journal outbox.
      this.logger.warn(
        `Story generation continuation drain failed: ${errorText(error)}`,
      );
    } finally {
      this.draining = false;
    }
  }

  /**
   * Oldest undelivered, un-abandoned candidate that is not currently backed
   * off. The pick is read-only: cross-replica double delivery is fenced by
   * the in-transaction delivery claim (`handoffResultDeliveredAt IS NULL`
   * update) plus the journal's own event/result conflict codes, both of which
   * classify as benign races in {@link handleDeliveryFailure}.
   */
  private async pickNextCandidateId(): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT batch."id"
      FROM "story_generation_batches" AS batch
      INNER JOIN "agent_os_external_handoff_registrations" AS registration
        ON registration."generation_batch_id" = batch."id"
      WHERE batch."handoff_result_delivered_at" IS NULL
        AND batch."handoff_abandoned_at" IS NULL
        AND batch."status" IN ('completed', 'cancelled')
      ORDER BY batch."completed_at" ASC NULLS LAST, batch."updated_at" ASC, batch."id" ASC
      LIMIT ${DEFAULT_BATCH_SIZE}
    `);
    const now = Date.now();
    return (
      rows.find((row) => (this.backoffUntil.get(row.id) ?? 0) <= now)?.id ??
      null
    );
  }

  private handleDeliveryFailure(candidateId: string, error: unknown): void {
    if (error instanceof StoryHandoffClaimLostError) {
      this.clearBackoff(candidateId);
      return;
    }
    const conflictCode = conflictErrorCode(error);
    if (conflictCode && BENIGN_HANDOFF_ERROR_CODES.has(conflictCode)) {
      this.clearBackoff(candidateId);
      return;
    }
    if (
      error instanceof StoryHandoffPermanentlyInvalidError ||
      (conflictCode && TERMINAL_HANDOFF_ERROR_CODES.has(conflictCode))
    ) {
      void this.abandonHandoff(candidateId, error);
      return;
    }
    // Transient (including AgentOsContinuationNotReadyError: the source run
    // has not reached a resumable state yet). Back off and let the drain
    // continue with other candidates instead of blocking behind this one.
    this.scheduleBackoff(candidateId, error);
  }

  private async abandonHandoff(
    candidateId: string,
    error: unknown,
  ): Promise<void> {
    const reason = {
      code: conflictErrorCode(error) ?? 'STORY_HANDOFF_PERMANENTLY_INVALID',
      message: errorText(error),
    };
    try {
      const abandoned = await this.prisma.storyGenerationBatch.updateMany({
        where: {
          id: candidateId,
          handoffResultDeliveredAt: null,
          handoffAbandonedAt: null,
        },
        data: {
          handoffAbandonedAt: new Date(),
          handoffAbandonReason: reason,
        },
      });
      if (abandoned.count === 1) {
        this.clearBackoff(candidateId);
        this.logger.error(
          `Story generation batch ${candidateId} continuation handoff is ` +
            `undeliverable (${reason.code}); marked abandoned. The creator's ` +
            `chat will not receive the batch completion message — check the ` +
            `Agent OS run state if this is unexpected. ${reason.message}`,
        );
      }
    } catch (abandonError) {
      this.logger.warn(
        `Failed to mark batch ${candidateId} handoff abandoned: ${errorText(abandonError)}`,
      );
      this.scheduleBackoff(candidateId, error);
    }
  }

  private scheduleBackoff(candidateId: string, error: unknown): void {
    if (!(error instanceof AgentOsContinuationNotReadyError)) {
      this.logger.warn(
        `Story generation continuation delivery failed: ${errorText(error)}`,
      );
    }
    const previous = this.backoffDelayMs.get(candidateId) ?? 1_000;
    const delay = Math.min(previous * 2, MAX_BACKOFF_MS);
    this.backoffDelayMs.set(candidateId, delay);
    this.backoffUntil.set(candidateId, Date.now() + delay);
  }

  private clearBackoff(candidateId: string): void {
    this.backoffDelayMs.delete(candidateId);
    this.backoffUntil.delete(candidateId);
  }

  private async deliverCandidateInTransaction(
    tx: Prisma.TransactionClient,
    candidateId: string,
  ): Promise<AgentOsJournalDispatch> {
    const batch = await tx.storyGenerationBatch.findUnique({
      where: { id: candidateId },
      include: {
        project: { select: { defaultLocale: true } },
        items: { orderBy: { ordinal: 'asc' }, take: 1 },
        externalHandoffRegistration: true,
      },
    });
    const registration = batch?.externalHandoffRegistration;
    const firstItem = batch?.items[0];
    if (!batch || !registration || !firstItem) {
      throw new StoryHandoffPermanentlyInvalidError(
        `Generation batch ${candidateId} is missing its durable handoff identity or first item.`,
      );
    }
    if (
      registration.externalJobId !== batch.id ||
      registration.generationBatchId !== batch.id ||
      registration.sourceToolId !== 'story.generation.confirmBatch'
    ) {
      throw new StoryHandoffPermanentlyInvalidError(
        `Generation batch ${batch.id} does not match its Agent OS handoff registration.`,
      );
    }

    const handoffDispatch =
      await this.journal.reconcileExternalHandoffInTransaction(tx, batch.id);
    const cancelled = batch.status === StoryGenerationBatchStatus.cancelled;
    const continuationPlan = StoryProductionContinuationPlanSchema.safeParse(
      registration.continuationPlan,
    );
    if (!cancelled && !continuationPlan.success) {
      throw new StoryHandoffPermanentlyInvalidError(
        `Generation batch ${batch.id} has an invalid Story continuation plan.`,
      );
    }
    const completedStage =
      firstItem.targetKind === StoryProductionGenerationTargetKind.asset_spec
        ? ('assets' as const)
        : ('storyboard' as const);
    const resultDispatch = cancelled
      ? await this.journal.appendExternalResultInTransaction(tx, {
          runId: registration.sourceAgentRunId,
          turnId: registration.sourceAgentTurnId,
          toolCallId: registration.sourceAgentToolCallId,
          toolId: registration.sourceToolId,
          externalJobId: batch.id,
          phase: 'apply',
          text: generationCancelledCopy(
            batch.project.defaultLocale,
            completedStage,
          ),
          outcome: 'cancelled',
          error: {
            code: 'STORY_GENERATION_BATCH_CANCELLED',
            message: generationCancelledCopy(
              batch.project.defaultLocale,
              completedStage,
            ),
            retryable: false,
          },
        })
      : await this.journal.appendExternalResultInTransaction(tx, {
          runId: registration.sourceAgentRunId,
          turnId: registration.sourceAgentTurnId,
          toolCallId: registration.sourceAgentToolCallId,
          toolId: registration.sourceToolId,
          externalJobId: batch.id,
          phase: 'apply',
          text: registration.completionMessage,
          outcome: 'completed',
          storyContinuation: {
            locale: storyContinuationLocale(batch.project.defaultLocale),
            plan: continuationPlan.data!,
            completedStage,
            mediaBatchCompleted: true,
          },
        });

    const delivered = await tx.storyGenerationBatch.updateMany({
      where: {
        id: batch.id,
        status: batch.status,
        handoffResultDeliveredAt: null,
      },
      data: { handoffResultDeliveredAt: new Date() },
    });
    if (delivered.count !== 1) {
      throw new StoryHandoffClaimLostError(
        `Generation batch ${batch.id} lost its continuation claim before commit.`,
      );
    }
    return mergeDispatches(handoffDispatch, resultDispatch);
  }
}

function conflictErrorCode(error: unknown): string | null {
  if (!(error instanceof ConflictException)) return null;
  const response = error.getResponse();
  if (typeof response === 'string') return null;
  const code = (response as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function mergeDispatches(
  first: AgentOsJournalDispatch,
  second: AgentOsJournalDispatch,
): AgentOsJournalDispatch {
  return {
    events: [...first.events, ...second.events],
    snapshot: second.snapshot,
  };
}

function storyContinuationLocale(
  locale: string | null,
): 'en-US' | 'zh-CN' | 'zh-HK' {
  return locale === 'zh-CN' || locale === 'zh-HK' ? locale : 'en-US';
}

function generationCancelledCopy(
  locale: string | null,
  stage: 'assets' | 'storyboard',
): string {
  if (locale === 'zh-CN')
    return stage === 'assets' ? '已停止生成资产图片。' : '已停止生成分镜片段。';
  if (locale === 'zh-HK')
    return stage === 'assets' ? '已停止生成資產圖片。' : '已停止生成分鏡片段。';
  return stage === 'assets'
    ? 'Asset image generation was stopped.'
    : 'Storyboard clip generation was stopped.';
}

function positiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `STORY_GENERATION_CONTINUATION_WORKER_INTERVAL_MS must be a positive integer.`,
    );
  }
  return parsed;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
