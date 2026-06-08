import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ProjectMemberRole, WorkspaceMemberRole } from '@prisma/client';
import { randomUUID } from 'crypto';
import type { AuthUser } from '../auth';
import { newUuidV7 } from '../common/id';
import { EntitlementService } from '../entitlements';
import { WorkspacesService, WorkspacePermissionService } from '../workspaces';
import { AiGenerationAuthzService } from './authz.service';
import { AiGenerationBillingWalletService } from './billing-wallet.service';
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
import { AiCanonicalCatalogService } from './canonical-catalog.service';
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

interface AiJobContext {
  workspaceId: string;
  projectId?: string;
  documentId?: string;
  documentBlockId?: string;
  sourceSurface?: string;
}

@Injectable()
export class AiGenerationService {
  private readonly logger = new Logger(AiGenerationService.name);

  constructor(
    private readonly providers: ProviderRegistry,
    private readonly catalog: AiCanonicalCatalogService,
    private readonly authz: AiGenerationAuthzService,
    private readonly validator: AiGenerationValidatorService,
    private readonly store: AiGenerationRepository,
    private readonly eta: AiGenerationEtaService,
    private readonly outbox: AiGenerationOutboxService,
    private readonly queue: AiGenerationQueueService,
    private readonly routing: AiGenerationRoutingService,
    private readonly workspaces: WorkspacesService,
    private readonly workspacePermissions: WorkspacePermissionService,
    private readonly entitlements: EntitlementService,
    private readonly billingWallet: AiGenerationBillingWalletService,
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
    // Canonical-model-driven catalog: the control plane is the single
    // source of truth. One AiModelDefinition per active canonical model,
    // assembled from its primary active provider binding (no provider fan-out,
    // no provider-merge). We only stamp per-user access on top.
    const models = await this.catalog.listModels();
    const entitlement = this.entitlements.resolveForUser(user);
    return models.map((model) => {
      const access = this.authz.decideModelAccess(entitlement, model);
      return {
        ...model,
        enabled: model.enabled,
        disabledReason: model.disabledReason,
        access,
      };
    });
  }

  async listCatalog(user: AuthUser): Promise<AiModelCatalogResponse> {
    const models = await this.listModels(user);
    const presets = this.routing.listPresets(models);
    return {
      dialect: AI_MODEL_PROTOCOL_DIALECT,
      version: '2026-05-26',
      region: process.env.NEXT_PUBLIC_SITE_REGION ?? 'global',
      presets,
      campaigns: this.routing.listCampaigns(),
      models,
    };
  }

