import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AiControlPlaneStatus,
  MediaAssetKind,
  MediaAssetModerationStatus,
  MediaAssetStatus,
  MediaAssetVariantStatus,
  Prisma,
  StoryVideoGenerationAttemptStatus,
  StoryVideoReferenceRole,
  StoryVideoTargetKind,
} from '@prisma/client';
import type { AuthUser } from '../auth';
import {
  AiGenerationService,
  type AiJobCancellationHooks,
  type AiJobSubmissionHooks,
} from '../ai-generation/ai-generation.service';
import type { AiSubmitReferenceBinding } from '../ai-generation/prompt-document.types';
import type { AiModelDefinition } from '../ai-generation/types';
import { PrismaService } from '../infra/db/db.module';
import {
  MediaAssetUrlResolverService,
  resolveMediaPublicUrl,
} from '../infra/storage/media-asset-url-resolver.service';
import { canonicalJsonHash } from './canonical-json';
import {
  InteractiveFilmDraftContentSchema,
  type StoryVideoTechnicalCheckDto,
  type MediaAssetSummaryDto,
  type StoryClipVideoSummaryDto,
  type StoryCurrentVideoDto,
  type StoryTrailerVideoSummaryDto,
  type StoryVideoGenerationDto,
} from './dto';
import { StoryPermissionService } from './story-permission.service';
import { StoryProjectWriteGuardService } from './story-project-write-guard.service';
import {
  StoryVideoRecipeSnapshotSchema,
  type CancelStoryVideoGenerationInput,
  type CreateStoryClipVideoGenerationInput,
  type CreateStoryTrailerVideoGenerationInput,
  type PutStoryClipVideoSelectionInput,
  type PutStoryTrailerVideoSelectionInput,
  type RetryStoryVideoGenerationInput,
  type StoryVideoGenerationReferenceInput,
  type StoryVideoRecipeSnapshot,
} from './story-video-production.schema';

const MEDIA_ASSET_INCLUDE = Prisma.validator<Prisma.MediaAssetInclude>()({
  placements: true,
  variants: {
    include: { placements: true },
    orderBy: [{ variantKey: 'asc' }, { id: 'asc' }],
  },
});

const GENERATION_INCLUDE =
  Prisma.validator<Prisma.StoryVideoGenerationAttemptInclude>()({
    selection: { select: { targetKind: true, targetKey: true } },
    aiJob: {
      include: {
        outputs: {
          where: { deletedAt: null },
          orderBy: [{ outputIndex: 'asc' }, { id: 'asc' }],
          include: { asset: { include: MEDIA_ASSET_INCLUDE } },
        },
      },
    },
    outputAsset: { include: MEDIA_ASSET_INCLUDE },
    outputVariant: true,
  });

const REFERENCE_INCLUDE =
  Prisma.validator<Prisma.StoryReferenceVersionInclude>()({
    referenceSlot: true,
    approval: true,
    asset: { include: MEDIA_ASSET_INCLUDE },
    variant: { include: { placements: true } },
  });

type GenerationRow = Prisma.StoryVideoGenerationAttemptGetPayload<{
  include: typeof GENERATION_INCLUDE;
}>;
type ReferenceRow = Prisma.StoryReferenceVersionGetPayload<{
  include: typeof REFERENCE_INCLUDE;
}>;
type MediaAssetRow = Prisma.MediaAssetGetPayload<{
  include: typeof MEDIA_ASSET_INCLUDE;
}>;

type DirectRecipeInput = Pick<
  CreateStoryClipVideoGenerationInput,
  'prompt' | 'modelId' | 'mode' | 'durationMs' | 'references' | 'seed'
>;

type VideoTarget =
  | { kind: 'clip'; graphNodeId: string; expectedDraftRevision: number }
  | { kind: 'trailer' };

interface PreparedReference {
  referenceSlotId: string;
  referenceVersionId: string;
  role: StoryVideoReferenceRole;
  position: number;
  assetId: string;
  variantId: string;
  checksumSha256: string;
  url: string;
}

interface PreparedRecipe {
  model: AiModelDefinition;
  snapshot: StoryVideoRecipeSnapshot;
  aiInput: Record<string, unknown>;
  referenceBindings: AiSubmitReferenceBinding[] | undefined;
  references: PreparedReference[];
}

interface ExactVideoVariant {
  asset: MediaAssetRow;
  variantId: string;
  checksumSha256: string;
  contentType: string;
  durationMs: number;
  width: number;
  height: number;
  hasAudio: boolean;
  browserSafeMp4: true;
}

const TRAILER_TARGET_KEY = 'trailer';
const OUTPUT_METADATA_GRACE_MS = 60_000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

