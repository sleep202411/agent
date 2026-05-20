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
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { Worker, Job as BullJob } from 'bullmq';
import { createHash } from 'crypto';
import { newShortId } from '../common/id';
import { QuotaService } from '../quota/quota.service';
import { TIERS, normalizeTier } from '../quota/tiers.config';
import { OutputStorageService } from '../infra/storage/storage.types';
import { AiGenerationOutboxService } from './outbox.service';
import type { ProviderAdapter, RawProviderOutput } from './provider-adapter';
import { ProviderRegistry } from './provider-registry.service';
import {
  createAiWorker,
  AI_QUEUE_IMAGE,
  AI_QUEUE_VIDEO,
  type AiQueueJobData,
} from './queue';
import { AiGenerationQueueService } from './queue.service';
import { AiGenerationRepository } from './repository';
import type { AiJob, AiJobError, AiJobOutput } from './types';

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

// SIGTERM drain budget — how long we wait for in-flight provider
// fetches to settle before letting the process exit. Set wider than
// the longest expected single job (gpt-image-2 high can stretch past
// 180s) so the common case finishes cleanly; pair with K8s
// terminationGracePeriodSeconds at the same number plus margin.
const DRAIN_TIMEOUT_MS = 250_000;
const DRAIN_POLL_MS = 500;

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
    private readonly queueService: AiGenerationQueueService,
    private readonly quota: QuotaService,
  ) {}

  onApplicationBootstrap() {
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
    );
    for (const w of this.workers) {
      w.on('failed', (job, err) => {
        // BullMQ-level failures (unhandled throws from processor).
        // Normal provider failures are caught inside runJob and
        // turned into FAILED/requeue without throwing — so anything
        // reaching here is unexpected.
        this.logger.error(
          `BullMQ job ${job?.id ?? '?'} failed at queue layer: ${err.message}`,
        );
      });
    }
    this.logger.log(
      `AiGenerationWorker subscribed to BullMQ (image=${IMAGE_WORKER_CONCURRENCY}, video=${VIDEO_WORKER_CONCURRENCY}); providers=${this.providers
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
   * row from Postgres rather than trusting the queue payload — the
   * payload is just `{ jobId }`, and there could be a stale view if
   * the row mutated between enqueue and dequeue.
   */
  private async processQueueJob(
    queueJob: BullJob<AiQueueJobData>,
  ): Promise<void> {
    const jobId = queueJob.data.jobId;
    const dbJob = await this.store.findById(jobId);
    if (!dbJob) {
      this.logger.warn(
        `BullMQ job ${queueJob.id} references missing DB row ${jobId}; dropping.`,
      );
      return;
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
    const next = await this.store.update(job.id, {
      status: 'in_progress',
      stage: 'calling_provider',
      startedAt: now,
      queuePosition: null,
      progress: 0,
      logs: [
        ...job.logs,
        {
          time: now,
          stage: 'calling_provider',
          message: 'Picked up by worker.',
        },
      ],
    });
    if (!next) return null;
    const repositioned = await this.store.recomputeQueuePositions(
      job.queueName,
    );
    this.emit(next);
    // Notify the rest of the queue that they moved up. The claimed
    // job already got its own emit() above; skip it here to avoid a
    // duplicate push in the same tick.
    for (const moved of repositioned) {
      if (moved.id === next.id) continue;
      this.emit(moved);
    }
    return next;
  }

  private async runJob(job: AiJob) {
    let adapter: ProviderAdapter;
    try {
      adapter = this.providers.get(job.provider);
    } catch {
      await this.markFailed(job, {
        code: 'PROVIDER_NOT_CONFIGURED',
        message: `No adapter registered for provider "${job.provider}"`,
        userMessage: 'This model is temporarily unavailable.',
        retryable: false,
        createdAt: new Date().toISOString(),
      });
      return;
    }

    try {
      const result = await adapter.startGeneration(
        job.modelId,
        job.normalizedInput,
        {
          jobId: job.id,
          userId: job.userId,
          publicBaseUrl: process.env.PUBLIC_BASE_URL,
        },
      );

      if (result.kind === 'completed') {
        // Sync provider (Azure Foundry image): bytes are here, go
        // straight to upload + complete.
        await this.completeWithOutputs(job, result.outputs);
        return;
      }

      // Async provider (fal / Replicate): persist providerJobId and
      // hand off to the polling/webhook path. Worker isn't done with
      // the job; another tick (or a webhook handler) will finalize.
      // TODO: scheduler that re-enqueues with a poll marker after
      // `initialPollDelayMs`. For now we log + return so the job stays
      // IN_PROGRESS and an operator can investigate. (Foundry never
      // returns kind: 'pending' so this branch is dead today.)
      await this.store.update(job.id, {
        stage: 'provider_queued',
        providerJobId: result.providerJobId,
      });
      this.logger.warn(
        `Async provider path not yet wired (job ${job.id}, providerJobId ${result.providerJobId}); stays IN_PROGRESS pending poll/webhook handler.`,
      );
    } catch (err) {
      const payload = adapter.mapError(err);
      await this.handleFailure(job, payload);
    }
  }

  /**
   * Sync success path — also reused by future poll completion handler.
   */
  private async completeWithOutputs(
    job: AiJob,
    rawOutputs: RawProviderOutput[],
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

    const fetched = await this.store.update(job.id, {
      stage: 'fetching_output',
      progress: 0.85,
      outputFetchedAt: new Date().toISOString(),
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
    const completed = await this.store.update(job.id, {
      status: 'completed',
      stage: 'completed',
      outputs,
      progress: 1,
      providerCompletedAt: now,
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
    if (completed) this.emit(completed);
  }

  private async handleFailure(job: AiJob, payload: AiJobError): Promise<void> {
    const attempt = job.attempt + 1;
    const backoffIdx = Math.min(job.attempt - 1, RETRY_BACKOFFS_MS.length - 1);
    const shouldRetry =
      RETRYABLE_CODES.has(payload.code) && attempt <= RETRY_BACKOFFS_MS.length;

    if (shouldRetry) {
      const delayMs = RETRY_BACKOFFS_MS[backoffIdx];
      const reQueuedAt = new Date(Date.now() + delayMs).toISOString();
      const requeued = await this.store.update(job.id, {
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
        // Preserve the original tier-priority across retries so a VIP3
        // user doesn't suddenly drop to default mid-flight.
        const priority = TIERS[normalizeTier(job.userLevel)].priority;
        await this.queueService.enqueue(
          job.queueName,
          job.id,
          delayMs,
          priority,
        );
        this.emit(requeued);
        this.logger.log(
          `job ${job.id} requeued after ${payload.code} (attempt ${attempt}, delay ${Math.round(delayMs / 1000)}s)`,
        );
      }
      return;
    }

    await this.markFailed(job, payload);
  }

  private async markFailed(job: AiJob, payload: AiJobError): Promise<void> {
    const now = new Date().toISOString();
    const failed = await this.store.update(job.id, {
      status: 'failed',
      stage: 'failed',
      error: payload,
      completedAt: now,
      logs: [
        ...job.logs,
        { time: now, stage: 'failed', message: payload.message },
      ],
    });
    if (failed) {
      this.emit(failed);
      this.logger.warn(
        `job ${job.id} failed: ${payload.code} ${payload.message}`,
      );
      // Refund the quota that QuotaGuard pre-consumed when this job
      // was submitted. Idempotent via the original idempotencyKey
      // (same key the controller passes to QuotaGuard via the
      // `body:idempotencyKey` decorator option) — repeated terminal
      // failures (e.g. multiple retry attempts hitting markFailed
      // before the user sees it) won't double-refund. We thread the
      // user's tier from the job row so the WS snapshot pushed to
      // the client carries the user's real daily cap (not a
      // sentinel that would over-write the badge with ∞).
      if (job.idempotencyKey) {
        void this.quota.refundFor({
          userId: job.userId,
          tier: normalizeTier(job.userLevel),
          dimension: 'image',
          cost: 1,
          idempotencyKey: job.idempotencyKey,
          reason: `ai_job_failed_${payload.code}`,
        });
      }
    }
  }

  private async uploadOutputs(
    job: AiJob,
    raws: RawProviderOutput[],
  ): Promise<AiJobOutput[]> {
    const created = new Date(job.createdAt);
    const yyyy = created.getUTCFullYear();
    const mm = String(created.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(created.getUTCDate()).padStart(2, '0');

    const out: AiJobOutput[] = [];
    for (const raw of raws) {
      let body = raw.buffer;
      if (!body && raw.providerUrl) {
        body = await this.fetchProviderBytes(raw.providerUrl);
      }
      if (!body) {
        throw new Error(`no bytes available for output index ${raw.index}`);
      }
      const hash = createHash('sha256').update(body).digest('hex').slice(0, 12);
      // Storage key prefix is the historical container name; safe to
      // keep even as more providers land (`foundry-outputs` is just
      // the container, not a provider-specific path).
      const key = `${job.provider}/${yyyy}/${mm}/${dd}/${job.userId}/${job.id}/${raw.index}-${hash}.${raw.ext}`;
      const result = await this.storage.upload({
        body,
        key,
        contentType: raw.mimeType,
        filename: `${job.id}-${raw.index}.${raw.ext}`,
      });
      out.push({
        // Short app-generated ID. Idempotent recovery on retry is via
        // `(jobId, outputIndex)` unique + repository.replaceOutputs
        // transactional DELETE + INSERT.
        id: newShortId(),
        type: 'image',
        url: result.url,
        storagePath: result.storagePath,
        width: raw.width,
        height: raw.height,
        mimeType: raw.mimeType,
        bytes: result.bytes,
        createdAt: new Date().toISOString(),
      });
    }
    return out;
  }

  private async fetchProviderBytes(url: string): Promise<Buffer> {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`provider URL fetch failed: HTTP ${res.status}`);
    }
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  }

  private emit(job: AiJob) {
    // Outbox-mediated emit — durable record + optimistic publish.
    void this.outbox.record(job);
  }
}
