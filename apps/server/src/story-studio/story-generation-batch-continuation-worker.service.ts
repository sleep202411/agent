import {
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

/**
 * Resumes the same Agent OS turn only after an H5 media batch reaches a real
 * terminal boundary. Blocked and failed batches intentionally remain paused so
 * the creator can recharge/retry the same batch without skipping a stage.
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly journal: AgentOsRunJournalService,
  ) {}

  onApplicationBootstrap(): void {
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
    if (this.stopping || this.draining) return;
    this.draining = true;
    try {
      for (let index = 0; index < Math.max(1, Math.trunc(limit)); index += 1) {
        if (this.stopping) break;
        let dispatch: AgentOsJournalDispatch | null;
        try {
          dispatch = await this.prisma.$transaction((tx) =>
            this.stopping
              ? Promise.resolve(null)
              : this.deliverNextInTransaction(tx),
          );
        } catch (error) {
          if (!(error instanceof AgentOsContinuationNotReadyError)) {
            this.logger.warn(
              `Story generation continuation delivery failed: ${errorText(error)}`,
            );
          }
          break;
        }
        if (!dispatch) break;
        await this.journal.publishCommitted(dispatch);
      }
    } finally {
      this.draining = false;
    }
  }

  private async deliverNextInTransaction(
    tx: Prisma.TransactionClient,
  ): Promise<AgentOsJournalDispatch | null> {
    const candidates = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT batch."id"
      FROM "story_generation_batches" AS batch
      INNER JOIN "agent_os_external_handoff_registrations" AS registration
        ON registration."generation_batch_id" = batch."id"
      WHERE batch."handoff_result_delivered_at" IS NULL
        AND batch."status" IN ('completed', 'cancelled')
      ORDER BY batch."completed_at" ASC NULLS LAST, batch."updated_at" ASC, batch."id" ASC
      FOR UPDATE OF batch SKIP LOCKED
      LIMIT 1
    `);
    const candidateId = candidates[0]?.id;
    if (!candidateId) return null;

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
      throw new Error(
        `Generation batch ${candidateId} is missing its durable handoff identity or first item.`,
      );
    }
    if (
      registration.externalJobId !== batch.id ||
      registration.generationBatchId !== batch.id ||
      registration.sourceToolId !== 'story.generation.confirmBatch'
    ) {
      throw new Error(
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
      throw new Error(
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
      throw new Error(
        `Generation batch ${batch.id} lost its continuation claim before commit.`,
      );
    }
    return mergeDispatches(handoffDispatch, resultDispatch);
  }
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