  async submitJob(
    user: AuthUser,
    body: AiSubmitJobBody,
    workspaceHeaderId?: string,
  ): Promise<AiSubmitResponse> {
    const now = new Date().toISOString();
    const context = await this.resolveJobContext(user, body, workspaceHeaderId);
    const entitlement = this.entitlements.resolveForUser(user, {
      workspaceId: context.workspaceId,
      now,
    });
    const decision = await this.routing.resolve({
      entitlement,
      body,
      now,
    });
    const { model, provider, snapshot } = decision;

    if (!model.enabled) {
      throw new ServiceUnavailableException({
        code: 'PROVIDER_NOT_CONFIGURED',
        msg: model.disabledReason ?? 'AI generation is not available.',
      });
    }

    // Per-model tier gate. UI is supposed to keep locked models
    // un-clickable, but never trust the client.
    this.authz.assertCanUseModel(entitlement, model);

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
    // Per-option plan gate (for example, high-resolution renders).
    // Server-side enforcement; the UI already gates these.
    this.authz.assertCanUseOptions(entitlement, model, normalizedInput);
    const rawPrompt = normalizedInput.prompt;
    const prompt = typeof rawPrompt === 'string' ? rawPrompt.trim() : '';
    const idempotencyKey = body.idempotencyKey?.trim() || randomUUID();

    const existing = await this.store.findByIdempotency(
      user.userId,
      model.id,
      idempotencyKey,
    );
    if (existing) return this.toSubmitResponse(existing);

    // Generated app-side so we know the id before insert — needed to
    // enqueue BullMQ + emit the optimistic queued push before save()
    // resolves. UUIDv7 keeps the durable job id standard, sortable, and
    // audit-friendly across DB, queues, logs, and provider evidence.
    const id = newUuidV7();
    const queueName = snapshot.policy.concurrency.queueName;
    const reservation: ReserveQueuedJobResult =
      await this.store.reserveQueuedJob({
        userId: user.userId,
        modelId: model.id,
        idempotencyKey,
        queueName,
        type: model.type,
        perUserQueued: snapshot.policy.concurrency.perUserQueued,
        perUserRunning: snapshot.policy.concurrency.perUserRunning,
        campaignLimit: this.campaignLimitFor(snapshot),
        beforeCreate: (tx, job) =>
          this.billingWallet.reserveForJobInTransaction({
            tx,
            job,
            requestIdempotencyKey: idempotencyKey,
          }),
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
            entitlementSnapshot: entitlement,
            type: model.type,
            provider,
            modelId: model.id,
            deployment: model.deployment,
            canonicalModelId: snapshot.selectedCanonicalModelId ?? null,
            providerBindingId: snapshot.selectedProviderBindingId ?? null,
            schemaVersion: model.schemaVersion,
            workspaceId: context.workspaceId,
            projectId: context.projectId,
            documentId: context.documentId,
            documentBlockId: context.documentBlockId,
            sourceSurface: context.sourceSurface,
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
    if (reservation.kind === 'campaign_limit') {
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
    await this.recordTraceSafe(job, {
      eventType: 'job_submitted',
      occurredAt: job.queuedAt ?? job.createdAt,
      source: 'internal',
      confidence: 'exact',
      title: 'Submitted',
      description: 'Request accepted and waiting for a generation slot.',
      idempotencyKey: `ai_trace:${job.id}:job_submitted`,
      payload: {
        queueName,
        queuePosition: job.queuePosition,
        sourceSurface: job.sourceSurface,
        modelId: job.modelId,
        selectedProvider: snapshot.selectedProvider,
        selectedDeployment: snapshot.selectedDeployment,
        quotaCost: snapshot.policy.quota.cost,
      },
    });
    // Hand off to BullMQ. The worker reads the canonical row from DB
    // when it picks the message up, so the payload is just the jobId.
    // Priority is frozen in the routing snapshot so later tier/config
    // edits don't reshuffle jobs already accepted into the queue.
    const priority = snapshot.policy.entitlement.queuePriority;
    try {
      await this.queue.enqueue(queueName, id, 0, priority);
    } catch (err) {
      await this.billingWallet.releaseForJob(job, 'ai_job_enqueue_failed');
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

  async listJobs(
    user: AuthUser,
    query: AiJobListQuery,
    workspaceHeaderId?: string,
  ) {
    const limit = query.limit ? Number(query.limit) : 50;
    const scope = await this.resolveListScope(user, query, workspaceHeaderId);
    const jobs = await this.store.listForUser({
      userId: user.userId,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      documentId: scope.documentId,
      includeCollaboratorJobs: Boolean(scope.projectId || scope.documentId),
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
    const job = await this.getEditableJob(user, id);
    if (TERMINAL_STATUSES.has(job.status))
      return this.publicJob(job, { detail: true });

    await this.cancelProviderJobIfNeeded(job);
    await this.billingWallet.releaseForJob(job, 'ai_job_cancelled');

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
    const job = await this.getEditableJob(user, id);
    return this.submitJob(user, {
      modelId: job.modelId,
      presetId: job.routingSnapshot?.presetId,
      campaignId: job.routingSnapshot?.policy.quota.campaignId,
      schemaVersion: job.schemaVersion,
      workspaceId: job.workspaceId ?? undefined,
      projectId: job.projectId ?? undefined,
      documentId: job.documentId ?? undefined,
      documentBlockId: job.documentBlockId ?? undefined,
      sourceSurface: job.sourceSurface ?? undefined,
      input: job.normalizedInput,
      idempotencyKey: randomUUID(),
    });
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

  private async getAccessibleJob(
    user: AuthUser,
    id: string,
    minimumRole: WorkspaceMemberRole,
  ): Promise<AiJob> {
    const job = await this.store.findById(id);
    if (!job) {
      throw new NotFoundException({
        code: 'JOB_NOT_FOUND',
        msg: 'Foundry job not found.',
      });
    }
    if (job.userId === user.userId) return job;

    if (job.projectId) {
      await this.workspacePermissions.requireProjectRole(
        user.userId,
        job.projectId,
        minimumRole === WorkspaceMemberRole.viewer
          ? ProjectMemberRole.viewer
          : ProjectMemberRole.editor,
      );
      return job;
    }

    if (job.workspaceId) {
      await this.workspacePermissions.requireWorkspaceRole(
        user.userId,
        job.workspaceId,
        minimumRole,
      );
      return job;
    }

    throw new NotFoundException({
      code: 'JOB_NOT_FOUND',
      msg: 'Foundry job not found.',
    });
  }

  private async getOwnedJob(user: AuthUser, id: string): Promise<AiJob> {
    return this.getAccessibleJob(user, id, WorkspaceMemberRole.viewer);
  }

  private async getEditableJob(user: AuthUser, id: string): Promise<AiJob> {
    return this.getAccessibleJob(user, id, WorkspaceMemberRole.editor);
  }

  private async resolveJobContext(
    user: AuthUser,
    body: AiSubmitJobBody,
    workspaceHeaderId?: string,
  ): Promise<AiJobContext> {
    const workspaceId = this.resolveWorkspaceScope(
      workspaceHeaderId,
      body.context?.workspaceId ?? body.workspaceId,
    );
    const projectId = body.context?.projectId ?? body.projectId;
    const documentId = body.context?.documentId ?? body.documentId;
    const documentBlockId =
      body.context?.documentBlockId ?? body.documentBlockId;
    const sourceSurface = this.normalizeSourceSurface(
      body.context?.sourceSurface ?? body.sourceSurface,
    );

    if (documentId) {
      const document = await this.workspacePermissions.requireDocumentRole(
        user.userId,
        documentId,
        ProjectMemberRole.editor,
      );
      if (workspaceId && workspaceId !== document.workspaceId) {
        throw new BadRequestException({
          code: 'DOCUMENT_WORKSPACE_MISMATCH',
          msg: 'Document does not belong to the selected workspace.',
        });
      }
      if (projectId && projectId !== document.projectId) {
        throw new BadRequestException({
          code: 'DOCUMENT_PROJECT_MISMATCH',
          msg: 'Document does not belong to the selected project.',
        });
      }
      return {
        workspaceId: document.workspaceId,
        projectId: document.projectId,
        documentId: document.id,
        documentBlockId: this.normalizeDocumentBlockId(documentBlockId),
        sourceSurface,
      };
    }

    if (projectId) {
      const project = await this.workspacePermissions.requireProjectRole(
        user.userId,
        projectId,
        ProjectMemberRole.editor,
      );
      if (workspaceId && workspaceId !== project.workspaceId) {
        throw new BadRequestException({
          code: 'PROJECT_WORKSPACE_MISMATCH',
          msg: 'Project does not belong to the selected workspace.',
        });
      }
      return {
        workspaceId: project.workspaceId,
        projectId: project.id,
        sourceSurface,
      };
    }

    if (workspaceId) {
      await this.workspacePermissions.requireWorkspaceRole(
        user.userId,
        workspaceId,
        WorkspaceMemberRole.editor,
      );
      return { workspaceId, sourceSurface };
    }

    const workspace = await this.workspaces.ensurePersonalWorkspace(user);
    return { workspaceId: workspace.id, sourceSurface };
  }

  private async resolveListScope(
    user: AuthUser,
    query: AiJobListQuery,
    workspaceHeaderId?: string,
  ): Promise<{
    workspaceId?: string;
    projectId?: string;
    documentId?: string;
  }> {
    const workspaceId = this.resolveWorkspaceScope(
      workspaceHeaderId,
      query.workspaceId,
    );

    if (query.documentId) {
      const document = await this.workspacePermissions.requireDocumentRole(
        user.userId,
        query.documentId,
        ProjectMemberRole.viewer,
      );
      if (workspaceId && workspaceId !== document.workspaceId) {
        throw new BadRequestException({
          code: 'DOCUMENT_WORKSPACE_MISMATCH',
          msg: 'Document does not belong to the selected workspace.',
        });
      }
      if (query.projectId && query.projectId !== document.projectId) {
        throw new BadRequestException({
          code: 'DOCUMENT_PROJECT_MISMATCH',
          msg: 'Document does not belong to the selected project.',
        });
      }
      return {
        workspaceId: document.workspaceId,
        projectId: document.projectId,
        documentId: document.id,
      };
    }

    if (query.projectId) {
      const project = await this.workspacePermissions.requireProjectRole(
        user.userId,
        query.projectId,
        ProjectMemberRole.viewer,
      );
      if (workspaceId && workspaceId !== project.workspaceId) {
        throw new BadRequestException({
          code: 'PROJECT_WORKSPACE_MISMATCH',
          msg: 'Project does not belong to the selected workspace.',
        });
      }
      return { workspaceId: project.workspaceId, projectId: project.id };
    }

    if (workspaceId) {
      await this.workspacePermissions.requireWorkspaceRole(
        user.userId,
        workspaceId,
        WorkspaceMemberRole.viewer,
      );
      return { workspaceId };
    }

    return {};
  }

  private resolveWorkspaceScope(
    headerWorkspaceId?: string,
    explicitWorkspaceId?: string,
  ): string | undefined {
    if (
      headerWorkspaceId &&
      explicitWorkspaceId &&
      headerWorkspaceId !== explicitWorkspaceId
    ) {
      throw new BadRequestException({
        code: 'WORKSPACE_SCOPE_MISMATCH',
        msg: 'Workspace header does not match the request workspace.',
      });
    }
    return headerWorkspaceId ?? explicitWorkspaceId;
  }

  private normalizeSourceSurface(
    value: string | undefined,
  ): string | undefined {
    const normalized = value?.trim();
    if (!normalized) return undefined;
    if (!/^[a-z0-9][a-z0-9:_-]{0,63}$/i.test(normalized)) {
      throw new BadRequestException({
        code: 'INVALID_SOURCE_SURFACE',
        msg: 'sourceSurface must be 1-64 URL-safe characters.',
      });
    }
    return normalized;
  }

  private normalizeDocumentBlockId(
    value: string | undefined,
  ): string | undefined {
    const normalized = value?.trim();
    if (!normalized) return undefined;
    if (normalized.length > 128) {
      throw new BadRequestException({
        code: 'INVALID_DOCUMENT_BLOCK_ID',
        msg: 'documentBlockId must be 128 characters or fewer.',
      });
    }
    return normalized;
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
      workspace_id: job.workspaceId ?? null,
      project_id: job.projectId ?? null,
      document_id: job.documentId ?? null,
      document_block_id: job.documentBlockId ?? null,
      source_surface: job.sourceSurface ?? null,
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
      workspaceId: job.workspaceId ?? null,
      projectId: job.projectId ?? null,
      documentId: job.documentId ?? null,
      documentBlockId: job.documentBlockId ?? null,
      sourceSurface: job.sourceSurface ?? null,
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

  private async recordTraceSafe(
    job: Pick<AiJob, 'id' | 'provider' | 'deployment' | 'createdAt'>,
    input: {
      eventType: string;
      occurredAt?: string | null;
      source: string;
      confidence: string;
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
        `Failed to record AI trace event for job ${job.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
