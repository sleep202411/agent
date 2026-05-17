/**
 * Foundry worker — subscribes to the BullMQ queues, dispatches each
 * job to the synchronous provider call, uploads the resulting bytes
 * to OSS, and emits Web PubSub pushes at every state transition.
 *
 * The queue (Redis + BullMQ) replaces the earlier setInterval/in-memory
 * polling: multi-pod safe (BullMQ owns the lock), restart-safe (jobs
 * survive in Redis), retry-safe (we requeue with a future delay via
 * `queue.add(..., { delay })`).
 *
 * Image only for now — video lands later (different lifecycle: the
 * provider returns a job id we poll on, not a synchronous response).
 */
import {
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { Worker, Job as BullJob } from 'bullmq';
import { createHash, randomUUID } from 'crypto';
import { OutputStorageService } from '../infra/storage/storage.types';
import { AiGenerationRepository } from './repository';
import { AiGenerationOutboxService } from './outbox.service';
import { mapFoundryProviderRequest } from './providers/foundry/request.mapper';
import {
  createAiWorker,
  AI_QUEUE_IMAGE,
  AI_QUEUE_VIDEO,
  type AiQueueJobData,
  type AiQueueName,
} from './queue';
import { AiGenerationQueueService } from './queue.service';
import { FoundrySchemaRegistry } from './providers/foundry/schema.registry';
import type { AiJob, AiJobError, AiJobOutput } from './types';

// gpt-image-2 image generation: low ≈ 80s, medium ≈ 100s, high can
// stretch well over 180s. Give it room before we declare timeout.
const PROVIDER_TIMEOUT_MS = 240_000;
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
// low for image so we don't saturate Azure's RPM.
const IMAGE_WORKER_CONCURRENCY = 4;
const VIDEO_WORKER_CONCURRENCY = 2;

interface ProviderImageResponse {
  data?: Array<{ b64_json?: string; url?: string }>;
}

interface RawOutput {
  index: number;
  buffer?: Buffer;
  providerUrl?: string;
  mimeType: string;
  ext: string;
  width?: number;
  height?: number;
}

class ProviderError extends Error {
  constructor(public readonly errorPayload: AiJobError) {
    super(errorPayload.message);
  }
}

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
  private readonly baseUrl: string | null;
  private readonly apiKey: string | null;
  private readonly workers: Worker<AiQueueJobData>[] = [];
  private readonly inflight = new Map<string, Promise<void>>();

  constructor(
    private readonly store: AiGenerationRepository,
    private readonly registry: FoundrySchemaRegistry,
    private readonly outbox: AiGenerationOutboxService,
    private readonly storage: OutputStorageService,
    private readonly queueService: AiGenerationQueueService,
  ) {
    this.baseUrl =
      (process.env.AZURE_OPENAI_BASE_URL ?? '').replace(/\/+$/, '') || null;
    this.apiKey = process.env.AZURE_OPENAI_API_KEY ?? null;
  }

  onApplicationBootstrap() {
    if (!this.baseUrl || !this.apiKey) {
      this.logger.warn(
        'AZURE_OPENAI_BASE_URL / AZURE_OPENAI_API_KEY unset — AiGenerationWorker is a no-op',
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
      `AiGenerationWorker subscribed to BullMQ (image concurrency=${IMAGE_WORKER_CONCURRENCY}, video=${VIDEO_WORKER_CONCURRENCY})`,
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
    if (dbJob.status !== 'IN_QUEUE') {
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
      status: 'IN_PROGRESS',
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
    try {
      if (job.type !== 'image') {
        throw providerError(
          'VALIDATION_ERROR',
          'Only image jobs are supported yet.',
        );
      }
      const model = await this.registry.getModel(job.modelId);
      if (!model) {
        throw providerError(
          'VALIDATION_ERROR',
          `Model ${job.modelId} not found.`,
        );
      }

      const mapped = mapFoundryProviderRequest(model, job.normalizedInput, {
        userId: job.userId,
      });
      // The schema doesn't carry `model` (it identifies the deployment,
      // not a user-facing field). Inject it here so Azure routes the
      // request to the correct deployment.
      mapped.body.model = model.deployment;

      const url = this.resolveProviderUrl(mapped.endpoint);
      // The schema declares `multipart/form-data` for gpt-image-2 at
      // the binding level, but Azure's `images.generations` only reads
      // `model` from a JSON body (multipart fields are ignored, which
      // triggers `NoModelName`). Only `images.edits` actually needs
      // multipart (it uploads image files). Decide per endpoint here
      // rather than reshape the schema for every model.
      const contentType: 'application/json' | 'multipart/form-data' =
        mapped.endpoint === 'images.edit'
          ? 'multipart/form-data'
          : 'application/json';

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: this.buildHeaders(contentType, model.deployment),
          body: this.buildBody(contentType, mapped.body),
          signal: controller.signal,
        });
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          throw providerError(
            'PROVIDER_TIMEOUT',
            `provider timed out after ${PROVIDER_TIMEOUT_MS}ms`,
          );
        }
        throw providerError(
          'UNKNOWN',
          err instanceof Error ? err.message : 'provider fetch failed',
        );
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        const raw = await response.text().catch(() => '');
        throw providerError(
          response.status === 429
            ? 'PROVIDER_429'
            : response.status >= 500
              ? 'PROVIDER_5XX'
              : 'VALIDATION_ERROR',
          `provider HTTP ${response.status}: ${raw.slice(0, 400)}`,
          response.status === 429
            ? 'The image service is busy. Please try again in a moment.'
            : response.status >= 500
              ? 'The image service is temporarily unavailable.'
              : 'The image request was rejected.',
        );
      }

      // Provider returned a payload — start the fetch_output stage so
      // the UI can show a different label between "calling provider"
      // and "moving bytes around".
      const fetched = await this.store.update(job.id, {
        stage: 'fetching_output',
        progress: 0.85,
        outputFetchedAt: new Date().toISOString(),
      });
      if (fetched) this.emit(fetched);

      const body = (await response.json()) as ProviderImageResponse;
      const rawOutputs = this.collectRawOutputs(job, body);
      if (rawOutputs.length === 0) {
        throw providerError('UNKNOWN', 'Provider returned no image outputs.');
      }

      // Upload to OSS before completing. completed must never reference
      // base64 data URLs or provider-temp URLs.
      const uploading = await this.store.update(job.id, {
        stage: 'uploading_to_oss',
        progress: 0.92,
      });
      if (uploading) this.emit(uploading);

      const outputs = await this.uploadOutputs(job, rawOutputs);

      const now = new Date().toISOString();
      const completed = await this.store.update(job.id, {
        status: 'COMPLETED',
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
    } catch (err) {
      const payload =
        err instanceof ProviderError
          ? err.errorPayload
          : ({
              code: 'UNKNOWN' as const,
              message:
                err instanceof Error ? err.message : 'Unknown worker error.',
              userMessage: 'Generation failed. Please try again.',
              retryable: true,
              createdAt: new Date().toISOString(),
            } satisfies AiJobError);

      // Auto-requeue transient provider errors (429 EngineOverloaded
      // dominates here). The job goes back to IN_QUEUE so the next
      // worker tick picks it up; backoff is enforced by stamping a
      // future `queuedAt` so the queue ordering naturally waits.
      const attempt = job.attempt + 1;
      const backoffIdx = Math.min(
        job.attempt - 1,
        RETRY_BACKOFFS_MS.length - 1,
      );
      const shouldRetry =
        RETRYABLE_CODES.has(payload.code) &&
        attempt <= RETRY_BACKOFFS_MS.length;

      if (shouldRetry) {
        const delayMs = RETRY_BACKOFFS_MS[backoffIdx];
        const reQueuedAt = new Date(Date.now() + delayMs).toISOString();
        const requeued = await this.store.update(job.id, {
          status: 'IN_QUEUE',
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
          // BullMQ jobIds are unique, but the previous job entry has
          // already moved past `process` (we got here from its
          // processor). A fresh `add` with the same jobId is fine —
          // BullMQ rejects only if the previous job is still active.
          await this.queueService.enqueue(job.queueName, job.id, delayMs);
          this.emit(requeued);
          this.logger.log(
            `job ${job.id} requeued after ${payload.code} (attempt ${attempt}, delay ${Math.round(delayMs / 1000)}s)`,
          );
        }
        return;
      }

      const now = new Date().toISOString();
      const failed = await this.store.update(job.id, {
        status: 'FAILED',
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
      }
    }
  }

  private resolveProviderUrl(endpoint: string): string {
    // The schema names endpoints by their OpenAI-SDK method (e.g.
    // `images.generate`). Translate to the HTTP path under
    // AZURE_OPENAI_BASE_URL (which already includes `/openai/v1`).
    const path = (() => {
      switch (endpoint) {
        case 'images.generate':
          return '/images/generations';
        case 'images.edit':
          return '/images/edits';
        case 'videos.create':
          return '/videos/generations/jobs';
        default:
          return `/${endpoint.replace(/\./g, '/')}`;
      }
    })();
    return `${this.baseUrl}${path}`;
  }

  private buildHeaders(
    contentType: 'application/json' | 'multipart/form-data',
    deployment: string,
  ): Record<string, string> {
    // Azure OpenAI accepts both `api-key` and `Authorization: Bearer`.
    // Send both — harmless and covers either gateway flavour.
    // `x-ms-model-mesh-model-name` is the Azure model-router fallback
    // when body parsing misses the model (e.g. multipart edits).
    const headers: Record<string, string> = {
      'api-key': this.apiKey!,
      Authorization: `Bearer ${this.apiKey}`,
      'x-ms-model-mesh-model-name': deployment,
    };
    if (contentType === 'application/json') {
      headers['Content-Type'] = 'application/json';
    }
    // multipart: leave Content-Type unset so fetch + FormData inject
    // the multipart boundary correctly.
    return headers;
  }

  private buildBody(
    contentType: 'application/json' | 'multipart/form-data',
    payload: Record<string, unknown>,
  ): BodyInit {
    if (contentType === 'application/json') {
      return JSON.stringify(payload);
    }
    const form = new FormData();
    for (const [key, value] of Object.entries(payload)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const item of value) form.append(`${key}[]`, String(item));
      } else if (typeof value === 'object') {
        form.append(key, JSON.stringify(value));
      } else {
        form.append(key, String(value));
      }
    }
    return form;
  }

  private collectRawOutputs(
    job: AiJob,
    body: ProviderImageResponse,
  ): RawOutput[] {
    const items = Array.isArray(body?.data) ? body.data : [];
    const size =
      typeof job.normalizedInput.size === 'string'
        ? (job.normalizedInput.size as string)
        : null;
    const { width, height } = parseSize(size);
    const collected: RawOutput[] = [];
    items.forEach((item, i) => {
      if (item.b64_json) {
        collected.push({
          index: i,
          buffer: Buffer.from(item.b64_json, 'base64'),
          mimeType: 'image/png',
          ext: 'png',
          width,
          height,
        });
        return;
      }
      // Provider returned a URL instead of bytes. Defer to upload phase
      // — uploadOutputs will fetch it then re-upload to our OSS so the
      // completed output never points outside our infra.
      if (item.url) {
        collected.push({
          index: i,
          providerUrl: item.url,
          mimeType: 'image/png',
          ext: 'png',
          width,
          height,
        });
      }
    });
    return collected;
  }

  private async uploadOutputs(
    job: AiJob,
    raws: RawOutput[],
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
        throw providerError(
          'UNKNOWN',
          `no bytes available for output index ${raw.index}`,
        );
      }
      const hash = createHash('sha256').update(body).digest('hex').slice(0, 12);
      const key = `foundry/${yyyy}/${mm}/${dd}/${job.userId}/${job.id}/${raw.index}-${hash}.${raw.ext}`;
      try {
        const result = await this.storage.upload({
          body,
          key,
          contentType: raw.mimeType,
          filename: `${job.id}-${raw.index}.${raw.ext}`,
        });
        out.push({
          // ID generated by Prisma `@default(uuid())`. Idempotent
          // recovery on retry is now via the `(jobId, outputIndex)`
          // unique constraint + the upstream `replaceOutputs` which
          // does DELETE + INSERT in a transaction, so re-running an
          // attempt overwrites cleanly without ID collisions.
          id: randomUUID(),
          type: 'image',
          url: result.url,
          storagePath: result.storagePath,
          width: raw.width,
          height: raw.height,
          mimeType: raw.mimeType,
          bytes: result.bytes,
          createdAt: new Date().toISOString(),
        });
      } catch (err) {
        throw providerError(
          'OSS_UPLOAD_FAILED',
          err instanceof Error ? err.message : 'OSS upload failed',
          'We generated your image but failed to save it. Please try again.',
        );
      }
    }
    return out;
  }

  private async fetchProviderBytes(url: string): Promise<Buffer> {
    const res = await fetch(url);
    if (!res.ok) {
      throw providerError(
        'OUTPUT_EXPIRED',
        `provider URL fetch failed: HTTP ${res.status}`,
      );
    }
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  }

  private emit(job: AiJob) {
    // Outbox-mediated emit — durable record + optimistic publish.
    void this.outbox.record(job);
  }
}

function providerError(
  code: AiJobError['code'],
  message: string,
  userMessage = 'Generation failed. Please try again.',
): ProviderError {
  return new ProviderError({
    code,
    message,
    userMessage,
    retryable: [
      'PROVIDER_429',
      'PROVIDER_5XX',
      'PROVIDER_TIMEOUT',
      'UNKNOWN',
    ].includes(code),
    createdAt: new Date().toISOString(),
  });
}

function parseSize(size: string | null): {
  width?: number;
  height?: number;
} {
  if (!size || size === 'auto') return {};
  const m = size.match(/^(\d+)x(\d+)$/i);
  if (!m) return {};
  return { width: Number(m[1]), height: Number(m[2]) };
}
