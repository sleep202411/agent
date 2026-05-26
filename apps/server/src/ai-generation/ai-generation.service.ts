import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { AuthUser } from '../auth';
import { newShortId } from '../common/id';
import { GeoPolicyService, type RequestGeoContext } from '../common/region';
import { QuotaService } from '../quota/quota.service';
import type { QuotaDimension } from '../quota/quota.types';
import { normalizeTier, type Tier } from '../quota/tiers.config';
import { AiGenerationAuthzService } from './authz.service';
import { AiGenerationEtaService } from './eta.service';
import {
  AiGenerationRepository,
  type ReserveQueuedJobResult,
} from './repository';
import { AiGenerationOutboxService } from './outbox.service';
import { ProviderRegistry } from './provider-registry.service';
import { AiGenerationQueueService } from './queue.service';
import { AiGenerationRoutingService } from './routing.service';
import { AiGenerationValidatorService } from './validator.service';
import { AI_MODEL_PROTOCOL_DIALECT } from './types';
import type {
  AiModelCatalogResponse,
  AiJob,
  AiJobListQuery,
  AiJobLog,
  AiStatusResponse,
  AiRoutingSnapshot,
  AiSubmitJobBody,
  AiSubmitResponse,
} from './types';

const TERMINAL_STATUSES = new Set([
  'completed',
  'failed',
  'cancelled',
  'expired',
]);

interface QuotaRefundToken {
  userId: string;
  tier: Tier;
  dimension: QuotaDimension;
  cost: number;
  idempotencyKey: string;
}

@Injectable()
export class AiGenerationService {
  private readonly logger = new Logger(AiGenerationService.name);

