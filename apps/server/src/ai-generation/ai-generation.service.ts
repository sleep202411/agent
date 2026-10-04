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
import { Prisma, ProjectMemberRole, WorkspaceMemberRole } from '@prisma/client';
import { randomUUID } from 'crypto';
import type { ProjectSkillResolutionSnapshot } from '@repo/agent-skills';
import type { AuthUser } from '../auth';
import {
  CharacterGenerationService,
  redactProviderAssetRefs,
  referenceSchemaFromModelInput,
  type CharacterReferenceSchemaByKind,
} from '../characters/character-generation.service';
import { newUuidV7 } from '../common/id';
import { EntitlementService } from '../entitlements';
import { StudioDocumentAccessService } from '../documents/studio-document-access.service';
import { StoryPermissionService } from '../story-studio/story-permission.service';
import { MediaAccessService } from '../media/media-access.service';
import { WorkspacesService, WorkspacePermissionService } from '../workspaces';
import {
  ProjectSkillSelectionSchema,
  ProjectSkillsResolver,
  type ProjectSkillOwnerKind,
  type ProjectSkillSelection,
} from '../project-skills';
import { AiGenerationAuthzService } from './authz.service';
import { AiGenerationBillingWalletService } from './billing-wallet.service';
import { AiGenerationEtaService } from './eta.service';
import {
  AiGenerationRepository,
  type ReserveQueuedJobResult,
} from './repository';
import { AiGenerationOutboxService } from './outbox.service';
import { OUTPUT_STORAGE_PROVIDER } from '../infra/storage/output-storage-policy';
import { ProviderRegistry } from './provider-registry.service';
import { ProviderCapacityRuntimeService } from './provider-capacity-runtime.service';
import { AiPromptCompilerService } from './prompt-compiler.service';
import { AiGenerationQueueService } from './queue.service';
import {
  AiGenerationRoutingService,
  refineProviderExecutionRouting,
} from './routing.service';
import { AiGenerationValidatorService } from './validator.service';
import { AiCanonicalCatalogService } from './canonical-catalog.service';
import type { AiPromptReferenceBinding } from './prompt-document.types';
import { AI_MODEL_PROTOCOL_DIALECT } from './types';
import type {
  AiModelCatalogResponse,
  AiModelDefinition,
  AiJob,
  AiJobError,
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
  storyProjectId?: string;
  billingSubjectType?: 'user' | 'workspace';
  billingSubjectId?: string;
  documentId?: string;
  documentBlockId?: string;
  sourceSurface?: string;
}

/**
 * Internal product-plane seam for atomically binding a durable domain row to
 * a newly accepted AiJob. HTTP clients cannot supply this callback.
 */
export interface AiJobSubmissionHooks {
  afterJobCreate?: (tx: Prisma.TransactionClient, job: AiJob) => Promise<void>;
  /** Trusted internal retry path. Never exposed through the HTTP DTO. */
  frozenSkillSnapshot?: ProjectSkillResolutionSnapshot | null;
  /**
   * Trusted retry lineage. Product-specific retry commands use this instead
   * of the generic HTTP DTO so a replacement job cannot lose the durable
   * request it supersedes.
   */
  retryOfJobId?: string;
  /** Trusted quote-time payer snapshot for delayed product-plane dispatch. */
  billingSubject?: { type: 'user' | 'workspace'; id: string };
}

/**
 * Internal product-plane seam for atomically ordering a domain cancellation
 * intent with the canonical AiJob terminal transition. The hook executes in
 * the repository transaction and must not perform network I/O.
 */
export interface AiJobCancellationHooks {
  beforeCancel?: (tx: Prisma.TransactionClient, job: AiJob) => Promise<void>;
  afterCancel?: (tx: Prisma.TransactionClient, job: AiJob) => Promise<void>;
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
    private readonly documentAccess: StudioDocumentAccessService,
    private readonly storyPermissions: StoryPermissionService,
    private readonly entitlements: EntitlementService,
    private readonly billingWallet: AiGenerationBillingWalletService,
    private readonly providerCapacity: ProviderCapacityRuntimeService,
    private readonly promptCompiler: AiPromptCompilerService,
    private readonly characterGeneration: CharacterGenerationService,
    private readonly projectSkills: ProjectSkillsResolver,
    private readonly mediaAccess: MediaAccessService,
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

