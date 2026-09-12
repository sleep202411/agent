import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import type {
  StoryAssetPlan,
  StoryStoryboardPlan,
} from '@repo/shared/story-production';
import type { StoryScreenplay } from '@repo/shared/story-agent';
import { StoryAgentRunService } from './story-agent-run.service';
import {
  StoryAuthoringPipelineService,
  type StoryAuthoringPipelineResult,
} from './story-authoring-pipeline.service';
import { StoryAuthoringStageError } from './story-authoring-model';

const DEFAULT_INTERVAL_MS = 750;
const DEFAULT_BATCH_SIZE = 5;
/** Renew well inside the 30s run lease so a healthy author is never fenced. */
const AUTHORING_HEARTBEAT_MS = 10_000;
/** Detached authoring slots per pod; model latency must never starve applies. */
const MAX_CONCURRENT_AUTHORING = 3;

/**
 * Durable Story Agent executor. PostgreSQL leases and fencing make every pod
 * eligible to work while guaranteeing that only the current project fence can
 * commit. Expired leases are reclaimable after a pod crash.
 */
@Injectable()
export class StoryAgentRunWorkerService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(StoryAgentRunWorkerService.name);
  private readonly enabled = optionalBoolean(
    process.env.STORY_AGENT_RUN_WORKER_ENABLED,
    true,
    'STORY_AGENT_RUN_WORKER_ENABLED',
  );
  private readonly workerId = `story-agent:${hostname().slice(0, 64)}:${process.pid}:${randomUUID()}`;
  private timer: NodeJS.Timeout | null = null;
  private draining = false;
  private stopping = false;
  private readonly inflightAuthoring = new Set<AbortController>();
  private readonly authoringInFlight = new Set<Promise<void>>();

  constructor(
    private readonly runs: StoryAgentRunService,
    private readonly pipeline: StoryAuthoringPipelineService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.enabled) {
      this.logger.log('Story Agent run worker is disabled by configuration');
      return;
    }
    const intervalMs = positiveInt(
      process.env.STORY_AGENT_RUN_WORKER_INTERVAL_MS,
      DEFAULT_INTERVAL_MS,
      'STORY_AGENT_RUN_WORKER_INTERVAL_MS',
    );
    this.timer = setInterval(() => void this.drainOnce(), intervalMs);
    this.timer.unref?.();
    this.wake();
    this.logger.log(
      `Story Agent run worker polling every ${intervalMs}ms (${this.workerId})`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.stopping = true;
    // Abandon in-flight authoring calls; the run lease expires and any pod
    // (including a restarted this one) reclaims the run cleanly.
    for (const controller of this.inflightAuthoring) controller.abort();
    this.inflightAuthoring.clear();
  }

  /** Low-latency local wake; DB polling remains the cross-pod source of truth. */
  wake(): void {
    if (!this.enabled) return;
    queueMicrotask(() => void this.drainOnce());
  }

  async drainOnce(batch = DEFAULT_BATCH_SIZE): Promise<void> {
    if (!this.enabled || this.draining) return;
    this.draining = true;
    try {
      await this.runs.expireProposals(Math.max(1, batch));
      await this.runs.recoverOrphanedApplyingRuns(batch);
      const claimed = await this.runs.claimApplyingRuns(
        this.workerId,
        Math.max(1, batch),
      );
      await Promise.all(
        claimed.map(async ({ id }) => {
          try {
            await this.runs.executeClaimedRun(id, this.workerId);
          } catch (error) {
            // Keep the database lease intact. A transient process/DB failure is
            // retried by this or another pod after expiry; deterministic domain
            // failures are persisted by executeClaimedRun before it returns.
            this.logger.warn(
              `Story Agent run execution escaped run=${id}: ${errorText(error)}`,
            );
          }
        }),
      );
      const authoringSlots =
        MAX_CONCURRENT_AUTHORING - this.authoringInFlight.size;
      if (authoringSlots > 0) {
        const authoring = await this.runs.claimAuthoringRuns(
          this.workerId,
          Math.min(authoringSlots, Math.max(1, batch)),
        );
        for (const { id } of authoring) {
          // Detached on purpose: an authoring run awaits model calls for tens
          // of seconds. Holding the drain over that await would starve the
          // apply pipeline, expiry sweeps, and orphan recovery — a confirmed
          // run (which already holds the project write fence) must never wait
          // on someone else's drafting latency.
          const task: Promise<void> = this.executeAuthoringRun(id)
            .catch((error) => {
              this.logger.warn(
                `Story Agent authoring escaped run=${id}: ${errorText(error)}`,
              );
            })
            .finally(() => {
              this.authoringInFlight.delete(task);
              this.wake();
            });
          this.authoringInFlight.add(task);
        }
      }
    } catch (error) {
      this.logger.warn(`Story Agent worker drain failed: ${errorText(error)}`);
    } finally {
      this.draining = false;
    }
  }

  /** Await every detached authoring execution currently in flight. */
  async authoringIdle(): Promise<void> {
    while (this.authoringInFlight.size > 0) {
      await Promise.allSettled([...this.authoringInFlight]);
    }
  }

  /**
   * Drive one claimed authoring run through the deterministic pipeline. The
   * pipeline owns per-baton bounded retry AND referential integrity (dangling
   * edges are structurally impossible), so the only whole-run retry left here
   * is one stale-base re-draft when a human edits the story mid-pipeline.
   */
  private async executeAuthoringRun(runId: string): Promise<void> {
    let staleRetried = false;
    for (;;) {
      const load = await this.runs.loadAuthoringJob(runId, this.workerId);
      if (load.kind !== 'job') return;

      const controller = new AbortController();
      this.inflightAuthoring.add(controller);
      const heartbeat = setInterval(() => {
        this.runs
          .renewAuthoringLease(runId, this.workerId)
          .then((alive) => {
            if (!alive) controller.abort();
          })
          .catch(() => controller.abort());
      }, AUTHORING_HEARTBEAT_MS);
      heartbeat.unref?.();

      let authored: StoryAuthoringPipelineResult | null = null;
      let screenplay: StoryScreenplay | undefined;
      let document: StoryAuthoringPipelineResult['document'];
      let assetPlan: StoryAssetPlan | undefined;
      let storyboardPlan: StoryStoryboardPlan | undefined;
      try {
        switch (load.job.targetStage) {
          case 'script':
            authored = await this.pipeline.author({
              job: load.job,
              signal: controller.signal,
              onStage: (stage) =>
                this.runs.advanceAuthoringStage(runId, this.workerId, stage),
            });
            break;
          case 'plot':
            if (load.job.screenplaySnapshot) {
              screenplay = load.job.screenplaySnapshot.screenplay;
              document = load.job.screenplaySnapshot.document;
            } else if (load.job.scriptSource) {
              const compiled = await this.pipeline.compileScript({
                ...(load.job.modelId ? { modelId: load.job.modelId } : {}),
                sourceText: load.job.scriptSource.sourceText,
                document: load.job.scriptSource.document,
                title: load.job.brief.title,
                instructions: load.job.brief.brief,
                creativeProfile: load.job.creativeProfile,
                signal: controller.signal,
                onStage: (stage) =>
                  this.runs.advanceAuthoringStage(runId, this.workerId, stage),
              });
              screenplay = compiled.screenplay;
              document = compiled.document;
            } else {
              throw new Error(
                'The canonical Plot route is missing both a structured Script and an exact Script source.',
              );
            }
            break;
          case 'assets':
            if (!load.job.screenplaySnapshot) {
              throw new Error(
                'The canonical Asset Specs route is missing its approved Plot interpretation.',
              );
            }
            screenplay = load.job.screenplaySnapshot.screenplay;
            assetPlan = await this.pipeline.planAssets({
              ...(load.job.modelId ? { modelId: load.job.modelId } : {}),
              screenplay,
              creativeProfile: load.job.creativeProfile,
              signal: controller.signal,
              onStage: (stage) =>
                this.runs.advanceAuthoringStage(runId, this.workerId, stage),
            });
            break;
          case 'storyboard':
            if (!load.job.screenplaySnapshot || !load.job.assetPlan) {
              throw new Error(
                'The canonical Storyboard route is missing its approved Plot or Asset Specs source.',
              );
            }
            screenplay = load.job.screenplaySnapshot.screenplay;
            assetPlan = load.job.assetPlan;
            storyboardPlan = await this.pipeline.planStoryboard({
              ...(load.job.modelId ? { modelId: load.job.modelId } : {}),
              screenplay,
              assetPlan,
              creativeProfile: load.job.creativeProfile,
              signal: controller.signal,
              onStage: (stage) =>
                this.runs.advanceAuthoringStage(runId, this.workerId, stage),
            });
            break;
          case 'noop':
            break;
        }
      } catch (error) {
        // Lease lost (cancel/supersede/reclaim) or shutdown: another actor
        // owns the outcome now; land nothing.
        if (controller.signal.aborted || this.stopping) return;
        await this.runs.failAuthoring(runId, this.workerId, {
          code:
            error instanceof StoryAuthoringStageError
              ? error.code
              : 'STORY_AGENT_AUTHORING_FAILED',
          detail: errorText(error),
        });
        return;
      } finally {
        clearInterval(heartbeat);
        this.inflightAuthoring.delete(controller);
      }

      const completion =
        load.job.targetStage === 'script'
          ? await this.runs.completeAuthoring(runId, this.workerId, {
              screenplay: authored!.screenplay,
              ...(authored!.document ? { document: authored!.document } : {}),
              authoredAgainst: load.job.snapshot,
            })
          : load.job.targetStage === 'noop'
            ? await this.runs.completeNoopAuthoring(
                runId,
                this.workerId,
                load.job.snapshot,
              )
            : await this.runs.completeStageAuthoring(runId, this.workerId, {
                targetStage: load.job.targetStage,
                screenplay,
                ...(document ? { document } : {}),
                ...(assetPlan ? { assetPlan } : {}),
                ...(storyboardPlan ? { storyboardPlan } : {}),
                authoredAgainst: load.job.snapshot,
              });
      switch (completion.kind) {
        case 'completed':
        case 'skip':
          return;
        case 'stale_base': {
          if (staleRetried) {
            await this.runs.failAuthoring(runId, this.workerId, {
              code: 'STORY_AGENT_AUTHORING_BASE_UNSTABLE',
              detail:
                'The story kept changing while the Agent was drafting. Retry when editing pauses.',
            });
            return;
          }
          staleRetried = true;
          continue;
        }
        case 'invalid': {
          // Skeleton validation makes danglers impossible, so a dry-run reject
          // here is a genuine bug in assembly, not a model miss — fail honestly.
          await this.runs.failAuthoring(runId, this.workerId, completion.error);
          return;
        }
      }
    }
  }
}

function optionalBoolean(
  raw: string | undefined,
  fallback: boolean,
  name: string,
): boolean {
  if (raw === undefined || raw.trim() === '') return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`${name} must be either "true" or "false".`);
}

function positiveInt(
  raw: string | undefined,
  fallback: number,
  name: string,
): number {
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(
    0,
    4_000,
  );
}
