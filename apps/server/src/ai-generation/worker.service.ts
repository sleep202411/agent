import { backgroundTasksEnabled } from '../common/background-tasks';
import { PollDispatchError } from './poll-dispatch-error';
/**
 * AiGenerationWorkerService — provider-agnostic worker.
 *
 * Subscribes to BullMQ queues, dispatches each job to the matching
 * `ProviderAdapter` (looked up via `ProviderRegistry`), uploads the
 * resulting bytes to OSS, and emits Web PubSub pushes at every state
 * transition.
 *
 * Provider specifics (Azure HTTP shape, fal API client, Replicate
 * polling) live in `providers/<name>/<name>-provider.adapter.ts`. This
 * file deals only with the generic lifecycle:
 *   claim → adapter.startGeneration → (sync) upload+complete
 *                                   → (async) persist providerJobId
 *                                              + schedule poll
 *
 * Retry on transient provider errors uses BullMQ delayed requeue
 * (`queue.add(..., { delay })`); SIGTERM drain waits for in-flight
 * fetches to settle before letting the process exit.
 */
import {
  Injectable,
  Logger,
  Optional,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { Worker, Job as BullJob } from 'bullmq';
import { createHash } from 'crypto';
import { createWriteStream } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { AlertingService, type AlertSeverity } from '../common/alerting';
import { newShortId } from '../common/id';
import { EntitlementService } from '../entitlements';
import { DocumentsService } from '../documents/documents.service';
import { StorageProviderRegistry } from '../infra/storage/storage-provider-registry.service';
import {
  OutputStorageService,
  type OutputStorageResult,
} from '../infra/storage/storage.types';
import { inspectImage } from '../media/uploaded-image-probe.service';
import { MediaAssetReadinessService } from '../media/media-asset-readiness.service';
import {
  PlayableVideoProbeService,
  type PlayableVideoProbeResult,
} from '../media/playable-video-probe.service';
import {
  PlayableAudioProbeService,
  type PlayableAudioProbeResult,
} from '../media/playable-audio-probe.service';
import { AiGenerationBillingWalletService } from './billing-wallet.service';
import { AiGenerationOutboxService } from './outbox.service';
import {
  ProviderCapacityRuntimeService,
  type ProviderCapacityGate,
} from './provider-capacity-runtime.service';
import {
  ReferencePreparationError,
  type ProviderAdapter,
  type ProviderTimingSnapshot,
  type ProviderTraceEvent,
  type RawProviderOutput,
} from './provider-adapter';
import { ProviderRegistry } from './provider-registry.service';
import {
  createAiWorker,
  AI_QUEUE_IMAGE,
  AI_QUEUE_VIDEO,
  AI_QUEUE_AUDIO,
  type AiQueueJobData,
} from './queue';
import { AiGenerationQueueService } from './queue.service';
import {
  AiGenerationRepository,
  type AiJobLimitSubject,
  type RecordAiJobAttemptInput,
} from './repository';
import type { AiJob, AiJobError, AiJobOutput } from './types';
import { AiReferenceUrlPreparerService } from './reference-url-preparer.service';
import { AiGenerationCompletionObserverRegistry } from './completion-observer.service';

// Azure preview pools (gpt-image-2 in particular) return 429
// `EngineOverloaded` when the global shared pool is full. It's not a
// per-deployment quota issue — a retry seconds later usually lands.
// Exponential backoff: 2s, 6s, 14s, 30s, 60s.
const RETRY_BACKOFFS_MS = [2_000, 6_000, 14_000, 30_000, 60_000];
const RETRYABLE_CODES = new Set<AiJobError['code']>([
  'PROVIDER_429',
  'PROVIDER_5XX',
  'PROVIDER_TIMEOUT',
]);
// BullMQ worker concurrency per queue. Each Worker pulls this many
// jobs in parallel and runs them as async fetches. Conservatively
// low for image so we don't saturate provider RPM.
// `AI_WORKER_IMAGE_CONCURRENCY` / `AI_WORKER_VIDEO_CONCURRENCY` env
// vars override at boot — useful for forcing concurrency=1 in dev
// to make the queue mechanic visually testable.
const IMAGE_WORKER_CONCURRENCY = Math.max(
  1,
  Number(process.env.AI_WORKER_IMAGE_CONCURRENCY ?? 4),
);
const VIDEO_WORKER_CONCURRENCY = Math.max(
  1,
  Number(process.env.AI_WORKER_VIDEO_CONCURRENCY ?? 2),
);
const AUDIO_WORKER_CONCURRENCY = Math.max(
  1,
  Number(process.env.AI_WORKER_AUDIO_CONCURRENCY ?? 8),
);

// SIGTERM drain budget — how long we wait for in-flight provider
// fetches to settle before letting the process exit. Set wider than
// the longest expected single job (gpt-image-2 high can stretch past
// 180s) so the common case finishes cleanly; pair with K8s
// terminationGracePeriodSeconds at the same number plus margin.
const DRAIN_TIMEOUT_MS = 250_000;
const DRAIN_POLL_MS = 500;
const ASYNC_PROVIDER_POLL_DELAY_MS = Math.max(
  1_000,
  Number(process.env.AI_ASYNC_PROVIDER_POLL_DELAY_MS ?? 5_000),
);
// Provider output download guards. The timeout spans the whole transfer
// (undici's default is header/idle only); the byte ceiling is a runaway
// backstop far above the largest legitimate output (15s Seedance 4k HEVC
// ≈ 300MB class).
const PROVIDER_FETCH_TIMEOUT_MS = 10 * 60_000;
const MAX_PROVIDER_OUTPUT_BYTES = 2 * 1024 * 1024 * 1024;
const ENTITLEMENT_CONCURRENCY_RETRY_DELAY_MS = Math.max(
  1_000,
  Number(process.env.AI_ENTITLEMENT_CONCURRENCY_RETRY_DELAY_MS ?? 3_000),
);

@Injectable()
export class AiGenerationWorkerService
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger(AiGenerationWorkerService.name);
  private readonly workers: Worker<AiQueueJobData>[] = [];
  private readonly inflight = new Map<string, Promise<void>>();

  constructor(
    private readonly store: AiGenerationRepository,
    private readonly providers: ProviderRegistry,
    private readonly outbox: AiGenerationOutboxService,
    private readonly storage: OutputStorageService,
    private readonly storageRegistry: StorageProviderRegistry,
    private readonly queueService: AiGenerationQueueService,
    private readonly entitlements: EntitlementService,
    private readonly alerts: AlertingService,
    private readonly billingWallet: AiGenerationBillingWalletService,
    private readonly providerCapacity: ProviderCapacityRuntimeService,
    private readonly documents: DocumentsService,
    private readonly mediaAssetReadiness: MediaAssetReadinessService,
    private readonly videoProbe: PlayableVideoProbeService,
    private readonly audioProbe: PlayableAudioProbeService,
    private readonly referenceUrls: AiReferenceUrlPreparerService,
    @Optional()
    private readonly completionObservers?: AiGenerationCompletionObserverRegistry,
  ) {}

  private queuePriorityFor(job: AiJob): number {
    return (
      job.routingSnapshot?.policy.entitlement.queuePriority ??
      this.entitlements.queuePriorityFor(job.entitlementSnapshot)
    );
  }

  private alertQueueFailure(
    queueName: string,
    queueJob: BullJob<AiQueueJobData> | undefined,
    err: Error,
  ): void {
    this.alerts.notify({
      kind: 'ai_generation_queue_failure',
      severity: 'critical',
      source: 'ai-generation.worker',
      title: 'AI generation queue processor failed',
      summary: `BullMQ ${queueName} job ${queueJob?.id ?? '?'} failed outside the managed provider error path: ${err.message}`,
      occurredAt: new Date().toISOString(),
      fingerprint: [
        'ai_generation_queue_failure',
        queueName,
        err.name,
        err.message,
      ].join('|'),
      error: {
        name: err.name,
        message: err.message,
        stack: err.stack,
      },
      context: {
        queueName,
        bullJobId: queueJob?.id,
        attemptsMade: queueJob?.attemptsMade,
        data: queueJob?.data,
      },
      tags: ['ai-generation', 'queue', 'bullmq'],
    });
  }

  private alertJobFailure(job: AiJob, payload: AiJobError, failedAt: string) {
    if (payload.code === 'CANCELLED_BY_USER') return;
    const selectedProvider =
      job.routingSnapshot?.selectedProvider ?? job.provider;
    const selectedModel = job.routingSnapshot?.selectedModelId ?? job.modelId;
    const selectedDeployment =
      job.routingSnapshot?.selectedDeployment ?? job.deployment;
    this.alerts.notify({
      kind: 'ai_generation_job_failed',
      severity: severityForAiFailure(payload.code),
      source: 'ai-generation.worker',
      title: `AI generation failed: ${payload.code}`,
      summary: `${selectedProvider}/${selectedModel} failed for job ${job.id}: ${payload.message}`,
      occurredAt: failedAt,
      fingerprint: [
        'ai_generation_job_failed',
        selectedProvider,
        selectedModel,
        selectedDeployment,
        payload.code,
      ].join('|'),
      error: {
        code: payload.code,
        name: 'AiJobError',
        message: payload.message,
      },
      context: {
        jobId: job.id,
        userId: job.userId,
        type: job.type,
        provider: job.provider,
        modelId: job.modelId,
        deployment: job.deployment,
        canonicalModelId: job.canonicalModelId,
        providerBindingId: job.providerBindingId,
        providerJobId: job.providerJobId,
        selectedProvider,
        selectedModel,
        selectedDeployment,
        selectedProviderEndpointId:
          job.routingSnapshot?.selectedProviderEndpointId,
        queueName: job.queueName,
        queuePosition: job.queuePosition,
        attempt: job.attempt,
        retryable: payload.retryable,
        stage: job.stage,
        status: job.status,
        workspaceId: job.workspaceId,
        projectId: job.projectId,
        documentId: job.documentId,
        documentBlockId: job.documentBlockId,
        sourceSurface: job.sourceSurface,
        createdAt: job.createdAt,
        queuedAt: job.queuedAt,
        startedAt: job.startedAt,
        providerSubmittedAt: job.providerSubmittedAt,
        providerStartedAt: job.providerStartedAt,
        completedAt: failedAt,
        durationMs: this.elapsedMs(job.createdAt, failedAt),
        chargedCredits: job.routingSnapshot?.policy.quota.cost,
        quotaMode: job.routingSnapshot?.policy.quota.mode,
        quotaDimension: job.routingSnapshot?.policy.quota.dimension,
        userMessage: payload.userMessage,
      },
      tags: ['ai-generation', job.type, selectedProvider, payload.code],
    });
  }

  onApplicationBootstrap() {
    if (!backgroundTasksEnabled()) return;
    if (this.providers.list().length === 0) {
      this.logger.warn(
        'No ProviderAdapter registered — AiGenerationWorker is a no-op',
      );
      return;
    }
    const connection = this.queueService.getConnection();
    this.workers.push(
      createAiWorker(
        AI_QUEUE_IMAGE,
        (job) => this.processQueueJob(job),
        connection,
        IMAGE_WORKER_CONCURRENCY,
      ),
      createAiWorker(
        AI_QUEUE_VIDEO,
        (job) => this.processQueueJob(job),
        connection,
        VIDEO_WORKER_CONCURRENCY,
      ),
      createAiWorker(
        AI_QUEUE_AUDIO,
        (job) => this.processQueueJob(job),
        connection,
        AUDIO_WORKER_CONCURRENCY,
      ),
    );
    for (const w of this.workers) {
      w.on('completed', (message) => {
        void this.scheduleAcceptedPoll(message.data.jobId).catch(
          (error: unknown) => {
            // The database receipt remains the durable recovery intent; the
            // periodic reconciler repairs lost completion notifications.
            this.logger.error(
              `Poll scheduling awaits recovery: ${String(error)}`,
            );
          },
        );
      });
      w.on('failed', (job, err) => {
        // BullMQ-level failures (unhandled throws from processor).
        // Normal provider failures are caught inside runJob and
        // turned into FAILED/requeue without throwing — so anything
        // reaching here is unexpected.
        this.logger.error(
          `BullMQ job ${job?.id ?? '?'} failed at queue layer: ${err.message}`,
        );
        this.alertQueueFailure(w.name, job, err);
      });
    }
    this.logger.log(
      `AiGenerationWorker subscribed to BullMQ (image=${IMAGE_WORKER_CONCURRENCY}, video=${VIDEO_WORKER_CONCURRENCY}, audio=${AUDIO_WORKER_CONCURRENCY}); providers=${this.providers
        .list()
        .map((p) => p.provider)
        .join(',')}`,
    );
  }

  /**
   * Nest fires this on SIGTERM (main.ts enables shutdown hooks). We
   * close BullMQ workers gracefully — `worker.close()` stops fetching
   * new jobs and waits for in-flight processors to resolve. Anything
   * still running when the process actually dies will be picked up
   * by another pod via BullMQ stalled detection.
   */
  async beforeApplicationShutdown(signal?: string) {
    this.logger.log(
      `Shutdown (${signal ?? 'unknown'}): closing ${this.workers.length} workers, ${this.inflight.size} in-flight.`,
    );
    const start = Date.now();
    await Promise.all(
      this.workers.map((w) =>
        w
          .close()
          .catch((err) =>
            this.logger.warn(
              `worker close failed: ${err instanceof Error ? err.message : String(err)}`,
            ),
          ),
      ),
    );
    while (this.inflight.size > 0 && Date.now() - start < DRAIN_TIMEOUT_MS) {
      await Promise.race([
        Promise.allSettled(Array.from(this.inflight.values())),
        new Promise((resolve) => setTimeout(resolve, DRAIN_POLL_MS)),
      ]);
    }
    if (this.inflight.size > 0) {
      this.logger.warn(
        `Shutdown drain timed out with ${this.inflight.size} job(s) still running; abandoning to stalled-reclaim.`,
      );
    } else {
      this.logger.log(
        `Shutdown drain finished in ${Date.now() - start}ms; all jobs settled.`,
      );
    }
  }

  /**
   * Entry point for each BullMQ message. We re-read the canonical job
   * row from Postgres rather than trusting the queue payload. The
   * payload only selects the operation (`start` vs async-provider
   * `poll`); all business state comes from the DB row.
   */
  private async processQueueJob(
    queueJob: BullJob<AiQueueJobData>,
  ): Promise<void> {
    if (!backgroundTasksEnabled()) return;
    const jobId = queueJob.data.jobId;
    const op = queueJob.data.op ?? 'start';
    const dbJob = await this.store.findById(jobId);
    if (!dbJob) {
      this.logger.warn(
        `BullMQ job ${queueJob.id} references missing DB row ${jobId}; dropping.`,
      );
      return;
    }

    // BullMQ owns redelivery of this message. An acknowledged async job
    // must resume observation, never call startGeneration again.
    const redelivered =
      queueJob.attemptsMade > 0 || queueJob.stalledCounter > 0;
    if (
      redelivered &&
      op !== 'poll' &&
      dbJob.status === 'in_progress' &&
      dbJob.providerJobId
    ) {
      await this.scheduleAcceptedPoll(jobId);
      return;
    }
    if (op === 'poll') {
      const promise = this.pollJob(dbJob).finally(() => {
        this.inflight.delete(`${jobId}:poll`);
      });
      this.inflight.set(`${jobId}:poll`, promise);
      await promise;
      return;
    }

    if (redelivered && dbJob.status === 'in_progress') {
      if (!(await this.store.recordUnknownAcceptance(jobId))) {
        // A concurrent acceptance/terminal update won; do not overwrite it.
        await this.scheduleAcceptedPoll(jobId);
        return;
      }

      // No durable provider receipt: accepting this message as completed would
      // conceal unfinished work. Resubmitting could duplicate a paid call.
      throw new Error(
        `Generation ${jobId} needs reconciliation after worker interruption: provider acceptance is unknown`,
      );
    }
    if (dbJob.status !== 'in_queue') {
      // Already terminal or being processed elsewhere — defensive
      // skip so a queue replay can't restart a completed job.
      this.logger.warn(
        `Skipping job ${jobId}: DB status is ${dbJob.status}, expected IN_QUEUE.`,
      );
      return;
    }
    const claimed = await this.claim(dbJob);
    if (!claimed) return;
    const promise = this.runJob(claimed).finally(() => {
      this.inflight.delete(jobId);
    });
    this.inflight.set(jobId, promise);
    await promise;
  }

  private async claim(job: AiJob): Promise<AiJob | null> {
    const now = new Date().toISOString();
    const result = await this.store.claimQueuedJob({
      jobId: job.id,
      limitSubject: this.concurrencySubjectFor(job),
      perSubjectRunning: this.perSubjectRunningFor(job),
      perTypeRunning: this.perTypeRunningFor(job),
      now,
    });

    if (result.kind === 'missing') return null;
    if (result.kind === 'not_queued') {
      this.logger.warn(
        `Skipping job ${job.id}: DB status is ${result.job.status}, expected IN_QUEUE.`,
      );
      return null;
    }
    if (result.kind === 'running_limit') {
      await this.deferForEntitlementConcurrency(job, result);
      return null;
    }

    const next = result.job;
    await this.recordTraceSafe(next, {
      eventType: 'worker_started',
      occurredAt: now,
      source: 'internal',
      confidence: 'exact',
      title: 'Worker started',
      description: 'A worker picked up the queued job.',
      idempotencyKey: `ai_trace:${job.id}:worker_started:${job.attempt}`,
      payload: {
        queueName: job.queueName,
        attempt: job.attempt,
      },
    });
    this.emit(next);
    // Notify the rest of the queue that they moved up. The claimed
    // job already got its own emit() above; skip it here to avoid a
    // duplicate push in the same tick.
    for (const moved of result.repositioned) {
      if (moved.id === next.id) continue;
      this.emit(moved);
    }
    return next;
  }

  private concurrencySubjectFor(job: AiJob): AiJobLimitSubject {
    const subject =
      job.routingSnapshot?.policy.concurrency.subject ??
      job.entitlementSnapshot?.subject;
    if (subject?.type === 'workspace' && (subject.id || job.workspaceId)) {
      return { type: 'workspace', id: subject.id || job.workspaceId! };
    }
    return { type: 'user', id: job.userId };
  }

  private perSubjectRunningFor(job: AiJob): number | null {
    const concurrency = job.routingSnapshot?.policy.concurrency as
      | {
          perSubjectRunning?: number | null;
          perUserRunning?: number | null;
        }
      | undefined;
    if (
      concurrency &&
      Object.prototype.hasOwnProperty.call(concurrency, 'perSubjectRunning')
    ) {
      return concurrency.perSubjectRunning ?? null;
    }
    const entitlementLimit = job.entitlementSnapshot?.limits.concurrentJobs;
    if (entitlementLimit !== undefined) return entitlementLimit;
    return concurrency?.perUserRunning ?? null;
  }

  private perTypeRunningFor(job: AiJob): number | null {
    const concurrency = job.routingSnapshot?.policy.concurrency as
      | {
          perTypeRunning?: number | null;
          perUserRunning?: number | null;
        }
      | undefined;
    if (
      concurrency &&
      Object.prototype.hasOwnProperty.call(concurrency, 'perTypeRunning')
    ) {
      return concurrency.perTypeRunning ?? null;
    }
    return concurrency?.perUserRunning ?? null;
  }

  private async deferForEntitlementConcurrency(
    job: AiJob,
    gate: Extract<
      Awaited<ReturnType<AiGenerationRepository['claimQueuedJob']>>,
      { kind: 'running_limit' }
    >,
  ): Promise<void> {
    const now = new Date().toISOString();
    const delayMs = ENTITLEMENT_CONCURRENCY_RETRY_DELAY_MS;
    const retryAt = new Date(Date.now() + delayMs).toISOString();
    const scope =
      gate.scope === 'subject'
        ? 'your plan concurrency'
        : `${gate.type} generation concurrency`;

    await this.recordTraceSafe(job, {
      eventType: 'entitlement_concurrency_wait',
      occurredAt: now,
      source: 'internal',
      confidence: 'exact',
      title: 'Entitlement concurrency wait',
      description: `Waiting because ${scope} is full.`,
      idempotencyKey: `ai_trace:${job.id}:entitlement_concurrency_wait:${job.attempt}:${Date.now()}`,
      payload: {
        scope: gate.scope,
        type: gate.type,
        running: gate.running,
        limit: gate.limit,
        retryAfterMs: delayMs,
        retryAt,
      },
    });

    const updated = await this.store.update(job.id, {
      status: 'in_queue',
      stage: 'queued',
      queuedAt: retryAt,
      progress: null,
      queuePosition: null,
      logs: [
        ...job.logs,
        {
          time: now,
          stage: 'queued',
          message: `Generation concurrency is full; retrying in ${Math.max(1, Math.round(delayMs / 1000))}s.`,
        },
      ],
    });

    if (!updated) return;
    await this.queueService.enqueue(
      job.queueName,
      job.id,
      delayMs,
      this.queuePriorityFor(job),
    );
    const repositioned = await this.store.recomputeQueuePositions(
      job.queueName,
    );
    this.emit(updated);
    for (const moved of repositioned) {
      if (moved.id === updated.id) continue;
      this.emit(moved);
    }
    this.logger.log(
      `job ${job.id} deferred ${Math.round(delayMs / 1000)}s for entitlement ${gate.scope} concurrency (${gate.running}/${gate.limit})`,
    );
  }

  private async scheduleAcceptedPoll(jobId: string): Promise<void> {
    if (!backgroundTasksEnabled()) return;
    const job = await this.store.findById(jobId);
    if (!job || job.status !== 'in_progress' || !job.providerJobId) return;
    await this.queueService.enqueue(
      job.queueName,
      job.id,
      job.routingSnapshot?.policy.runtime.pollIntervalMs ??
        ASYNC_PROVIDER_POLL_DELAY_MS,
      this.queuePriorityFor(job),
      'poll',
    );
  }

  private async dispatchPoll(enqueue: () => Promise<void>): Promise<void> {
    if (!backgroundTasksEnabled()) return;
    try {
      await enqueue();
    } catch (error) {
      throw new PollDispatchError(error);
    }
  }

  private async pollJob(job: AiJob): Promise<void> {
    if (!backgroundTasksEnabled()) return;
    if (job.status !== 'in_progress') {
      this.logger.warn(
        `Skipping poll for job ${job.id}: DB status is ${job.status}, expected IN_PROGRESS.`,
      );
      return;
    }
    if (!job.providerJobId) {
      await this.markFailed(job, {
        code: 'WORKER_CRASHED',
        message: 'Async provider poll requested without providerJobId.',
        userMessage: 'Generation failed. Please try again.',
        retryable: true,
        createdAt: new Date().toISOString(),
      });
      return;
    }

    const provider = job.routingSnapshot?.selectedProvider ?? job.provider;
    let adapter: ProviderAdapter;
    try {
      adapter = this.providers.get(provider);
    } catch {
      await this.markFailed(job, {
        code: 'PROVIDER_NOT_CONFIGURED',
        message: `No adapter registered for provider "${provider}"`,
        userMessage: 'This model is temporarily unavailable.',
        retryable: false,
        createdAt: new Date().toISOString(),
      });
      return;
    }
    if (!adapter.pollStatus) {
      await this.markFailed(job, {
        code: 'PROVIDER_NOT_CONFIGURED',
        message: `Provider "${provider}" does not support polling.`,
        userMessage: 'This model is temporarily unavailable.',
        retryable: false,
        createdAt: new Date().toISOString(),
      });
      return;
    }

    try {
      if (this.isAsyncProviderTimedOut(job)) {
        const payload: AiJobError = {
          code: 'PROVIDER_TIMEOUT',
          message: `Provider job exceeded ${this.maxProviderRuntimeSeconds(job)}s runtime budget.`,
          userMessage:
            'Generation took too long and was stopped. Please try again.',
          retryable: true,
          createdAt: new Date().toISOString(),
        };
        await this.providerCapacity.recordFailure(job, payload);
        await this.providerCapacity.release(job);
        await this.handleFailure(job, payload);
        return;
      }

      await this.providerCapacity.heartbeat(job);
      const providerContext = await this.store.findProviderAttemptContext(job);
      const result = await adapter.pollStatus(
        job.providerJobId,
        providerContext,
      );
      if (result.kind === 'pending') {
        const now = new Date().toISOString();
        const executionStartedAt =
          !job.providerStartedAt && (result.progress ?? 0) >= 0.5
            ? now
            : undefined;
        const attempt = await this.recordAttemptSafe(job, {
          status: 'running',
          providerRequestId: result.providerRequestId,
          providerEndpoint: result.providerEndpoint ?? job.deployment,
          queuePosition: result.queuePosition,
          rawStatus: result.rawStatus,
          providerLogs: result.providerLogs,
          executionStartedAt,
          timing: {
            submittedAt: job.providerSubmittedAt,
            lastStatusAt: now,
            stageHint: result.stageHint,
          },
        });
        await this.recordProviderTraceEventsSafe(
          job,
          attempt?.id,
          result.providerTraceEvents,
          result.providerRequestId,
          result.providerEndpoint,
        );
        if (executionStartedAt) {
          await this.recordTraceSafe(job, {
            eventType: 'provider_execution_started',
            occurredAt: executionStartedAt,
            source: 'internal',
            confidence: 'inferred',
            title: 'Execution started',
            description:
              'Provider status indicated execution had started; exact provider timing may be backfilled later.',
            idempotencyKey: `ai_trace:${job.id}:provider_execution_started:inferred:${job.attempt}`,
            providerRequestId: result.providerRequestId,
            endpointId: result.providerEndpoint ?? job.deployment,
            payload: {
              progress: result.progress,
              stageHint: result.stageHint,
            },
          });
        }
        const updated = await this.store.updateProgressIfRunning(job, {
          stage: 'generating',
          progress: result.progress ?? job.progress ?? 0.5,
          providerStartedAt: executionStartedAt,
          logs: result.stageHint
            ? [
                ...job.logs,
                {
                  time: now,
                  stage: 'generating',
                  message: result.stageHint,
                },
              ]
            : job.logs,
        });
        if (!updated) return;
        this.emit(updated);
        await this.dispatchPoll(() =>
          this.queueService.enqueue(
            job.queueName,
            job.id,
            updated?.routingSnapshot?.policy.runtime.pollIntervalMs ??
              job.routingSnapshot?.policy.runtime.pollIntervalMs ??
              ASYNC_PROVIDER_POLL_DELAY_MS,
            this.queuePriorityFor(updated ?? job),
            'poll',
          ),
        );
        return;
      }

      if (result.kind === 'completed') {
        const latestJob = (await this.store.findById(job.id)) ?? job;
        const now = new Date().toISOString();
        const providerCompletedAt = result.providerTiming?.completedAt ?? now;
        const attempt = await this.recordAttemptSafe(latestJob, {
          status: 'succeeded',
          providerRequestId: result.providerRequestId,
          providerEndpoint: result.providerEndpoint ?? latestJob.deployment,
          providerStatus: result.providerStatus,
          rawStatus: rawStatusWithDiagnostics(
            result.rawStatus,
            result.providerDiagnostics,
          ),
          providerResponse: result.providerResponse,
          providerResponseHeaders: result.providerResponseHeaders,
          providerLogs: result.providerLogs,
          costAccounting: result.costAccounting,
          pricingSnapshot: result.pricingSnapshot,
          runDurationMs:
            result.providerTiming?.durationMs ??
            this.elapsedMs(latestJob.providerSubmittedAt, now),
          submittedAt:
            result.providerTiming?.submittedAt ?? latestJob.providerSubmittedAt,
          executionStartedAt:
            result.providerTiming?.executionStartedAt ??
            latestJob.providerStartedAt,
          completedAt: providerCompletedAt,
          timing: {
            submittedAt:
              result.providerTiming?.submittedAt ??
              latestJob.providerSubmittedAt,
            executionStartedAt:
              result.providerTiming?.executionStartedAt ??
              latestJob.providerStartedAt,
            completedAt: providerCompletedAt,
            provider: result.providerTiming,
            diagnostics: result.providerDiagnostics,
          },
        });
        await this.recordProviderTraceEventsSafe(
          latestJob,
          attempt?.id,
          result.providerTraceEvents,
          result.providerRequestId,
          result.providerEndpoint,
        );
        await this.recordTraceSafe(latestJob, {
          eventType: 'provider_response_received',
          occurredAt: now,
          source: 'internal',
          confidence: 'observed',
          title: 'Provider response received',
          description: 'Worker retrieved the final provider response.',
          idempotencyKey: `ai_trace:${latestJob.id}:provider_response_received:${latestJob.attempt}`,
          providerRequestId: result.providerRequestId,
          endpointId: result.providerEndpoint ?? latestJob.deployment,
          payload: {
            providerStatus: result.providerStatus,
          },
        });
        await this.recordProviderCostLedger(latestJob, attempt?.id, result);
        await this.providerCapacity.recordSuccess(latestJob);
        await this.providerCapacity.release(latestJob);
        await this.completeWithOutputs(
          latestJob,
          result.outputs,
          result.providerTiming,
        );
        return;
      }

      const latestJob = (await this.store.findById(job.id)) ?? job;
      const now = new Date().toISOString();
      const providerCompletedAt = result.providerTiming?.completedAt ?? now;
      const attempt = await this.recordAttemptSafe(latestJob, {
        status: 'failed',
        providerRequestId: result.providerRequestId,
        providerEndpoint: result.providerEndpoint ?? latestJob.deployment,
        providerStatus: result.providerStatus,
        rawStatus: rawStatusWithDiagnostics(
          result.rawStatus,
          result.providerDiagnostics,
        ),
        providerResponse: result.providerResponse,
        providerResponseHeaders: result.providerResponseHeaders,
        providerLogs: result.providerLogs,
        error: result.error,
        runDurationMs:
          result.providerTiming?.durationMs ??
          this.elapsedMs(latestJob.providerSubmittedAt, now),
        submittedAt:
          result.providerTiming?.submittedAt ?? latestJob.providerSubmittedAt,
        executionStartedAt:
          result.providerTiming?.executionStartedAt ??
          latestJob.providerStartedAt,
        completedAt: providerCompletedAt,
        timing: {
          submittedAt:
            result.providerTiming?.submittedAt ?? latestJob.providerSubmittedAt,
          executionStartedAt:
            result.providerTiming?.executionStartedAt ??
            latestJob.providerStartedAt,
          completedAt: providerCompletedAt,
          provider: result.providerTiming,
          diagnostics: result.providerDiagnostics,
        },
      });
      await this.recordProviderTraceEventsSafe(
        latestJob,
        attempt?.id,
        result.providerTraceEvents,
        result.providerRequestId,
        result.providerEndpoint,
      );
      await this.providerCapacity.recordFailure(latestJob, result.error);
      await this.providerCapacity.release(latestJob);
      await this.handleFailure(latestJob, result.error);
    } catch (err) {
      if (err instanceof PollDispatchError) throw err;
      const payload = adapter.mapError(err);
      await this.handlePollTransportFailure(job, payload);
    }
  }

  private async handlePollTransportFailure(
    job: AiJob,
    payload: AiJobError,
  ): Promise<void> {
    await this.providerCapacity.recordFailure(job, payload);
    await this.recordAttemptSafe(job, {
      status: RETRYABLE_CODES.has(payload.code) ? 'running' : 'failed',
      providerEndpoint: job.deployment,
      error: payload,
      timing: { lastStatusAt: new Date().toISOString() },
    });
    if (!RETRYABLE_CODES.has(payload.code)) {
      await this.providerCapacity.release(job);
      await this.handleFailure(job, payload);
      return;
    }

    const delayMs = Math.max(
      job.routingSnapshot?.policy.runtime.pollIntervalMs ??
        ASYNC_PROVIDER_POLL_DELAY_MS,
      RETRY_BACKOFFS_MS[
        Math.min(job.attempt - 1, RETRY_BACKOFFS_MS.length - 1)
      ],
    );
    const now = new Date().toISOString();
    const updated = await this.store.update(job.id, {
      stage: 'generating',
      logs: [
        ...job.logs,
        {
          time: now,
          stage: 'generating',
          message: `Provider status check returned ${payload.code}; polling again in ${Math.round(delayMs / 1000)}s.`,
        },
      ],
    });
    if (updated) this.emit(updated);
    await this.dispatchPoll(() =>
      this.queueService.enqueue(
        job.queueName,
        job.id,
        delayMs,
        this.queuePriorityFor(updated ?? job),
        'poll',
      ),
    );
  }

  private isAsyncProviderTimedOut(job: AiJob): boolean {
    const startedAt =
      Date.parse(job.providerSubmittedAt ?? '') ||
      Date.parse(job.startedAt ?? '') ||
      Date.parse(job.createdAt);
    if (!Number.isFinite(startedAt)) return false;
    return Date.now() - startedAt > this.maxProviderRuntimeSeconds(job) * 1000;
  }

  private maxProviderRuntimeSeconds(job: AiJob): number {
    return (
      job.routingSnapshot?.policy.runtime.maxProviderRuntimeSeconds ??
      (job.type === 'video' ? 45 * 60 : 10 * 60)
    );
  }

  private async recordAttemptSafe(
    job: Pick<AiJob, 'id' | 'attempt'>,
    input: RecordAiJobAttemptInput,
  ): Promise<{ id: string } | null> {
    try {
      const attempt = await this.store.recordAttempt(job, input);
      return { id: String(attempt.id) };
    } catch (err) {
      this.logger.warn(
        `Failed to record attempt for job ${job.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  private async recordProviderTraceEventsSafe(
    job: Pick<AiJob, 'id' | 'provider' | 'deployment' | 'createdAt'>,
    attemptId: string | null | undefined,
    events: ProviderTraceEvent[] | undefined,
    providerRequestId?: string | null,
    endpointId?: string | null,
  ): Promise<void> {
    if (!events || events.length === 0) return;
    try {
      await this.store.recordProviderTraceEvents(
        job,
        events.map((event) => ({
          attemptId: attemptId ?? null,
          provider: job.provider,
          endpointId: endpointId ?? job.deployment,
          providerRequestId,
          eventType: event.eventType,
          source: event.source,
          confidence: event.confidence,
          occurredAt: event.occurredAt ?? null,
          offsetMs: event.offsetMs ?? null,
          durationMs: event.durationMs ?? null,
          title: event.title ?? null,
          description: event.description ?? null,
          payload: event.payload ?? null,
          idempotencyKey: event.idempotencyKey
            ? `ai_trace:${job.id}:${event.idempotencyKey}`
            : null,
        })),
      );
    } catch (err) {
      this.logger.warn(
        `Failed to record provider trace events for job ${job.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async recordTraceSafe(
    job: Pick<AiJob, 'id' | 'provider' | 'deployment' | 'createdAt'>,
    input: {
      attemptId?: string | null;
      providerRequestId?: string | null;
      endpointId?: string | null;
      eventType: string;
      source: string;
      confidence: string;
      occurredAt?: string | null;
      offsetMs?: number | null;
      durationMs?: number | null;
      title?: string | null;
      description?: string | null;
      payload?: Record<string, unknown> | null;
      idempotencyKey?: string | null;
    },
  ): Promise<void> {
    try {
      await this.store.recordProviderTraceEvent(job, input);
    } catch (err) {
      this.logger.warn(
        `Failed to record provider trace event for job ${job.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private elapsedMs(start: string | undefined, end: string): number | null {
    if (!start) return null;
    const startMs = Date.parse(start);
    const endMs = Date.parse(end);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
    return Math.max(0, endMs - startMs);
  }

  private async recordProviderCostLedger(
    job: AiJob,
    attemptId: string | null | undefined,
    result: {
      providerRequestId?: string;
      providerEndpoint?: string;
      costAccounting?: Record<string, unknown> | null;
      pricingSnapshot?: Record<string, unknown> | null;
    },
  ): Promise<void> {
    const cost = result.costAccounting;
    if (!cost) return;

    const providerCostUsd = numberFromRecord(cost, 'providerCostUsd');
    const providerCost = numberFromRecord(cost, 'providerCost');
    const amount = providerCost ?? providerCostUsd;
    if (amount == null) return;

    const currency = stringFromRecord(cost, 'currency') ?? 'USD';
    const endpointId =
      stringFromRecord(cost, 'endpointId') ??
      result.providerEndpoint ??
      job.deployment;
    const requestId =
      stringFromRecord(cost, 'requestId') ??
      result.providerRequestId ??
      job.providerJobId ??
      job.id;

    try {
      await this.store.recordCostLedgerEntry(job, {
        attemptId: attemptId ?? null,
        providerBindingId: job.providerBindingId,
        entryType: 'provider_cost',
        currency,
        amount,
        providerCostUsd,
        listPriceCredits: job.routingSnapshot?.policy.quota.cost ?? null,
        pricingSnapshot: result.pricingSnapshot ?? cost,
        idempotencyKey: `ai_provider_cost:${job.id}:${requestId}`,
        source: stringFromRecord(cost, 'source') ?? 'provider_response',
        metadata: {
          provider: job.provider,
          endpointId,
          requestId,
          billableUnits: numberFromRecord(cost, 'billableUnits'),
          unitPrice: numberFromRecord(cost, 'unitPrice'),
          unit: stringFromRecord(cost, 'unit'),
          selectedProviderEndpointId:
            job.routingSnapshot?.selectedProviderEndpointId,
          selectedProviderBindingId: job.providerBindingId,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to record provider cost ledger for job ${job.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async runJob(job: AiJob) {
    if (!backgroundTasksEnabled()) return;
    let adapter: ProviderAdapter;
    const provider = job.routingSnapshot?.selectedProvider ?? job.provider;
    const modelId = job.routingSnapshot?.selectedModelId ?? job.modelId;
    try {
      adapter = this.providers.get(provider);
    } catch {
      await this.markFailed(job, {
        code: 'PROVIDER_NOT_CONFIGURED',
        message: `No adapter registered for provider "${provider}"`,
        userMessage: 'This model is temporarily unavailable.',
        retryable: false,
        createdAt: new Date().toISOString(),
      });
      return;
    }

    // Canvas URLs are display caches, not durable identity. Re-resolve every
    // assetId from its current placement on every attempt so storage/CDN moves,
    // moderation changes, and long-lived documents cannot send stale URLs to a
    // provider. These are public direct URLs, not per-request signatures.
    let providerInput: Record<string, unknown>;
    try {
      providerInput = await this.referenceUrls.prepareReferences(
        job.normalizedInput,
      );
    } catch (err) {
      const payload =
        err instanceof ReferencePreparationError
          ? err.jobError
          : {
              code: 'MEDIA_ASSET_NOT_READY' as const,
              message:
                err instanceof Error
                  ? err.message
                  : 'Reference media preparation failed.',
              userMessage:
                'A referenced asset is unavailable. Choose another asset and try again.',
              retryable: false,
              createdAt: new Date().toISOString(),
            };
      await this.recordAttemptSafe(job, {
        status: 'failed',
        providerEndpoint: job.deployment,
        error: payload,
        completedAt: new Date().toISOString(),
      });
      await this.markFailed(job, payload);
      return;
    }

    // Provider-specific seam (design §3.4): provider-hosted references
    // (asset:// mirrors, character status) are re-validated on EVERY attempt —
    // the submit-time readiness check can go stale in queue. Terminal by
    // contract: a typed failure releases the billing hold and never requeues.
    if (adapter.prepareReferences) {
      try {
        providerInput = await adapter.prepareReferences(
          modelId,
          providerInput,
          {
            jobId: job.id,
            userId: job.userId,
            projectId: job.projectId,
            workspaceId: job.workspaceId,
            publicBaseUrl: process.env.PUBLIC_BASE_URL,
          },
        );
      } catch (err) {
        const payload =
          err instanceof ReferencePreparationError
            ? err.jobError
            : { ...adapter.mapError(err), retryable: false };
        await this.recordAttemptSafe(job, {
          status: 'failed',
          providerEndpoint: job.deployment,
          error: payload,
          completedAt: new Date().toISOString(),
        });
        await this.markFailed(job, payload);
        return;
      }
    }

    const gate = await this.providerCapacity.reserveForProviderSubmit(job);
    if (!gate.ok) {
      await this.deferForProviderCapacity(job, gate);
      return;
    }

    try {
      const result = await adapter.startGeneration(modelId, providerInput, {
        expectedExecutionBinding: job.routingSnapshot?.executionBindingIdentity,
        jobId: job.id,
        userId: job.userId,
        publicBaseUrl: process.env.PUBLIC_BASE_URL,
      });

      if (result.kind === 'completed') {
        // Sync provider (Azure Foundry image): bytes are here, go
        // straight to upload + complete.
        const now = new Date().toISOString();
        const providerCompletedAt = result.providerTiming?.completedAt ?? now;
        const attempt = await this.recordAttemptSafe(job, {
          status: 'succeeded',
          providerRequestId: result.providerRequestId,
          providerEndpoint: result.providerEndpoint ?? job.deployment,
          providerStatus: result.providerStatus,
          providerRequest: result.providerRequest,
          providerResponse: result.providerResponse,
          providerResponseHeaders: result.providerResponseHeaders,
          costAccounting: result.costAccounting,
          pricingSnapshot: result.pricingSnapshot,
          runDurationMs:
            result.providerTiming?.durationMs ??
            this.elapsedMs(job.startedAt, now),
          submittedAt: result.providerTiming?.submittedAt ?? job.startedAt,
          executionStartedAt: result.providerTiming?.executionStartedAt,
          timing: {
            submittedAt: result.providerTiming?.submittedAt ?? job.startedAt,
            executionStartedAt: result.providerTiming?.executionStartedAt,
            completedAt: providerCompletedAt,
            provider: result.providerTiming,
            diagnostics: result.providerDiagnostics,
          },
          completedAt: providerCompletedAt,
        });
        await this.recordProviderTraceEventsSafe(
          job,
          attempt?.id,
          result.providerTraceEvents,
          result.providerRequestId,
          result.providerEndpoint ?? job.deployment,
        );
        await this.recordProviderCostLedger(job, attempt?.id, result);
        await this.providerCapacity.recordSuccess(job);
        await this.providerCapacity.release(job);
        await this.completeWithOutputs(
          job,
          result.outputs,
          result.providerTiming,
        );
        return;
      }

      // Async provider (fal / Replicate): persist providerJobId and
      // re-enqueue a poll marker. Poll completion reuses the same
      // upload / failure / refund paths as sync providers.
      const now = new Date().toISOString();
      const attempt = await this.recordAttemptSafe(job, {
        status: 'submitted',
        providerRequestId: result.providerRequestId,
        providerEndpoint: result.providerEndpoint ?? job.deployment,
        providerRequest: result.providerRequest,
        providerResponse: result.providerResponse,
        providerResponseHeaders: result.providerResponseHeaders,
        costAccounting: result.costAccounting,
        pricingSnapshot: result.pricingSnapshot,
        queuePosition: result.queuePosition,
        submittedAt: result.submittedAt ?? now,
        timing: {
          submittedAt: result.submittedAt ?? now,
          workerAcceptedAt: job.startedAt,
          diagnostics: result.providerDiagnostics,
        },
      });
      await this.recordProviderTraceEventsSafe(
        job,
        attempt?.id,
        result.providerTraceEvents,
        result.providerRequestId,
        result.providerEndpoint,
      );
      const queued = await this.store.update(job.id, {
        stage: 'provider_queued',
        providerJobId: result.providerJobId,
        providerSubmittedAt: result.submittedAt ?? now,
        progress: 0.1,
        logs: [
          ...job.logs,
          {
            time: now,
            stage: 'provider_queued',
            message: 'Provider accepted the generation request.',
          },
        ],
      });
      if (queued) this.emit(queued);
      await this.dispatchPoll(() =>
        this.queueService.enqueue(
          job.queueName,
          job.id,
          result.initialPollDelayMs ?? ASYNC_PROVIDER_POLL_DELAY_MS,
          this.queuePriorityFor(job),
          'poll',
        ),
      );
      this.logger.log(
        `job ${job.id} queued provider poll for ${result.providerJobId}`,
      );
    } catch (err) {
      if (err instanceof PollDispatchError) throw err;
      const payload = adapter.mapError(err);
      await this.providerCapacity.recordFailure(job, payload);
      await this.providerCapacity.release(job);
      await this.recordAttemptSafe(job, {
        status: 'failed',
        providerEndpoint: job.deployment,
        error: payload,
        completedAt: new Date().toISOString(),
      });
      await this.handleFailure(job, payload);
    }
  }

  private async deferForProviderCapacity(
    job: AiJob,
    gate: Extract<ProviderCapacityGate, { ok: false }>,
  ): Promise<void> {
    const now = new Date().toISOString();
    // Concurrency leases span the whole async render, so the gate's
    // retryAfterMs is the WORST-case lease expiry (up to the runtime budget),
    // not the expected slot release — re-check on a short cadence instead of
    // sleeping it out (a 1-slot lane like Seedance 4k frees after minutes).
    const delayCapMs =
      gate.reason === 'provider_concurrency' ? 30_000 : Number.MAX_SAFE_INTEGER;
    const delayMs = Math.max(1_000, Math.min(gate.retryAfterMs, delayCapMs));
    const retryAt = new Date(Date.now() + delayMs).toISOString();
    await this.recordTraceSafe(job, {
      eventType: 'provider_capacity_wait',
      occurredAt: now,
      source: 'internal',
      confidence: 'exact',
      title: 'Provider capacity wait',
      description: gate.message,
      idempotencyKey: `ai_trace:${job.id}:provider_capacity_wait:${job.attempt}:${Date.now()}`,
      endpointId: gate.endpointKey,
      payload: {
        reason: gate.reason,
        endpointKey: gate.endpointKey,
        retryAfterMs: delayMs,
        retryAt,
        capacity: gate.capacity,
      },
    });

    const updated = await this.store.update(job.id, {
      status: 'in_queue',
      stage: 'queued',
      queuedAt: retryAt,
      progress: null,
      queuePosition: null,
      logs: [
        ...job.logs,
        {
          time: now,
          stage: 'queued',
          message: `Generation capacity is busy; retrying in ${Math.max(1, Math.round(delayMs / 1000))}s.`,
        },
      ],
    });

    if (updated) {
      await this.queueService.enqueue(
        job.queueName,
        job.id,
        delayMs,
        this.queuePriorityFor(job),
      );
      const repositioned = await this.store.recomputeQueuePositions(
        job.queueName,
      );
      this.emit(updated);
      for (const moved of repositioned) {
        if (moved.id === updated.id) continue;
        this.emit(moved);
      }
    }
    this.logger.log(
      `job ${job.id} deferred ${Math.round(delayMs / 1000)}s for ${gate.reason} (${gate.endpointKey})`,
    );
  }

  /**
   * Sync success path — also reused by future poll completion handler.
   */
  private async completeWithOutputs(
    job: AiJob,
    rawOutputs: RawProviderOutput[],
    providerTiming?: ProviderTimingSnapshot | null,
  ) {
    if (rawOutputs.length === 0) {
      await this.handleFailure(job, {
        code: 'UNKNOWN',
        message: 'Provider returned no outputs',
        userMessage: 'Generation failed. Please try again.',
        retryable: true,
        createdAt: new Date().toISOString(),
      });
      return;
    }

    const outputFetchStartedAt = new Date().toISOString();
    await this.recordTraceSafe(job, {
      eventType: 'output_fetch_started',
      occurredAt: outputFetchStartedAt,
      source: 'internal',
      confidence: 'exact',
      title: 'Output fetch started',
      description: 'Worker started fetching provider-hosted outputs.',
      idempotencyKey: `ai_trace:${job.id}:output_fetch_started:${job.attempt}`,
      payload: {
        outputCount: rawOutputs.length,
      },
    });

    const fetched = await this.store.update(job.id, {
      stage: 'fetching_output',
      progress: 0.85,
      outputFetchedAt: outputFetchStartedAt,
    });
    if (fetched) this.emit(fetched);

    const uploading = await this.store.update(job.id, {
      stage: 'uploading_to_oss',
      progress: 0.92,
    });
    if (uploading) this.emit(uploading);

    let outputs: AiJobOutput[];
    try {
      outputs = await this.uploadOutputs(job, rawOutputs);
    } catch (err) {
      await this.handleFailure(job, {
        code: 'OSS_UPLOAD_FAILED',
        message: err instanceof Error ? err.message : 'OSS upload failed',
        userMessage:
          'We generated your image but failed to save it. Please try again.',
        retryable: true,
        createdAt: new Date().toISOString(),
      });
      return;
    }

    const now = new Date().toISOString();
    await this.recordTraceSafe(job, {
      eventType: 'oss_upload_finished',
      occurredAt: now,
      source: 'internal',
      confidence: 'exact',
      title: 'OSS upload finished',
      description: 'Generated outputs were persisted to FizzDragon storage.',
      idempotencyKey: `ai_trace:${job.id}:oss_upload_finished:${job.attempt}`,
      payload: {
        outputCount: outputs.length,
        outputBytes: outputs.reduce(
          (sum, output) => sum + (output.bytes ?? 0),
          0,
        ),
      },
    });
    // Claim the terminal completion BEFORE charging. A user cancel runs
    // out-of-band from this BullMQ worker, so the status write is the barrier:
    // completeIfRunning only transitions in_progress → completed. If it returns
    // null the job was cancelled (or failed) first — the cancel path already
    // released the hold, so we must NOT settle and must NOT deliver. The
    // uploaded outputs are then orphaned in storage (swept by storage GC), never
    // handed to the user.
    const completed = await this.store.completeIfRunning(job.id, {
      status: 'completed',
      stage: 'completed',
      outputs,
      progress: 1,
      providerSubmittedAt:
        providerTiming?.submittedAt ?? job.providerSubmittedAt,
      providerStartedAt:
        providerTiming?.executionStartedAt ?? job.providerStartedAt,
      providerCompletedAt: providerTiming?.completedAt ?? now,
      ossUploadedAt: now,
      completedAt: now,
      logs: [
        ...job.logs,
        {
          time: now,
          stage: 'completed',
          message: `Generation complete (${outputs.length} output${outputs.length === 1 ? '' : 's'}).`,
        },
      ],
    });
    if (!completed) {
      this.logger.warn(
        `job ${job.id} left in_progress before completion (cancelled?); discarding outputs and skipping settlement`,
      );
      return;
    }

    // We own the outcome now: status is terminal 'completed', so a racing cancel
    // can no longer win the transition. Convert the hold to a charge. On the rare
    // settlement failure (wallet infra), keep the completed + delivered job and
    // leave the hold reserved for reconciliation — we NEVER refund a delivered
    // generation, so this cannot become a free-generation path.
    try {
      await this.billingWallet.settleForJob(completed);
    } catch (err) {
      this.logger.error(
        `settlement failed for completed job ${job.id}: ${
          err instanceof Error ? err.message : String(err)
        } — hold left reserved for reconciliation`,
      );
      this.alertJobFailure(
        completed,
        {
          code: 'BILLING_SETTLEMENT_FAILED',
          message:
            err instanceof Error
              ? err.message
              : 'Compute point settlement failed',
          userMessage: 'Generation finished but billing settlement failed.',
          retryable: false,
          createdAt: now,
        },
        now,
      );
    }

    await this.recordTraceSafe(completed, {
      eventType: 'job_completed',
      occurredAt: now,
      source: 'internal',
      confidence: 'exact',
      title: 'Job completed',
      description:
        'Job completed after output persistence and database update.',
      idempotencyKey: `ai_trace:${job.id}:job_completed:${job.attempt}`,
      payload: {
        outputCount: outputs.length,
      },
    });
    await this.completionObservers?.notifyCompleted(completed);
    this.emit(completed);
    await this.recordActivityVersionSafe(completed);
  }

  /**
   * Log an 'ai' activity entry on the canvas document so the activity feed shows
   * "<user> generated <prompt>". Best-effort: the generation is already complete
   * and emitted, so a failure here must never surface to the user.
   */
  private async recordActivityVersionSafe(job: AiJob): Promise<void> {
    if (!job.documentId) return;
    try {
      await this.documents.createSystemVersion(job.documentId, {
        source: 'ai',
        label: this.activityLabel(job),
        sourceId: job.id,
        createdById: job.userId,
      });
    } catch (err) {
      this.logger.warn(
        `Activity version failed for job ${job.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private activityLabel(job: AiJob): string {
    const text = (job.promptDisplayText ?? job.prompt ?? '').trim();
    if (text) return text.length > 110 ? `${text.slice(0, 110)}…` : text;
    return job.type;
  }

  private async handleFailure(job: AiJob, payload: AiJobError): Promise<void> {
    const attempt = job.attempt + 1;
    const backoffIdx = Math.min(job.attempt - 1, RETRY_BACKOFFS_MS.length - 1);
    const shouldRetry =
      RETRYABLE_CODES.has(payload.code) && attempt <= RETRY_BACKOFFS_MS.length;

    if (shouldRetry) {
      const delayMs = RETRY_BACKOFFS_MS[backoffIdx];
      const reQueuedAt = new Date(Date.now() + delayMs).toISOString();
      // Status-guarded: only requeue a job that is STILL in_progress. If a user
      // cancel already terminated + refunded it out-of-band, requeueIfRunning
      // returns null and we drop the retry — otherwise a retryable provider
      // error would resurrect the cancelled job to in_queue, re-run it, and
      // deliver outputs that can no longer be settled (the hold is gone) = free
      // generation after a refund.
      const requeued = await this.store.requeueIfRunning(job.id, {
        status: 'in_queue',
        stage: 'provider_queued',
        attempt,
        queuedAt: reQueuedAt,
        progress: null,
        logs: [
          ...job.logs,
          {
            time: new Date().toISOString(),
            stage: 'provider_queued',
            message: `Provider returned ${payload.code}; retrying in ${Math.round(delayMs / 1000)}s (attempt ${attempt}/${RETRY_BACKOFFS_MS.length}).`,
          },
        ],
      });
      if (requeued) {
        // Preserve the submit-time route priority across retries so
        // config/tier edits don't reshuffle an already accepted job.
        await this.queueService.enqueue(
          job.queueName,
          job.id,
          delayMs,
          this.queuePriorityFor(job),
        );
        this.emit(requeued);
        this.logger.log(
          `job ${job.id} requeued after ${payload.code} (attempt ${attempt}, delay ${Math.round(delayMs / 1000)}s)`,
        );
      } else {
        this.logger.warn(
          `job ${job.id} left in_progress before retryable ${payload.code} could requeue (cancelled?); dropping retry`,
        );
      }
      return;
    }

    await this.markFailed(job, payload);
  }

  private async markFailed(job: AiJob, payload: AiJobError): Promise<void> {
    const now = new Date().toISOString();
    const failed = await this.store.failIfActive(job.id, {
      status: 'failed',
      stage: 'failed',
      error: payload,
      completedAt: now,
      logs: [
        ...job.logs,
        { time: now, stage: 'failed', message: payload.message },
      ],
    });
    if (!failed) return;
    await this.providerCapacity.release(job);
    await this.recordTraceSafe(job, {
      eventType: 'job_failed',
      occurredAt: now,
      source: 'internal',
      confidence: 'exact',
      title: 'Job failed',
      description: payload.message,
      idempotencyKey: `ai_trace:${job.id}:job_failed:${job.attempt}`,
      payload: {
        code: payload.code,
        retryable: payload.retryable,
        userMessage: payload.userMessage,
      },
    });
    await this.billingWallet.releaseForJob(
      failed,
      `ai_job_failed_${payload.code}`,
    );
    this.emit(failed);
    this.logger.warn(
      `job ${job.id} failed: ${payload.code} ${payload.message}`,
    );
    this.alertJobFailure(failed, payload, now);
  }

  /**
   * Where this job's outputs go. The target is frozen on the job row at submit
   * time, so a requeued attempt re-uploads into the store the first attempt
   * used instead of following the process-wide binding, which is what keeps
   * the content-addressed key pointing at one object.
   */
  private storageFor(job: AiJob): OutputStorageService {
    if (!job.outputStorageProvider) return this.storage;
    const pinned = this.storageRegistry.forProvider(job.outputStorageProvider);
    if (!pinned) {
      throw new Error(
        `job pins storage provider ${job.outputStorageProvider}, which has no writable implementation`,
      );
    }
    return pinned;
  }

  private async uploadOutputs(
    job: AiJob,
    raws: RawProviderOutput[],
  ): Promise<AiJobOutput[]> {
    const storage = this.storageFor(job);
    const created = new Date(job.createdAt);
    const yyyy = created.getUTCFullYear();
    const mm = String(created.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(created.getUTCDate()).padStart(2, '0');

    const out: AiJobOutput[] = [];
    for (const raw of raws) {
      const outputType = raw.type ?? job.type;
      let checksumSha256: string;
      let result: OutputStorageResult;
      let actualVideo: PlayableVideoProbeResult | null = null;
      let actualAudio: PlayableAudioProbeResult | null = null;
      let actualImage: { width: number; height: number } | null = null;
      if (outputType === 'video') {
        // Every video takes one byte-truth path: spool, hash, ffprobe, then
        // upload. Provider width/height/duration and requested audio flags are
        // not persisted as facts.
        const spoolPath = join(
          tmpdir(),
          `ai-output-${job.id}-${raw.index}-${newShortId()}.spool`,
        );
        try {
          const spooled = raw.buffer
            ? await this.spoolBufferToFile(raw.buffer, spoolPath)
            : raw.providerUrl
              ? await this.spoolProviderUrlToFile(raw.providerUrl, spoolPath)
              : null;
          if (!spooled) {
            throw new Error(`no bytes available for output index ${raw.index}`);
          }
          checksumSha256 = spooled.sha256;
          actualVideo = await this.videoProbe.probeFile(spoolPath, {
            requireBrowserSafeMp4: false,
          });
          const normalizedRaw = { ...raw, ext: actualVideo.fileExtension };
          result = await storage.uploadFromFile({
            filePath: spoolPath,
            sizeBytes: spooled.bytes,
            key: this.outputKey(job, normalizedRaw, checksumSha256, {
              yyyy,
              mm,
              dd,
            }),
            contentType: actualVideo.contentType,
            filename: `${job.id}-${raw.index}.${actualVideo.fileExtension}`,
          });
        } finally {
          await unlink(spoolPath).catch(() => {});
        }
      } else if (outputType === 'audio') {
        const spoolPath = join(
          tmpdir(),
          `ai-output-${job.id}-${raw.index}-${newShortId()}.spool`,
        );
        try {
          const spooled = raw.buffer
            ? await this.spoolBufferToFile(raw.buffer, spoolPath)
            : raw.providerUrl
              ? await this.spoolProviderUrlToFile(raw.providerUrl, spoolPath)
              : null;
          if (!spooled) {
            throw new Error(`no bytes available for output index ${raw.index}`);
          }
          checksumSha256 = spooled.sha256;
          actualAudio = await this.audioProbe.probeFile(spoolPath);
          const normalizedRaw = {
            ...raw,
            ext: actualAudio.fileExtension,
          };
          result = await storage.uploadFromFile({
            filePath: spoolPath,
            sizeBytes: spooled.bytes,
            key: this.outputKey(job, normalizedRaw, checksumSha256, {
              yyyy,
              mm,
              dd,
            }),
            contentType: actualAudio.contentType,
            filename: `${job.id}-${raw.index}.${actualAudio.fileExtension}`,
          });
        } finally {
          await unlink(spoolPath).catch(() => {});
        }
      } else {
        let body = raw.buffer;
        if (!body && raw.providerUrl) {
          body = await this.fetchProviderBytes(raw.providerUrl);
        }
        if (!body) {
          throw new Error(`no bytes available for output index ${raw.index}`);
        }
        // Some image providers return only a URL. Persist dimensions now so
        // later reference quotes need neither client guesses nor re-downloads.
        if (outputType === 'image' && (!raw.width || !raw.height)) {
          const imagePath = join(tmpdir(), `ai-image-${newShortId()}.spool`);
          try {
            await writeFile(imagePath, body);
            actualImage = await inspectImage(imagePath);
          } finally {
            await unlink(imagePath).catch(() => {});
          }
        }
        checksumSha256 = createHash('sha256').update(body).digest('hex');
        result = await storage.upload({
          body,
          key: this.outputKey(job, raw, checksumSha256, { yyyy, mm, dd }),
          contentType: raw.mimeType,
          filename: `${job.id}-${raw.index}.${raw.ext}`,
        });
      }
      const contentHash = checksumSha256.slice(0, 12);
      const contentType =
        actualVideo?.contentType ?? actualAudio?.contentType ?? raw.mimeType;
      const width = actualVideo?.width ?? actualImage?.width ?? raw.width;
      const height = actualVideo?.height ?? actualImage?.height ?? raw.height;
      const durationSeconds =
        actualVideo?.durationSeconds ??
        actualAudio?.durationSeconds ??
        raw.durationSeconds;
      const durationMs = actualVideo?.durationMs ?? actualAudio?.durationMs;
      const assetId = await this.store.createAiOutputAsset(job, {
        type: outputType,
        url: result.url,
        storageProvider: result.provider,
        bucket: result.bucket,
        region: result.region,
        objectKey: result.storagePath,
        contentType,
        sizeBytes: result.bytes,
        width,
        height,
        durationMs,
        durationSeconds,
        videoMetadata: actualVideo
          ? {
              videoCodec: actualVideo.videoCodec,
              audioCodecs: actualVideo.audioCodecs,
              browserSafeMp4: actualVideo.browserSafeMp4,
            }
          : undefined,
        audioMetadata: actualAudio
          ? {
              audioCodec: actualAudio.audioCodec,
              sampleRate: actualAudio.sampleRate,
              channels: actualAudio.channels,
            }
          : undefined,
        checksumSha256,
        outputIndex: raw.index,
        contentHash,
        safetyFlags: raw.safetyFlags,
      });
      void this.mediaAssetReadiness.enqueueAutomaticChecks(assetId);
      out.push({
        // Short app-generated ID. Idempotent recovery on retry is via
        // `(jobId, outputIndex)` unique + repository.replaceOutputs
        // transactional DELETE + INSERT.
        id: newShortId(),
        assetId,
        type: outputType,
        url: result.url,
        storagePath: result.storagePath,
        contentHash,
        width,
        height,
        durationSeconds,
        mimeType: contentType,
        bytes: result.bytes,
        seed: raw.seed,
        safetyFlags: raw.safetyFlags,
        provenance: {
          provider: job.provider,
          modelId: job.modelId,
          deployment: job.deployment,
          canonicalModelId: job.canonicalModelId,
          providerBindingId: job.providerBindingId,
          checksumSha256,
        },
        createdAt: new Date().toISOString(),
      });
    }
    return out;
  }

  /**
   * Storage key prefix is the historical container name; safe to keep even
   * as more providers land (`foundry-outputs` is just the container, not a
   * provider-specific path).
   */
  private outputKey(
    job: AiJob,
    raw: RawProviderOutput,
    checksumSha256: string,
    date: { yyyy: number; mm: string; dd: string },
  ): string {
    const contentHash = checksumSha256.slice(0, 12);
    return `${job.provider}/${date.yyyy}/${date.mm}/${date.dd}/${job.userId}/${job.id}/${raw.index}-${contentHash}.${raw.ext}`;
  }

  private async fetchProviderBytes(
    url: string,
    maxBytes = MAX_PROVIDER_OUTPUT_BYTES,
  ): Promise<Buffer> {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(PROVIDER_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new Error(`provider URL fetch failed: HTTP ${res.status}`);
    }
    const tooLarge = () =>
      new Error(`provider output exceeds ${maxBytes} bytes`);
    if (Number(res.headers.get('content-length')) > maxBytes) {
      await res.body?.cancel().catch(() => undefined);
      throw tooLarge();
    }
    if (!res.body) return Buffer.alloc(0);
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) throw tooLarge();
        chunks.push(value);
      }
      return Buffer.concat(chunks, bytes);
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  private async spoolBufferToFile(
    body: Buffer,
    filePath: string,
  ): Promise<{ sha256: string; bytes: number }> {
    if (body.byteLength > MAX_PROVIDER_OUTPUT_BYTES) {
      throw new Error(
        `provider output exceeds ${MAX_PROVIDER_OUTPUT_BYTES} bytes`,
      );
    }
    await writeFile(filePath, body, { flag: 'wx', mode: 0o600 });
    return {
      sha256: createHash('sha256').update(body).digest('hex'),
      bytes: body.byteLength,
    };
  }

  /**
   * Streams a provider output straight to disk, computing sha256 and byte
   * count en route, so worker memory stays O(chunk) no matter how large the
   * file is. Guards: whole-transfer abort timeout + hard byte ceiling.
   */
  private async spoolProviderUrlToFile(
    url: string,
    filePath: string,
  ): Promise<{ sha256: string; bytes: number }> {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(PROVIDER_FETCH_TIMEOUT_MS),
    });
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => undefined);
      throw new Error(`provider URL fetch failed: HTTP ${res.status}`);
    }
    const hash = createHash('sha256');
    let bytes = 0;
    const guardAndHash = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > MAX_PROVIDER_OUTPUT_BYTES) {
          callback(
            new Error(
              `provider output exceeds ${MAX_PROVIDER_OUTPUT_BYTES} bytes`,
            ),
          );
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(res.body as WebReadableStream),
      guardAndHash,
      createWriteStream(filePath),
    );
    return { sha256: hash.digest('hex'), bytes };
  }

  private emit(job: AiJob) {
    // Outbox-mediated emit — durable record + optimistic publish.
    void this.outbox.record(job);
  }
}

function severityForAiFailure(code: AiJobError['code']): AlertSeverity {
  switch (code) {
    case 'PROVIDER_NOT_CONFIGURED':
    case 'QUEUE_UNAVAILABLE':
    case 'OSS_UPLOAD_FAILED':
    case 'BILLING_SETTLEMENT_FAILED':
    case 'WORKER_CRASHED':
      return 'critical';
    case 'PROVIDER_429':
    case 'PROVIDER_5XX':
    case 'PROVIDER_TIMEOUT':
    case 'PROVIDER_REFERENCE_DOWNLOAD':
    case 'MEDIA_STORAGE_UNAVAILABLE':
    case 'UNKNOWN':
      return 'error';
    case 'VALIDATION_ERROR':
    case 'SCHEMA_VERSION_MISMATCH':
    case 'MEMBERSHIP_REQUIRED':
    case 'MEMBERSHIP_EXPIRED':
    case 'RATE_LIMITED':
    case 'QUEUE_LIMIT_EXCEEDED':
    case 'PROVIDER_CONTENT_FILTER':
    case 'OUTPUT_EXPIRED':
    case 'CANCELLED_BY_USER':
    case 'CHARACTER_REVOKED':
    case 'CHARACTER_ASSET_NOT_READY':
    case 'MEDIA_ASSET_NOT_READY':
      return 'warning';
  }
}

function numberFromRecord(
  record: Record<string, unknown>,
  key: string,
): number | null {
  const value = record[key];
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringFromRecord(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function rawStatusWithDiagnostics(
  rawStatus: unknown,
  diagnostics: Record<string, unknown> | null | undefined,
): unknown {
  if (!diagnostics) return rawStatus;
  return {
    queueStatus: rawStatus ?? null,
    diagnostics,
  };
}
