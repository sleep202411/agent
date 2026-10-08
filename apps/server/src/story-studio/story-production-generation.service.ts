import { backgroundTasksEnabled } from '../common/background-tasks';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  AiJobStatus,
  MediaAssetKind,
  MediaAssetVariantKind,
  MediaAssetVariantStatus,
  Prisma,
  StoryGenerationBatchItemStatus,
  StoryGenerationBatchStatus,
  StoryProductionGenerationKind,
  StoryProductionGenerationTargetKind,
  StoryProductionSpecStatus,
  StoryStoryboardBindingMode,
  type StoryFrameProfile,
} from '@prisma/client';
import type { ProjectSkillResolutionSnapshot } from '@repo/agent-skills';
import {
  estimateProductModelPoints,
  extractStoryAssetMentions,
} from '@repo/shared';
import type { AuthUser } from '../auth';
import {
  AiGenerationCompletionObserverRegistry,
  type AiGenerationCompletionObserver,
} from '../ai-generation/completion-observer.service';
import { AiGenerationService } from '../ai-generation/ai-generation.service';
import {
  describeGenerationRequestShape,
  generationRequestShape,
  modelSupportsRequest,
} from '../ai-generation/generation-mode-capability';
import { STORY_STUDIO_WORKBENCH_SURFACE } from '../ai-generation/output-storage-target';
import type {
  AiPromptDocument,
  AiSubmitReferenceBinding,
} from '../ai-generation/prompt-document.types';
import type { AiJob, AiModelDefinition } from '../ai-generation/types';
import { newUuidV7 } from '../common/id';
import { PrismaService } from '../infra/db/db.module';
import { MediaAssetUrlResolverService } from '../infra/storage/media-asset-url-resolver.service';
import { canonicalJsonHash } from './canonical-json';
import {
  storyProductionGenerationBasePath,
  toStoryProductionGenerationProgressDto,
} from './story-production-generation.dto';
import { StoryPermissionService } from './story-permission.service';
import {
  type CreateStoryAssetGenerationInput,
  type CreateStoryStoryboardClipGenerationInput,
  type RetryStoryProductionGenerationInput,
  type StoryAssetGenerationPurpose,
  type StoryGenerationOptions,
  StoryGenerationOptionsSchema,
} from './story-production-generation.schema';
import { StoryProjectWriteGuardService } from './story-project-write-guard.service';
import { StoryProductionPlanService } from './story-production-plan.service';

const DEFAULT_RECONCILE_INTERVAL_MS = 15_000;
const DEFAULT_RECONCILE_BATCH_SIZE = 25;
const RECONCILE_LEASE_MS = 60_000;
const MAX_RECONCILE_ATTEMPTS = 12;
const GENERATION_TARGET_SNAPSHOT_VERSION = 1;
const STORYBOARD_CLIP_TARGET_SNAPSHOT_VERSION = 2;
const GENERATION_SUBMISSION_SNAPSHOT_VERSION = 1;
// Version the server-owned layout contract so retries cannot silently cross
// prompt-template revisions while the creator-authored Asset Spec is unchanged.
const CHARACTER_TURNAROUND_PROMPT_PROFILE =
  'character-turnaround-reference-board.v2';
const SERVER_OWNED_AI_INPUT_FIELDS = new Set([
  'prompt',
  'referenceImages',
  'referenceVideos',
  'referenceAudios',
]);

const GENERATION_RESPONSE_INCLUDE =
  Prisma.validator<Prisma.StoryProductionGenerationInclude>()({
    aiJob: true,
    assetMediaVersions: {
      orderBy: [{ versionNumber: 'asc' }, { id: 'asc' }],
      include: {
        mediaAsset: {
          include: {
            placements: true,
            variants: {
              where: {
                deletedAt: null,
                status: MediaAssetVariantStatus.ready,
              },
              include: { placements: true },
            },
          },
        },
        preferredVariant: { include: { placements: true } },
      },
    },
    storyboardMediaVersions: {
      orderBy: [{ versionNumber: 'asc' }, { id: 'asc' }],
      include: {
        mediaAsset: {
          include: {
            placements: true,
            variants: {
              where: {
                deletedAt: null,
                status: MediaAssetVariantStatus.ready,
              },
              include: { placements: true },
            },
          },
        },
        preferredVariant: { include: { placements: true } },
      },
    },
    storyboardClip: { select: { sequenceId: true } },
  });

const REFERENCE_MEDIA_VERSION_INCLUDE =
  Prisma.validator<Prisma.StoryAssetMediaVersionInclude>()({
    mediaAsset: {
      include: {
        placements: true,
        variants: { where: { variantKey: 'original', deletedAt: null } },
      },
    },
  });

const CLIP_TARGET_INCLUDE =
  Prisma.validator<Prisma.StoryStoryboardClipInclude>()({
    project: { select: { frameProfile: true } },
    sequence: {
      select: {
        id: true,
        status: true,
        version: true,
        sourceFingerprint: true,
      },
    },
    assetBindings: {
      where: { status: { not: StoryProductionSpecStatus.archived } },
      orderBy: [{ rank: 'asc' }, { id: 'asc' }],
      include: {
        assetSpec: {
          include: {
            selectedMediaVersion: {
              include: REFERENCE_MEDIA_VERSION_INCLUDE,
            },
          },
        },
        pinnedMediaVersion: {
          include: REFERENCE_MEDIA_VERSION_INCLUDE,
        },
      },
    },
  });

const ASSET_TARGET_INCLUDE = Prisma.validator<Prisma.StoryAssetSpecInclude>()({
  project: { select: { frameProfile: true } },
  selectedMediaVersion: { include: REFERENCE_MEDIA_VERSION_INCLUDE },
});

type GenerationResponseRow = Prisma.StoryProductionGenerationGetPayload<{
  include: typeof GENERATION_RESPONSE_INCLUDE;
}>;
type GenerationCreativeMediaVersionRow =
  | GenerationResponseRow['assetMediaVersions'][number]
  | GenerationResponseRow['storyboardMediaVersions'][number];
type ClipTargetRow = Prisma.StoryStoryboardClipGetPayload<{
  include: typeof CLIP_TARGET_INCLUDE;
}>;
type AssetTargetRow = Prisma.StoryAssetSpecGetPayload<{
  include: typeof ASSET_TARGET_INCLUDE;
}>;
type ReferenceMediaVersion = Prisma.StoryAssetMediaVersionGetPayload<{
  include: typeof REFERENCE_MEDIA_VERSION_INCLUDE;
}>;

type StoryGenerationTarget =
  | {
      targetKind: 'asset_spec';
      targetId: string;
      sequenceId: null;
      generationKind: 'image' | 'video';
      version: number;
      sourceFingerprint: string;
      status: StoryProductionSpecStatus;
      prompt: string;
      negativePrompt: string | null;
      generationConfig: Prisma.JsonValue;
      frameProfile: StoryFrameProfile;
      assetKind: 'character' | 'location' | 'prop';
      purpose: StoryAssetGenerationPurpose;
      durationMs: null;
      logicalSnapshot: Record<string, unknown>;
      references: ResolvedTargetReference[];
    }
  | {
      targetKind: 'storyboard_clip';
      targetId: string;
      sequenceId: string;
      generationKind: 'image' | 'video';
      version: number;
      sourceFingerprint: string;
      status: StoryProductionSpecStatus;
      prompt: string;
      negativePrompt: string | null;
      generationConfig: Prisma.JsonValue;
      frameProfile: StoryFrameProfile;
      durationMs: number;
      logicalSnapshot: Record<string, unknown>;
      references: ResolvedTargetReference[];
    };

interface ResolvedTargetReference {
  bindingId: string;
  refId: string;
  role: string;
  /** The mention token identity: the referenced Asset Spec's stableKey. */
  stableKey: string;
  label: string;
  rank: number;
  required: boolean;
  mediaVersionId: string | null;
  mediaAsset: ReferenceMediaVersion['mediaAsset'] | null;
}

interface SubmitGenerationCommand {
  user: AuthUser;
  workspaceId: string;
  projectId: string;
  chapterId: string;
  targetKind: 'asset_spec' | 'storyboard_clip';
  targetId: string;
  sequenceId: string | null;
  idempotencyKey: string;
  expectedVersion: number;
  modelId?: string;
  schemaVersion?: string;
  clientOptions: StoryGenerationOptions;
  requestedOutputKind?: 'image' | 'video';
  requestedPurpose?: StoryAssetGenerationPurpose;
  expectedQuote?: {
    pricingVersion: string;
    points: number;
  };
  billingSubject?: { type: 'user' | 'workspace'; id: string };
  batchAdmission?: {
    itemId: string;
    leaseOwner: string;
  };
  retryOf?: GenerationRetrySource;
}

interface GenerationRetrySource {
  generationId: string;
  aiJobId: string;
  targetSnapshotFingerprint: string;
  skillSnapshot: ProjectSkillResolutionSnapshot | null;
}

interface StoryGenerationSubmissionSnapshot {
  version: 1;
  modelId: string;
  schemaVersion: string;
  outputKind: 'image' | 'video';
  purpose: StoryAssetGenerationPurpose;
  clientOptions: StoryGenerationOptions;
  effectiveOptions: Record<string, unknown>;
  timelineDurationMs: number | null;
  requestedSourceDurationSeconds: number | null;
  sourceSurface: typeof STORY_STUDIO_WORKBENCH_SURFACE;
}

interface ResolvedGenerationRequest {
  modelId: string;
  schemaVersion: string;
  effectiveOptions: Record<string, unknown>;
  targetSnapshotFingerprint: string;
}

interface MaterializationFailureShape {
  code: string;
  message: string;
  retryable: boolean;
  occurredAt: string;
}