  async listModels(user: AuthUser, workspaceId?: string | null) {
    // Canonical-model-driven catalog: the control plane is the single
    // source of truth. One AiModelDefinition per active canonical model,
    // assembled from its primary active provider binding (no provider fan-out,
    // no provider-merge). We only stamp per-user access on top.
    //
    // Resolve entitlement WITH the active workspace so a team plan's models
    // light up for members — without it, team grants never enter the candidate
    // set and team-gated models read as locked even though submitJob allows them.
    if (workspaceId) {
      await this.workspacePermissions.requireWorkspacePresence(
        user.userId,
        workspaceId,
      );
    }
    const models = await this.catalog.listModels();
    const entitlement = await this.entitlements.resolveForUser(user, {
      workspaceId: workspaceId ?? null,
    });
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

  async listCatalog(
    user: AuthUser,
    workspaceId?: string | null,
  ): Promise<AiModelCatalogResponse> {
    const models = await this.listModels(user, workspaceId);
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
    hooks: AiJobSubmissionHooks = {},
  ): Promise<AiSubmitResponse> {
    const now = new Date().toISOString();
    const context = await this.resolveJobContext(
      user,
      body,
      workspaceHeaderId,
      hooks.billingSubject,
    );

    // Character bindings expand FIRST — before routing — because routing,
    // quota pricing, and input-shape matching must all see the true
    // per-media reference counts (design §3.2). `input` below is the
    // EXPANDED input; the raw client input is frozen on the job for audit.
    const rawInput =
      body.input && typeof body.input === 'object' ? body.input : {};
    // Security invariant (design §3.2): `asset://` provider-hosted references
    // may ONLY be produced by server-side character expansion (which enforces
    // subject-only + the routing pin + forced watermark). A client that puts a
    // raw asset:// URL into a reference field would bypass all of that, so
    // reject it BEFORE expansion — expansion is the sole legitimate source.
    this.characterGeneration.rejectClientAssetReferences(rawInput);
    const characterExpansion =
      await this.characterGeneration.expandCharacterBindings({
        user,
        workspaceId: context.workspaceId,
        projectId: context.projectId,
        referenceSchema: await this.referenceSchemaForCharacterBindings(body),
        bindings: body.referenceBindings,
        input: rawInput,
      });
    // Resolve server-trusted media duration/size BEFORE routing. Routing
    // freezes the wallet quote, and Seedance 2.5 charges reference-video jobs
    // on input-video + output duration; accepting client-claimed duration here
    // would let a caller understate the hold before validation corrected it.
    const input = await this.validator.applyTrustedMediaFacts({
      ...characterExpansion.input,
      referenceBindings: characterExpansion.bindings,
    });
    const referenceBindings = characterExpansion.bindings;

    const entitlement = await this.entitlements.resolveForUser(user, {
      workspaceId: context.workspaceId,
      now,
    });
    const decision = await this.routing.resolve({
      entitlement,
      body: { ...body, input, referenceBindings },
      now,
      resolvedCharacterKinds: characterExpansion.characterKinds,
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

    const schemaNormalizedInput = this.validator.normalizeInput(
      model.input_schema,
      input,
    );
    // Per-option plan gate (for example, high-resolution renders).
    // Server-side enforcement; the UI already gates these.
    this.authz.assertCanUseOptions(entitlement, model, schemaNormalizedInput);
    const supportsReferences = Boolean(
      model.input_schema.properties?.referenceImages ||
      model.input_schema.properties?.referenceVideos ||
      model.input_schema.properties?.referenceAudios,
    );
    const skillSnapshot = await this.resolveGenerationSkillSnapshot({
      context,
      body,
      type: model.type,
      frozen: hooks.frozenSkillSnapshot,
    });
    const promptCompilation = this.promptCompiler.compile({
      normalizedInput: schemaNormalizedInput,
      rawInput: input,
      promptDocument: body.promptDocument,
      references: supportsReferences ? referenceBindings : undefined,
      styles: body.styleBindings,
      skillSnapshot,
    });
    const normalizedInput = promptCompilation.normalizedInput;
    await refineProviderExecutionRouting(decision, normalizedInput);
    const prompt = promptCompilation.snapshot.displayText;
    await this.requireReferenceAccess(
      user.userId,
      promptCompilation.snapshot.references,
      context.documentId,
    );
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
    const limitSubject =
      snapshot.policy.concurrency.subject ?? entitlement.subject;
    const reservation: ReserveQueuedJobResult =
      await this.store.reserveQueuedJob({
        userId: user.userId,
        modelId: model.id,
        idempotencyKey,
        queueName,
        type: model.type,
        limitSubject,
        perSubjectQueued: snapshot.policy.concurrency.perSubjectQueued,
        campaignLimit: this.campaignLimitFor(snapshot),
        references: promptCompilation.snapshot.references.flatMap(
          (reference) =>
            reference.assetId
              ? [
                  {
                    assetId: reference.assetId,
                    refId: reference.refId,
                    kind: reference.kind,
                    characterId: reference.characterId,
                  },
                ]
              : [],
        ),
        beforeCreate: (tx, job) =>
          this.billingWallet.reserveForJobInTransaction({
            tx,
            job,
          }),
        afterCreate: hooks.afterJobCreate,
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
            deployment: snapshot.selectedDeployment,
            canonicalModelId: snapshot.selectedCanonicalModelId ?? null,
            providerBindingId: snapshot.selectedProviderBindingId ?? null,
            schemaVersion: model.schemaVersion,
            workspaceId: context.workspaceId,
            projectId: context.projectId,
            storyProjectId: context.storyProjectId,
            billingSubjectType: context.billingSubjectType,
            billingSubjectId: context.billingSubjectId,
            documentId: context.documentId,
            documentBlockId: context.documentBlockId,
            sourceSurface: context.sourceSurface,
            // Frozen here, never re-read at upload time, so every attempt of
            // this job writes into the same store.
            outputStorageProvider: OUTPUT_STORAGE_PROVIDER,
            status: 'in_queue',
            stage: 'queued',
            input: rawInput,
            normalizedInput,
            prompt,
            promptDocument: promptCompilation.snapshot.promptDocument,
            promptDisplayText: promptCompilation.snapshot.displayText,
            promptSearchText: promptCompilation.snapshot.searchText,
            compiledPrompt: promptCompilation.snapshot.compiledPrompt,
            // Character jobs freeze the ORIGINAL (pre-expansion) bindings so
            // retryJob re-runs expansion and re-validates character status;
            // the expanded media live on in normalizedInput + the compiled
            // references, and the expansion audit rides the job_submitted
            // trace event. Non-character jobs keep the compiled bindings
            // (unchanged behavior).
            referenceSnapshot:
              characterExpansion.expansions.length > 0
                ? body.referenceBindings
                : promptCompilation.snapshot.references,
            styleSnapshot: promptCompilation.snapshot.styles,
            skillSnapshot,
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
            retryOfJobId: hooks.retryOfJobId,
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
        // Expansion audit: which characters expanded into which media.
        ...(characterExpansion.expansions.length > 0
          ? { characterExpansions: characterExpansion.expansions }
          : {}),
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
      // Admission already committed the job and its hold. A lost enqueue ACK
      // does not prove the queue rejected it; refunding can race a live worker.
      // The queued-row reconciler restores missing delivery with the same job.
      this.logger.error(
        `Generation ${id} awaiting queue recovery: ${String(err)}`,
      );
    }
    const saved = (await this.store.findById(id)) ?? job;
    this.emitJobUpdate(saved);
    this.emitRepositioned(reservation.repositioned, saved.id);
    return this.toSubmitResponse(saved);
  }

  /**
   * Schema-awareness for character expansion (design §3.2): the expansion
   * must know which reference-array fields the SELECTED model declares (and
   * their maxItems) BEFORE routing runs, so undeliverable media is never
   * token-compiled and routing/pricing see true reference counts. Cheapest
   * existing lookup: the same per-provider `getModel` probe that
   * routing.findModel uses — no policy resolution, no routing snapshot.
   * Skipped entirely (empty schema) when no character bindings are present.
   */
  private async referenceSchemaForCharacterBindings(
    body: AiSubmitJobBody,
  ): Promise<CharacterReferenceSchemaByKind> {
    const hasCharacterBindings = (body.referenceBindings ?? []).some(
      (binding) => binding.role === 'character',
    );
    if (!hasCharacterBindings) return {};

    const modelId = body.modelId?.trim();
    if (!modelId) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        msg: 'modelId is required when referencing characters.',
      });
    }
    const candidates: AiModelDefinition[] = [];
    for (const adapter of this.providers.list()) {
      const model = await adapter.getModel(modelId);
      if (model) candidates.push(model);
    }
    const model =
      candidates.find((candidate) => candidate.enabled) ?? candidates[0];
    if (!model) {
      throw new NotFoundException({
        code: 'MODEL_NOT_FOUND',
        msg: 'Model not found.',
      });
    }
    return referenceSchemaFromModelInput(model.input_schema);
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
    if (query.ids !== undefined && typeof query.ids !== 'string') {
      throw new BadRequestException('Expected comma-separated job IDs.');
    }
    const ids = query.ids?.split(',').filter(Boolean);
    if (
      ids &&
      (ids.length > 100 ||
        ids.some(
          (id) =>
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
              id,
            ),
        ))
    ) {
      throw new BadRequestException('Expected at most 100 job IDs.');
    }
    const scope = await this.resolveListScope(user, query, workspaceHeaderId);
    const sourceSurface = query.sourceSurface
      ? this.normalizeSourceSurface(query.sourceSurface)
      : undefined;
    const jobs = await this.store.listForUser({
      userId: user.userId,
      ids,
      idempotencyKey: query.idempotencyKey,
      documentBlockId: query.documentBlockId,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      storyProjectId: scope.storyProjectId,
      documentId: scope.documentId,
      sourceSurface,
      includeCollaboratorJobs: Boolean(
        scope.projectId || scope.storyProjectId || scope.documentId,
      ),
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

  async cancelJob(
    user: AuthUser,
    id: string,
    hooks: AiJobCancellationHooks = {},
  ) {
    const job = await this.getEditableJob(user, id);
    if (job.status === 'cancelled') {
      if (hooks.beforeCancel || hooks.afterCancel) {
        const synchronized = await this.cancelJobRow(
          job,
          {
            code: 'CANCELLED_BY_USER',
            message: 'Cancelled by user.',
            userMessage: 'This generation was cancelled.',
            retryable: true,
            releaseReason: 'ai_job_cancelled',
          },
          hooks,
        );
        return this.publicJob(synchronized, { detail: true });
      }
      // The DB transition is the durable acceptance point. Provider, Redis
      // capacity and wallet cleanup are idempotent post-commit lifecycle work;
      // replaying a cancelled request heals a process crash between the claim
      // and cleanup without ever reopening the cancellation decision.
      await this.completeCancellationLifecycle(job, 'ai_job_cancelled');
      return this.publicJob(job, { detail: true });
    }
    if (TERMINAL_STATUSES.has(job.status)) {
      return this.publicJob(job, { detail: true });
    }

    const updated = await this.cancelJobRow(
      job,
      {
        code: 'CANCELLED_BY_USER',
        message: 'Cancelled by user.',
        userMessage: 'This generation was cancelled.',
        retryable: true,
        releaseReason: 'ai_job_cancelled',
      },
      hooks,
    );
    return this.publicJob(updated, { detail: true });
  }

  /**
   * Cancel one non-terminal job row: provider cancel + capacity/hold release +
   * status update + queue reposition + realtime emit. Shared by the user
   * cancel path and the internal likeness-revocation cancellation (v2 §5).
   */
  private async cancelJobRow(
    job: AiJob,
    opts: {
      code: AiJobError['code'];
      message: string;
      userMessage: string;
      retryable: boolean;
      releaseReason: string;
    },
    hooks: AiJobCancellationHooks = {},
  ): Promise<AiJob> {
    const now = new Date().toISOString();
    // Claim the cancellation atomically FIRST. A worker completing this job runs
    // out-of-band from this API call, so the status write must be the barrier:
    // if the worker already claimed completion (in_progress → completed), this
    // returns null and we must NOT release the hold or cancel the provider run —
    // otherwise a delivered job would also be refunded (free generation).
    const cancelled = await this.store.cancelIfActive(job.id, {
      observedJob: job,
      beforeCancel: hooks.beforeCancel,
      afterCancel: hooks.afterCancel,
      patch: {
        status: 'cancelled',
        stage: 'cancelled',
        completedAt: now,
        queuePosition: null,
        logs: [
          ...job.logs,
          { time: now, stage: 'cancelled', message: opts.message },
        ],
        error: {
          code: opts.code,
          message: opts.message,
          userMessage: opts.userMessage,
          retryable: opts.retryable,
          createdAt: now,
        },
      },
    });
    if (!cancelled) {
      // Lost the race: the job reached a terminal state first. A completion or
      // failure owns its hold + outputs; a cancellation owns cleanup below.
      const winner = (await this.store.findById(job.id)) ?? job;
      if (winner.status === 'cancelled') {
        // A concurrent cancellation may have committed and crashed before its
        // post-commit cleanup. Every cleanup operation is idempotent, so the
        // losing request may safely finish that durable lifecycle.
        await this.completeCancellationLifecycle(winner, opts.releaseReason);
      }
      return winner;
    }

    await this.completeCancellationLifecycle(cancelled, opts.releaseReason);
    return cancelled;
  }

  private async completeCancellationLifecycle(
    job: AiJob,
    releaseReason: string,
  ): Promise<void> {
    await this.cancelProviderJobIfNeeded(job);
    await this.providerCapacity.release(job);
    await this.billingWallet.releaseForJob(job, releaseReason);
    const repositioned = await this.store.recomputeQueuePositions(
      job.queueName,
    );
    this.emitJobUpdate(job);
    this.emitRepositioned(repositioned, job.id);
  }

  /**
   * {@link RealPersonJobCanceller} port impl (design v2 §5): cancel non-terminal
   * jobs referencing a likeness whose per-project grant (or the character
   * itself) was withdrawn. Best-effort cleanup — the worker prepareReferences
   * seam is the correctness barrier; this releases holds + slots promptly.
   * Never throws into the revoke transaction: per-job failures are logged.
   */
  async cancelJobsForCharacter(args: {
    characterId: string;
    projectId?: string;
    reason: string;
  }): Promise<number> {
    const jobs = await this.store.activeReferencingCharacter(
      args.characterId,
      args.projectId,
    );
    let cancelled = 0;
    for (const job of jobs) {
      if (TERMINAL_STATUSES.has(job.status)) continue;
      try {
        await this.cancelJobRow(job, {
          code: 'CHARACTER_REVOKED',
          message: `Authorization to use a referenced character was withdrawn (${args.reason}).`,
          userMessage:
            'Authorization to use a referenced character was withdrawn, so this generation was cancelled and your points released.',
          retryable: false,
          releaseReason: 'ai_job_character_revoked',
        });
        cancelled += 1;
      } catch (err) {
        this.logger.warn(
          `failed to cancel job ${job.id} on character revoke: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    return cancelled;
  }

  async retryJob(user: AuthUser, id: string): Promise<AiSubmitResponse> {
    const job = await this.getEditableJob(user, id);
    // Existing retries may predate the stable key. Recover their trusted
    // lineage too, rather than creating another job after an upgrade.
    const priorRetry = await this.store.findRetryForJob(user.userId, job.id);
    if (priorRetry) return this.toSubmitResponse(priorRetry);
    // Retry advances a failed attempt once. Repeating this endpoint after a
    // lost response must recover the same child; another failure is retried
    // through that child's id. The repository serializes this key before billing.
    const idempotencyKey = `retry:${job.id}`;
    const existing = await this.store.findByIdempotency(
      user.userId,
      job.modelId,
      idempotencyKey,
    );
    if (existing) {
      if (existing.retryOfJobId !== job.id) {
        throw new ConflictException({
          code: 'RETRY_IDEMPOTENCY_CONFLICT',
          msg: 'The retry request conflicts with an existing generation.',
        });
      }
      return this.toSubmitResponse(existing);
    }
    if (!['failed', 'cancelled', 'expired'].includes(job.status)) {
      throw new ConflictException({
        code: 'JOB_NOT_RETRYABLE',
        msg: 'Only a failed, cancelled, or expired generation can be retried.',
      });
    }
    return this.submitJob(
      user,
      {
        modelId: job.modelId,
        presetId: job.routingSnapshot?.presetId,
        campaignId: job.routingSnapshot?.policy.quota.campaignId,
        schemaVersion: job.schemaVersion,
        workspaceId: job.workspaceId ?? undefined,
        projectId: job.projectId ?? undefined,
        storyProjectId: job.storyProjectId ?? undefined,
        documentId: job.documentId ?? undefined,
        documentBlockId: job.documentBlockId ?? undefined,
        sourceSurface: job.sourceSurface ?? undefined,
        // Strip server-minted asset:// urls before resubmit: the submit-time
        // rejectClientAssetReferences guard would otherwise 400 the retry, and
        // expansion re-derives asset:// from the frozen referenceSnapshot anyway
        // (the stamped url-less entries are stripped + re-appended). Preserves
        // the guard for genuine client-sent asset:// (which never reach here).
        input: redactProviderAssetRefs(job.normalizedInput) ?? undefined,
        promptDocument: job.promptDocument ?? undefined,
        referenceBindings: job.referenceSnapshot ?? undefined,
        styleBindings: job.styleSnapshot ?? undefined,
        idempotencyKey,
      },
      undefined,
      {
        frozenSkillSnapshot: job.skillSnapshot ?? null,
        retryOfJobId: job.id,
      },
    );
  }

  private async resolveGenerationSkillSnapshot(input: {
    context: AiJobContext;
    body: AiSubmitJobBody;
    type: AiJob['type'];
    frozen?: ProjectSkillResolutionSnapshot | null;
  }): Promise<ProjectSkillResolutionSnapshot | null> {
    const owner = projectOwner(input.context);
    const selection = parseSkillSelection(input.body);
    if (!owner) {
      if (
        input.frozen ||
        (selection.includeInstallationIds?.length ?? 0) > 0 ||
        (selection.excludeInstallationIds?.length ?? 0) > 0
      ) {
        throw new BadRequestException({
          code: 'PROJECT_SKILL_CONTEXT_REQUIRED',
          msg: 'Project Skills can only be used by a generation with a trusted project context.',
        });
      }
      return null;
    }

    if (input.type === 'audio') {
      if (
        input.frozen ||
        (selection.includeInstallationIds?.length ?? 0) > 0 ||
        (selection.excludeInstallationIds?.length ?? 0) > 0
      ) {
        throw new BadRequestException({
          code: 'PROJECT_SKILL_SCOPE_UNSUPPORTED',
          msg: 'Project Skills do not currently support audio generation.',
        });
      }
      return null;
    }
    const scope =
      input.type === 'image' ? 'image_generation' : 'video_generation';
    if (input.frozen) {
      return this.projectSkills.validateFrozen(input.frozen, {
        ...owner,
        scope,
      });
    }
    return this.projectSkills.resolve({
      ...owner,
      scope,
      sourceSurface: input.context.sourceSurface,
      selection,
    });
  }

  private async cancelProviderJobIfNeeded(job: AiJob): Promise<void> {
    if (!job.providerJobId) return;
    const provider = job.routingSnapshot?.selectedProvider ?? job.provider;
    try {
      const adapter = this.providers.get(provider);
      if (!adapter.cancelGeneration) return;
      const providerContext = await this.store.findProviderAttemptContext(job);
      await adapter.cancelGeneration(job.providerJobId, providerContext);
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
        msg: 'AI generation job not found.',
      });
    }

    // Keep the existing creator history/read contract. Mutations on scoped
    // jobs must recheck current permissions, even for the original submitter.
    if (
      job.userId === user.userId &&
      minimumRole === WorkspaceMemberRole.viewer
    )
      return job;

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

    if (job.storyProjectId) {
      await this.storyPermissions.requireProject(
        user.userId,
        job.storyProjectId,
        minimumRole === WorkspaceMemberRole.viewer
          ? 'story.read'
          : 'story.generate',
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

    // Legacy unscoped jobs still belong to their original submitter.
    if (job.userId === user.userId) return job;

    throw new NotFoundException({
      code: 'JOB_NOT_FOUND',
      msg: 'AI generation job not found.',
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
    frozenBillingSubject?: { type: 'user' | 'workspace'; id: string },
  ): Promise<AiJobContext> {
    // The x-fizz-workspace-id header is UI scope only (the studio client
    // stamps the ACTIVE workspace on every request). When the body pins an
    // explicit document/project context, that entity's home workspace is the
    // source of truth for the job's workspaceId — a shared project can live
    // outside the caller's active workspace, so the header must never veto
    // it. Only an EXPLICIT body workspaceId is cross-checked against the
    // entity's home workspace.
    const explicitWorkspaceId = body.context?.workspaceId ?? body.workspaceId;
    const projectId = body.context?.projectId ?? body.projectId;
    const storyProjectId = body.context?.storyProjectId ?? body.storyProjectId;
    const documentId = body.context?.documentId ?? body.documentId;
    const documentBlockId =
      body.context?.documentBlockId ?? body.documentBlockId;
    const sourceSurface = this.normalizeSourceSurface(
      body.context?.sourceSurface ?? body.sourceSurface,
    );

    this.assertSingleProjectScope(projectId, storyProjectId);

    if (documentId) {
      const document = await this.documentAccess.requireDocument(
        user.userId,
        documentId,
        'generate',
      );
      if (explicitWorkspaceId && explicitWorkspaceId !== document.workspaceId) {
        throw new BadRequestException({
          code: 'DOCUMENT_WORKSPACE_MISMATCH',
          msg: 'Document does not belong to the selected workspace.',
        });
      }
      if (projectId && projectId !== document.platformProjectId) {
        throw new BadRequestException({
          code: 'DOCUMENT_PROJECT_MISMATCH',
          msg: 'Document does not belong to the selected project.',
        });
      }
      if (storyProjectId && storyProjectId !== document.storyProjectId) {
        throw new BadRequestException({
          code: 'DOCUMENT_STORY_PROJECT_MISMATCH',
          msg: 'Document does not belong to the selected Story project.',
        });
      }
      const billingSubject = document.storyProjectId
        ? (frozenBillingSubject ??
          (await this.resolveStoryBillingSubject(
            user,
            document.storyProjectId,
          )))
        : { type: 'workspace' as const, id: document.workspaceId };
      return {
        workspaceId: document.workspaceId,
        projectId: document.platformProjectId ?? undefined,
        storyProjectId: document.storyProjectId ?? undefined,
        billingSubjectType: billingSubject?.type,
        billingSubjectId: billingSubject?.id,
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
      if (explicitWorkspaceId && explicitWorkspaceId !== project.workspaceId) {
        throw new BadRequestException({
          code: 'PROJECT_WORKSPACE_MISMATCH',
          msg: 'Project does not belong to the selected workspace.',
        });
      }
      return {
        workspaceId: project.workspaceId,
        billingSubjectType: 'workspace',
        billingSubjectId: project.workspaceId,
        projectId: project.id,
        sourceSurface,
      };
    }

    if (storyProjectId) {
      const { project } = await this.storyPermissions.requireProject(
        user.userId,
        storyProjectId,
        'story.generate',
      );
      if (explicitWorkspaceId && explicitWorkspaceId !== project.workspaceId) {
        throw new BadRequestException({
          code: 'STORY_PROJECT_WORKSPACE_MISMATCH',
          msg: 'Story project does not belong to the selected workspace.',
        });
      }
      const billingSubject =
        frozenBillingSubject ??
        (await this.resolveStoryBillingSubject(user, project.id));
      return {
        workspaceId: project.workspaceId,
        storyProjectId: project.id,
        billingSubjectType: billingSubject.type,
        billingSubjectId: billingSubject.id,
        sourceSurface,
      };
    }

    // No entity context: the header participates again as the workspace
    // scope (and must agree with an explicit body workspaceId, if any).
    const workspaceId = this.resolveWorkspaceScope(
      workspaceHeaderId,
      explicitWorkspaceId,
    );

    if (workspaceId) {
      await this.workspacePermissions.requireWorkspaceRole(
        user.userId,
        workspaceId,
        WorkspaceMemberRole.editor,
      );
      return {
        workspaceId,
        billingSubjectType: 'workspace',
        billingSubjectId: workspaceId,
        sourceSurface,
      };
    }

    const workspace = await this.workspaces.ensureDefaultWorkspace(user);
    return {
      workspaceId: workspace.id,
      billingSubjectType: 'workspace',
      billingSubjectId: workspace.id,
      sourceSurface,
    };
  }

  async resolveStoryBillingSubject(
    _user: AuthUser,
    storyProjectId: string,
  ): Promise<{ type: 'user' | 'workspace'; id: string }> {
    return this.billingWallet.resolveStoryProjectPayer(storyProjectId);
  }

  async getStoryBillingBalance(user: AuthUser, storyProjectId: string) {
    await this.storyPermissions.requireProject(
      user.userId,
      storyProjectId,
      'story.read',
    );
    const subject = await this.resolveStoryBillingSubject(user, storyProjectId);
    const balance = await this.billingWallet.getComputeBalance(subject);
    return {
      workspaceId: subject.id,
      availablePoints: balance.available.toString(),
      heldPoints: balance.held.toString(),
      totalPoints: balance.total.toString(),
    };
  }

  async getBillingSubjectComputeBalance(subject: {
    type: 'user' | 'workspace';
    id: string;
  }) {
    return this.billingWallet.getComputeBalance(subject);
  }

  private async resolveListScope(
    user: AuthUser,
    query: AiJobListQuery,
    workspaceHeaderId?: string,
  ): Promise<{
    workspaceId?: string;
    projectId?: string;
    storyProjectId?: string;
    documentId?: string;
  }> {
    this.assertSingleProjectScope(query.projectId, query.storyProjectId);
    const workspaceId = this.resolveWorkspaceScope(
      workspaceHeaderId,
      query.workspaceId,
    );

    if (query.documentId) {
      const document = await this.documentAccess.requireDocument(
        user.userId,
        query.documentId,
        'read',
      );
      if (workspaceId && workspaceId !== document.workspaceId) {
        throw new BadRequestException({
          code: 'DOCUMENT_WORKSPACE_MISMATCH',
          msg: 'Document does not belong to the selected workspace.',
        });
      }
      if (query.projectId && query.projectId !== document.platformProjectId) {
        throw new BadRequestException({
          code: 'DOCUMENT_PROJECT_MISMATCH',
          msg: 'Document does not belong to the selected project.',
        });
      }
      if (
        query.storyProjectId &&
        query.storyProjectId !== document.storyProjectId
      ) {
        throw new BadRequestException({
          code: 'DOCUMENT_STORY_PROJECT_MISMATCH',
          msg: 'Document does not belong to the selected Story project.',
        });
      }
      return {
        workspaceId: document.workspaceId,
        projectId: document.platformProjectId ?? undefined,
        storyProjectId: document.storyProjectId ?? undefined,
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

    if (query.storyProjectId) {
      const { project } = await this.storyPermissions.requireProject(
        user.userId,
        query.storyProjectId,
        'story.read',
      );
      if (workspaceId && workspaceId !== project.workspaceId) {
        throw new BadRequestException({
          code: 'STORY_PROJECT_WORKSPACE_MISMATCH',
          msg: 'Story project does not belong to the selected workspace.',
        });
      }
      return {
        workspaceId: project.workspaceId,
        storyProjectId: project.id,
      };
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

  private assertSingleProjectScope(
    projectId: string | undefined,
    storyProjectId: string | undefined,
  ): void {
    if (!projectId || !storyProjectId) return;
    throw new BadRequestException({
      code: 'PROJECT_SCOPE_CONFLICT',
      msg: 'Choose either a Creative Studio project or a Story project, not both.',
    });
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
      story_project_id: job.storyProjectId ?? null,
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
      idempotencyKey: job.idempotencyKey,
      type: job.type,
      workspaceId: job.workspaceId ?? null,
      projectId: job.projectId ?? null,
      storyProjectId: job.storyProjectId ?? null,
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
      promptDocument: job.promptDocument ?? null,
      promptDisplayText: job.promptDisplayText ?? job.prompt,
      promptSearchText: job.promptSearchText ?? job.prompt,
      compiledPrompt: job.compiledPrompt ?? null,
      referenceSnapshot: job.referenceSnapshot ?? [],
      styleSnapshot: job.styleSnapshot ?? [],
      skillSnapshot: job.skillSnapshot ?? null,
      // Always include the normalized input so the gallery can render
      // the correct aspect ratio for queued/in-flight cards on reload
      // (output rows don't carry width/height until upload finishes).
      // asset:// provider handles are stripped — never leave the server (§2.3).
      input: redactProviderAssetRefs(job.normalizedInput),
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

  /**
   * Reference authorization belongs to request acceptance, not asynchronous
   * provider execution. Once accepted, the immutable job + reference usage
   * ledger is the grant that worker retries consume; workers only re-resolve
   * storage location and lifecycle state.
   */
  private async requireReferenceAccess(
    userId: string,
    references: AiPromptReferenceBinding[],
    documentId?: string | null,
  ): Promise<void> {
    const assetIds = [
      ...new Set(
        references.flatMap((reference) =>
          reference.assetId ? [reference.assetId] : [],
        ),
      ),
    ];
    await Promise.all(
      assetIds.map((assetId) =>
        this.mediaAccess.requireUseAccessById(userId, assetId, {
          documentId,
        }),
      ),
    );
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

function projectOwner(context: AiJobContext): {
  ownerKind: ProjectSkillOwnerKind;
  projectId: string;
} | null {
  if (context.projectId) {
    return { ownerKind: 'platform', projectId: context.projectId };
  }
  if (context.storyProjectId) {
    return { ownerKind: 'story', projectId: context.storyProjectId };
  }
  return null;
}

function parseSkillSelection(
  body: AiSubmitJobBody,
): NonNullable<ProjectSkillSelection> {
  const inlineInstallationIds = (body.promptDocument?.nodes ?? []).flatMap(
    (node) => (node.type === 'skill_ref' ? [node.refId] : []),
  );
  const candidate = {
    includeInstallationIds: uniqueStrings([
      ...(body.skillSelection?.includeInstallationIds ?? []),
      ...inlineInstallationIds,
    ]),
    excludeInstallationIds: uniqueStrings(
      body.skillSelection?.excludeInstallationIds ?? [],
    ),
  };
  const parsed = ProjectSkillSelectionSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new BadRequestException({
      code: 'INVALID_PROJECT_SKILL_SELECTION',
      msg: parsed.error.issues[0]?.message ?? 'Skill selection is invalid.',
    });
  }
  return parsed.data ?? {};
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}