@Injectable()
export class StoryVideoProductionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: StoryPermissionService,
    private readonly aiGeneration: AiGenerationService,
    private readonly assetUrls: MediaAssetUrlResolverService,
    private readonly writeGuard: StoryProjectWriteGuardService,
  ) {}

  async createClipGeneration(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    graphNodeId: string,
    input: CreateStoryClipVideoGenerationInput,
    idempotencyKey: string,
  ): Promise<StoryVideoGenerationDto> {
    return this.createGeneration(user, workspaceId, projectId, {
      target: {
        kind: 'clip',
        graphNodeId,
        expectedDraftRevision: input.expectedDraftRevision,
      },
      expectedSelectionVersion: input.expectedSelectionVersion,
      recipe: input,
      idempotencyKey,
    });
  }

  async createTrailerGeneration(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    input: CreateStoryTrailerVideoGenerationInput,
    idempotencyKey: string,
  ): Promise<StoryVideoGenerationDto> {
    return this.createGeneration(user, workspaceId, projectId, {
      target: { kind: 'trailer' },
      expectedSelectionVersion: input.expectedSelectionVersion,
      recipe: input,
      idempotencyKey,
    });
  }

  async getGeneration(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    generationId: string,
  ): Promise<StoryVideoGenerationDto> {
    await this.requireProjectScope(user, workspaceId, projectId, 'story.read');
    const generation = await this.requireGeneration(projectId, generationId);
    return this.toGenerationDto(
      await this.reconcileGeneration(generation, workspaceId),
    );
  }

  async cancelGeneration(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    generationId: string,
    input: CancelStoryVideoGenerationInput,
  ): Promise<StoryVideoGenerationDto> {
    await this.requireProjectScope(
      user,
      workspaceId,
      projectId,
      'story.generate',
    );
    const generation = await this.requireGeneration(projectId, generationId);
    if (generation.version !== input.expectedGenerationVersion) {
      throw generationVersionConflict(
        input.expectedGenerationVersion,
        generation.version,
      );
    }
    if (!isTerminalGeneration(generation.status)) {
      const hooks: AiJobCancellationHooks = {
        beforeCancel: async (tx, job) => {
          // This callback and the AiJob `cancelled` transition share one DB
          // transaction. Locking the permanent project write-state first
          // closes the permission-boundary TOCTOU without holding a database
          // lock across provider/capacity/billing network lifecycle work.
          await this.writeGuard.assertHumanWriteAllowed(tx, projectId);
          const rows = await tx.$queryRaw<
            Array<{ id: string; version: number; aiJobId: string }>
          >`
            SELECT
              "id",
              "version",
              "ai_job_id" AS "aiJobId"
            FROM "story_video_generation_attempts"
            WHERE "id" = ${generationId}::uuid
              AND "story_project_id" = ${projectId}::uuid
            FOR UPDATE
          `;
          const locked = rows[0];
          if (!locked || locked.aiJobId !== job.id) {
            throw new NotFoundException({
              code: 'STORY_GENERATION_NOT_FOUND',
              message: 'Story video generation not found.',
            });
          }
          if (locked.version !== input.expectedGenerationVersion) {
            throw generationVersionConflict(
              input.expectedGenerationVersion,
              locked.version,
            );
          }
        },
        afterCancel: async (tx, job) => {
          // The Story attempt is project-visible state, so it must become
          // terminal in the very same transaction as the canonical AiJob.
          // Provider/capacity/billing cleanup may continue after commit, but
          // it can no longer cause a Story row write after Agent acquires the
          // project fence.
          const completedAt = job.completedAt
            ? new Date(job.completedAt)
            : new Date();
          const updated = await tx.storyVideoGenerationAttempt.updateMany({
            where: {
              id: generationId,
              storyProjectId: projectId,
              version: input.expectedGenerationVersion,
              status: {
                in: [
                  StoryVideoGenerationAttemptStatus.queued,
                  StoryVideoGenerationAttemptStatus.running,
                  StoryVideoGenerationAttemptStatus.processing,
                ],
              },
            },
            data: {
              status: StoryVideoGenerationAttemptStatus.cancelled,
              error: job.error == null ? Prisma.DbNull : asInputJson(job.error),
              completedAt,
              cancelledAt: completedAt,
              version: { increment: 1 },
            },
          });
          if (updated.count !== 1) {
            throw new ConflictException({
              code: 'STORY_GENERATION_CANCEL_CLAIM_LOST',
              message:
                'The Story generation changed before its cancellation could be committed.',
              generationId,
            });
          }
        },
      };
      await this.aiGeneration.cancelJob(user, generation.aiJobId, hooks);
    }
    return this.toGenerationDto(
      await this.reconcileGeneration(
        await this.requireGeneration(projectId, generationId),
        workspaceId,
      ),
    );
  }

  async retryGeneration(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    generationId: string,
    input: RetryStoryVideoGenerationInput,
    idempotencyKey: string,
  ): Promise<StoryVideoGenerationDto> {
    await this.requireProjectScope(
      user,
      workspaceId,
      projectId,
      'story.generate',
    );
    const previous = await this.requireGeneration(projectId, generationId);
    if (previous.version !== input.expectedGenerationVersion) {
      throw generationVersionConflict(
        input.expectedGenerationVersion,
        previous.version,
      );
    }
    if (
      previous.status !== StoryVideoGenerationAttemptStatus.failed &&
      previous.status !== StoryVideoGenerationAttemptStatus.cancelled &&
      previous.status !== StoryVideoGenerationAttemptStatus.superseded
    ) {
      throw new ConflictException({
        code: 'STORY_GENERATION_NOT_RETRYABLE',
        message: 'Only failed, cancelled, or superseded generations can retry.',
      });
    }

    const snapshot = parseRecipeSnapshot(previous.recipeSnapshot);
    const previousTarget = targetFromSelection(previous.selection);
    assertRetryTarget(previousTarget, input.target);
    const target: VideoTarget =
      input.target.kind === 'clip'
        ? {
            kind: 'clip',
            graphNodeId: input.target.graphNodeId,
            expectedDraftRevision: input.target.expectedDraftRevision,
          }
        : { kind: 'trailer' };

    return this.createGeneration(user, workspaceId, projectId, {
      target,
      expectedSelectionVersion: input.expectedSelectionVersion,
      recipe: {
        prompt: snapshot.prompt,
        modelId: snapshot.model.slug,
        mode: snapshot.mode,
        durationMs: snapshot.durationMs,
        references: snapshot.references.map((reference) => ({
          referenceVersionId: reference.referenceVersionId,
          role: reference.role,
        })),
        ...(snapshot.seed ? { seed: snapshot.seed } : {}),
      },
      idempotencyKey,
      exactRecipeSnapshot: snapshot,
    });
  }

  async putClipCurrentVideo(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    graphNodeId: string,
    input: PutStoryClipVideoSelectionInput,
  ): Promise<StoryClipVideoSummaryDto> {
    await this.requireProjectScope(
      user,
      workspaceId,
      projectId,
      'story.generate',
    );
    await this.putCurrentVideo(user, workspaceId, projectId, {
      target: {
        kind: 'clip',
        graphNodeId,
        expectedDraftRevision: input.expectedDraftRevision,
      },
      expectedSelectionVersion: input.expectedSelectionVersion,
      assetId: input.assetId,
      variantId: input.variantId,
    });
    return this.getClipSummary(user, workspaceId, projectId, graphNodeId);
  }

  async putTrailerCurrentVideo(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    input: PutStoryTrailerVideoSelectionInput,
  ): Promise<StoryTrailerVideoSummaryDto> {
    await this.requireProjectScope(
      user,
      workspaceId,
      projectId,
      'story.generate',
    );
    await this.putCurrentVideo(user, workspaceId, projectId, {
      target: { kind: 'trailer' },
      expectedSelectionVersion: input.expectedSelectionVersion,
      assetId: input.assetId,
      variantId: input.variantId,
    });
    return this.getTrailerSummary(user, workspaceId, projectId);
  }

  async getClipSummary(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    graphNodeId: string,
  ): Promise<StoryClipVideoSummaryDto> {
    await this.requireProjectScope(user, workspaceId, projectId, 'story.read');
    return this.loadTargetSummary(
      projectId,
      workspaceId,
      StoryVideoTargetKind.clip,
      graphNodeId,
    ) as Promise<StoryClipVideoSummaryDto>;
  }

  async getTrailerSummary(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
  ): Promise<StoryTrailerVideoSummaryDto> {
    await this.requireProjectScope(user, workspaceId, projectId, 'story.read');
    return this.loadTargetSummary(
      projectId,
      workspaceId,
      StoryVideoTargetKind.trailer,
      TRAILER_TARGET_KEY,
    ) as Promise<StoryTrailerVideoSummaryDto>;
  }

  private async createGeneration(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    args: {
      target: VideoTarget;
      expectedSelectionVersion: number;
      recipe: DirectRecipeInput;
      idempotencyKey: string;
      exactRecipeSnapshot?: StoryVideoRecipeSnapshot;
    },
  ): Promise<StoryVideoGenerationDto> {
    const scope = await this.requireProjectScope(
      user,
      workspaceId,
      projectId,
      'story.generate',
    );
    const targetIdentity = targetIdentityOf(args.target);
    const requestFingerprint = canonicalJsonHash({
      target: targetIdentity,
      expectedDraftRevision:
        args.target.kind === 'clip'
          ? args.target.expectedDraftRevision
          : undefined,
      expectedSelectionVersion: args.expectedSelectionVersion,
      prompt: args.recipe.prompt,
      modelId: args.recipe.modelId,
      mode: args.recipe.mode,
      durationMs: args.recipe.durationMs,
      references: args.recipe.references,
      seed: args.recipe.seed ?? null,
    });
    const submissionKey = `story-video:${canonicalJsonHash({
      userId: user.userId,
      projectId,
      target: targetIdentity,
      idempotencyKey: args.idempotencyKey,
    })}`;

    const existing = await this.prisma.storyVideoGenerationAttempt.findUnique({
      where: { submissionKey },
      include: GENERATION_INCLUDE,
    });
    if (existing) {
      assertIdempotentFingerprint(existing, requestFingerprint);
      return this.toGenerationDto(
        await this.reconcileGeneration(existing, workspaceId),
      );
    }

    const prepared = await this.prepareRecipe(
      user,
      scope.project.workspaceId,
      projectId,
      args.recipe,
    );
    if (
      args.exactRecipeSnapshot &&
      canonicalJsonHash(prepared.snapshot) !==
        canonicalJsonHash(args.exactRecipeSnapshot)
    ) {
      throw new ConflictException({
        code: 'STORY_RETRY_RECIPE_NO_LONGER_CURRENT',
        message:
          'The exact model or reference recipe is no longer valid and cannot be retried.',
      });
    }

    let createdGenerationId: string | null = null;
    const hooks: AiJobSubmissionHooks = {
      afterJobCreate: async (tx, job) => {
        // The AI job and Story binding share this transaction. Taking the
        // project write-state row first makes Agent apply and human submission
        // totally ordered; a rejected guard rolls the newly created job back.
        await this.writeGuard.assertHumanWriteAllowed(tx, projectId);
        const replay = await tx.storyVideoGenerationAttempt.findUnique({
          where: { submissionKey },
          select: { id: true, requestFingerprint: true },
        });
        if (replay) {
          if (replay.requestFingerprint !== requestFingerprint) {
            throw idempotencyConflict();
          }
          createdGenerationId = replay.id;
          return;
        }

        if (args.target.kind === 'clip') {
          await this.assertCurrentDraftClip(
            tx,
            projectId,
            args.target.graphNodeId,
            args.target.expectedDraftRevision,
          );
        }
        await this.assertPreparedRecipeStillCurrent(
          tx,
          scope.project.workspaceId,
          projectId,
          prepared,
        );

        await lockSelection(
          tx,
          projectId,
          targetIdentity.kind,
          targetIdentity.key,
        );
        const selection = await reserveSelectionIntent(tx, {
          projectId,
          targetKind: targetIdentity.kind,
          targetKey: targetIdentity.key,
          expectedVersion: args.expectedSelectionVersion,
        });
        const latest = await tx.storyVideoGenerationAttempt.findFirst({
          where: { selectionId: selection.id },
          orderBy: [{ attemptNumber: 'desc' }, { id: 'desc' }],
          select: { attemptNumber: true },
        });
        const generation = await tx.storyVideoGenerationAttempt.create({
          data: {
            storyProjectId: projectId,
            selectionId: selection.id,
            attemptNumber: (latest?.attemptNumber ?? 0) + 1,
            submissionKey,
            requestFingerprint,
            status: StoryVideoGenerationAttemptStatus.queued,
            selectionVersionAtSubmit: selection.version,
            recipeSnapshot: asInputJson(prepared.snapshot),
            aiJobId: job.id,
            createdByUserId: user.userId,
            queuedAt: job.queuedAt ? new Date(job.queuedAt) : new Date(),
            references: prepared.references.length
              ? {
                  createMany: {
                    data: prepared.references.map((reference) => ({
                      storyProjectId: projectId,
                      referenceSlotId: reference.referenceSlotId,
                      referenceVersionId: reference.referenceVersionId,
                      role: reference.role,
                      position: reference.position,
                      assetId: reference.assetId,
                      variantId: reference.variantId,
                      checksumSha256: reference.checksumSha256,
                    })),
                  },
                }
              : undefined,
          },
        });
        createdGenerationId = generation.id;
      },
    };

    try {
      const submitted = await this.aiGeneration.submitJob(
        user,
        {
          modelId: prepared.model.id,
          schemaVersion: prepared.model.schemaVersion,
          context: {
            workspaceId: scope.project.workspaceId,
            documentBlockId: targetIdentity.key,
            sourceSurface: 'story-studio',
          },
          idempotencyKey: `story-video-job:${canonicalJsonHash(submissionKey)}`,
          input: prepared.aiInput,
          promptDocument: {
            version: 1,
            nodes: [{ type: 'text', text: prepared.snapshot.prompt }],
          },
          referenceBindings: prepared.referenceBindings,
        },
        workspaceId,
        hooks,
      );
      const generation =
        await this.prisma.storyVideoGenerationAttempt.findFirst({
          where: {
            OR: [
              { submissionKey },
              { aiJobId: submitted.request_id },
              ...(createdGenerationId ? [{ id: createdGenerationId }] : []),
            ],
          },
          include: GENERATION_INCLUDE,
        });
      if (!generation) {
        throw new ConflictException({
          code: 'STORY_GENERATION_BINDING_MISSING',
          message: 'The accepted AI job has no Story video generation binding.',
        });
      }
      assertIdempotentFingerprint(generation, requestFingerprint);
      return this.toGenerationDto(
        await this.reconcileGeneration(generation, workspaceId),
      );
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const winner = await this.prisma.storyVideoGenerationAttempt.findUnique(
          {
            where: { submissionKey },
            include: GENERATION_INCLUDE,
          },
        );
        if (winner) {
          assertIdempotentFingerprint(winner, requestFingerprint);
          return this.toGenerationDto(
            await this.reconcileGeneration(winner, workspaceId),
          );
        }
      }
      throw error;
    }
  }

  private async prepareRecipe(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    input: DirectRecipeInput,
  ): Promise<PreparedRecipe> {
    const [canonicalModel, models, referenceRows] = await Promise.all([
      this.prisma.aiCanonicalModel.findFirst({
        where: {
          slug: input.modelId,
          modality: 'video',
          status: AiControlPlaneStatus.active,
          archivedAt: null,
        },
      }),
      this.aiGeneration.listModels(user, workspaceId),
      this.loadReferenceRows(projectId, input.references),
    ]);
    if (!canonicalModel) throw videoModelUnavailable(input.modelId);
    const model = models.find(
      (candidate) => candidate.id === canonicalModel.slug,
    );
    if (
      !model ||
      !model.enabled ||
      model.type !== 'video' ||
      !model.generationModes.includes(input.mode)
    ) {
      throw videoModelUnavailable(input.modelId);
    }

    const preparedReferences = input.references.map((reference, position) =>
      this.prepareReference(
        workspaceId,
        reference,
        position,
        referenceRows.get(reference.referenceVersionId),
      ),
    );
    const aiInput = buildAiInput(model, input, preparedReferences);
    const snapshot: StoryVideoRecipeSnapshot = {
      schemaVersion: 1,
      prompt: input.prompt,
      mode: input.mode,
      durationMs: input.durationMs,
      seed: input.seed ?? null,
      model: {
        id: canonicalModel.id,
        slug: canonicalModel.slug,
        displayName: canonicalModel.displayName,
        schemaVersion: model.schemaVersion,
        generationModes: [...model.generationModes],
      },
      references: preparedReferences.map((reference) => ({
        referenceSlotId: reference.referenceSlotId,
        referenceVersionId: reference.referenceVersionId,
        role: fromPrismaReferenceRole(reference.role),
        position: reference.position,
        assetId: reference.assetId,
        variantId: reference.variantId,
        checksumSha256: reference.checksumSha256,
      })),
    };
    StoryVideoRecipeSnapshotSchema.parse(snapshot);

    const referenceBindings =
      input.mode === 'multimodal_to_video' &&
      hasInputProperty(model, 'referenceImages')
        ? preparedReferences.map((reference) => ({
            refId: reference.referenceVersionId,
            kind: 'image' as const,
            role: 'reference',
            order: reference.position + 1,
            url: reference.url,
            assetId: reference.assetId,
          }))
        : undefined;
    return {
      model,
      snapshot,
      aiInput,
      referenceBindings,
      references: preparedReferences,
    };
  }

  private async loadReferenceRows(
    projectId: string,
    references: StoryVideoGenerationReferenceInput[],
  ): Promise<Map<string, ReferenceRow>> {
    if (references.length === 0) return new Map();
    const rows = await this.prisma.storyReferenceVersion.findMany({
      where: {
        storyProjectId: projectId,
        id: { in: references.map((reference) => reference.referenceVersionId) },
      },
      include: REFERENCE_INCLUDE,
    });
    return new Map(rows.map((row) => [row.id, row]));
  }

  private prepareReference(
    workspaceId: string,
    input: StoryVideoGenerationReferenceInput,
    position: number,
    row: ReferenceRow | undefined,
  ): PreparedReference {
    if (
      !row ||
      row.status !== 'ready' ||
      !row.approval ||
      row.referenceSlot.archivedAt ||
      row.referenceSlot.approvedVersionId !== row.id ||
      row.asset.workspaceId !== workspaceId ||
      row.asset.kind !== MediaAssetKind.image ||
      row.asset.status !== MediaAssetStatus.ready ||
      row.asset.moderationStatus === MediaAssetModerationStatus.blocked ||
      row.asset.deletedAt ||
      row.variant.status !== MediaAssetVariantStatus.ready ||
      row.variant.deletedAt ||
      row.variant.assetId !== row.assetId ||
      !row.variant.contentType.startsWith('image/') ||
      !SHA256_PATTERN.test(row.checksumSha256) ||
      row.variant.checksumSha256 !== row.checksumSha256
    ) {
      throw new UnprocessableEntityException({
        code: 'STORY_REFERENCE_NOT_USABLE',
        message: `Reference version ${input.referenceVersionId} is not an approved, ready image version.`,
      });
    }
    let url: string;
    try {
      url = this.assetUrls.resolveVariant(row.asset, row.variant.variantKey);
    } catch {
      throw new UnprocessableEntityException({
        code: 'STORY_REFERENCE_URL_UNAVAILABLE',
        message: `Reference version ${input.referenceVersionId} has no resolvable media URL.`,
      });
    }
    return {
      referenceSlotId: row.referenceSlotId,
      referenceVersionId: row.id,
      role: toPrismaReferenceRole(input.role),
      position,
      assetId: row.assetId,
      variantId: row.variantId,
      checksumSha256: row.checksumSha256,
      url,
    };
  }

  private async assertPreparedRecipeStillCurrent(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    projectId: string,
    prepared: PreparedRecipe,
  ): Promise<void> {
    const canonicalModel = await tx.aiCanonicalModel.findFirst({
      where: {
        id: prepared.snapshot.model.id,
        slug: prepared.snapshot.model.slug,
        modality: 'video',
        status: AiControlPlaneStatus.active,
        archivedAt: null,
      },
      select: { displayName: true, generationModes: true },
    });
    if (
      !canonicalModel ||
      canonicalModel.displayName !== prepared.snapshot.model.displayName ||
      !jsonStringArray(canonicalModel.generationModes).includes(
        prepared.snapshot.mode,
      )
    ) {
      throw videoModelUnavailable(prepared.snapshot.model.slug);
    }

    if (prepared.references.length === 0) return;
    const rows = await tx.storyReferenceVersion.findMany({
      where: {
        storyProjectId: projectId,
        id: {
          in: prepared.references.map(
            (reference) => reference.referenceVersionId,
          ),
        },
      },
      include: REFERENCE_INCLUDE,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const reference of prepared.references) {
      const row = byId.get(reference.referenceVersionId);
      if (
        !row ||
        row.referenceSlotId !== reference.referenceSlotId ||
        row.referenceSlot.approvedVersionId !== row.id ||
        row.referenceSlot.archivedAt ||
        row.status !== 'ready' ||
        !row.approval ||
        row.assetId !== reference.assetId ||
        row.variantId !== reference.variantId ||
        row.checksumSha256 !== reference.checksumSha256 ||
        row.asset.workspaceId !== workspaceId ||
        row.asset.kind !== MediaAssetKind.image ||
        row.asset.status !== MediaAssetStatus.ready ||
        row.asset.moderationStatus === MediaAssetModerationStatus.blocked ||
        row.asset.deletedAt ||
        row.variant.status !== MediaAssetVariantStatus.ready ||
        row.variant.deletedAt ||
        row.variant.checksumSha256 !== reference.checksumSha256
      ) {
        throw new ConflictException({
          code: 'STORY_REFERENCE_CHANGED',
          message:
            'An approved reference changed while the generation was being submitted.',
        });
      }
    }
  }

  private async putCurrentVideo(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    args: {
      target: VideoTarget;
      expectedSelectionVersion: number;
      assetId: string | null;
      variantId: string | null;
    },
  ): Promise<void> {
    const identity = targetIdentityOf(args.target);
    await this.prisma.$transaction(async (tx) => {
      await this.writeGuard.assertHumanWriteAllowed(tx, projectId);
      if (args.target.kind === 'clip') {
        await this.assertCurrentDraftClip(
          tx,
          projectId,
          args.target.graphNodeId,
          args.target.expectedDraftRevision,
        );
      }
      const media =
        args.assetId && args.variantId
          ? await requireExactVideoVariant(
              tx,
              workspaceId,
              args.assetId,
              args.variantId,
            )
          : null;

      await lockSelection(tx, projectId, identity.kind, identity.key);
      const existing = await tx.storyVideoSelection.findFirst({
        where: {
          storyProjectId: projectId,
          targetKind: identity.kind,
          targetKey: identity.key,
        },
      });
      const actualVersion = existing?.version ?? 0;
      if (actualVersion !== args.expectedSelectionVersion) {
        throw selectionVersionConflict(
          args.expectedSelectionVersion,
          actualVersion,
        );
      }
      const nextVersion = actualVersion + 1;
      const data = selectionMediaData(media, user.userId, nextVersion);
      if (existing) {
        const updated = await tx.storyVideoSelection.updateMany({
          where: { id: existing.id, version: actualVersion },
          data,
        });
        if (updated.count !== 1) {
          throw selectionVersionConflict(
            args.expectedSelectionVersion,
            actualVersion + 1,
          );
        }
      } else {
        await tx.storyVideoSelection.create({
          data: {
            storyProjectId: projectId,
            targetKind: identity.kind,
            targetKey: identity.key,
            ...data,
          },
        });
      }
    });
  }

  private async assertCurrentDraftClip(
    tx: Prisma.TransactionClient,
    projectId: string,
    graphNodeId: string,
    expectedDraftRevision: number,
  ): Promise<void> {
    const draft = await tx.storyDraft.findUnique({
      where: { storyProjectId: projectId },
      select: { revision: true, content: true, contentHash: true },
    });
    if (!draft) {
      throw new NotFoundException({
        code: 'STORY_DRAFT_NOT_FOUND',
        message: 'Story draft not found.',
      });
    }
    if (draft.revision !== expectedDraftRevision) {
      throw draftRevisionConflict(expectedDraftRevision, draft.revision);
    }
    if (canonicalJsonHash(draft.content) !== draft.contentHash) {
      throw new ConflictException({
        code: 'DRAFT_INTEGRITY_ERROR',
        message: 'The saved draft content does not match its hash.',
      });
    }
    const parsed = InteractiveFilmDraftContentSchema.safeParse(draft.content);
    if (!parsed.success) {
      throw new UnprocessableEntityException({
        code: 'STORY_DRAFT_INVALID',
        message: 'The saved story draft does not match the current schema.',
      });
    }
    const node = parsed.data.graph.nodes.find(
      (candidate) => candidate.nodeId === graphNodeId,
    );
    if (!node || node.kind !== 'clip') {
      throw new NotFoundException({
        code: 'STORY_CLIP_NOT_FOUND',
        message: 'Story clip node not found in the current draft.',
      });
    }
  }

  private async reconcileGeneration(
    generation: GenerationRow,
    workspaceId: string,
  ): Promise<GenerationRow> {
    if (isTerminalGeneration(generation.status)) return generation;
    switch (generation.aiJob.status) {
      case 'in_queue':
        return this.updateProgressStatus(
          generation,
          StoryVideoGenerationAttemptStatus.queued,
        );
      case 'in_progress':
        return this.updateProgressStatus(
          generation,
          generation.aiJob.stage === 'fetching_output' ||
            generation.aiJob.stage === 'uploading_to_oss'
            ? StoryVideoGenerationAttemptStatus.processing
            : StoryVideoGenerationAttemptStatus.running,
        );
      case 'cancelled':
        return this.finishWithoutOutput(
          generation,
          StoryVideoGenerationAttemptStatus.cancelled,
          generation.aiJob.error,
        );
      case 'failed':
      case 'expired':
        return this.finishWithoutOutput(
          generation,
          StoryVideoGenerationAttemptStatus.failed,
          generation.aiJob.error ?? {
            code: 'AI_JOB_FAILED',
            message: 'The AI video job failed.',
          },
        );
      case 'completed':
        return this.finalizeCompletedGeneration(generation, workspaceId);
      default:
        return generation;
    }
  }

  private async updateProgressStatus(
    generation: GenerationRow,
    status: StoryVideoGenerationAttemptStatus,
  ): Promise<GenerationRow> {
    if (generation.status === status) return generation;
    const updated = await this.prisma.storyVideoGenerationAttempt.updateMany({
      where: { id: generation.id, version: generation.version },
      data: {
        status,
        version: { increment: 1 },
        ...(status === StoryVideoGenerationAttemptStatus.running &&
        !generation.startedAt
          ? { startedAt: generation.aiJob.startedAt ?? new Date() }
          : {}),
      },
    });
    return updated.count === 1
      ? this.requireGeneration(generation.storyProjectId, generation.id)
      : this.requireGeneration(generation.storyProjectId, generation.id);
  }

  private async finishWithoutOutput(
    generation: GenerationRow,
    status:
      | typeof StoryVideoGenerationAttemptStatus.failed
      | typeof StoryVideoGenerationAttemptStatus.cancelled,
    error: unknown,
  ): Promise<GenerationRow> {
    await this.prisma.storyVideoGenerationAttempt.updateMany({
      where: { id: generation.id, version: generation.version },
      data: {
        status,
        error: error == null ? Prisma.DbNull : asInputJson(error),
        completedAt: generation.aiJob.completedAt ?? new Date(),
        ...(status === StoryVideoGenerationAttemptStatus.cancelled
          ? { cancelledAt: new Date() }
          : {}),
        version: { increment: 1 },
      },
    });
    return this.requireGeneration(generation.storyProjectId, generation.id);
  }

  private async finalizeCompletedGeneration(
    generation: GenerationRow,
    workspaceId: string,
  ): Promise<GenerationRow> {
    const media = completedOutputVideo(generation, workspaceId);
    if (!media) {
      const completedAt = generation.aiJob.completedAt ?? generation.updatedAt;
      if (Date.now() - completedAt.getTime() < OUTPUT_METADATA_GRACE_MS) {
        return this.updateProgressStatus(
          generation,
          StoryVideoGenerationAttemptStatus.processing,
        );
      }
      return this.finishWithoutOutput(
        generation,
        StoryVideoGenerationAttemptStatus.failed,
        {
          code: 'STORY_GENERATION_OUTPUT_METADATA_MISSING',
          message:
            'The generated video did not produce a ready variant with complete technical metadata.',
        },
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const canReconcile = await this.writeGuard.tryAcquireDeferredWriteFence(
        tx,
        generation.storyProjectId,
      );
      if (!canReconcile) {
        // Generation polling remains a read operation while Agent apply owns
        // the project. Do not mutate either the selected video or its attempt;
        // a later poll will retry completion after the shared fence is free.
        return;
      }
      await lockSelection(
        tx,
        generation.storyProjectId,
        generation.selection.targetKind,
        generation.selection.targetKey,
      );
      const current = await tx.storyVideoGenerationAttempt.findUnique({
        where: { id: generation.id },
      });
      if (!current || isTerminalGeneration(current.status)) return;
      const selected = await tx.storyVideoSelection.updateMany({
        where: {
          id: current.selectionId,
          version: current.selectionVersionAtSubmit,
        },
        data: {
          currentAssetId: media.asset.id,
          currentVariantId: media.variantId,
          currentSourceGenerationAttemptId: current.id,
          currentChecksumSha256: media.checksumSha256,
          currentContentType: media.contentType,
          currentDurationMs: media.durationMs,
          currentWidth: media.width,
          currentHeight: media.height,
          currentHasAudio: media.hasAudio,
          currentBrowserSafeMp4: media.browserSafeMp4,
          setByUserId: current.createdByUserId,
          setAt: new Date(),
          version: { increment: 1 },
        },
      });
      const ready = selected.count === 1;
      await tx.storyVideoGenerationAttempt.update({
        where: { id: current.id },
        data: {
          status: ready
            ? StoryVideoGenerationAttemptStatus.ready
            : StoryVideoGenerationAttemptStatus.superseded,
          aiJobOutputId: generation.aiJob.outputs.find(
            (output) => output.assetId === media.asset.id,
          )?.id,
          outputAssetId: media.asset.id,
          outputVariantId: media.variantId,
          outputChecksumSha256: media.checksumSha256,
          technicalChecks: asInputJson([
            {
              key: 'media_metadata',
              status: 'passed',
              message: null,
            },
          ] satisfies StoryVideoTechnicalCheckDto[]),
          error: Prisma.DbNull,
          readyAt: new Date(),
          ...(ready ? {} : { supersededAt: new Date() }),
          completedAt: generation.aiJob.completedAt ?? new Date(),
          version: { increment: 1 },
        },
      });
    });
    return this.requireGeneration(generation.storyProjectId, generation.id);
  }

  private async loadTargetSummary(
    projectId: string,
    workspaceId: string,
    targetKind: StoryVideoTargetKind,
    targetKey: string,
  ): Promise<StoryClipVideoSummaryDto | StoryTrailerVideoSummaryDto> {
    const selection = await this.prisma.storyVideoSelection.findFirst({
      where: { storyProjectId: projectId, targetKind, targetKey },
      include: { currentAsset: { include: MEDIA_ASSET_INCLUDE } },
    });
    const latest = selection
      ? await this.prisma.storyVideoGenerationAttempt.findFirst({
          where: { selectionId: selection.id },
          orderBy: [{ attemptNumber: 'desc' }, { id: 'desc' }],
          include: GENERATION_INCLUDE,
        })
      : null;
    const generation = latest
      ? await this.reconcileGeneration(latest, workspaceId)
      : null;
    const currentVideo = selection
      ? currentVideoDto(selection, selection.currentAsset)
      : null;
    const common = {
      selectionVersion: selection?.version ?? 0,
      currentVideo,
      generation: generation ? this.toGenerationDto(generation) : null,
    };
    return targetKind === StoryVideoTargetKind.clip
      ? { graphNodeId: targetKey, ...common }
      : common;
  }

  private async requireGeneration(
    projectId: string,
    generationId: string,
  ): Promise<GenerationRow> {
    const generation = await this.prisma.storyVideoGenerationAttempt.findFirst({
      where: { id: generationId, storyProjectId: projectId },
      include: GENERATION_INCLUDE,
    });
    if (!generation) {
      throw new NotFoundException({
        code: 'STORY_GENERATION_NOT_FOUND',
        message: 'Story video generation not found.',
      });
    }
    return generation;
  }

  private async requireProjectScope(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    capability: Parameters<StoryPermissionService['requireProject']>[2],
  ) {
    const scope = await this.permissions.requireProject(
      user.userId,
      projectId,
      capability,
    );
    if (scope.project.workspaceId !== workspaceId) {
      throw new NotFoundException({
        code: 'STORY_PROJECT_NOT_FOUND',
        message: 'Story project not found.',
      });
    }
    return scope;
  }

  private toGenerationDto(row: GenerationRow): StoryVideoGenerationDto {
    return {
      id: row.id,
      projectId: row.storyProjectId,
      target: targetFromSelection(row.selection),
      number: row.attemptNumber,
      version: row.version,
      selectionVersionAtSubmit: row.selectionVersionAtSubmit,
      aiJobId: row.aiJobId,
      aiJobOutputId: row.aiJobOutputId,
      status: row.status,
      recipeSnapshot: parseRecipeSnapshot(row.recipeSnapshot),
      outputAsset: row.outputAsset ? mediaAssetSummary(row.outputAsset) : null,
      outputVariantId: row.outputVariantId,
      outputChecksumSha256: row.outputChecksumSha256,
      technicalChecks: technicalChecks(row.technicalChecks),
      error: jsonRecord(row.error),
      createdByUserId: row.createdByUserId,
      queuedAt: iso(row.queuedAt),
      startedAt: iso(row.startedAt),
      readyAt: iso(row.readyAt),
      cancelledAt: iso(row.cancelledAt),
      supersededAt: iso(row.supersededAt),
      completedAt: iso(row.completedAt),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

async function reserveSelectionIntent(
  tx: Prisma.TransactionClient,
  args: {
    projectId: string;
    targetKind: StoryVideoTargetKind;
    targetKey: string;
    expectedVersion: number;
  },
) {
  const existing = await tx.storyVideoSelection.findFirst({
    where: {
      storyProjectId: args.projectId,
      targetKind: args.targetKind,
      targetKey: args.targetKey,
    },
  });
  const actualVersion = existing?.version ?? 0;
  if (actualVersion !== args.expectedVersion) {
    throw selectionVersionConflict(args.expectedVersion, actualVersion);
  }
  if (!existing) {
    return tx.storyVideoSelection.create({
      data: {
        storyProjectId: args.projectId,
        targetKind: args.targetKind,
        targetKey: args.targetKey,
        version: 1,
      },
    });
  }
  const updated = await tx.storyVideoSelection.updateMany({
    where: { id: existing.id, version: actualVersion },
    data: { version: { increment: 1 } },
  });
  if (updated.count !== 1) {
    throw selectionVersionConflict(args.expectedVersion, actualVersion + 1);
  }
  return tx.storyVideoSelection.findUniqueOrThrow({
    where: { id: existing.id },
  });
}

async function lockSelection(
  tx: Prisma.TransactionClient,
  projectId: string,
  targetKind: StoryVideoTargetKind,
  targetKey: string,
): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtext(${`story-video-selection:${projectId}:${targetKind}:${targetKey}`})::bigint
    )
  `;
}

async function requireExactVideoVariant(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  assetId: string,
  variantId: string,
): Promise<ExactVideoVariant> {
  const asset = await tx.mediaAsset.findFirst({
    where: { id: assetId, workspaceId },
    include: MEDIA_ASSET_INCLUDE,
  });
  const variant = asset?.variants.find(
    (candidate) => candidate.id === variantId,
  );
  const exact = asset && variant ? exactVideoVariant(asset, variant) : null;
  if (!exact) {
    throw new UnprocessableEntityException({
      code: 'STORY_VIDEO_VARIANT_NOT_USABLE',
      message:
        'The selected video variant is not a browser-safe MP4 with exact probed technical metadata.',
    });
  }
  return exact;
}

function completedOutputVideo(
  generation: GenerationRow,
  workspaceId: string,
): ExactVideoVariant | null {
  for (const output of generation.aiJob.outputs) {
    const asset = output.asset;
    if (!asset || asset.workspaceId !== workspaceId || asset.deletedAt) {
      continue;
    }
    const variant = asset.variants.find(
      (candidate) =>
        candidate.variantKey === 'original' &&
        candidate.status === MediaAssetVariantStatus.ready &&
        !candidate.deletedAt,
    );
    const exact = variant ? exactVideoVariant(asset, variant) : null;
    if (exact) return exact;
  }
  return null;
}

function exactVideoVariant(
  asset: MediaAssetRow,
  variant: MediaAssetRow['variants'][number],
): ExactVideoVariant | null {
  if (
    asset.kind !== MediaAssetKind.video ||
    asset.status !== MediaAssetStatus.ready ||
    asset.moderationStatus === MediaAssetModerationStatus.blocked ||
    asset.deletedAt ||
    variant.assetId !== asset.id ||
    variant.status !== MediaAssetVariantStatus.ready ||
    variant.deletedAt ||
    variant.contentType !== 'video/mp4' ||
    !isBrowserSafeMp4Metadata(variant.metadata) ||
    !variant.checksumSha256 ||
    !SHA256_PATTERN.test(variant.checksumSha256) ||
    !variant.durationMs ||
    variant.durationMs <= 0 ||
    !variant.width ||
    variant.width <= 0 ||
    !variant.height ||
    variant.height <= 0 ||
    typeof variant.hasAudio !== 'boolean'
  ) {
    return null;
  }
  return {
    asset,
    variantId: variant.id,
    checksumSha256: variant.checksumSha256,
    contentType: variant.contentType,
    durationMs: variant.durationMs,
    width: variant.width,
    height: variant.height,
    hasAudio: variant.hasAudio,
    browserSafeMp4: true,
  };
}

function isBrowserSafeMp4Metadata(value: unknown): boolean {
  const metadata = jsonRecord(value);
  if (!metadata) return false;
  if (metadata.browserSafeMp4 === true) return true;
  return jsonRecord(metadata.videoProbe)?.browserSafeMp4 === true;
}

function buildAiInput(
  model: AiModelDefinition,
  recipe: DirectRecipeInput,
  references: PreparedReference[],
): Record<string, unknown> {
  if (!Number.isInteger(recipe.durationMs / 1_000)) {
    throw new UnprocessableEntityException({
      code: 'STORY_VIDEO_DURATION_UNSUPPORTED',
      message: 'The selected model accepts video duration in whole seconds.',
    });
  }
  const seconds = recipe.durationMs / 1_000;
  const input: Record<string, unknown> = { prompt: recipe.prompt };
  const properties = model.input_schema.properties ?? {};
  if (properties.duration) {
    const allowed = stringEnum(properties.duration);
    const value = String(seconds);
    if (allowed.length > 0 && !allowed.includes(value)) {
      throw durationUnsupported(recipe.durationMs, model.id);
    }
    input.duration = value;
  } else if (properties.durationSeconds) {
    assertNumberSchemaSupports(properties.durationSeconds, seconds, model.id);
    input.durationSeconds = seconds;
  } else {
    throw durationUnsupported(recipe.durationMs, model.id);
  }

  if (recipe.seed !== undefined) {
    if (!properties.seed) {
      throw new UnprocessableEntityException({
        code: 'STORY_VIDEO_SEED_UNSUPPORTED',
        message: `Model ${model.id} does not support a seed.`,
      });
    }
    const seed = Number(recipe.seed);
    if (!Number.isSafeInteger(seed)) {
      throw new UnprocessableEntityException({
        code: 'STORY_VIDEO_SEED_INVALID',
        message: 'Seed exceeds the safe integer range supported by this model.',
      });
    }
    input.seed = seed;
  }

  if (recipe.mode === 'first_last_frame_to_video') {
    if (!properties.startFrame || !properties.endFrame) {
      throw new UnprocessableEntityException({
        code: 'STORY_VIDEO_MODE_SCHEMA_MISMATCH',
        message: `Model ${model.id} has no first/last-frame input contract.`,
      });
    }
    const first = references.find(
      (reference) => reference.role === StoryVideoReferenceRole.first_frame,
    );
    const last = references.find(
      (reference) => reference.role === StoryVideoReferenceRole.last_frame,
    );
    if (!first || !last) {
      throw new UnprocessableEntityException({
        code: 'STORY_VIDEO_REFERENCE_PLAN_INVALID',
        message: 'First/last-frame generation requires both exact frames.',
      });
    }
    input.startFrame = { url: first.url };
    input.endFrame = { url: last.url };
    return input;
  }

  if (properties.references) {
    input.references = references.map((reference) => ({
      type: 'reference_image',
      url: reference.url,
    }));
  } else if (properties.referenceImages) {
    input.referenceImages = references.map((reference) => ({
      url: reference.url,
    }));
  } else if (references.length > 0) {
    throw new UnprocessableEntityException({
      code: 'STORY_VIDEO_MODE_SCHEMA_MISMATCH',
      message: `Model ${model.id} has no multimodal reference input contract.`,
    });
  }
  return input;
}

function selectionMediaData(
  media: ExactVideoVariant | null,
  userId: string,
  version: number,
): {
  currentAssetId: string | null;
  currentVariantId: string | null;
  currentSourceGenerationAttemptId: null;
  currentChecksumSha256: string | null;
  currentContentType: string | null;
  currentDurationMs: number | null;
  currentWidth: number | null;
  currentHeight: number | null;
  currentHasAudio: boolean | null;
  currentBrowserSafeMp4: boolean | null;
  version: number;
  setByUserId: string;
  setAt: Date;
} {
  return {
    currentAssetId: media?.asset.id ?? null,
    currentVariantId: media?.variantId ?? null,
    currentSourceGenerationAttemptId: null,
    currentChecksumSha256: media?.checksumSha256 ?? null,
    currentContentType: media?.contentType ?? null,
    currentDurationMs: media?.durationMs ?? null,
    currentWidth: media?.width ?? null,
    currentHeight: media?.height ?? null,
    currentHasAudio: media?.hasAudio ?? null,
    currentBrowserSafeMp4: media?.browserSafeMp4 ?? null,
    version,
    setByUserId: userId,
    setAt: new Date(),
  };
}

function currentVideoDto(
  selection: {
    currentAssetId: string | null;
    currentVariantId: string | null;
    currentSourceGenerationAttemptId: string | null;
    currentChecksumSha256: string | null;
    currentContentType: string | null;
    currentDurationMs: number | null;
    currentWidth: number | null;
    currentHeight: number | null;
    currentHasAudio: boolean | null;
    currentBrowserSafeMp4: boolean | null;
    version: number;
    setByUserId: string | null;
    setAt: Date | null;
  },
  asset: MediaAssetRow | null,
): StoryCurrentVideoDto | null {
  const variant = asset?.variants.find(
    (candidate) => candidate.id === selection.currentVariantId,
  );
  const exact = asset && variant ? exactVideoVariant(asset, variant) : null;
  if (
    !exact ||
    !selection.currentAssetId ||
    !selection.currentVariantId ||
    !selection.currentChecksumSha256 ||
    !selection.currentContentType ||
    selection.currentDurationMs == null ||
    selection.currentWidth == null ||
    selection.currentHeight == null ||
    selection.currentHasAudio == null ||
    selection.currentBrowserSafeMp4 !== true ||
    !selection.setAt ||
    selection.currentAssetId !== exact.asset.id ||
    selection.currentVariantId !== exact.variantId ||
    selection.currentChecksumSha256 !== exact.checksumSha256 ||
    selection.currentContentType !== exact.contentType ||
    selection.currentDurationMs !== exact.durationMs ||
    selection.currentWidth !== exact.width ||
    selection.currentHeight !== exact.height ||
    selection.currentHasAudio !== exact.hasAudio
  ) {
    return null;
  }
  return {
    asset: mediaAssetSummary(exact.asset),
    variantId: selection.currentVariantId,
    sourceGenerationId: selection.currentSourceGenerationAttemptId,
    checksumSha256: selection.currentChecksumSha256,
    contentType: selection.currentContentType,
    durationMs: selection.currentDurationMs,
    width: selection.currentWidth,
    height: selection.currentHeight,
    hasAudio: selection.currentHasAudio,
    browserSafeMp4: true,
    selectionVersion: selection.version,
    setByUserId: selection.setByUserId,
    setAt: selection.setAt.toISOString(),
  };
}

function mediaAssetSummary(asset: MediaAssetRow): MediaAssetSummaryDto {
  return {
    id: asset.id,
    kind: asset.kind,
    status: asset.status,
    moderationStatus: asset.moderationStatus,
    contentType: asset.contentType,
    width: asset.width,
    height: asset.height,
    durationSeconds: asset.durationSeconds,
    checksumSha256: asset.checksumSha256,
    previewUrl: resolveMediaPublicUrl(asset),
  };
}

function targetIdentityOf(target: VideoTarget): {
  kind: StoryVideoTargetKind;
  key: string;
} {
  return target.kind === 'clip'
    ? { kind: StoryVideoTargetKind.clip, key: target.graphNodeId }
    : { kind: StoryVideoTargetKind.trailer, key: TRAILER_TARGET_KEY };
}

function targetFromSelection(selection: {
  targetKind: StoryVideoTargetKind;
  targetKey: string;
}): StoryVideoGenerationDto['target'] {
  return selection.targetKind === StoryVideoTargetKind.clip
    ? { kind: 'clip', graphNodeId: selection.targetKey }
    : { kind: 'trailer' };
}

function assertRetryTarget(
  actual: StoryVideoGenerationDto['target'],
  requested: RetryStoryVideoGenerationInput['target'],
): void {
  if (
    actual.kind !== requested.kind ||
    (actual.kind === 'clip' &&
      requested.kind === 'clip' &&
      actual.graphNodeId !== requested.graphNodeId)
  ) {
    throw new ConflictException({
      code: 'STORY_RETRY_TARGET_MISMATCH',
      message: 'A generation can retry only for its original video target.',
    });
  }
}

function parseRecipeSnapshot(value: unknown): StoryVideoRecipeSnapshot {
  const parsed = StoryVideoRecipeSnapshotSchema.safeParse(value);
  if (!parsed.success) {
    throw new UnprocessableEntityException({
      code: 'STORY_VIDEO_RECIPE_INVALID',
      message: 'The stored video recipe does not match the current schema.',
    });
  }
  return parsed.data;
}

function technicalChecks(value: unknown): StoryVideoTechnicalCheckDto[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const row = entry as Record<string, unknown>;
    if (
      typeof row.key !== 'string' ||
      (row.status !== 'pending' &&
        row.status !== 'passed' &&
        row.status !== 'failed') ||
      (row.message !== null && typeof row.message !== 'string')
    ) {
      return [];
    }
    return [
      { key: row.key, status: row.status, message: row.message },
    ] as StoryVideoTechnicalCheckDto[];
  });
}

function jsonRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function jsonStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function stringEnum(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return jsonStringArray((value as Record<string, unknown>).enum);
}

function assertNumberSchemaSupports(
  schema: unknown,
  value: number,
  modelId: string,
): void {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return;
  const record = schema as Record<string, unknown>;
  const allowed = Array.isArray(record.enum)
    ? record.enum.filter((item): item is number => typeof item === 'number')
    : [];
  if (
    (allowed.length > 0 && !allowed.includes(value)) ||
    (typeof record.minimum === 'number' && value < record.minimum) ||
    (typeof record.maximum === 'number' && value > record.maximum)
  ) {
    throw durationUnsupported(value * 1_000, modelId);
  }
}

function hasInputProperty(model: AiModelDefinition, key: string): boolean {
  return Boolean(model.input_schema.properties?.[key]);
}

function toPrismaReferenceRole(
  role: StoryVideoGenerationReferenceInput['role'],
): StoryVideoReferenceRole {
  switch (role) {
    case 'reference':
      return StoryVideoReferenceRole.reference;
    case 'first_frame':
      return StoryVideoReferenceRole.first_frame;
    case 'last_frame':
      return StoryVideoReferenceRole.last_frame;
  }
}

function fromPrismaReferenceRole(
  role: StoryVideoReferenceRole,
): StoryVideoGenerationReferenceInput['role'] {
  return role;
}

function isTerminalGeneration(
  status: StoryVideoGenerationAttemptStatus,
): boolean {
  return (
    status === StoryVideoGenerationAttemptStatus.ready ||
    status === StoryVideoGenerationAttemptStatus.superseded ||
    status === StoryVideoGenerationAttemptStatus.failed ||
    status === StoryVideoGenerationAttemptStatus.cancelled
  );
}

function assertIdempotentFingerprint(
  row: { requestFingerprint: string },
  fingerprint: string,
): void {
  if (row.requestFingerprint !== fingerprint) throw idempotencyConflict();
}

function idempotencyConflict(): ConflictException {
  return new ConflictException({
    code: 'IDEMPOTENCY_KEY_REUSED',
    message: 'Idempotency-Key was already used for a different request.',
  });
}

function selectionVersionConflict(
  expected: number,
  actual: number,
): ConflictException {
  return new ConflictException({
    code: 'STORY_VIDEO_SELECTION_VERSION_CONFLICT',
    message: 'The current video target changed. Refresh and try again.',
    expectedVersion: expected,
    actualVersion: actual,
  });
}

function generationVersionConflict(
  expected: number,
  actual: number,
): ConflictException {
  return new ConflictException({
    code: 'STORY_GENERATION_VERSION_CONFLICT',
    message: 'The video generation changed. Refresh and try again.',
    expectedVersion: expected,
    actualVersion: actual,
  });
}

function draftRevisionConflict(
  expected: number,
  actual: number,
): ConflictException {
  return new ConflictException({
    code: 'DRAFT_REVISION_CONFLICT',
    message: 'The story draft changed. Refresh and try again.',
    expectedRevision: expected,
    actualRevision: actual,
  });
}

function videoModelUnavailable(modelId: string): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'STORY_VIDEO_MODEL_UNAVAILABLE',
    message: `Video model ${modelId} is not active for this recipe.`,
  });
}

function durationUnsupported(
  durationMs: number,
  modelId: string,
): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'STORY_VIDEO_DURATION_UNSUPPORTED',
    message: `Model ${modelId} does not support ${durationMs}ms video generation.`,
  });
}

function asInputJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}