@Injectable()
export class StoryProductionGenerationService
  implements
    AiGenerationCompletionObserver,
    OnApplicationBootstrap,
    OnModuleDestroy
{
  private readonly logger = new Logger(StoryProductionGenerationService.name);
  private timer: NodeJS.Timeout | null = null;
  private unregisterObserver: (() => void) | null = null;
  private draining = false;
  private stopping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: StoryPermissionService,
    private readonly writeGuard: StoryProjectWriteGuardService,
    private readonly aiGeneration: AiGenerationService,
    private readonly completionObservers: AiGenerationCompletionObserverRegistry,
    private readonly assetUrls: MediaAssetUrlResolverService,
    private readonly productionPlans: StoryProductionPlanService,
  ) {}

  onApplicationBootstrap(): void {
    if (!backgroundTasksEnabled()) return;
    if (this.stopping || this.unregisterObserver) return;
    this.unregisterObserver = this.completionObservers.register(this);
    if (
      process.env.STORY_PRODUCTION_GENERATION_RECONCILER_ENABLED === 'false'
    ) {
      this.logger.log('Story production generation reconciler is disabled');
      return;
    }
    const intervalMs = positiveInteger(
      process.env.STORY_PRODUCTION_GENERATION_RECONCILER_INTERVAL_MS,
      DEFAULT_RECONCILE_INTERVAL_MS,
    );
    this.timer = setInterval(() => void this.drainOnce(), intervalMs);
    this.timer.unref?.();
    queueMicrotask(() => void this.drainOnce());
    this.logger.log(
      `Story production generation reconciler polling every ${intervalMs}ms`,
    );
  }

  onModuleDestroy(): void {
    this.stopping = true;
    this.unregisterObserver?.();
    this.unregisterObserver = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async createAssetGeneration(
    user: AuthUser,
    projectId: string,
    chapterId: string,
    assetSpecId: string,
    idempotencyKey: string,
    input: CreateStoryAssetGenerationInput,
  ) {
    const workspaceId = await this.requireProjectScope(
      user,
      projectId,
      chapterId,
      'story.generate',
    );
    return this.submitGeneration({
      user,
      workspaceId,
      projectId,
      chapterId,
      targetKind: 'asset_spec',
      targetId: assetSpecId,
      sequenceId: null,
      idempotencyKey,
      expectedVersion: input.expectedVersion,
      modelId: input.modelId,
      schemaVersion: input.schemaVersion,
      clientOptions: input.options ?? {},
      requestedOutputKind: input.outputKind,
      requestedPurpose: input.purpose,
    });
  }

  /**
   * Server-authoritative preflight used by durable batches. It resolves the
   * same target snapshot, references, model compatibility, defaults, and
   * pricing contract as submission without reserving points or creating an AI
   * job. The returned values are frozen into the quote item.
   */
  async quoteAssetGeneration(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    chapterId: string,
    assetSpecId: string,
    input: CreateStoryAssetGenerationInput,
  ) {
    return this.quoteGeneration({
      user,
      workspaceId,
      projectId,
      chapterId,
      targetKind: 'asset_spec',
      targetId: assetSpecId,
      sequenceId: null,
      idempotencyKey: 'quote-only',
      expectedVersion: input.expectedVersion,
      modelId: input.modelId,
      schemaVersion: input.schemaVersion,
      clientOptions: input.options ?? {},
      requestedOutputKind: input.outputKind,
      requestedPurpose: input.purpose,
    });
  }

  /**
   * Executes one creator-confirmed batch item against the exact quote that was
   * shown to the creator. A catalog price change never silently changes the
   * amount approved by the creator; the item fails closed and must be requoted.
   */
  async createQuotedAssetGeneration(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    chapterId: string,
    assetSpecId: string,
    idempotencyKey: string,
    input: CreateStoryAssetGenerationInput,
    expectedQuote: { pricingVersion: string; points: number },
    billingSubject: { type: 'user' | 'workspace'; id: string },
    batchAdmission: { itemId: string; leaseOwner: string },
  ) {
    return this.submitGeneration({
      user,
      workspaceId,
      projectId,
      chapterId,
      targetKind: 'asset_spec',
      targetId: assetSpecId,
      sequenceId: null,
      idempotencyKey,
      expectedVersion: input.expectedVersion,
      modelId: input.modelId,
      schemaVersion: input.schemaVersion,
      clientOptions: input.options ?? {},
      requestedOutputKind: input.outputKind,
      requestedPurpose: input.purpose,
      expectedQuote,
      billingSubject,
      batchAdmission,
    });
  }

  async quoteStoryboardClipGeneration(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    chapterId: string,
    sequenceId: string,
    clipId: string,
    input: CreateStoryStoryboardClipGenerationInput,
  ) {
    return this.quoteGeneration({
      user,
      workspaceId,
      projectId,
      chapterId,
      targetKind: 'storyboard_clip',
      targetId: clipId,
      sequenceId,
      idempotencyKey: 'quote-only',
      expectedVersion: input.expectedVersion,
      modelId: input.modelId,
      schemaVersion: input.schemaVersion,
      clientOptions: input.options ?? {},
    });
  }

  async createQuotedStoryboardClipGeneration(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    chapterId: string,
    sequenceId: string,
    clipId: string,
    idempotencyKey: string,
    input: CreateStoryStoryboardClipGenerationInput,
    expectedQuote: { pricingVersion: string; points: number },
    billingSubject: { type: 'user' | 'workspace'; id: string },
    batchAdmission: { itemId: string; leaseOwner: string },
  ) {
    return this.submitGeneration({
      user,
      workspaceId,
      projectId,
      chapterId,
      targetKind: 'storyboard_clip',
      targetId: clipId,
      sequenceId,
      idempotencyKey,
      expectedVersion: input.expectedVersion,
      modelId: input.modelId,
      schemaVersion: input.schemaVersion,
      clientOptions: input.options ?? {},
      expectedQuote,
      billingSubject,
      batchAdmission,
    });
  }

  async createStoryboardClipGeneration(
    user: AuthUser,
    projectId: string,
    chapterId: string,
    sequenceId: string,
    clipId: string,
    idempotencyKey: string,
    input: CreateStoryStoryboardClipGenerationInput,
  ) {
    const workspaceId = await this.requireProjectScope(
      user,
      projectId,
      chapterId,
      'story.generate',
    );
    return this.submitGeneration({
      user,
      workspaceId,
      projectId,
      chapterId,
      targetKind: 'storyboard_clip',
      targetId: clipId,
      sequenceId,
      idempotencyKey,
      expectedVersion: input.expectedVersion,
      modelId: input.modelId,
      schemaVersion: input.schemaVersion,
      clientOptions: input.options ?? {},
    });
  }

  async getAssetGeneration(
    user: AuthUser,
    projectId: string,
    chapterId: string,
    assetSpecId: string,
    generationId: string,
  ) {
    await this.requireProjectScope(user, projectId, chapterId, 'story.read');
    await this.reconcileCompletedGeneration(generationId, false);
    const row = await this.requireGeneration({
      generationId,
      projectId,
      chapterId,
      targetKind: StoryProductionGenerationTargetKind.asset_spec,
      targetId: assetSpecId,
      sequenceId: null,
    });
    return this.toGenerationDto(row);
  }

  async getStoryboardClipGeneration(
    user: AuthUser,
    projectId: string,
    chapterId: string,
    sequenceId: string,
    clipId: string,
    generationId: string,
  ) {
    await this.requireProjectScope(user, projectId, chapterId, 'story.read');
    await this.reconcileCompletedGeneration(generationId, false);
    const row = await this.requireGeneration({
      generationId,
      projectId,
      chapterId,
      targetKind: StoryProductionGenerationTargetKind.storyboard_clip,
      targetId: clipId,
      sequenceId,
    });
    return this.toGenerationDto(row);
  }

  async cancelAssetGeneration(
    user: AuthUser,
    projectId: string,
    chapterId: string,
    assetSpecId: string,
    generationId: string,
  ) {
    const workspaceId = await this.requireProjectScope(
      user,
      projectId,
      chapterId,
      'story.generate',
    );
    return this.cancelGeneration({
      user,
      workspaceId,
      projectId,
      chapterId,
      targetKind: StoryProductionGenerationTargetKind.asset_spec,
      targetId: assetSpecId,
      sequenceId: null,
      generationId,
    });
  }

  async cancelStoryboardClipGeneration(
    user: AuthUser,
    projectId: string,
    chapterId: string,
    sequenceId: string,
    clipId: string,
    generationId: string,
  ) {
    const workspaceId = await this.requireProjectScope(
      user,
      projectId,
      chapterId,
      'story.generate',
    );
    return this.cancelGeneration({
      user,
      workspaceId,
      projectId,
      chapterId,
      targetKind: StoryProductionGenerationTargetKind.storyboard_clip,
      targetId: clipId,
      sequenceId,
      generationId,
    });
  }

  async retryAssetGeneration(
    user: AuthUser,
    projectId: string,
    chapterId: string,
    assetSpecId: string,
    generationId: string,
    idempotencyKey: string,
    input: RetryStoryProductionGenerationInput,
  ) {
    const workspaceId = await this.requireProjectScope(
      user,
      projectId,
      chapterId,
      'story.generate',
    );
    return this.retryGeneration({
      user,
      workspaceId,
      projectId,
      chapterId,
      targetKind: 'asset_spec',
      targetId: assetSpecId,
      sequenceId: null,
      generationId,
      idempotencyKey,
      expectedVersion: input.expectedVersion,
    });
  }

  async retryStoryboardClipGeneration(
    user: AuthUser,
    projectId: string,
    chapterId: string,
    sequenceId: string,
    clipId: string,
    generationId: string,
    idempotencyKey: string,
    input: RetryStoryProductionGenerationInput,
  ) {
    const workspaceId = await this.requireProjectScope(
      user,
      projectId,
      chapterId,
      'story.generate',
    );
    return this.retryGeneration({
      user,
      workspaceId,
      projectId,
      chapterId,
      targetKind: 'storyboard_clip',
      targetId: clipId,
      sequenceId,
      generationId,
      idempotencyKey,
      expectedVersion: input.expectedVersion,
    });
  }

  async reattachAssetGeneration(
    user: AuthUser,
    projectId: string,
    chapterId: string,
    assetSpecId: string,
    generationId: string,
    idempotencyKey: string,
  ) {
    const workspaceId = await this.requireProjectScope(
      user,
      projectId,
      chapterId,
      'story.generate',
    );
    return this.reattachGeneration({
      user,
      workspaceId,
      projectId,
      chapterId,
      targetKind: StoryProductionGenerationTargetKind.asset_spec,
      targetId: assetSpecId,
      sequenceId: null,
      generationId,
      idempotencyKey,
    });
  }

  async reattachStoryboardClipGeneration(
    user: AuthUser,
    projectId: string,
    chapterId: string,
    sequenceId: string,
    clipId: string,
    generationId: string,
    idempotencyKey: string,
  ) {
    const workspaceId = await this.requireProjectScope(
      user,
      projectId,
      chapterId,
      'story.generate',
    );
    return this.reattachGeneration({
      user,
      workspaceId,
      projectId,
      chapterId,
      targetKind: StoryProductionGenerationTargetKind.storyboard_clip,
      targetId: clipId,
      sequenceId,
      generationId,
      idempotencyKey,
    });
  }

  /**
   * Retry only the durable output -> Story media-version attachment. This
   * never submits or retries an AI job, so it cannot incur another generation
   * charge. A separate explicit Generate/Generate again command remains the
   * only path that can create paid work.
   */
  private async reattachGeneration(input: {
    user: AuthUser;
    workspaceId: string;
    projectId: string;
    chapterId: string;
    targetKind: StoryProductionGenerationTargetKind;
    targetId: string;
    sequenceId: string | null;
    generationId: string;
    idempotencyKey: string;
  }) {
    await this.requireScope(
      input.user,
      input.workspaceId,
      input.projectId,
      input.chapterId,
      'story.generate',
    );
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
    const operation = 'story-generation.reattach';
    const requestFingerprint = canonicalJsonHash({
      operation,
      projectId: input.projectId,
      chapterId: input.chapterId,
      targetKind: input.targetKind,
      targetId: input.targetId,
      sequenceId: input.sequenceId,
      generationId: input.generationId,
    });

    await this.prisma.$transaction(async (tx) => {
      await this.writeGuard.assertHumanWriteAllowed(tx, input.projectId);
      await this.permissions.requireProjectInTransaction(
        tx,
        input.user.userId,
        input.projectId,
        'story.generate',
      );
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtext(${`story-production-mutation:${input.chapterId}:${input.user.userId}:${idempotencyKey}`})::bigint
        )
      `;
      const receipt = await tx.storyProductionMutationReceipt.findUnique({
        where: {
          storyChapterId_actorUserId_idempotencyKey: {
            storyChapterId: input.chapterId,
            actorUserId: input.user.userId,
            idempotencyKey,
          },
        },
      });
      if (receipt) {
        assertReattachReceipt(receipt, operation, requestFingerprint);
        return;
      }

      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT generation."id"
        FROM "story_production_generations" AS generation
        WHERE generation."id" = ${input.generationId}::uuid
        FOR UPDATE
      `;
      if (locked.length === 0) {
        throw productionNotFound(
          'Story production generation',
          input.generationId,
        );
      }
      const generation = await tx.storyProductionGeneration.findFirst({
        where: {
          id: input.generationId,
          storyProjectId: input.projectId,
          storyChapterId: input.chapterId,
          targetKind: input.targetKind,
          ...(input.targetKind ===
          StoryProductionGenerationTargetKind.asset_spec
            ? { assetSpecId: input.targetId }
            : {
                storyboardClipId: input.targetId,
                ...(input.sequenceId
                  ? { storyboardClip: { sequenceId: input.sequenceId } }
                  : {}),
              }),
        },
        include: { aiJob: true },
      });
      if (!generation) {
        throw productionNotFound(
          'Story production generation',
          input.generationId,
        );
      }
      if (generation.aiJob.status !== AiJobStatus.completed) {
        throw new ConflictException({
          code: 'STORY_GENERATION_REATTACH_JOB_INCOMPLETE',
          message:
            'Only a completed AI generation with a failed attachment can be reattached.',
        });
      }
      if (!generation.materializedAt) {
        const failure = jsonObject(generation.materializationError);
        if (generation.nextReconcileAt) {
          throw new ConflictException({
            code: 'STORY_GENERATION_MATERIALIZATION_RETRY_SCHEDULED',
            message:
              'Attachment recovery is already scheduled. Wait for the current retry before reattaching again.',
          });
        }
        if (failure.attachmentRetryable !== true) {
          throw new ConflictException({
            code: 'STORY_GENERATION_MATERIALIZATION_NOT_RETRYABLE',
            message:
              'This output cannot be reattached. Use Generate again to create a new source asset.',
          });
        }
        await tx.storyProductionGeneration.update({
          where: { id: generation.id },
          data: {
            reconcileAttempts: 0,
            materializationError: Prisma.DbNull,
            nextReconcileAt: null,
          },
        });
      }
      await tx.storyProductionMutationReceipt.create({
        data: {
          storyProjectId: input.projectId,
          storyChapterId: input.chapterId,
          actorUserId: input.user.userId,
          idempotencyKey,
          operation,
          requestFingerprint,
          response: {
            version: 1,
            generationId: input.generationId,
            action: 'reattach',
          },
        },
      });
    });

    // The durable reset commits before work begins. A lost HTTP response or a
    // process crash is therefore recoverable by the normal reconciler, and a
    // same-key replay never resets the attempt budget twice.
    await this.reconcileCompletedGeneration(input.generationId, false);
    return this.toGenerationDto(
      await this.requireGeneration({
        generationId: input.generationId,
        projectId: input.projectId,
        chapterId: input.chapterId,
        targetKind: input.targetKind,
        targetId: input.targetId,
        sequenceId: input.sequenceId,
      }),
    );
  }

  private async cancelGeneration(input: {
    user: AuthUser;
    workspaceId: string;
    projectId: string;
    chapterId: string;
    targetKind: StoryProductionGenerationTargetKind;
    targetId: string;
    sequenceId: string | null;
    generationId: string;
  }) {
    await this.requireScope(
      input.user,
      input.workspaceId,
      input.projectId,
      input.chapterId,
      'story.generate',
    );
    const generation = await this.requireGeneration({
      generationId: input.generationId,
      projectId: input.projectId,
      chapterId: input.chapterId,
      targetKind: input.targetKind,
      targetId: input.targetId,
      sequenceId: input.sequenceId,
    });

    await this.aiGeneration.cancelJob(input.user, generation.aiJobId, {
      beforeCancel: async (tx, observedJob) => {
        await this.writeGuard.assertHumanWriteAllowed(tx, input.projectId);
        await this.permissions.requireProjectInTransaction(
          tx,
          input.user.userId,
          input.projectId,
          'story.generate',
        );
        const exactGeneration = await tx.storyProductionGeneration.findFirst({
          where: {
            id: input.generationId,
            aiJobId: observedJob.id,
            storyProjectId: input.projectId,
            storyChapterId: input.chapterId,
            targetKind: input.targetKind,
            ...(input.targetKind ===
            StoryProductionGenerationTargetKind.asset_spec
              ? { assetSpecId: input.targetId }
              : {
                  storyboardClipId: input.targetId,
                  ...(input.sequenceId
                    ? { storyboardClip: { sequenceId: input.sequenceId } }
                    : {}),
                }),
          },
          select: { id: true },
        });
        if (!exactGeneration) {
          throw productionNotFound(
            'Story production generation',
            input.generationId,
          );
        }
      },
    });

    await this.reconcileCompletedGeneration(input.generationId, false);
    return this.toGenerationDto(
      await this.requireGeneration({
        generationId: input.generationId,
        projectId: input.projectId,
        chapterId: input.chapterId,
        targetKind: input.targetKind,
        targetId: input.targetId,
        sequenceId: input.sequenceId,
      }),
    );
  }

  async onAiGenerationCompleted(job: AiJob): Promise<void> {
    if (!backgroundTasksEnabled()) return;
    if (this.stopping || job.sourceSurface !== STORY_STUDIO_WORKBENCH_SURFACE)
      return;
    await this.reconcileCompletedGeneration(job.id, true, true);
  }

  async drainOnce(batch = DEFAULT_RECONCILE_BATCH_SIZE): Promise<void> {
    if (!backgroundTasksEnabled()) return;
    if (this.stopping || this.draining) return;
    this.draining = true;
    try {
      const ids = await this.claimCompletedGenerations(
        Math.max(1, Math.trunc(batch)),
      );
      if (this.stopping) return;
      await Promise.all(
        ids.map((id) =>
          this.reconcileCompletedGeneration(id, false, true, true),
        ),
      );
    } catch (error) {
      this.logger.warn(
        `Story generation reconciliation failed: ${safeErrorMessage(error)}`,
      );
    } finally {
      this.draining = false;
    }
  }

  private async submitGeneration(command: SubmitGenerationCommand) {
    const idempotencyKey = normalizeIdempotencyKey(command.idempotencyKey);
    await this.requireScope(
      command.user,
      command.workspaceId,
      command.projectId,
      command.chapterId,
      'story.generate',
    );
    const replay = await this.findReplay(
      command.chapterId,
      command.user.userId,
      idempotencyKey,
    );
    if (replay) {
      this.assertReplay(
        replay,
        command,
        generationRequestFingerprint(
          command,
          resolvedGenerationRequestFromSnapshots(replay),
        ),
      );
      await this.reconcileCompletedGeneration(replay.id, false);
      return this.toGenerationDto(await this.requireGenerationById(replay.id));
    }

    const target = await this.prisma.$transaction((tx) =>
      this.loadTarget(
        tx,
        command.projectId,
        command.chapterId,
        command.targetKind,
        command.targetId,
        command.sequenceId,
        command.requestedOutputKind,
        command.requestedPurpose,
      ),
    );
    this.assertTargetCanGenerate(target, command);
    const targetSnapshotFingerprint = canonicalJsonHash(target.logicalSnapshot);
    if (
      command.retryOf &&
      command.retryOf.targetSnapshotFingerprint !== targetSnapshotFingerprint
    ) {
      throw new ConflictException({
        code: 'STORY_GENERATION_RETRY_TARGET_CHANGED',
        message:
          'The production target or one of its @Asset references changed. Start a new generation instead of retrying the old request.',
      });
    }
    const references = this.resolveProviderReferences(target);
    const model = await this.requireCompatibleModel(
      command.user,
      command.workspaceId,
      command.modelId,
      command.schemaVersion,
      target,
      references,
      command.clientOptions,
    );
    const effectiveOptions = this.effectiveOptions(
      model,
      target,
      command.clientOptions,
    );
    const requestedSourceDurationSeconds = sourceDurationSeconds(
      model,
      target,
      effectiveOptions,
    );
    const requestFingerprint = generationRequestFingerprint(command, {
      modelId: model.id,
      schemaVersion: model.schemaVersion,
      effectiveOptions,
      targetSnapshotFingerprint,
    });
    const aiInput = this.buildAiInput(
      model,
      target,
      effectiveOptions,
      references,
    );
    if (command.expectedQuote) {
      assertStoryGenerationQuoteMatches(model, aiInput, command.expectedQuote);
    }
    const promptDocument = providerPromptDocument(
      target.prompt,
      target.references,
      references,
    );
    const referenceBindings = references.map((item) => item.binding);
    const generationId = newUuidV7();
    const aiIdempotencyKey = `story-production:${canonicalJsonHash({
      chapterId: command.chapterId,
      actorUserId: command.user.userId,
      idempotencyKey,
    })}`;
    const submissionSnapshot: StoryGenerationSubmissionSnapshot = {
      version: GENERATION_SUBMISSION_SNAPSHOT_VERSION,
      modelId: model.id,
      schemaVersion: model.schemaVersion,
      outputKind: target.generationKind,
      purpose: command.requestedPurpose ?? 'primary',
      clientOptions: command.clientOptions,
      effectiveOptions,
      timelineDurationMs: target.durationMs,
      requestedSourceDurationSeconds,
      sourceSurface: STORY_STUDIO_WORKBENCH_SURFACE,
    };
    const promptSnapshot = {
      version: GENERATION_TARGET_SNAPSHOT_VERSION,
      targetSnapshotFingerprint,
      target: target.logicalSnapshot,
    };

    try {
      await this.aiGeneration.submitJob(
        command.user,
        {
          modelId: model.id,
          schemaVersion: model.schemaVersion,
          workspaceId: command.workspaceId,
          storyProjectId: command.projectId,
          sourceSurface: STORY_STUDIO_WORKBENCH_SURFACE,
          input: aiInput,
          promptDocument,
          referenceBindings,
          idempotencyKey: aiIdempotencyKey,
        },
        command.workspaceId,
        {
          retryOfJobId: command.retryOf?.aiJobId,
          frozenSkillSnapshot: command.retryOf?.skillSnapshot,
          billingSubject: command.billingSubject,
          afterJobCreate: async (tx, job) => {
            await this.writeGuard.assertHumanWriteAllowed(
              tx,
              command.projectId,
            );
            await this.permissions.requireProjectInTransaction(
              tx,
              command.user.userId,
              command.projectId,
              'story.generate',
            );
            if (command.batchAdmission) {
              const admission = await tx.storyGenerationBatchItem.findUnique({
                where: { id: command.batchAdmission.itemId },
                select: {
                  status: true,
                  leaseOwner: true,
                  batch: { select: { status: true } },
                },
              });
              if (
                admission?.status !==
                  StoryGenerationBatchItemStatus.dispatching ||
                admission.leaseOwner !== command.batchAdmission.leaseOwner ||
                (admission.batch.status !== StoryGenerationBatchStatus.queued &&
                  admission.batch.status !== StoryGenerationBatchStatus.running)
              ) {
                throw new ConflictException({
                  code: 'STORY_GENERATION_BATCH_ADMISSION_REVOKED',
                  message:
                    'This batch item is no longer eligible for generation.',
                });
              }
            }
            await tx.$executeRaw`
              SELECT pg_advisory_xact_lock(
                hashtext(${`story-production-generation:${command.chapterId}:${command.user.userId}:${idempotencyKey}`})::bigint
              )
            `;
            const existing = await tx.storyProductionGeneration.findUnique({
              where: {
                storyChapterId_actorUserId_idempotencyKey: {
                  storyChapterId: command.chapterId,
                  actorUserId: command.user.userId,
                  idempotencyKey,
                },
              },
            });
            if (existing) {
              this.assertReplay(existing, command, requestFingerprint);
              throw new ConflictException({
                code: 'STORY_GENERATION_ALREADY_ACCEPTED',
                message: 'This generation request was already accepted.',
              });
            }
            const lockedTarget = await this.loadTarget(
              tx,
              command.projectId,
              command.chapterId,
              command.targetKind,
              command.targetId,
              command.sequenceId,
              command.requestedOutputKind,
              command.requestedPurpose,
            );
            this.assertTargetCanGenerate(lockedTarget, command);
            if (
              canonicalJsonHash(lockedTarget.logicalSnapshot) !==
              targetSnapshotFingerprint
            ) {
              throw new ConflictException({
                code: 'STORY_GENERATION_TARGET_CHANGED',
                message:
                  'The production target changed while generation was being submitted. Reload and try again.',
              });
            }
            if (job.type !== target.generationKind) {
              throw new InternalServerErrorException({
                code: 'STORY_GENERATION_JOB_KIND_MISMATCH',
                message:
                  'The routed AI job does not match the production target.',
              });
            }
            await tx.storyProductionGeneration.create({
              data: {
                id: generationId,
                storyProjectId: command.projectId,
                storyChapterId: command.chapterId,
                targetKind:
                  command.targetKind === 'asset_spec'
                    ? StoryProductionGenerationTargetKind.asset_spec
                    : StoryProductionGenerationTargetKind.storyboard_clip,
                generationKind:
                  target.generationKind === 'image'
                    ? StoryProductionGenerationKind.image
                    : StoryProductionGenerationKind.video,
                purpose: submissionSnapshot.purpose,
                assetSpecId:
                  command.targetKind === 'asset_spec' ? command.targetId : null,
                storyboardClipId:
                  command.targetKind === 'storyboard_clip'
                    ? command.targetId
                    : null,
                aiJobId: job.id,
                actorUserId: command.user.userId,
                idempotencyKey,
                requestFingerprint,
                targetVersion: target.version,
                targetSourceFingerprint: target.sourceFingerprint,
                promptSnapshot: promptSnapshot as Prisma.InputJsonValue,
                submissionSnapshot:
                  submissionSnapshot as unknown as Prisma.InputJsonValue,
                retryOfGenerationId: command.retryOf?.generationId ?? null,
              },
            });
            if (command.batchAdmission) {
              const admitted = await tx.storyGenerationBatchItem.updateMany({
                where: {
                  id: command.batchAdmission.itemId,
                  status: StoryGenerationBatchItemStatus.dispatching,
                  leaseOwner: command.batchAdmission.leaseOwner,
                },
                data: {
                  status: StoryGenerationBatchItemStatus.submitted,
                  generationId,
                  submittedAt: new Date(),
                  leaseOwner: null,
                  leaseExpiresAt: null,
                  nextDispatchAt: null,
                  error: Prisma.JsonNull,
                },
              });
              if (admitted.count !== 1) {
                throw new ConflictException({
                  code: 'STORY_GENERATION_BATCH_ADMISSION_REVOKED',
                  message:
                    'This batch item was cancelled while generation was being submitted.',
                });
              }
            }
          },
        },
      );
    } catch (error) {
      const winner = await this.findReplay(
        command.chapterId,
        command.user.userId,
        idempotencyKey,
      );
      if (!winner) throw error;
      this.assertReplay(winner, command, requestFingerprint);
      return this.toGenerationDto(await this.requireGenerationById(winner.id));
    }

    return this.toGenerationDto(await this.requireGenerationById(generationId));
  }

  private async quoteGeneration(command: SubmitGenerationCommand) {
    await this.requireScope(
      command.user,
      command.workspaceId,
      command.projectId,
      command.chapterId,
      'story.generate',
    );
    const target = await this.prisma.$transaction((tx) =>
      this.loadTarget(
        tx,
        command.projectId,
        command.chapterId,
        command.targetKind,
        command.targetId,
        command.sequenceId,
        command.requestedOutputKind,
        command.requestedPurpose,
      ),
    );
    this.assertTargetCanGenerate(target, command);
    const references = this.resolveProviderReferences(target);
    const model = await this.requireCompatibleModel(
      command.user,
      command.workspaceId,
      command.modelId,
      command.schemaVersion,
      target,
      references,
      command.clientOptions,
    );
    const effectiveOptions = this.effectiveOptions(
      model,
      target,
      command.clientOptions,
    );
    const aiInput = this.buildAiInput(
      model,
      target,
      effectiveOptions,
      references,
    );
    const estimate = estimateGenerationPoints(model, aiInput);
    return {
      targetKind: command.targetKind,
      targetId: command.targetId,
      sequenceId: command.sequenceId,
      targetVersion: target.version,
      targetSnapshotFingerprint: canonicalJsonHash(target.logicalSnapshot),
      outputKind: target.generationKind,
      modelId: model.id,
      schemaVersion: model.schemaVersion,
      // A durable batch replays creator-controlled options through the same
      // target/model resolver at dispatch time. Persist only those authored
      // values, not the schema defaults added to `effectiveOptions`.
      options: command.clientOptions,
      quotedPoints: estimate.sellPoints,
      pricingVersion: estimate.pricingVersion,
    };
  }

  private async retryGeneration(input: {
    user: AuthUser;
    workspaceId: string;
    projectId: string;
    chapterId: string;
    targetKind: 'asset_spec' | 'storyboard_clip';
    targetId: string;
    sequenceId: string | null;
    generationId: string;
    idempotencyKey: string;
    expectedVersion: number;
  }) {
    await this.requireScope(
      input.user,
      input.workspaceId,
      input.projectId,
      input.chapterId,
      'story.generate',
    );
    const original = await this.requireGeneration({
      generationId: input.generationId,
      projectId: input.projectId,
      chapterId: input.chapterId,
      targetKind:
        input.targetKind === 'asset_spec'
          ? StoryProductionGenerationTargetKind.asset_spec
          : StoryProductionGenerationTargetKind.storyboard_clip,
      targetId: input.targetId,
      sequenceId: input.sequenceId,
    });
    if (original.aiJob.status === AiJobStatus.completed) {
      throw new ConflictException({
        code: 'STORY_GENERATION_ALREADY_COMPLETED',
        message:
          'The AI generation already completed. Retry its attachment with materialization.retryUrl, or start an explicit Generate again request.',
      });
    }
    const retryableTerminalStatuses = new Set<AiJobStatus>([
      AiJobStatus.failed,
      AiJobStatus.cancelled,
      AiJobStatus.expired,
    ]);
    if (!retryableTerminalStatuses.has(original.aiJob.status)) {
      throw new ConflictException({
        code: 'STORY_GENERATION_NOT_RETRYABLE_YET',
        message:
          'Only a terminal failed or cancelled generation can be retried.',
      });
    }
    const jobError = jsonObject(original.aiJob.error);
    if (jobError.retryable === false) {
      throw new ConflictException({
        code: 'STORY_GENERATION_NOT_RETRYABLE',
        message: 'This generation failure is not retryable.',
      });
    }
    const submission = parseSubmissionSnapshot(original.submissionSnapshot);
    const promptSnapshot = jsonObject(original.promptSnapshot);
    const targetSnapshotFingerprint = stringValue(
      promptSnapshot.targetSnapshotFingerprint,
    );
    if (!targetSnapshotFingerprint) {
      throw new InternalServerErrorException({
        code: 'STORY_GENERATION_SNAPSHOT_CORRUPT',
        message: 'The generation target snapshot is incomplete.',
      });
    }
    return this.submitGeneration({
      user: input.user,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      chapterId: input.chapterId,
      targetKind: input.targetKind,
      targetId: input.targetId,
      sequenceId: input.sequenceId,
      idempotencyKey: input.idempotencyKey,
      expectedVersion: input.expectedVersion,
      modelId: submission.modelId,
      schemaVersion: submission.schemaVersion,
      clientOptions: submission.clientOptions,
      requestedOutputKind: submission.outputKind,
      requestedPurpose: submission.purpose,
      retryOf: {
        generationId: original.id,
        aiJobId: original.aiJobId,
        targetSnapshotFingerprint,
        skillSnapshot:
          (original.aiJob
            .skillSnapshot as unknown as ProjectSkillResolutionSnapshot | null) ??
          null,
      },
    });
  }

  private async requireCompatibleModel(
    user: AuthUser,
    workspaceId: string,
    modelId: string | undefined,
    schemaVersion: string | undefined,
    target: StoryGenerationTarget,
    references: ProviderReference[],
    clientOptions: StoryGenerationOptions,
  ): Promise<AiModelDefinition> {
    const kind = target.generationKind;
    const catalog = await this.aiGeneration.listCatalog(user, workspaceId);
    const models = catalog.models as Array<
      AiModelDefinition & { access?: { allowed?: boolean } }
    >;

    if (modelId) {
      const selected = models.find((candidate) => candidate.id === modelId);
      if (!selected) {
        throw new NotFoundException({
          code: 'STORY_GENERATION_MODEL_NOT_FOUND',
          message: 'The selected generation model was not found.',
        });
      }
      if (selected.schemaVersion !== schemaVersion) {
        throw new ConflictException({
          code: 'SCHEMA_VERSION_MISMATCH',
          message: 'The AI model schema changed. Refresh and try again.',
        });
      }
      const issue = modelCompatibilityIssue(selected, kind, references);
      if (issue) throw new BadRequestException(issue);
      this.assertModelInputComplete(
        selected,
        target,
        clientOptions,
        references,
      );
      return selected;
    }

    const standardPreset = catalog.presets.find(
      (preset) => preset.id === `${kind}.standard` && preset.enabled,
    );
    const presetRank = new Map(
      (standardPreset?.modelIds ?? []).map((id, index) => [id, index]),
    );
    const candidates = [...models].sort((left, right) => {
      const leftPresetRank = presetRank.get(left.id) ?? Number.MAX_SAFE_INTEGER;
      const rightPresetRank =
        presetRank.get(right.id) ?? Number.MAX_SAFE_INTEGER;
      if (leftPresetRank !== rightPresetRank) {
        return leftPresetRank - rightPresetRank;
      }
      const recommended =
        Number(Boolean(right.ui_policy?.recommended)) -
        Number(Boolean(left.ui_policy?.recommended));
      if (recommended !== 0) return recommended;
      const sortOrder =
        (left.ui_policy?.sortOrder ?? Number.MAX_SAFE_INTEGER) -
        (right.ui_policy?.sortOrder ?? Number.MAX_SAFE_INTEGER);
      return sortOrder || left.id.localeCompare(right.id);
    });
    let durationFailure: BadRequestException | null = null;
    let inputFailure: BadRequestException | null = null;
    let modeFailure: BadRequestException | null = null;
    for (const candidate of candidates) {
      if (!candidate.enabled || candidate.access?.allowed === false) {
        continue;
      }
      const issue = modelCompatibilityIssue(candidate, kind, references);
      if (issue) {
        if (issue.code === 'STORY_GENERATION_MODEL_MODE_UNSUPPORTED') {
          modeFailure ??= new BadRequestException(issue);
        }
        continue;
      }
      try {
        this.assertModelInputComplete(
          candidate,
          target,
          clientOptions,
          references,
        );
        return candidate;
      } catch (error) {
        if (!(error instanceof BadRequestException)) continue;
        const response = jsonObject(error.getResponse());
        if (response.code === 'STORY_GENERATION_MODEL_DURATION_UNSUPPORTED') {
          durationFailure ??= error;
        } else {
          inputFailure ??= error;
        }
      }
    }

    // Do not hide a timeline that no available provider can cover behind a
    // generic "default unavailable" response. The creator needs the concrete
    // split-clip action, required-input failures explain that an
    // explicit model/setting selection is necessary, and mode failures
    // explain that every candidate lacked the capability this request
    // shape needs (e.g. only image-to-video models for a text-only clip).
    if (inputFailure) throw inputFailure;
    if (durationFailure) throw durationFailure;
    if (modeFailure) throw modeFailure;
    throw new ServiceUnavailableException({
      code: 'STORY_GENERATION_DEFAULT_MODEL_UNAVAILABLE',
      message: `No accessible ${kind} generation model can satisfy this target and its resolved @Asset references.`,
    });
  }

  private assertModelInputComplete(
    model: AiModelDefinition,
    target: StoryGenerationTarget,
    clientOptions: StoryGenerationOptions,
    references: ProviderReference[],
  ): void {
    const effective = this.effectiveOptions(model, target, clientOptions);
    const input = this.buildAiInput(model, target, effective, references);
    const missing = missingRequiredStoryModelInputs(model.input_schema, input);
    if (missing.length > 0) {
      throw new BadRequestException({
        code: 'STORY_GENERATION_MODEL_INPUT_REQUIRED',
        message: `The selected model requires input that this Story target cannot safely supply: ${missing.join(', ')}.`,
        fields: missing,
      });
    }
  }

  private effectiveOptions(
    model: AiModelDefinition,
    target: StoryGenerationTarget,
    clientOptions: SubmitGenerationCommand['clientOptions'],
  ): Record<string, unknown> {
    const storedOptions = StoryGenerationOptionsSchema.parse(
      jsonObject(target.generationConfig),
    );
    const options: Record<string, unknown> = {
      ...storedOptions,
      ...clientOptions,
    };
    const properties = model.input_schema.properties ?? {};
    for (const key of Object.keys(options)) {
      if (!properties[key]) {
        throw new BadRequestException({
          code: 'STORY_GENERATION_OPTION_UNSUPPORTED',
          message: `The selected model does not support Story generation option "${key}".`,
        });
      }
    }

    Object.assign(options, storyModelSchemaDefaults(properties, options));

    if (properties.aspectRatio && options.aspectRatio === undefined) {
      const aspectRatio =
        target.frameProfile === 'portrait_9_16' ? '9:16' : '16:9';
      const allowed = stringArray(properties.aspectRatio.enum);
      if (allowed.length === 0 || allowed.includes(aspectRatio)) {
        options.aspectRatio = aspectRatio;
      } else {
        throw new BadRequestException({
          code: 'STORY_GENERATION_MODEL_FRAME_PROFILE_UNSUPPORTED',
          message: `The selected model does not support the Story project's ${aspectRatio} frame profile.`,
        });
      }
    }

    if (
      target.targetKind === 'storyboard_clip' &&
      target.generationKind === 'video' &&
      target.durationMs !== null
    ) {
      const seconds = target.durationMs / 1_000;
      const field = storyDurationProperty(properties);
      if (field && clientOptions[field] === undefined) {
        const defaultDuration = nearestStoryDurationValue(
          properties[field],
          seconds,
        );
        if (defaultDuration) options[field] = defaultDuration.value;
      }
    }
    return options;
  }

  private buildAiInput(
    model: AiModelDefinition,
    target: StoryGenerationTarget,
    options: Record<string, unknown>,
    references: ProviderReference[],
  ): Record<string, unknown> {
    const input: Record<string, unknown> = {
      ...options,
      prompt: target.prompt,
    };
    if (
      target.negativePrompt &&
      model.input_schema.properties?.negativePrompt
    ) {
      input.negativePrompt = target.negativePrompt;
    }
    for (const kind of ['image', 'video'] as const) {
      const field = kind === 'image' ? 'referenceImages' : 'referenceVideos';
      const ofKind = references.filter(
        (reference) => reference.binding.kind === kind,
      );
      if (ofKind.length > 0) {
        input[field] = ofKind.map((reference) => ({
          url: reference.binding.url,
          width: reference.width,
          height: reference.height,
          assetId: reference.binding.assetId,
          refId: reference.binding.refId,
          label: reference.binding.label,
          ...(reference.binding.durationSeconds !== undefined
            ? { durationSeconds: reference.binding.durationSeconds }
            : {}),
          ...(reference.binding.bytes !== undefined
            ? { bytes: reference.binding.bytes }
            : {}),
        }));
      }
    }
    return input;
  }

  private resolveProviderReferences(
    target: StoryGenerationTarget,
  ): ProviderReference[] {
    const references: ProviderReference[] = [];
    const seenAssets = new Set<string>();
    for (const reference of target.references) {
      const asset = reference.mediaAsset;
      const available =
        asset &&
        (asset.kind === MediaAssetKind.image ||
          asset.kind === MediaAssetKind.video) &&
        !asset.deletedAt
          ? this.assetUrls.resolvePublicUrl(asset)
          : null;
      const url = httpsUrl(available);
      if (!asset || !url) {
        if (reference.required) {
          throw new ConflictException({
            code: reference.mediaVersionId
              ? 'STORY_GENERATION_REQUIRED_REFERENCE_UNAVAILABLE'
              : 'STORY_GENERATION_REQUIRED_REFERENCE_EMPTY',
            message: reference.mediaVersionId
              ? `Required @Asset "${reference.label}" has no provider-accessible media.`
              : `Required @Asset "${reference.label}" is still an empty placeholder. Generate or select its media first.`,
            bindingId: reference.bindingId,
          });
        }
        continue;
      }
      if (seenAssets.has(asset.id)) continue;
      seenAssets.add(asset.id);
      const durationMs = asset.variants?.[0]?.durationMs;
      const durationSeconds =
        durationMs != null ? durationMs / 1000 : asset.durationSeconds;
      references.push({
        width: asset.width,
        height: asset.height,
        bindingId: reference.bindingId,
        binding: {
          refId: reference.refId,
          kind: asset.kind === MediaAssetKind.video ? 'video' : 'image',
          role: reference.role,
          label: reference.label,
          order: reference.rank,
          url,
          assetId: asset.id,
          ...(durationSeconds != null ? { durationSeconds } : {}),
          ...(asset.sizeBytes !== null
            ? { bytes: safeBigIntNumber(asset.sizeBytes) }
            : {}),
        },
      });
    }
    return references;
  }

  private assertTargetCanGenerate(
    target: StoryGenerationTarget,
    command: Pick<
      SubmitGenerationCommand,
      'expectedVersion' | 'requestedOutputKind' | 'batchAdmission'
    >,
  ): void {
    if (target.status === StoryProductionSpecStatus.archived) {
      throw new ConflictException({
        code: 'STORY_GENERATION_TARGET_ARCHIVED',
        message: 'This production target has been archived.',
      });
    }
    // Trusted batch dispatches re-read the live target: the batch's OWN
    // materializations legitimately bump target versions between quote and
    // dispatch (e.g. a completed same-sequence clip writes the timeline and
    // bumps sibling clips), and a confirmed, paid batch must not die to its
    // own progress. Direct creator submissions keep the strict optimistic
    // lock — a stale version there still means "reload and retry".
    if (target.version !== command.expectedVersion && !command.batchAdmission) {
      throw new ConflictException({
        code: 'STORY_PRODUCTION_VERSION_CONFLICT',
        message:
          'The production target changed after it was loaded. Reload and retry.',
      });
    }
    if (
      command.requestedOutputKind &&
      command.requestedOutputKind !== target.generationKind
    ) {
      throw new BadRequestException({
        code: 'STORY_GENERATION_OUTPUT_KIND_MISMATCH',
        message: `This target is configured for ${target.generationKind} generation.`,
      });
    }
    if (!target.prompt.trim()) {
      throw new BadRequestException({
        code: 'STORY_GENERATION_PROMPT_MISSING',
        message: 'The production target has no prompt for this output kind.',
      });
    }
  }

  private async loadTarget(
    db: PrismaService | Prisma.TransactionClient,
    projectId: string,
    chapterId: string,
    targetKind: 'asset_spec' | 'storyboard_clip',
    targetId: string,
    sequenceId: string | null,
    requestedOutputKind?: 'image' | 'video',
    requestedPurpose: StoryAssetGenerationPurpose = 'primary',
  ): Promise<StoryGenerationTarget> {
    if (targetKind === 'asset_spec') {
      const row = await db.storyAssetSpec.findFirst({
        where: {
          id: targetId,
          storyProjectId: projectId,
          storyChapterId: chapterId,
        },
        include: ASSET_TARGET_INCLUDE,
      });
      if (!row) throw productionNotFound('Asset Spec', targetId);
      const generationKind = requestedOutputKind ?? 'image';
      const mentionKeys = extractStoryAssetMentions(
        assetGenerationPrompt(row, generationKind, requestedPurpose),
      ).filter((stableKey) => stableKey !== row.stableKey);
      const referencedAssets = mentionKeys.length
        ? await db.storyAssetSpec.findMany({
            where: {
              storyProjectId: projectId,
              storyChapterId: chapterId,
              stableKey: { in: mentionKeys },
              status: { not: StoryProductionSpecStatus.archived },
            },
            include: ASSET_TARGET_INCLUDE,
          })
        : [];
      return assetTarget(
        row,
        generationKind,
        requestedPurpose,
        referencedAssets,
      );
    }
    const row = await db.storyStoryboardClip.findFirst({
      where: {
        id: targetId,
        storyProjectId: projectId,
        storyChapterId: chapterId,
        ...(sequenceId ? { sequenceId } : {}),
      },
      include: CLIP_TARGET_INCLUDE,
    });
    if (!row) throw productionNotFound('Storyboard clip', targetId);
    return clipTarget(row);
  }

  private async reconcileCompletedGeneration(
    generationOrJobId: string,
    idMayBeJobId: boolean,
    logFailure = false,
    reconcileLeaseAlreadyClaimed = false,
  ): Promise<void> {
    if (this.stopping) return;
    const generation = await this.prisma.storyProductionGeneration.findFirst({
      where: idMayBeJobId
        ? { OR: [{ id: generationOrJobId }, { aiJobId: generationOrJobId }] }
        : { id: generationOrJobId },
      select: {
        id: true,
        materializedAt: true,
        materializationError: true,
        reconcileAttempts: true,
        aiJob: { select: { status: true } },
      },
    });
    if (
      this.stopping ||
      !generation ||
      generation.materializedAt ||
      generation.aiJob.status !== AiJobStatus.completed
    ) {
      return;
    }
    if (
      !reconcileLeaseAlreadyClaimed &&
      !(await this.claimCompletedGeneration(generation.id))
    ) {
      return;
    }

    if (this.stopping) return;
    try {
      await this.materializeGeneration(generation.id);
    } catch (error) {
      const failure = materializationFailure(error);
      const attempts = generation.reconcileAttempts + 1;
      const retryable = failure.retryable && attempts < MAX_RECONCILE_ATTEMPTS;
      const backoffMs = reconcileBackoffMs(attempts);
      const failureJson = JSON.stringify({
        ...failure,
        // `retryable` describes the current automatic backoff budget. The
        // underlying failure capability stays durable so an explicit,
        // idempotent Reattach can reset that budget without a second AI job.
        retryable,
        attachmentRetryable: failure.retryable,
      });
      await this.prisma.$executeRaw(Prisma.sql`
        UPDATE "story_production_generations"
        SET "reconcile_attempts" = "reconcile_attempts" + 1,
            "last_reconciled_at" = transaction_timestamp(),
            "next_reconcile_at" = ${
              retryable
                ? Prisma.sql`transaction_timestamp() + (${backoffMs} * INTERVAL '1 millisecond')`
                : Prisma.sql`NULL`
            },
            "materialization_error" = ${failureJson}::jsonb,
            "updated_at" = transaction_timestamp()
        WHERE "id" = ${generation.id}::uuid
          AND "materialized_at" IS NULL
      `);
      if (logFailure) {
        this.logger.warn(
          `Story generation ${generation.id} materialization failed: ${failure.code} ${failure.message}`,
        );
      }
    }
  }

  private async materializeGeneration(generationId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "story_production_generations"
        WHERE "id" = ${generationId}::uuid
        FOR UPDATE
      `;
      if (locked.length === 0) return;
      const generation = await tx.storyProductionGeneration.findUnique({
        where: { id: generationId },
        include: {
          aiJob: {
            include: {
              outputs: {
                where: { deletedAt: null },
                orderBy: [{ outputIndex: 'asc' }, { id: 'asc' }],
                include: { asset: true },
              },
            },
          },
        },
      });
      if (!generation || generation.materializedAt) return;
      if (generation.aiJob.status !== AiJobStatus.completed) return;
      if (
        !(await this.writeGuard.tryAcquireDeferredWriteFence(
          tx,
          generation.storyProjectId,
        ))
      ) {
        throw new StoryMaterializationError(
          'STORY_PROJECT_WRITE_BUSY',
          'Story Agent is applying a project mutation; media attachment will retry.',
          true,
        );
      }
      if (generation.aiJob.outputs.length === 0) {
        throw new StoryMaterializationError(
          'STORY_GENERATION_OUTPUT_MISSING',
          'The completed AI job has no durable outputs.',
          false,
        );
      }
      for (const output of generation.aiJob.outputs) {
        if (!output.assetId || !output.asset) {
          throw new StoryMaterializationError(
            'STORY_GENERATION_OUTPUT_ASSET_MISSING',
            `AI output ${output.id} has no durable MediaAsset.`,
            false,
          );
        }
        if (
          String(output.type) !== String(generation.generationKind) ||
          String(output.asset.kind) !== String(generation.generationKind)
        ) {
          throw new StoryMaterializationError(
            'STORY_GENERATION_OUTPUT_KIND_MISMATCH',
            `AI output ${output.id} does not match the requested ${generation.generationKind} kind.`,
            false,
          );
        }
      }

      // More than one completed job may legitimately target the same logical
      // Asset Spec or Storyboard clip. Serialize the target's creative-version
      // namespace before reading MAX(version_number), so concurrent completions
      // allocate distinct monotonically increasing numbers and only the first
      // still-current result may become selected.
      const targetLockKey = `story-production-media-version:${generation.targetKind}:${generation.assetSpecId ?? generation.storyboardClipId}`;
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${targetLockKey})::bigint)
      `;

      const targetKind =
        generation.targetKind === StoryProductionGenerationTargetKind.asset_spec
          ? 'asset_spec'
          : 'storyboard_clip';
      const target = await this.loadTarget(
        tx,
        generation.storyProjectId,
        generation.storyChapterId,
        targetKind,
        generation.assetSpecId ?? generation.storyboardClipId ?? '',
        null,
        generation.generationKind,
        parseSubmissionSnapshot(generation.submissionSnapshot).purpose,
      );
      const promptSnapshot = jsonObject(generation.promptSnapshot);
      const originalTargetFingerprint = stringValue(
        promptSnapshot.targetSnapshotFingerprint,
      );
      const targetStillUnchanged =
        originalTargetFingerprint !== null &&
        target.status !== StoryProductionSpecStatus.archived &&
        target.version === generation.targetVersion &&
        target.sourceFingerprint === generation.targetSourceFingerprint &&
        canonicalJsonHash(target.logicalSnapshot) === originalTargetFingerprint;
      const now = new Date();
      const outputRows = generation.aiJob.outputs;
      const submission = parseSubmissionSnapshot(generation.submissionSnapshot);
      const generationSnapshot = {
        version: 1,
        generationId: generation.id,
        aiJobId: generation.aiJobId,
        modelId: generation.aiJob.modelId,
        schemaVersion: generation.aiJob.schemaVersion,
        targetSnapshotFingerprint: originalTargetFingerprint,
        timelineDurationMs: submission.timelineDurationMs,
        requestedSourceDurationSeconds:
          submission.requestedSourceDurationSeconds,
        purpose: submission.purpose,
      };

      if (
        generation.targetKind === StoryProductionGenerationTargetKind.asset_spec
      ) {
        const latest = await tx.storyAssetMediaVersion.findFirst({
          where: { assetSpecId: generation.assetSpecId! },
          orderBy: { versionNumber: 'desc' },
          select: { versionNumber: true },
        });
        const createdIds: string[] = [];
        for (const [index, output] of outputRows.entries()) {
          const created = await tx.storyAssetMediaVersion.create({
            data: {
              storyProjectId: generation.storyProjectId,
              storyChapterId: generation.storyChapterId,
              assetSpecId: generation.assetSpecId!,
              versionNumber: (latest?.versionNumber ?? 0) + index + 1,
              mediaAssetId: output.assetId!,
              sourceFingerprint: generation.targetSourceFingerprint,
              generationSnapshot: {
                ...generationSnapshot,
                aiJobOutputId: output.id,
                outputIndex: output.outputIndex,
                generatedSourceDurationSeconds: output.asset!.durationSeconds,
              } as Prisma.InputJsonValue,
              generationId: generation.id,
              aiJobId: generation.aiJobId,
              aiJobOutputId: output.id,
              createdByUserId: generation.actorUserId,
            },
            select: { id: true },
          });
          createdIds.push(created.id);
        }
        if (
          submission.purpose === 'primary' &&
          targetStillUnchanged &&
          createdIds[0]
        ) {
          await tx.storyAssetSpec.updateMany({
            where: {
              id: generation.assetSpecId!,
              version: generation.targetVersion,
              sourceFingerprint: generation.targetSourceFingerprint,
              status: { not: StoryProductionSpecStatus.archived },
            },
            data: {
              selectedMediaVersionId: createdIds[0],
              version: { increment: 1 },
            },
          });
        }
      } else {
        if (target.targetKind !== 'storyboard_clip') {
          throw new StoryMaterializationError(
            'STORY_GENERATION_TARGET_KIND_MISMATCH',
            'The completed Storyboard generation resolved to an invalid target kind.',
            false,
          );
        }
        const latest = await tx.storyStoryboardClipMediaVersion.findFirst({
          where: { storyboardClipId: generation.storyboardClipId! },
          orderBy: { versionNumber: 'desc' },
          select: { versionNumber: true },
        });
        const createdIds: string[] = [];
        for (const [index, output] of outputRows.entries()) {
          const created = await tx.storyStoryboardClipMediaVersion.create({
            data: {
              storyProjectId: generation.storyProjectId,
              storyChapterId: generation.storyChapterId,
              storyboardClipId: generation.storyboardClipId!,
              versionNumber: (latest?.versionNumber ?? 0) + index + 1,
              mediaAssetId: output.assetId!,
              sourceFingerprint: generation.targetSourceFingerprint,
              generationSnapshot: {
                ...generationSnapshot,
                aiJobOutputId: output.id,
                outputIndex: output.outputIndex,
                generatedSourceDurationSeconds: output.asset!.durationSeconds,
              } as Prisma.InputJsonValue,
              generationId: generation.id,
              aiJobId: generation.aiJobId,
              aiJobOutputId: output.id,
              createdByUserId: generation.actorUserId,
            },
            select: { id: true },
          });
          createdIds.push(created.id);
        }
        if (targetStillUnchanged && createdIds[0]) {
          const generatedDurationMs =
            generation.generationKind === StoryProductionGenerationKind.video
              ? generatedVideoDurationMs(outputRows[0].asset!.durationSeconds)
              : null;
          const timelineResize = generatedDurationMs
            ? await this.productionPlans.prepareStoryboardTimelineResizeInTransaction(
                tx,
                {
                  projectId: generation.storyProjectId,
                  chapterId: generation.storyChapterId,
                  sequenceId: target.sequenceId,
                  clipId: generation.storyboardClipId!,
                  durationMs: generatedDurationMs,
                },
              )
            : null;
          const selected = await tx.storyStoryboardClip.updateMany({
            where: {
              id: generation.storyboardClipId!,
              version: generation.targetVersion,
              sourceFingerprint: generation.targetSourceFingerprint,
              status: { not: StoryProductionSpecStatus.archived },
            },
            data: {
              selectedMediaVersionId: createdIds[0],
              ...(generatedDurationMs
                ? { durationMs: generatedDurationMs }
                : {}),
              version: { increment: 1 },
            },
          });
          if (selected.count === 1 && timelineResize) {
            await this.productionPlans.applyStoryboardTimelineResizeInTransaction(
              tx,
              {
                sequenceId: target.sequenceId,
                clipId: generation.storyboardClipId!,
                resize: timelineResize,
              },
            );
          }
        }
      }
      await tx.storyProductionGeneration.update({
        where: { id: generation.id },
        data: {
          materializedAt: now,
          materializationError: Prisma.DbNull,
          nextReconcileAt: null,
          lastReconciledAt: now,
        },
      });
    });
  }

  private async claimCompletedGenerations(batch: number): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      WITH candidates AS (
        SELECT generation."id"
        FROM "story_production_generations" AS generation
        INNER JOIN "ai_jobs" AS job ON job."id" = generation."ai_job_id"
        WHERE generation."materialized_at" IS NULL
          AND job."status" = 'completed'::"AiJobStatus"
          AND (
            (
              generation."materialization_error" IS NULL
              AND generation."next_reconcile_at" IS NULL
            )
            OR generation."next_reconcile_at" <= transaction_timestamp()
          )
        ORDER BY generation."created_at" ASC, generation."id" ASC
        FOR UPDATE OF generation SKIP LOCKED
        LIMIT ${batch}
      )
      UPDATE "story_production_generations" AS generation
      SET "next_reconcile_at" = transaction_timestamp() + (${RECONCILE_LEASE_MS} * INTERVAL '1 millisecond'),
          "last_reconciled_at" = transaction_timestamp(),
          "updated_at" = transaction_timestamp()
      FROM candidates
      WHERE generation."id" = candidates."id"
      RETURNING generation."id"
    `);
    return rows.map((row) => row.id);
  }

  private async claimCompletedGeneration(
    generationId: string,
  ): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      UPDATE "story_production_generations" AS generation
      SET "next_reconcile_at" = transaction_timestamp() + (${RECONCILE_LEASE_MS} * INTERVAL '1 millisecond'),
          "last_reconciled_at" = transaction_timestamp(),
          "updated_at" = transaction_timestamp()
      FROM "ai_jobs" AS job
      WHERE generation."id" = ${generationId}::uuid
        AND job."id" = generation."ai_job_id"
        AND generation."materialized_at" IS NULL
        AND job."status" = 'completed'::"AiJobStatus"
        AND (
          (
            generation."materialization_error" IS NULL
            AND generation."next_reconcile_at" IS NULL
          )
          OR generation."next_reconcile_at" <= transaction_timestamp()
        )
      RETURNING generation."id"
    `);
    return rows.length === 1;
  }

  private async requireGeneration(input: {
    generationId: string;
    projectId: string;
    chapterId: string;
    targetKind: StoryProductionGenerationTargetKind;
    targetId: string;
    sequenceId: string | null;
  }): Promise<GenerationResponseRow> {
    const row = await this.prisma.storyProductionGeneration.findFirst({
      where: {
        id: input.generationId,
        storyProjectId: input.projectId,
        storyChapterId: input.chapterId,
        targetKind: input.targetKind,
        ...(input.targetKind === StoryProductionGenerationTargetKind.asset_spec
          ? { assetSpecId: input.targetId }
          : {
              storyboardClipId: input.targetId,
              ...(input.sequenceId
                ? { storyboardClip: { sequenceId: input.sequenceId } }
                : {}),
            }),
      },
      include: GENERATION_RESPONSE_INCLUDE,
    });
    if (!row)
      throw productionNotFound(
        'Story production generation',
        input.generationId,
      );
    return row;
  }

  private async requireGenerationById(
    id: string,
  ): Promise<GenerationResponseRow> {
    const row = await this.prisma.storyProductionGeneration.findUnique({
      where: { id },
      include: GENERATION_RESPONSE_INCLUDE,
    });
    if (!row) throw productionNotFound('Story production generation', id);
    return row;
  }

  private findReplay(
    chapterId: string,
    actorUserId: string,
    idempotencyKey: string,
  ) {
    return this.prisma.storyProductionGeneration.findUnique({
      where: {
        storyChapterId_actorUserId_idempotencyKey: {
          storyChapterId: chapterId,
          actorUserId,
          idempotencyKey,
        },
      },
    });
  }

  private assertReplay(
    replay: {
      storyProjectId: string;
      targetKind: StoryProductionGenerationTargetKind;
      assetSpecId: string | null;
      storyboardClipId: string | null;
      requestFingerprint: string;
    },
    command: Pick<
      SubmitGenerationCommand,
      'projectId' | 'targetKind' | 'targetId'
    >,
    requestFingerprint: string,
  ): void {
    const expectedKind =
      command.targetKind === 'asset_spec'
        ? StoryProductionGenerationTargetKind.asset_spec
        : StoryProductionGenerationTargetKind.storyboard_clip;
    const replayTargetId = replay.assetSpecId ?? replay.storyboardClipId;
    if (
      replay.storyProjectId === command.projectId &&
      replay.targetKind === expectedKind &&
      replayTargetId === command.targetId &&
      replay.requestFingerprint === requestFingerprint
    ) {
      return;
    }
    throw new ConflictException({
      code: 'STORY_GENERATION_IDEMPOTENCY_CONFLICT',
      message:
        'This idempotency key was already used for a different Story generation request.',
    });
  }

  private async requireScope(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    chapterId: string,
    capability: 'story.read' | 'story.generate',
  ): Promise<void> {
    const projectWorkspaceId = await this.requireProjectScope(
      user,
      projectId,
      chapterId,
      capability,
    );
    if (projectWorkspaceId !== workspaceId) {
      throw new NotFoundException({
        code: 'STORY_PROJECT_NOT_FOUND',
        message: 'Story project not found.',
      });
    }
  }

  private async requireProjectScope(
    user: AuthUser,
    projectId: string,
    chapterId: string,
    capability: 'story.read' | 'story.generate',
  ): Promise<string> {
    const { project } = await this.permissions.requireProject(
      user.userId,
      projectId,
      capability,
    );
    const chapter = await this.prisma.storyChapter.findFirst({
      where: { id: chapterId, storyProjectId: projectId, archivedAt: null },
      select: { id: true },
    });
    if (!chapter) throw productionNotFound('Story chapter', chapterId);
    return project.workspaceId;
  }

  private toGenerationDto(row: GenerationResponseRow) {
    const targetKind =
      row.targetKind === StoryProductionGenerationTargetKind.asset_spec
        ? 'asset_spec'
        : 'storyboard_clip';
    const targetId = row.assetSpecId ?? row.storyboardClipId!;
    const sequenceId = row.storyboardClip?.sequenceId ?? null;
    if (targetKind === 'storyboard_clip' && !sequenceId) {
      throw new InternalServerErrorException({
        code: 'STORY_GENERATION_TARGET_CORRUPT',
        message: 'Storyboard generation is missing its owning sequence.',
      });
    }
    const basePath = storyProductionGenerationBasePath({
      projectId: row.storyProjectId,
      chapterId: row.storyChapterId,
      generationId: row.id,
      target:
        targetKind === 'asset_spec'
          ? { kind: 'asset_spec', id: targetId }
          : {
              kind: 'storyboard_clip',
              id: targetId,
              sequenceId: sequenceId!,
            },
    });
    const progress = toStoryProductionGenerationProgressDto(row);
    const submission = parseSubmissionSnapshot(row.submissionSnapshot);
    const mediaVersions =
      targetKind === 'asset_spec'
        ? row.assetMediaVersions.map((version) =>
            this.toCreativeMediaVersionDto(version, submission.purpose),
          )
        : row.storyboardMediaVersions.map((version) =>
            this.toCreativeMediaVersionDto(version, 'primary'),
          );
    const generatedSourceDurationSeconds =
      mediaVersions.find((version) => version.durationSeconds !== null)
        ?.durationSeconds ?? null;
    return {
      id: row.id,
      projectId: row.storyProjectId,
      chapterId: row.storyChapterId,
      target: {
        kind: targetKind,
        id: targetId,
        sequenceId,
      },
      outputKind: row.generationKind,
      purpose: submission.purpose,
      targetVersion: row.targetVersion,
      targetSourceFingerprint: row.targetSourceFingerprint,
      retryOfGenerationId: row.retryOfGenerationId,
      ...progress,
      materialization: {
        ...progress.materialization,
        retryUrl: `${basePath}/materialization/retry`,
      },
      timing: {
        timelineDurationMs: submission.timelineDurationMs,
        requestedSourceDurationSeconds:
          submission.requestedSourceDurationSeconds,
        generatedSourceDurationSeconds,
        trimToTimeline:
          submission.timelineDurationMs !== null &&
          (generatedSourceDurationSeconds ??
            submission.requestedSourceDurationSeconds ??
            0) *
            1_000 >
            submission.timelineDurationMs,
      },
      mediaVersions,
      statusUrl: basePath,
      cancelUrl: `${basePath}/cancel`,
      retryUrl: `${basePath}/retry`,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toCreativeMediaVersionDto(
    row: GenerationCreativeMediaVersionRow,
    purpose: StoryAssetGenerationPurpose,
  ) {
    const previewUrl = this.assetUrls.resolvePublicUrl(row.mediaAsset);
    const preferredKey =
      row.preferredVariant?.status === MediaAssetVariantStatus.ready &&
      !row.preferredVariant.deletedAt
        ? row.preferredVariant.variantKey
        : undefined;
    const thumbnailVariant = row.mediaAsset.variants.find(
      (variant) => variant.kind === MediaAssetVariantKind.thumbnail,
    );
    const thumbnailUrl = resolveVariantUrl(
      this.assetUrls,
      row.mediaAsset,
      preferredKey ?? thumbnailVariant?.variantKey,
    );
    return {
      id: row.id,
      versionNumber: row.versionNumber,
      mediaAssetId: row.mediaAssetId,
      mediaKind: row.mediaAsset.kind,
      mediaStatus: row.mediaAsset.status,
      preferredVariantId: row.preferredVariantId,
      previewUrl,
      thumbnailUrl: thumbnailUrl ?? previewUrl,
      width: row.mediaAsset.width,
      height: row.mediaAsset.height,
      durationSeconds: row.mediaAsset.durationSeconds,
      mimeType: row.mediaAsset.contentType,
      sourceFingerprint: row.sourceFingerprint,
      purpose,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

interface ProviderReference {
  width?: number | null;
  height?: number | null;
  bindingId: string;
  binding: AiSubmitReferenceBinding & {
    kind: 'image' | 'video';
    url: string;
    assetId: string;
  };
}

export function modelCompatibilityIssue(
  model: AiModelDefinition,
  kind: 'image' | 'video',
  references: ProviderReference[],
): { code: string; message: string } | null {
  if (!model.enabled) {
    return {
      code: 'STORY_GENERATION_MODEL_UNAVAILABLE',
      message:
        model.disabledReason ?? 'The selected generation model is disabled.',
    };
  }
  if (model.type !== kind) {
    return {
      code: 'STORY_GENERATION_MODEL_KIND_MISMATCH',
      message: `This production target requires a ${kind} generation model.`,
    };
  }
  const properties = model.input_schema.properties ?? {};
  if (!properties.prompt) {
    return {
      code: 'STORY_GENERATION_MODEL_PROMPT_UNSUPPORTED',
      message: 'The selected model does not accept a Story prompt.',
    };
  }
  // Single capability authority: the canonical's declared generationModes
  // decide whether this request shape is quotable at all. A text-only request
  // must never quote an i2v-only model (the kling-motion class of failure:
  // quoted, billed, then rejected 422 by the provider for image_url).
  // Models with no declared modes keep the schema-only checks below.
  if (model.generationModes?.length) {
    const shape = generationRequestShape(
      kind,
      references.map((reference) => reference.binding.kind),
    );
    if (!modelSupportsRequest(model.generationModes, shape)) {
      return {
        code: 'STORY_GENERATION_MODEL_MODE_UNSUPPORTED',
        message:
          `The selected model only supports ${model.generationModes.join(', ')} ` +
          `and cannot serve ${describeGenerationRequestShape(shape)}.`,
      };
    }
  }
  for (const referenceKind of ['image', 'video'] as const) {
    const count = references.filter(
      (reference) => reference.binding.kind === referenceKind,
    ).length;
    if (count === 0) continue;
    const field =
      referenceKind === 'image' ? 'referenceImages' : 'referenceVideos';
    const property = properties[field];
    if (!property) {
      return {
        code: 'STORY_GENERATION_MODEL_REFERENCES_UNSUPPORTED',
        message: `The selected model cannot consume the target's ${referenceKind} references.`,
      };
    }
    const maxItems = numberValue(jsonObject(property).maxItems);
    if (maxItems !== null && count > maxItems) {
      return {
        code: 'STORY_GENERATION_REFERENCE_LIMIT_EXCEEDED',
        message: `The selected model accepts at most ${maxItems} ${referenceKind} references; this target resolves ${count}.`,
      };
    }
  }
  return null;
}

function assetTarget(
  row: AssetTargetRow,
  generationKind: 'image' | 'video',
  purpose: StoryAssetGenerationPurpose,
  referencedAssets: AssetTargetRow[] = [],
): StoryGenerationTarget {
  if (purpose === 'turnaround' && row.kind !== 'character') {
    throw new BadRequestException({
      code: 'STORY_GENERATION_PURPOSE_UNSUPPORTED',
      message: 'Three-view generation is only available for character assets.',
    });
  }
  const turnaroundReference: ResolvedTargetReference | null =
    purpose === 'turnaround'
      ? {
          bindingId: `turnaround:${row.id}`,
          refId: `asset:${row.id}:primary`,
          role: 'identity_reference',
          stableKey: row.stableKey,
          label: row.name,
          rank: 0,
          required: true,
          mediaVersionId: row.selectedMediaVersionId,
          mediaAsset: row.selectedMediaVersion?.mediaAsset ?? null,
        }
      : null;
  const mentionedAssets = new Map(
    referencedAssets.map((asset) => [asset.stableKey, asset]),
  );
  const promptReferences = extractStoryAssetMentions(
    assetGenerationPrompt(row, generationKind, purpose),
  ).flatMap((stableKey, index) => {
    const asset = mentionedAssets.get(stableKey);
    if (!asset || asset.id === row.id) return [];
    return [
      {
        bindingId: `asset-mention:${row.id}:${asset.id}`,
        refId: `asset:${asset.id}:selected`,
        role: 'reference',
        stableKey: asset.stableKey,
        label: asset.name,
        rank: index + (turnaroundReference ? 1 : 0),
        required: false,
        mediaVersionId: asset.selectedMediaVersionId,
        mediaAsset:
          asset.selectedMediaVersion?.archivedAt === null
            ? asset.selectedMediaVersion.mediaAsset
            : null,
      } satisfies ResolvedTargetReference,
    ];
  });
  const references = turnaroundReference
    ? [turnaroundReference, ...promptReferences]
    : promptReferences;
  const logicalSnapshot = {
    version: GENERATION_TARGET_SNAPSHOT_VERSION,
    targetKind: 'asset_spec',
    id: row.id,
    versionNumber: row.version,
    status: row.status,
    sourceFingerprint: row.sourceFingerprint,
    selectedMediaVersionId: row.selectedMediaVersionId,
    purpose,
    promptProfile:
      purpose === 'turnaround' ? CHARACTER_TURNAROUND_PROMPT_PROFILE : null,
    imagePrompt: row.imagePrompt,
    videoPrompt: row.videoPrompt,
    negativePrompt: row.negativePrompt,
    generationConfig: row.generationConfig,
    frameProfile: row.project.frameProfile,
    references: references.map((reference) => ({
      bindingId: reference.bindingId,
      refId: reference.refId,
      stableKey: reference.stableKey,
      mediaVersionId: reference.mediaVersionId,
      mediaAssetId: reference.mediaAsset?.id ?? null,
    })),
  };
  return {
    targetKind: 'asset_spec',
    targetId: row.id,
    sequenceId: null,
    generationKind,
    version: row.version,
    sourceFingerprint: row.sourceFingerprint,
    status: row.status,
    assetKind: row.kind,
    purpose,
    prompt: assetGenerationPrompt(row, generationKind, purpose),
    negativePrompt: row.negativePrompt,
    generationConfig: row.generationConfig,
    frameProfile: row.project.frameProfile,
    durationMs: null,
    logicalSnapshot,
    references,
  };
}

function assetGenerationPrompt(
  row: Pick<AssetTargetRow, 'imagePrompt' | 'name' | 'videoPrompt'>,
  generationKind: 'image' | 'video',
  purpose: StoryAssetGenerationPurpose,
): string {
  if (purpose === 'turnaround') {
    return characterTurnaroundPrompt(row.name, row.imagePrompt);
  }
  return generationKind === 'video' ? (row.videoPrompt ?? '') : row.imagePrompt;
}

function characterTurnaroundPrompt(
  name: string,
  identityPrompt: string,
): string {
  return [
    `Create a high-resolution professional character turnaround and detail reference board for "${name}".`,
    '',
    'IDENTITY SOURCE',
    'Treat the attached primary character image as the authoritative identity reference. Preserve the same face, head shape, hairstyle or fur, body proportions, apparent age, wardrobe, materials, colors, accessories, and overall silhouette in every view and detail.',
    `Character specification: ${identityPrompt}`,
    '',
    'CANVAS AND PRESENTATION',
    'Use a landscape composition on a pure white background. The board must feel minimal, spacious, orderly, and premium, like a professional game-art modeling sheet, character design reference page, or 3D character turnaround board. Preserve the source art direction while rendering materials and anatomy with precise, high-fidelity detail. Use consistent eye-level camera height, neutral studio lighting, sharp silhouettes, natural hair or fur, and no dramatic perspective.',
    '',
    'LEFT MAIN REGION — FULL-BODY TURNAROUND',
    "Show exactly three complete, uncropped full-body views at the same scale: front, left profile, and back. These are three views of one identical character, not three different characters. Keep facial structure, hair or fur, clothing when present, body shape, proportions, materials, and colors identical. Use a relaxed neutral model-reference pose appropriate to the character's anatomy; for humanoids, let the arms rest naturally at the sides. Keep silhouettes unobstructed with enough spacing for character-modeling reference.",
    '',
    'RIGHT UPPER REGION — HEAD-ANGLE GRID',
    'Arrange exactly six clear head or head-and-shoulder studies of the same character in a clean grid: front, slightly elevated view revealing the crown, rear of the head, left profile, near-profile comparison, and three-quarter view. Preserve the same facial anatomy, hair or fur separation, proportions, and identity in all six studies.',
    '',
    'RIGHT LOWER REGION — DESIGN-DETAIL GRID',
    "Arrange exactly six close-up studies of the character's most identity-defining details. Select only details that truly exist in the reference, such as garment fabric and construction, upper- or lower-body tailoring, hair or fur, skin or surface texture, eyes or facial features, footwear, or a signature accessory. Keep every material, color, shape, and construction detail consistent with the main turnaround; do not invent clothing, anatomy, footwear, or accessories that the character does not have.",
    '',
    'OUTPUT CONSTRAINTS',
    'Keep every full-body view completely visible with generous white space. No cropped bodies, extra full-body poses, unrelated people, extra props, scenery, complex background, captions, annotations, logos, watermarks, interface elements, social-media framing, like buttons, or save buttons.',
  ].join('\n');
}

function clipTarget(row: ClipTargetRow): StoryGenerationTarget {
  const targetStatus = row.status;
  const references = row.assetBindings.map((binding) => {
    const mediaVersion =
      binding.mode === StoryStoryboardBindingMode.pinned
        ? binding.pinnedMediaVersion
        : binding.assetSpec.selectedMediaVersion;
    return {
      bindingId: binding.id,
      refId: binding.id,
      role: binding.role,
      stableKey: binding.assetSpec.stableKey,
      label: binding.assetSpec.name,
      rank: binding.rank,
      required: binding.required,
      mediaVersionId: mediaVersion?.id ?? null,
      mediaAsset:
        mediaVersion && mediaVersion.archivedAt === null
          ? mediaVersion.mediaAsset
          : null,
    } satisfies ResolvedTargetReference;
  });
  const logicalSnapshot = {
    version: STORYBOARD_CLIP_TARGET_SNAPSHOT_VERSION,
    targetKind: 'storyboard_clip',
    id: row.id,
    sequenceId: row.sequenceId,
    sequence: {
      id: row.sequence.id,
      versionNumber: row.sequence.version,
      status: row.sequence.status,
      sourceFingerprint: row.sequence.sourceFingerprint,
    },
    versionNumber: row.version,
    status: targetStatus,
    sourceFingerprint: row.sourceFingerprint,
    selectedMediaVersionId: row.selectedMediaVersionId,
    kind: row.kind,
    startMs: row.startMs,
    durationMs: row.durationMs,
    imagePrompt: row.imagePrompt,
    videoPrompt: row.videoPrompt,
    negativePrompt: row.negativePrompt,
    generationConfig: row.generationConfig,
    frameProfile: row.project.frameProfile,
    bindings: row.assetBindings.map((binding, index) => {
      const resolved = references[index];
      return {
        id: binding.id,
        versionNumber: binding.version,
        status: binding.status,
        sourceFingerprint: binding.sourceFingerprint,
        mode: binding.mode,
        role: binding.role,
        required: binding.required,
        rank: binding.rank,
        assetSpec: {
          id: binding.assetSpec.id,
          versionNumber: binding.assetSpec.version,
          status: binding.assetSpec.status,
          sourceFingerprint: binding.assetSpec.sourceFingerprint,
          selectedMediaVersionId: binding.assetSpec.selectedMediaVersionId,
        },
        pinnedMediaVersionId: binding.pinnedMediaVersionId,
        resolvedMediaVersionId: resolved?.mediaVersionId ?? null,
        resolvedMediaAssetId: resolved?.mediaAsset?.id ?? null,
      };
    }),
  };
  return {
    targetKind: 'storyboard_clip',
    targetId: row.id,
    sequenceId: row.sequenceId,
    generationKind: row.kind,
    version: row.version,
    sourceFingerprint: row.sourceFingerprint,
    status: targetStatus,
    prompt:
      row.kind === 'video' ? (row.videoPrompt ?? '') : (row.imagePrompt ?? ''),
    negativePrompt: row.negativePrompt,
    generationConfig: row.generationConfig,
    frameProfile: row.project.frameProfile,
    durationMs: row.durationMs,
    logicalSnapshot,
    references,
  };
}

/**
 * Split the prompt at its inline `@stableKey` mentions into text and
 * asset_ref nodes, mirroring the platform prompt composer: a resolved mention
 * becomes an asset_ref node at its authored position; a mention whose asset
 * has no provider-accessible media degrades to the asset's display name so
 * the logical reference still contributes textually. Prompts without inline
 * mentions fall back to appending the resolved references.
 */
function providerPromptDocument(
  prompt: string,
  targetReferences: ResolvedTargetReference[],
  references: ProviderReference[],
): AiPromptDocument {
  const providerByBindingId = new Map(
    references.map((reference) => [reference.bindingId, reference]),
  );
  interface MentionSpan {
    start: number;
    end: number;
    reference: ResolvedTargetReference;
  }
  const spans: MentionSpan[] = [];
  const byKeyLengthDesc = [...targetReferences].sort(
    (a, b) => b.stableKey.length - a.stableKey.length,
  );
  for (const reference of byKeyLengthDesc) {
    if (!reference.stableKey) continue;
    const token = `@${reference.stableKey}`;
    let index = prompt.indexOf(token);
    while (index !== -1) {
      const end = index + token.length;
      // Mirror STORY_ASSET_MENTION_PATTERN's trailing semantics: a separator
      // only extends the token when a word character follows, so a mention at
      // sentence end ("... of @location_lighthouse.") still matches.
      const next = prompt[end];
      const boundaryOk =
        end >= prompt.length ||
        (!/[A-Za-z0-9_]/.test(next) &&
          !(
            /[.:-]/.test(next) &&
            end + 1 < prompt.length &&
            /[A-Za-z0-9_]/.test(prompt[end + 1])
          ));
      const overlaps = spans.some(
        (span) => index < span.end && end > span.start,
      );
      if (boundaryOk && !overlaps) {
        spans.push({ start: index, end, reference });
      }
      index = prompt.indexOf(token, end);
    }
  }
  spans.sort((a, b) => a.start - b.start);

  if (spans.length === 0) {
    if (references.length === 0) {
      return { version: 1, nodes: [{ type: 'text', text: prompt }] };
    }
    return {
      version: 1,
      nodes: [
        { type: 'text', text: `${prompt}\n\nReferences: ` },
        ...references.flatMap((reference, index) => [
          ...(index > 0 ? ([{ type: 'text', text: ', ' }] as const) : []),
          {
            type: 'asset_ref' as const,
            refId: reference.binding.refId,
            label: reference.binding.label,
          },
        ]),
      ],
    };
  }

  const nodes: AiPromptDocument['nodes'] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) {
      nodes.push({ type: 'text', text: prompt.slice(cursor, span.start) });
    }
    const provider = providerByBindingId.get(span.reference.bindingId);
    if (provider) {
      nodes.push({
        type: 'asset_ref',
        refId: provider.binding.refId,
        label: provider.binding.label,
      });
    } else {
      nodes.push({ type: 'text', text: span.reference.label });
    }
    cursor = span.end;
  }
  if (cursor < prompt.length) {
    nodes.push({ type: 'text', text: prompt.slice(cursor) });
  }
  return { version: 1, nodes };
}

export function generationRequestFingerprint(
  command: SubmitGenerationCommand,
  resolved: ResolvedGenerationRequest,
): string {
  return canonicalJsonHash({
    operation: command.retryOf ? 'generation.retry' : 'generation.create',
    projectId: command.projectId,
    chapterId: command.chapterId,
    targetKind: command.targetKind,
    targetId: command.targetId,
    sequenceId: command.sequenceId,
    expectedVersion: command.expectedVersion,
    modelId: command.modelId ?? null,
    schemaVersion: command.schemaVersion ?? null,
    clientOptions: command.clientOptions ?? {},
    requestedOutputKind: command.requestedOutputKind ?? null,
    requestedPurpose: command.requestedPurpose ?? 'primary',
    expectedQuote: command.expectedQuote ?? null,
    retryOfGenerationId: command.retryOf?.generationId ?? null,
    resolved,
  });
}

function resolvedGenerationRequestFromSnapshots(generation: {
  submissionSnapshot: Prisma.JsonValue;
  promptSnapshot: Prisma.JsonValue;
}): ResolvedGenerationRequest {
  const submission = parseSubmissionSnapshot(generation.submissionSnapshot);
  const targetSnapshotFingerprint = stringValue(
    jsonObject(generation.promptSnapshot).targetSnapshotFingerprint,
  );
  if (!targetSnapshotFingerprint) {
    throw new InternalServerErrorException({
      code: 'STORY_GENERATION_SNAPSHOT_CORRUPT',
      message: 'The generation target snapshot is incomplete.',
    });
  }
  return {
    modelId: submission.modelId,
    schemaVersion: submission.schemaVersion,
    effectiveOptions: submission.effectiveOptions,
    targetSnapshotFingerprint,
  };
}

function sourceDurationSeconds(
  model: AiModelDefinition,
  target: StoryGenerationTarget,
  effectiveOptions: Record<string, unknown>,
): number | null {
  if (
    target.targetKind !== 'storyboard_clip' ||
    target.generationKind !== 'video'
  ) {
    return null;
  }
  const properties = model.input_schema.properties ?? {};
  const field = storyDurationProperty(properties);
  return field ? numericDuration(effectiveOptions[field]) : null;
}

function storyDurationProperty(
  properties: Record<string, unknown>,
): 'duration' | 'durationSeconds' | 'duration_seconds' | null {
  if (properties.durationSeconds) return 'durationSeconds';
  if (properties.duration_seconds) return 'duration_seconds';
  return properties.duration ? 'duration' : null;
}

function parseSubmissionSnapshot(
  value: Prisma.JsonValue,
): StoryGenerationSubmissionSnapshot {
  const row = jsonObject(value);
  const modelId = stringValue(row.modelId);
  const schemaVersion = stringValue(row.schemaVersion);
  const outputKind = stringValue(row.outputKind);
  const purpose = stringValue(row.purpose) ?? 'primary';
  const sourceSurface = stringValue(row.sourceSurface);
  if (
    row.version !== GENERATION_SUBMISSION_SNAPSHOT_VERSION ||
    !modelId ||
    !schemaVersion ||
    (outputKind !== 'image' && outputKind !== 'video') ||
    (purpose !== 'primary' && purpose !== 'turnaround') ||
    sourceSurface !== STORY_STUDIO_WORKBENCH_SURFACE
  ) {
    throw new InternalServerErrorException({
      code: 'STORY_GENERATION_SUBMISSION_SNAPSHOT_CORRUPT',
      message: 'The saved generation submission snapshot is invalid.',
    });
  }
  const clientOptions = storyGenerationClientOptionsFromSnapshot(
    row.clientOptions,
  );
  return {
    version: 1,
    modelId,
    schemaVersion,
    outputKind,
    purpose,
    clientOptions,
    effectiveOptions: jsonObject(row.effectiveOptions),
    timelineDurationMs:
      typeof row.timelineDurationMs === 'number' &&
      Number.isSafeInteger(row.timelineDurationMs) &&
      row.timelineDurationMs > 0
        ? row.timelineDurationMs
        : null,
    requestedSourceDurationSeconds:
      typeof row.requestedSourceDurationSeconds === 'number' &&
      Number.isFinite(row.requestedSourceDurationSeconds) &&
      row.requestedSourceDurationSeconds > 0
        ? row.requestedSourceDurationSeconds
        : null,
    sourceSurface: STORY_STUDIO_WORKBENCH_SURFACE,
  };
}

/**
 * Early durable batches stored the server-resolved source duration in the
 * snapshot's client-options field. The provider job is already immutable at
 * this point, so discard only those two known server-owned keys while keeping
 * every other reserved option subject to the normal strict validation.
 */
export function storyGenerationClientOptionsFromSnapshot(
  value: unknown,
): StoryGenerationOptions {
  return StoryGenerationOptionsSchema.parse(jsonObject(value));
}

function materializationFailure(error: unknown): MaterializationFailureShape {
  if (error instanceof StoryMaterializationError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      occurredAt: new Date().toISOString(),
    };
  }
  const prismaCode =
    error instanceof Prisma.PrismaClientKnownRequestError ? error.code : null;
  return {
    code: prismaCode
      ? `PRISMA_${prismaCode}`
      : 'STORY_GENERATION_MATERIALIZATION_FAILED',
    message: safeErrorMessage(error),
    retryable: isRetryableStoryMaterializationPrismaCode(prismaCode),
    occurredAt: new Date().toISOString(),
  };
}

function assertReattachReceipt(
  receipt: { operation: string; requestFingerprint: string },
  operation: string,
  requestFingerprint: string,
): void {
  if (
    receipt.operation === operation &&
    receipt.requestFingerprint === requestFingerprint
  ) {
    return;
  }
  throw new ConflictException({
    code: 'STORY_PRODUCTION_IDEMPOTENCY_CONFLICT',
    message:
      'This idempotency key was already used for a different Story production mutation.',
  });
}

export function isRetryableStoryMaterializationPrismaCode(
  code: string | null,
): boolean {
  return code === null || ['P2002', 'P2024', 'P2028', 'P2034'].includes(code);
}

class StoryMaterializationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

function productionNotFound(resource: string, id: string): NotFoundException {
  return new NotFoundException({
    code: 'STORY_PRODUCTION_RESOURCE_NOT_FOUND',
    message: `${resource} not found.`,
    id,
  });
}

function normalizeIdempotencyKey(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 160) {
    throw new BadRequestException({
      code: 'INVALID_IDEMPOTENCY_KEY',
      message: 'Idempotency-Key must contain between 1 and 160 characters.',
    });
  }
  return normalized;
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function estimateGenerationPoints(
  model: AiModelDefinition,
  aiInput: Record<string, unknown>,
) {
  const pricing = model.billing_policy?.productPricing;
  if (!pricing) {
    throw new BadRequestException({
      code: 'MODEL_PRICING_NOT_CONFIGURED',
      message: 'The selected generation model is missing product pricing.',
    });
  }
  return estimateProductModelPoints({
    policy: pricing,
    numOutputs: finiteNumber(aiInput.numOutputs),
    resolution: optionalString(aiInput.resolution),
    quality: optionalString(aiInput.quality),
    duration: durationValue(aiInput.duration),
    durationSeconds: finiteNumber(aiInput.durationSeconds),
    text: optionalString(aiInput.prompt),
    referenceMedia: {
      images: Array.isArray(aiInput.referenceImages)
        ? aiInput.referenceImages
        : [],
      videos: Array.isArray(aiInput.referenceVideos)
        ? aiInput.referenceVideos
        : [],
      audios: Array.isArray(aiInput.referenceAudios)
        ? aiInput.referenceAudios
        : [],
    },
    referenceImageCount: arraySize(aiInput.referenceImages),
    referenceVideoSeconds: mediaDurationSeconds(aiInput.referenceVideos),
    // Seedance 2.5 edit contract (doc 1520757): output keeps the source
    // video's duration — an explicit 'auto' quotes at the combined
    // reference-video length instead of the ceiling.
    outputDurationFollowsReferenceVideos:
      optionalString(aiInput.omniReferenceTaskType) === 'edit',
    generateAudio:
      typeof aiInput.generateAudio === 'boolean'
        ? aiInput.generateAudio
        : undefined,
    hasMask: aiInput.maskImage !== undefined && aiInput.maskImage !== null,
  });
}

export function assertStoryGenerationQuoteMatches(
  model: AiModelDefinition,
  aiInput: Record<string, unknown>,
  expectedQuote: { pricingVersion: string; points: number },
): void {
  const currentQuote = estimateGenerationPoints(model, aiInput);
  if (
    currentQuote.pricingVersion === expectedQuote.pricingVersion &&
    currentQuote.sellPoints === expectedQuote.points
  ) {
    return;
  }
  throw new ConflictException({
    code: 'STORY_GENERATION_BATCH_QUOTE_STALE',
    message:
      'The selected model pricing changed after confirmation. Request a fresh batch quote before generating.',
    quotedPricingVersion: expectedQuote.pricingVersion,
    currentPricingVersion: currentQuote.pricingVersion,
    quotedPoints: expectedQuote.points,
    currentPoints: currentQuote.sellPoints,
  });
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function durationValue(value: unknown): string | number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : optionalString(value);
}

function arraySize(value: unknown): number | undefined {
  return Array.isArray(value) ? value.length : undefined;
}

function mediaDurationSeconds(value: unknown): number | undefined {
  if (!Array.isArray(value)) return undefined;
  const total = (value as unknown[]).reduce<number>((sum, item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return sum;
    const record = item as Record<string, unknown>;
    const seconds =
      finiteNumber(record.durationSeconds) ??
      finiteNumber(record.duration) ??
      (finiteNumber(record.durationMs) ?? 0) / 1000;
    return sum + Math.max(0, seconds ?? 0);
  }, 0);
  return total > 0 ? total : undefined;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

export function storyModelSchemaDefaults(
  properties: Record<string, unknown>,
  current: Record<string, unknown>,
): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const [key, property] of Object.entries(properties)) {
    if (
      current[key] !== undefined ||
      SERVER_OWNED_AI_INPUT_FIELDS.has(key) ||
      !Object.prototype.hasOwnProperty.call(jsonObject(property), 'default')
    ) {
      continue;
    }
    defaults[key] = jsonObject(property).default;
  }
  return defaults;
}