  constructor(
    private readonly providers: ProviderRegistry,
    private readonly authz: AiGenerationAuthzService,
    private readonly validator: AiGenerationValidatorService,
    private readonly store: AiGenerationRepository,
    private readonly eta: AiGenerationEtaService,
    private readonly outbox: AiGenerationOutboxService,
    private readonly queue: AiGenerationQueueService,
    private readonly routing: AiGenerationRoutingService,
    private readonly quota: QuotaService,
    private readonly geoPolicy: GeoPolicyService,
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

  async listModels(user: AuthUser, geo?: RequestGeoContext) {
    // Fan out across every registered provider. Each adapter returns
    // its own model definitions; we concat and stamp per-user access.
    const results = await Promise.all(
      this.providers.list().map((adapter) => adapter.listModels()),
    );
    const models = results.flat();
    return models.map((model) => {
      const access = this.authz.decideModelAccess(user, model);
      const geoDecision = geo
        ? this.geoPolicy.evaluate(model.region_policy, geo)
        : { allowed: true };
      return {
        ...model,
        enabled: model.enabled && geoDecision.allowed,
        disabledReason:
          model.disabledReason ??
          (!geoDecision.allowed ? geoDecision.reason : undefined),
        access: {
          ...access,
          allowed: access.allowed && geoDecision.allowed,
          reason: access.reason ?? geoDecision.reason,
        },
      };
    });
  }

  async listCatalog(
    user: AuthUser,
    geo?: RequestGeoContext,
  ): Promise<AiModelCatalogResponse> {
    const models = await this.listModels(user, geo);
    const presets = this.routing.listPresets(models, geo);
    return {
      dialect: AI_MODEL_PROTOCOL_DIALECT,
      version: '2026-05-26',
      region: process.env.NEXT_PUBLIC_SITE_REGION ?? 'global',
      context: geo ? this.geoPolicy.snapshot(geo) : undefined,
      presets,
      campaigns: this.routing.listCampaigns(),
      models,
    };
  }

  async submitJob(
    user: AuthUser,
    body: AiSubmitJobBody,
    geo?: RequestGeoContext,
  ): Promise<AiSubmitResponse> {
    const now = new Date().toISOString();
    const decision = await this.routing.resolve({ user, body, now, geo });
    const { model, provider, snapshot } = decision;

    if (!model.enabled) {
      throw new ServiceUnavailableException({
        code: 'PROVIDER_NOT_CONFIGURED',
        msg: model.disabledReason ?? 'AI generation is not available.',
      });
    }

    // Per-model tier gate. UI is supposed to keep locked models
    // un-clickable, but never trust the client.
    this.authz.assertCanUseModel(user, model);

    if (body.schemaVersion !== model.schemaVersion) {
      throw new ConflictException({
        code: 'SCHEMA_VERSION_MISMATCH',
        msg: 'The AI model schema changed. Refresh and try again.',
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
    const rawPrompt = normalizedInput.prompt;
    const prompt = typeof rawPrompt === 'string' ? rawPrompt.trim() : '';
    const idempotencyKey = body.idempotencyKey?.trim() || randomUUID();

    const existing = await this.store.findByIdempotency(
      user.userId,
      model.id,
      idempotencyKey,
    );
    if (existing) return this.toSubmitResponse(existing);

    const quotaRefund = await this.consumeQuotaIfNeeded(
      user,
      snapshot,
      idempotencyKey,
    );

    // Generated app-side so we know the id before insert — needed to
    // enqueue BullMQ + emit the optimistic queued push before save()
    // resolves. Keep it short because this id appears in URLs/logs.
    const id = newShortId();
    const queueName = snapshot.policy.concurrency.queueName;
    let reservation: ReserveQueuedJobResult;
    try {
      reservation = await this.store.reserveQueuedJob({
        userId: user.userId,
        modelId: model.id,
        idempotencyKey,
        queueName,
        type: model.type,
        perUserQueued: snapshot.policy.concurrency.perUserQueued,
        perUserRunning: snapshot.policy.concurrency.perUserRunning,
        campaignLimit: this.campaignLimitFor(snapshot),
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
            routingSnapshot: snapshot,
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
    } catch (err) {
      await this.refundQuotaIfNeeded(quotaRefund, 'ai_job_reserve_failed');
      throw err;
    }

    if (reservation.kind === 'existing') {
      await this.refundQuotaIfNeeded(
        quotaRefund,
        'ai_job_duplicate_submission',
      );
      return this.toSubmitResponse(reservation.job);
    }
    if (reservation.kind === 'queued_limit') {
      await this.refundQuotaIfNeeded(quotaRefund, 'ai_job_queue_limit');
      throw new ConflictException({
        code: 'QUEUE_LIMIT_EXCEEDED',
        msg: `You can queue up to ${reservation.limit} generation task(s).`,
      });
    }
    if (reservation.kind === 'running_limit') {
      await this.refundQuotaIfNeeded(quotaRefund, 'ai_job_running_limit');
      throw new ConflictException({
        code: 'RATE_LIMITED',
        msg: `You can run up to ${reservation.limit} ${reservation.type} generation task(s) at once.`,
      });
    }
    if (reservation.kind === 'campaign_limit') {
      await this.refundQuotaIfNeeded(quotaRefund, 'ai_job_campaign_limit');
      throw new HttpException(
        {
          code: 'CAMPAIGN_LIMIT_EXCEEDED',
          campaignId: reservation.campaignId,
          scope: reservation.scope,
          limit: reservation.limit,
          msg:
            reservation.scope === 'user'
              ? 'You have used all free generations for this campaign.'
              : 'This campaign has reached its generation limit.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const job = reservation.job;
    // Hand off to BullMQ. The worker reads the canonical row from DB
    // when it picks the message up, so the payload is just the jobId.
    // Priority is frozen in the routing snapshot so later tier/config
    // edits don't reshuffle jobs already accepted into the queue.
    const priority = snapshot.policy.tier.queuePriority;
    try {
      await this.queue.enqueue(queueName, id, 0, priority);
    } catch (err) {
      await this.refundQuotaIfNeeded(quotaRefund, 'ai_job_enqueue_failed');
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

  private async consumeQuotaIfNeeded(
    user: AuthUser,
    snapshot: AiRoutingSnapshot,
    idempotencyKey: string,
  ): Promise<QuotaRefundToken | null> {
    const policy = snapshot.policy.quota;
    if (policy.mode !== 'charge' || policy.cost <= 0) return null;

    const tier = normalizeTier(user.userLevel);
    const dimension = policy.dimension as QuotaDimension;
    const result = await this.quota.consume({
      userId: user.userId,
      tier,
      dimension,
      cost: policy.cost,
      idempotencyKey,
      reason: policy.reason,
      metadata: {
        routeId: snapshot.routeId,
        presetId: snapshot.presetId,
        selectedProvider: snapshot.selectedProvider,
        selectedModelId: snapshot.selectedModelId,
        strategy: snapshot.strategy,
        campaignId: policy.campaignId,
      },
    });

    if (!result.ok) {
      throw new HttpException(
        {
          code: 429,
          error: result.reason,
          dimension: result.dimension,
          used: result.used,
          limit: result.limit,
          resetAt: result.resetAt,
          nextTier: result.nextTier,
          nextTierLimit: result.nextTierLimit,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (result.deduped) return null;
    return {
      userId: user.userId,
      tier,
      dimension,
      cost: policy.cost,
      idempotencyKey,
    };
  }

  private campaignLimitFor(snapshot: AiRoutingSnapshot):
    | {
        campaignId: string;
        perUserLimit?: number;
        totalLimit?: number;
      }
    | undefined {
    const campaign = snapshot.policy.quota.campaign;
    const campaignId = campaign?.id ?? snapshot.policy.quota.campaignId;
    if (!campaignId) return undefined;
    if (campaign?.perUserLimit == null && campaign?.totalLimit == null) {
      return undefined;
    }
    return {
      campaignId,
      perUserLimit: campaign.perUserLimit,
      totalLimit: campaign.totalLimit,
    };
  }

  private async refundQuotaIfNeeded(
    token: QuotaRefundToken | null,
    reason: string,
  ): Promise<void> {
    if (!token) return;
    await this.quota.refundFor({
      userId: token.userId,
      tier: token.tier,
      dimension: token.dimension,
      cost: token.cost,
      idempotencyKey: token.idempotencyKey,
      reason,
    });
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

    await this.cancelProviderJobIfNeeded(job);

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

  async retryJob(
    user: AuthUser,
    id: string,
    geo?: RequestGeoContext,
  ): Promise<AiSubmitResponse> {
    const job = await this.getOwnedJob(user, id);
    return this.submitJob(
      user,
      {
        modelId: job.modelId,
        presetId: job.routingSnapshot?.presetId,
        campaignId: job.routingSnapshot?.policy.quota.campaignId,
        schemaVersion: job.schemaVersion,
        input: job.normalizedInput,
        idempotencyKey: randomUUID(),
      },
      geo,
    );
  }

  private async cancelProviderJobIfNeeded(job: AiJob): Promise<void> {
    if (!job.providerJobId) return;
    const provider = job.routingSnapshot?.selectedProvider ?? job.provider;
    try {
      const adapter = this.providers.get(provider);
      if (!adapter.cancelGeneration) return;
      await adapter.cancelGeneration(job.providerJobId);
    } catch (err) {
      this.logger.warn(
        `provider cancel failed for job ${job.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
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
      status_url: `/aurora/ai/jobs/${job.id}/status`,
      cancel_url: `/aurora/ai/jobs/${job.id}/cancel`,
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
      response_url: `/aurora/ai/jobs/${job.id}`,
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
      routing: job.routingSnapshot
        ? {
            presetId: job.routingSnapshot.presetId,
            routeId: job.routingSnapshot.routeId,
            strategy: job.routingSnapshot.strategy,
            quota: job.routingSnapshot.policy.quota,
          }
        : null,
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
