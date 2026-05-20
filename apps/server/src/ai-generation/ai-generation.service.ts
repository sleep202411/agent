import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { AuthUser } from '../auth';
import { newShortId } from '../common/id';
import { TIERS, normalizeTier } from '../quota/tiers.config';
import { AiGenerationAuthzService } from './authz.service';
import { AiGenerationEtaService } from './eta.service';
import { AiGenerationRepository } from './repository';
import { AiGenerationOutboxService } from './outbox.service';
import type { AiModelDefinition } from './provider-adapter';
import { ProviderRegistry } from './provider-registry.service';
import { AiGenerationQueueService } from './queue.service';
import { AiGenerationValidatorService } from './validator.service';
import type {
  AiJob,
  AiJobListQuery,
  AiJobLog,
  AiStatusResponse,
  AiSubmitJobBody,
  AiSubmitResponse,
} from './types';

const TERMINAL_STATUSES = new Set([
  'completed',
  'failed',
  'cancelled',
  'expired',
]);

@Injectable()
export class AiGenerationService {
  constructor(
    private readonly providers: ProviderRegistry,
    private readonly authz: AiGenerationAuthzService,
    private readonly validator: AiGenerationValidatorService,
    private readonly store: AiGenerationRepository,
    private readonly eta: AiGenerationEtaService,
    private readonly outbox: AiGenerationOutboxService,
    private readonly queue: AiGenerationQueueService,
  ) {}

  /**
   * Fire-and-forget realtime push for any job state transition. Built
   * on the Assets hub so callers from other modules (future video
   * worker, audio worker, etc.) can publish through the same channel
   * with their own `kind`.
   */
  private emitJobUpdate(job: AiJob): void {
    // Outbox-mediated emit: writes a durable row first, attempts an
    // immediate Web PubSub publish, and the dispatcher retries on
    // failure. Callers stay synchronous-fire-and-forget.
    void this.outbox.record(job);
  }

  /**
   * Fan out queue-position pushes after a recompute. Skips the job
   * that triggered the recompute (it gets its own emit alongside the
   * primary state change) so users don't see two pushes for the same
   * change in the same tick.
   */
  private emitRepositioned(jobs: AiJob[], skipJobId?: string): void {
    for (const job of jobs) {
      if (job.id === skipJobId) continue;
      this.emitJobUpdate(job);
    }
  }

  async listModels(user: AuthUser) {
    // Fan out across every registered provider. Each adapter returns
    // its own model definitions; we concat and stamp per-user access.
    const results = await Promise.all(
      this.providers.list().map((adapter) => adapter.listModels()),
    );
    const models = results.flat();
    return models.map((model) => ({
      ...model,
      access: this.authz.decideModelAccess(user, model),
    }));
  }

  /**
   * Look up a model by id across all providers. Returns the first
   * match; model ids are unique per provider so collisions shouldn't
   * happen (Foundry uses `foundry/<deployment>`, fal will use
   * `fal-ai/<model-path>`).
   */
  private async findModel(modelId: string): Promise<{
    model: AiModelDefinition;
    provider: string;
  } | null> {
    for (const adapter of this.providers.list()) {
      const model = await adapter.getModel(modelId);
      if (model) return { model, provider: adapter.provider };
    }
    return null;
  }