export function missingRequiredStoryModelInputs(
  schema: {
    required?: readonly string[];
    properties?: Record<string, unknown>;
  },
  input: Record<string, unknown>,
): string[] {
  return (schema.required ?? []).filter(
    (field) => input[field] === undefined || input[field] === null,
  );
}

/**
 * Seed the generation form from the current clip without coupling the two
 * values afterwards. Choose the closest provider-supported value; ties prefer
 * the longer source.
 */
export function nearestStoryDurationValue(
  property: unknown,
  clipSeconds: number,
): { value: unknown; seconds: number } | undefined {
  const schema = jsonObject(property);
  if (!Number.isFinite(clipSeconds) || clipSeconds <= 0) return undefined;
  if (Array.isArray(schema.enum)) {
    return (schema.enum as unknown[])
      .map((value) => ({ value, seconds: numericDuration(value) }))
      .filter(
        (candidate): candidate is { value: unknown; seconds: number } =>
          candidate.seconds !== null,
      )
      .sort((left, right) => {
        const distance =
          Math.abs(left.seconds - clipSeconds) -
          Math.abs(right.seconds - clipSeconds);
        return distance || right.seconds - left.seconds;
      })[0];
  }

  const declaredTypes = Array.isArray(schema.type)
    ? schema.type
    : [schema.type];
  if (declaredTypes.includes('number') || declaredTypes.includes('integer')) {
    const minimum = numberValue(schema.minimum);
    const maximum = numberValue(schema.maximum);
    const exclusiveMinimum = numberValue(schema.exclusiveMinimum);
    const exclusiveMaximum = numberValue(schema.exclusiveMaximum);
    const multipleOf = numberValue(schema.multipleOf);
    let candidate = Math.min(
      maximum ?? clipSeconds,
      Math.max(minimum ?? clipSeconds, clipSeconds),
    );
    if (exclusiveMinimum !== null && candidate <= exclusiveMinimum) {
      if (multipleOf !== null && multipleOf > 0) {
        candidate =
          (Math.floor(exclusiveMinimum / multipleOf + 1e-9) + 1) * multipleOf;
      } else if (declaredTypes.includes('integer')) {
        candidate = Math.floor(exclusiveMinimum) + 1;
      } else {
        return undefined;
      }
    }
    if (multipleOf !== null && multipleOf > 0) {
      candidate = Math.round(candidate / multipleOf) * multipleOf;
      if (minimum !== null) candidate = Math.max(candidate, minimum);
      if (maximum !== null) candidate = Math.min(candidate, maximum);
    }
    if (declaredTypes.includes('integer')) {
      candidate = Math.round(candidate);
    }
    candidate = Number(candidate.toFixed(9));
    if (exclusiveMaximum !== null && candidate >= exclusiveMaximum) {
      return undefined;
    }
    return candidate > 0 ? { value: candidate, seconds: candidate } : undefined;
  }
  if (declaredTypes.includes('string') && schema.pattern === undefined) {
    return { value: String(clipSeconds), seconds: clipSeconds };
  }
  return undefined;
}

function numericDuration(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function generatedVideoDurationMs(durationSeconds: number | null): number {
  const durationMs =
    durationSeconds !== null ? Math.round(durationSeconds * 1_000) : 0;
  if (durationMs >= 250) return durationMs;
  throw new StoryMaterializationError(
    'STORY_GENERATION_OUTPUT_DURATION_MISSING',
    'The generated video has no valid duration metadata and cannot be placed on the Storyboard timeline.',
    false,
  );
}

function httpsUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

function safeBigIntNumber(value: bigint): number {
  const maximum = BigInt(Number.MAX_SAFE_INTEGER);
  return Number(value > maximum ? maximum : value);
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function reconcileBackoffMs(attempt: number): number {
  return Math.min(15 * 60_000, 2 ** Math.min(10, attempt) * 1_000);
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(/\s+/g, ' ').trim().slice(0, 500);
}

function resolveVariantUrl(
  resolver: MediaAssetUrlResolverService,
  asset: GenerationResponseRow['assetMediaVersions'][number]['mediaAsset'],
  variantKey: string | undefined,
): string | null {
  if (!variantKey) return null;
  try {
    return resolver.resolveVariant(asset, variantKey);
  } catch {
    return null;
  }
}