  async submitJob(
    user: AuthUser,
    body: AiSubmitJobBody,
  ): Promise<AiSubmitResponse> {
    const modelId = body.modelId?.trim();
    if (!modelId) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        msg: 'modelId is required.',
      });
    }

    const found = await this.findModel(modelId);
    if (!found) {
      throw new NotFoundException({
        code: 'MODEL_NOT_FOUND',
        msg: 'Model not found.',
      });
    }
    const { model, provider } = found;

    if (!model.enabled) {
      throw new ServiceUnavailableException({
        code: 'PROVIDER_NOT_CONFIGURED',
        msg: model.disabledReason ?? 'Foundry execution is not available.',
      });
    }

    // Per-model tier gate. UI is supposed to keep locked models
    // un-clickable, but never trust the client.
    this.authz.assertCanUseModel(user, model);

    if (body.schemaVersion !== model.schemaVersion) {
      throw new ConflictException({
        code: 'SCHEMA_VERSION_MISMATCH',
        msg: 'The Foundry model schema changed. Refresh and try again.',
      });
    }

    const input =
      body.input && typeof body.input === 'object' ? body.input : {};
    const normalizedInput = this.validator.normalizeInput(
      model.input_schema,
      input,
    );
    // Per-option tier gate (e.g. resolution_tier=uhd needs VIP2).
    // Server-side enforcement; the UI already gates these.
    this.authz.assertCanUseOptions(user, model, normalizedInput);
    const prompt = String(normalizedInput.prompt ?? '').trim();
    const idempotencyKey = body.idempotencyKey?.trim() || randomUUID();

    const now = new Date().toISOString();
    // Generated app-side so we know the id before insert — needed to
    // enqueue BullMQ + emit the optimistic queued push before save()
    // resolves. Keep it short because this id appears in URLs/logs.
    const id = newShortId();
    const queueName = model.queue.queueName;
    const reservation = await this.store.reserveQueuedJob({
      userId: user.userId,
      modelId: model.id,
      idempotencyKey,
      queueName,
      type: model.type,
      perUserQueued: model.queue.perUserQueued,
      perUserRunning: model.queue.perUserRunning,
      buildJob: (queuePosition) => {
        const estimate = this.eta.estimateForNewJob(
          model,
          normalizedInput,
          queuePosition,
        );
        const logs: AiJobLog[] = [
          {
            time: now,
            stage: 'queued',
            message: 'Request accepted and waiting for a generation slot.',
          },
        ];

        return {
          id,
          userId: user.userId,
          userLevel: user.userLevel ?? null,
          type: model.type,
          // `provider` is the adapter key (e.g. 'microsoft-foundry');
          // `model.provider` happens to be the same Foundry string today
          // but that's a coincidence — the adapter is the source of truth.
          provider,
          modelId: model.id,
          deployment: model.deployment,
          schemaVersion: model.schemaVersion,
          status: 'in_queue',
          stage: 'queued',
          input,
          normalizedInput,
          prompt,
          idempotencyKey,
          outputs: [],
          logs,
          queueName,
          queuePosition,
          progress: null,
          estimatedWaitSeconds: estimate.estimatedWaitSeconds,
          estimatedRunSeconds: estimate.estimatedRunSeconds,
          estimatedTotalSeconds: estimate.estimatedTotalSeconds,
          etaConfidence: estimate.etaConfidence,
          attempt: 1,
          createdAt: now,
          queuedAt: now,
          updatedAt: now,
          metrics: {},
        };
      },
    });

    if (reservation.kind === 'existing') {
      return this.toSubmitResponse(reservation.job);
    }
    if (reservation.kind === 'queued_limit') {
      throw new ConflictException({
        code: 'QUEUE_LIMIT_EXCEEDED',
        msg: `You can queue up to ${reservation.limit} generation task(s).`,
      });
    }
    if (reservation.kind === 'running_limit') {
      throw new ConflictException({
        code: 'RATE_LIMITED',
        msg: `You can run up to ${reservation.limit} ${reservation.type} generation task(s) at once.`,
      });
    }

    const job = reservation.job;
    // Hand off to BullMQ. The worker reads the canonical row from DB
    // when it picks the message up, so the payload is just the jobId.
    // Priority is derived from the user's tier so VIP3 submissions
    // jump to the front of a contended image queue — see TIERS in
    // src/quota/tiers.config.ts for the full mapping.
    const priority = TIERS[normalizeTier(user.userLevel)].priority;
    try {
      await this.queue.enqueue(queueName, id, 0, priority);
    } catch (err) {
      const failed = await this.store.update(id, {
        status: 'failed',
        stage: 'failed',
        completedAt: new Date().toISOString(),
        error: {
          code: 'QUEUE_UNAVAILABLE',
          message: err instanceof Error ? err.message : String(err),
          userMessage:
            'Generation queue is temporarily unavailable. Please try again in a moment.',
          retryable: true,
          createdAt: new Date().toISOString(),
        },
      });
      if (failed) this.emitJobUpdate(failed);
      throw new ServiceUnavailableException({
        code: 'QUEUE_UNAVAILABLE',
        msg: 'Generation queue is temporarily unavailable. Please try again in a moment.',
      });
    }
    const saved = (await this.store.findById(id)) ?? job;
    this.emitJobUpdate(saved);
    this.emitRepositioned(reservation.repositioned, saved.id);
    return this.toSubmitResponse(saved);
  }

  async listJobs(user: AuthUser, query: AiJobListQuery) {
    const limit = query.limit ? Number(query.limit) : 50;
    const jobs = await this.store.listForUser({
      userId: user.userId,
      type: query.type,
      limit: Number.isFinite(limit) ? limit : 50,
    });
    return {
      jobs: jobs.map((job) => this.publicJob(job)),
      nextCursor: null,
    };
  }

  async getJob(user: AuthUser, id: string) {
    const job = await this.getOwnedJob(user, id);
    return this.publicJob(job, { detail: true });
  }

  async getStatus(user: AuthUser, id: string): Promise<AiStatusResponse> {
    const job = await this.getOwnedJob(user, id);
    return this.toStatusResponse(job);
  }

  async cancelJob(user: AuthUser, id: string) {
    const job = await this.getOwnedJob(user, id);
    if (TERMINAL_STATUSES.has(job.status))
      return this.publicJob(job, { detail: true });

    const now = new Date().toISOString();
    const next = await this.store.update(id, {
      status: 'cancelled',
      stage: 'cancelled',
      completedAt: now,
      queuePosition: null,
      logs: [
        ...job.logs,
        {
          time: now,
          stage: 'cancelled',
          message: 'Cancelled by user.',
        },
      ],
      error: {
        code: 'CANCELLED_BY_USER',
        message: 'Cancelled by user.',
        userMessage: 'This generation was cancelled.',
        retryable: true,
        createdAt: now,
      },
    });
    const repositioned = await this.store.recomputeQueuePositions(
      job.queueName,
    );
    const updated = next ?? job;
    this.emitJobUpdate(updated);
    this.emitRepositioned(repositioned, updated.id);
    return this.publicJob(updated, { detail: true });
  }

  async retryJob(user: AuthUser, id: string): Promise<AiSubmitResponse> {
    const job = await this.getOwnedJob(user, id);
    return this.submitJob(user, {
      modelId: job.modelId,
      schemaVersion: job.schemaVersion,
      input: job.normalizedInput,
      idempotencyKey: randomUUID(),
    });
  }

  private async getOwnedJob(user: AuthUser, id: string): Promise<AiJob> {
    const job = await this.store.findById(id);
    if (!job || job.userId !== user.userId) {
      throw new NotFoundException({
        code: 'JOB_NOT_FOUND',
        msg: 'Foundry job not found.',
      });
    }
    return job;
  }

  private toSubmitResponse(job: AiJob): AiSubmitResponse {
    return {
      ...this.toStatusResponse(job),
      status_url: `/aurora/foundry/jobs/${job.id}/status`,
      cancel_url: `/aurora/foundry/jobs/${job.id}/cancel`,
    };
  }

  private toStatusResponse(job: AiJob): AiStatusResponse {
    return {
      request_id: job.id,
      status: job.status,
      stage: job.stage,
      progress: job.progress ?? null,
      queue_position: job.queuePosition ?? null,
      estimated_wait_seconds: job.estimatedWaitSeconds ?? null,
      estimated_run_seconds: job.estimatedRunSeconds ?? null,
      estimated_total_seconds: job.estimatedTotalSeconds ?? null,
      eta_confidence: job.etaConfidence ?? 'low',
      logs: job.logs.slice(-20),
      response_url: `/aurora/foundry/jobs/${job.id}`,
    };
  }

  private publicJob(job: AiJob, opts?: { detail?: boolean }) {
    const base = {
      id: job.id,
      request_id: job.id,
      type: job.type,
      provider: job.provider,
      modelId: job.modelId,
      deployment: job.deployment,
      status: job.status,
      stage: job.stage,
      queuePosition: job.queuePosition ?? null,
      progress: job.progress ?? null,
      estimatedWaitSeconds: job.estimatedWaitSeconds ?? null,
      estimatedRunSeconds: job.estimatedRunSeconds ?? null,
      estimatedTotalSeconds: job.estimatedTotalSeconds ?? null,
      etaConfidence: job.etaConfidence ?? 'low',
      prompt: job.prompt,
      // Always include the normalized input so the gallery can render
      // the correct aspect ratio for queued/in-flight cards on reload
      // (output rows don't carry width/height until upload finishes).
      input: job.normalizedInput,
      outputs: job.outputs,
      error: job.error,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      completedAt: job.completedAt,
    };

    if (!opts?.detail) return base;

    return {
      ...base,
      schemaVersion: job.schemaVersion,
      logs: job.logs,
      metrics: job.metrics,
      timings: {
        createdAt: job.createdAt,
        queuedAt: job.queuedAt,
        startedAt: job.startedAt,
        providerSubmittedAt: job.providerSubmittedAt,
        providerStartedAt: job.providerStartedAt,
        providerCompletedAt: job.providerCompletedAt,
        outputFetchedAt: job.outputFetchedAt,
        ossUploadedAt: job.ossUploadedAt,
        completedAt: job.completedAt,
      },
    };
  }
}
