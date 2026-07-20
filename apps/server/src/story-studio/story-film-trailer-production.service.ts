import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  MediaAssetKind,
  MediaAssetModerationStatus,
  MediaAssetStatus,
  MediaAssetVariantStatus,
  Prisma,
  StoryFilmGenerationAttemptStatus,
} from '@prisma/client';
import type { AuthUser } from '../auth';
import {
  AiGenerationService,
  type AiJobSubmissionHooks,
} from '../ai-generation/ai-generation.service';
import type { AiSubmitReferenceBinding } from '../ai-generation/prompt-document.types';
import type { AiModelDefinition } from '../ai-generation/types';
import { PrismaService } from '../infra/db/db.module';
import { resolveMediaPublicUrl } from '../infra/storage/media-asset-url-resolver.service';
import { canonicalJsonHash } from './canonical-json';
import {
  FilmTrailerSpecSchema,
  ValidateFilmClipReferencePlanSchema,
  type CancelFilmGenerationInput,
  type CreateFilmTrailerGenerationInput,
  type FilmClipReferenceBindingDto,
  type FilmTrailerReferencesDto,
  type FilmTrailerSummaryDto,
  type FilmVideoGenerationDto,
  type MediaAssetSummaryDto,
  type PutFilmCurrentVideoInput,
  type PutFilmTrailerReferencesInput,
  type RetryFilmGenerationInput,
} from './dto';
import {
  assertModelSupportsClip,
  buildGenerationConfig,
  generationReferenceBindingsForClip,
  referenceInputForClip,
  storyFilmHasFailedTechnicalCheck,
  storyFilmTechnicalCheckDtos,
  storyFilmTechnicalChecks,
} from './story-film-production.service';
import {
  compileStoryFilmPrompt,
  modelPromptMaxLength,
  providerImageReferencePromptOverhead,
} from './story-film-prompt-compiler';
import { roleMatchesSlotKind } from './story-film-reference.service';
import { StoryPermissionService } from './story-permission.service';

const TRAILER_GENERATION_INCLUDE =
  Prisma.validator<Prisma.StoryFilmTrailerGenerationAttemptInclude>()({
    aiJob: {
      include: {
        outputs: {
          where: { deletedAt: null },
          orderBy: { outputIndex: 'asc' },
          include: {
            asset: {
              include: {
                placements: true,
                variants: { include: { placements: true } },
              },
            },
          },
        },
      },
    },
    outputAsset: {
      include: {
        placements: true,
        variants: { include: { placements: true } },
      },
    },
    outputVariant: true,
    trailer: {
      select: {
        specHash: true,
        productionInputHash: true,
        latestGenerationAttemptId: true,
      },
    },
  });

const TRAILER_PRODUCTION_INCLUDE =
  Prisma.validator<Prisma.StoryFilmTrailerInclude>()({
    references: {
      orderBy: [{ role: 'asc' }, { position: 'asc' }],
      include: {
        referenceSlot: {
          include: {
            approvedVersion: {
              include: {
                asset: {
                  include: {
                    placements: true,
                    variants: { include: { placements: true } },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

const TRAILER_SUMMARY_INCLUDE =
  Prisma.validator<Prisma.StoryFilmTrailerInclude>()({
    references: {
      orderBy: [{ role: 'asc' }, { position: 'asc' }],
      include: {
        referenceSlot: { select: { approvedVersionId: true } },
      },
    },
    currentVideoAsset: {
      include: {
        placements: true,
        variants: { include: { placements: true } },
      },
    },
    latestGenerationAttempt: {
      include: TRAILER_GENERATION_INCLUDE,
    },
  });

type TrailerGenerationRow = Prisma.StoryFilmTrailerGenerationAttemptGetPayload<{
  include: typeof TRAILER_GENERATION_INCLUDE;
}>;
type ProductionTrailerRow = Prisma.StoryFilmTrailerGetPayload<{
  include: typeof TRAILER_PRODUCTION_INCLUDE;
}>;
type TrailerSummaryRow = Prisma.StoryFilmTrailerGetPayload<{
  include: typeof TRAILER_SUMMARY_INCLUDE;
}>;

interface PreparedTrailerProduction {
  trailer: ProductionTrailerRow;
  trailerSpec: ReturnType<typeof FilmTrailerSpecSchema.parse>;
  model: AiModelDefinition;
  compiledPrompt: string;
  promptSnapshot: Prisma.InputJsonObject;
  generationConfig: Prisma.InputJsonObject;
  modelSnapshot: Prisma.InputJsonObject;
  productionManifest: Prisma.InputJsonObject;
  productionInputHash: string;
  aiInput: Record<string, unknown>;
  referenceBindings: AiSubmitReferenceBinding[];
  generationReferences: Array<{
    referenceSlotId: string;
    referenceVersionId: string;
    role: ProductionTrailerRow['references'][number]['role'];
    position: number;
    assetId: string;
    checksumSha256: string;
  }>;
}

@Injectable()
export class StoryFilmTrailerProductionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: StoryPermissionService,
    private readonly aiGeneration: AiGenerationService,
  ) {}

  async getTrailer(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    revisionId: string,
  ): Promise<FilmTrailerSummaryDto> {
    await this.requireProjectScope(user, workspaceId, projectId, 'story.read');
    const trailer = await this.prisma.storyFilmTrailer.findFirst({
      where: { storyProjectId: projectId, revisionId },
      include: TRAILER_SUMMARY_INCLUDE,
    });
    if (!trailer) throw trailerNotFound();
    return toTrailerSummary(trailer);
  }

  async putReferences(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    revisionId: string,
    input: PutFilmTrailerReferencesInput,
  ): Promise<FilmTrailerReferencesDto> {
    await this.requireProjectScope(user, workspaceId, projectId, 'story.edit');
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtext(${`story-film-trailer-references:${revisionId}`})::bigint
        )
      `;
      const trailer = await tx.storyFilmTrailer.findFirst({
        where: { storyProjectId: projectId, revisionId },
      });
      if (!trailer) throw trailerNotFound();
      const trailerSpec = FilmTrailerSpecSchema.parse(trailer.specJson);
      const plan = ValidateFilmClipReferencePlanSchema.safeParse({
        generationControl: trailerSpec.generationControl,
        bindings: input.bindings,
      });
      if (!plan.success) {
        throw new UnprocessableEntityException({
          code: 'STORY_FILM_TRAILER_REFERENCE_PLAN_INVALID',
          message:
            'Trailer reference bindings do not match the generation mode.',
          issues: plan.error.issues,
        });
      }
      assertUniqueBindings(input.bindings);
      const slotIds = [
        ...new Set(input.bindings.map((binding) => binding.referenceSlotId)),
      ];
      const slots = await tx.storyFilmReferenceSlot.findMany({
        where: {
          id: { in: slotIds },
          storyProjectId: projectId,
          revisionId,
          archivedAt: null,
        },
        select: { id: true, kind: true },
      });
      if (slots.length !== slotIds.length) {
        throw new UnprocessableEntityException({
          code: 'STORY_FILM_TRAILER_REFERENCE_SLOT_SCOPE_INVALID',
          message: 'Every binding must use an active slot from this Revision.',
        });
      }
      const kindBySlot = new Map(slots.map((slot) => [slot.id, slot.kind]));
      if (
        input.bindings.some((binding) => {
          const kind = kindBySlot.get(binding.referenceSlotId);
          return !kind || !roleMatchesSlotKind(binding.role, kind);
        })
      ) {
        throw new UnprocessableEntityException({
          code: 'STORY_FILM_TRAILER_REFERENCE_ROLE_KIND_INVALID',
          message:
            'A binding role is incompatible with its reference slot kind.',
        });
      }
      const current = await tx.storyFilmTrailerReference.findMany({
        where: { trailerId: trailer.id },
        orderBy: [{ role: 'asc' }, { position: 'asc' }],
        include: {
          referenceSlot: { select: { approvedVersionId: true } },
        },
      });
      if (sameBindings(current, input.bindings)) {
        return {
          trailerId: trailer.id,
          trailerVersion: trailer.version,
          currentVideoRevision: trailer.currentVideoRevision,
          bindings: current.map(toReferenceBinding),
        };
      }
      if (trailer.version !== input.expectedTrailerVersion) {
        throw trailerVersionConflict(
          input.expectedTrailerVersion,
          trailer.version,
        );
      }
      await tx.storyFilmTrailerReference.deleteMany({
        where: { trailerId: trailer.id },
      });
      if (input.bindings.length > 0) {
        await tx.storyFilmTrailerReference.createMany({
          data: input.bindings.map((binding) => ({
            storyProjectId: projectId,
            revisionId,
            trailerId: trailer.id,
            referenceSlotId: binding.referenceSlotId,
            role: binding.role,
            position: binding.rank,
            required: binding.required,
          })),
        });
      }
      const updated = await tx.storyFilmTrailer.update({
        where: { id: trailer.id },
        data: {
          productionInputManifest: Prisma.DbNull,
          productionInputHash: null,
          version: { increment: 1 },
          latestGenerationAttemptId: null,
          updatedByUserId: user.userId,
        },
        select: { version: true, currentVideoRevision: true },
      });
      const bindings = await tx.storyFilmTrailerReference.findMany({
        where: { trailerId: trailer.id },
        orderBy: [{ role: 'asc' }, { position: 'asc' }],
        include: {
          referenceSlot: { select: { approvedVersionId: true } },
        },
      });
      return {
        trailerId: trailer.id,
        trailerVersion: updated.version,
        currentVideoRevision: updated.currentVideoRevision,
        bindings: bindings.map(toReferenceBinding),
      };
    });
  }

  async createGeneration(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    revisionId: string,
    input: CreateFilmTrailerGenerationInput,
    idempotencyKey: string,
  ): Promise<FilmVideoGenerationDto> {
    const scope = await this.requireProjectScope(
      user,
      workspaceId,
      projectId,
      'story.generate',
    );
    const trailer = await this.prisma.storyFilmTrailer.findFirst({
      where: { storyProjectId: projectId, revisionId },
      select: { id: true },
    });
    if (!trailer) throw trailerNotFound();
    const submissionKey = trailerSubmissionKey(
      user.userId,
      projectId,
      trailer.id,
      idempotencyKey,
    );
    const existing =
      await this.prisma.storyFilmTrailerGenerationAttempt.findUnique({
        where: { submissionKey },
        include: TRAILER_GENERATION_INCLUDE,
      });
    if (existing) {
      assertIdempotentGenerationInput(existing, input);
      return this.toGenerationDto(await this.reconcileGeneration(existing));
    }

    const prepared = await this.prepareProduction(
      user,
      scope.project.workspaceId,
      projectId,
      revisionId,
      input,
    );
    const jobKey = `story-trailer-generation:${canonicalJsonHash(submissionKey)}`;
    let createdGenerationId: string | null = null;
    const hooks: AiJobSubmissionHooks = {
      afterJobCreate: async (tx, job) => {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(
            hashtext(${`story-film-trailer-current-video:${revisionId}`})::bigint
          )
        `;
        const locked = await tx.storyFilmTrailer.findFirst({
          where: {
            id: prepared.trailer.id,
            storyProjectId: projectId,
            revisionId,
          },
          include: TRAILER_PRODUCTION_INCLUDE,
        });
        if (!locked) throw trailerNotFound();
        if (locked.version !== input.expectedTrailerVersion) {
          throw trailerVersionConflict(
            input.expectedTrailerVersion,
            locked.version,
          );
        }
        assertReferenceSnapshotCurrent(locked, prepared);
        const latest = await tx.storyFilmTrailerGenerationAttempt.findFirst({
          where: { trailerId: locked.id },
          orderBy: [{ attemptNumber: 'desc' }, { id: 'desc' }],
          select: { attemptNumber: true },
        });
        const generation = await tx.storyFilmTrailerGenerationAttempt.create({
          data: {
            storyProjectId: projectId,
            revisionId,
            trailerId: locked.id,
            attemptNumber: (latest?.attemptNumber ?? 0) + 1,
            submissionKey,
            status: StoryFilmGenerationAttemptStatus.queued,
            trailerSpecHash: prepared.trailer.specHash,
            productionInputHash: prepared.productionInputHash,
            promptSnapshot: prepared.promptSnapshot,
            generationConfig: prepared.generationConfig,
            modelSnapshot: prepared.modelSnapshot,
            aiJobId: job.id,
            createdByUserId: user.userId,
            queuedAt: job.queuedAt ? new Date(job.queuedAt) : new Date(),
            references: {
              createMany: {
                data: prepared.generationReferences.map((reference) => ({
                  storyProjectId: projectId,
                  revisionId,
                  ...reference,
                })),
              },
            },
          },
        });
        await tx.storyFilmTrailer.update({
          where: { id: locked.id },
          data: {
            latestGenerationAttemptId: generation.id,
            ...(locked.productionInputHash !== prepared.productionInputHash
              ? {
                  productionInputManifest: prepared.productionManifest,
                  productionInputHash: prepared.productionInputHash,
                  version: { increment: 1 },
                }
              : {}),
            updatedByUserId: user.userId,
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
            documentBlockId: prepared.trailer.id,
            sourceSurface: 'story-studio-trailer',
          },
          idempotencyKey: jobKey,
          input: prepared.aiInput,
          promptDocument: {
            version: 1,
            nodes: [{ type: 'text', text: prepared.compiledPrompt }],
          },
          referenceBindings: prepared.referenceBindings,
        },
        workspaceId,
        hooks,
      );
      const generation =
        await this.prisma.storyFilmTrailerGenerationAttempt.findFirst({
          where: {
            OR: [
              { submissionKey },
              { aiJobId: submitted.request_id },
              ...(createdGenerationId ? [{ id: createdGenerationId }] : []),
            ],
          },
          include: TRAILER_GENERATION_INCLUDE,
        });
      if (!generation) {
        throw new ConflictException({
          code: 'STORY_TRAILER_GENERATION_BINDING_MISSING',
          message: 'The generation job has no trailer generation binding.',
        });
      }
      return this.toGenerationDto(await this.reconcileGeneration(generation));
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const winner =
          await this.prisma.storyFilmTrailerGenerationAttempt.findUnique({
            where: { submissionKey },
            include: TRAILER_GENERATION_INCLUDE,
          });
        if (winner) {
          assertIdempotentGenerationInput(winner, input);
          return this.toGenerationDto(await this.reconcileGeneration(winner));
        }
      }
      throw error;
    }
  }

  async getGeneration(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    generationId: string,
  ): Promise<FilmVideoGenerationDto> {
    await this.requireProjectScope(user, workspaceId, projectId, 'story.read');
    return this.toGenerationDto(
      await this.reconcileGeneration(
        await this.loadGeneration(projectId, generationId),
      ),
    );
  }

  async cancelGeneration(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    generationId: string,
    input: CancelFilmGenerationInput,
  ): Promise<FilmVideoGenerationDto> {
    await this.requireProjectScope(
      user,
      workspaceId,
      projectId,
      'story.generate',
    );
    const generation = await this.reconcileGeneration(
      await this.loadGeneration(projectId, generationId),
    );
    if (generation.version !== input.expectedGenerationVersion) {
      throw generationVersionConflict(
        input.expectedGenerationVersion,
        generation.version,
      );
    }
    await this.aiGeneration.cancelJob(user, generation.aiJobId);
    return this.toGenerationDto(
      await this.reconcileGeneration(
        await this.loadGeneration(projectId, generationId),
      ),
    );
  }

  async retryGeneration(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    generationId: string,
    input: RetryFilmGenerationInput,
    idempotencyKey: string,
  ): Promise<FilmVideoGenerationDto> {
    await this.requireProjectScope(
      user,
      workspaceId,
      projectId,
      'story.generate',
    );
    const generation = await this.reconcileGeneration(
      await this.loadGeneration(projectId, generationId),
    );
    if (generation.version !== input.expectedGenerationVersion) {
      throw generationVersionConflict(
        input.expectedGenerationVersion,
        generation.version,
      );
    }
    if (
      generation.status !== StoryFilmGenerationAttemptStatus.failed &&
      generation.status !== StoryFilmGenerationAttemptStatus.cancelled
    ) {
      throw new ConflictException({
        code: 'STORY_TRAILER_GENERATION_NOT_RETRYABLE',
        message:
          'Only a failed or cancelled trailer generation may be retried.',
      });
    }
    const modelId = jsonString(generation.modelSnapshot, 'slug');
    if (!modelId) {
      throw new ConflictException({
        code: 'STORY_TRAILER_GENERATION_MODEL_SNAPSHOT_CORRUPT',
        message: 'The trailer generation model snapshot cannot be resolved.',
      });
    }
    const trailer = await this.prisma.storyFilmTrailer.findUnique({
      where: { id: generation.trailerId },
      select: { version: true },
    });
    if (!trailer) throw trailerNotFound();
    return this.createGeneration(
      user,
      workspaceId,
      projectId,
      generation.revisionId,
      {
        expectedTrailerVersion: trailer.version,
        modelId,
        variationNote: input.variationNote,
      },
      idempotencyKey,
    );
  }

  async putCurrentVideo(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    revisionId: string,
    input: PutFilmCurrentVideoInput,
  ): Promise<FilmTrailerSummaryDto> {
    await this.requireProjectScope(
      user,
      workspaceId,
      projectId,
      'story.generate',
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtext(${`story-film-trailer-current-video:${revisionId}`})::bigint
        )
      `;
      const trailer = await tx.storyFilmTrailer.findFirst({
        where: { storyProjectId: projectId, revisionId },
      });
      if (!trailer) throw trailerNotFound();
      if (trailer.currentVideoRevision !== input.expectedCurrentVideoRevision) {
        throw currentVideoRevisionConflict(
          input.expectedCurrentVideoRevision,
          trailer.currentVideoRevision,
        );
      }

      if (input.assetId === null || input.variantId === null) {
        await tx.storyFilmTrailer.update({
          where: { id: trailer.id },
          data: {
            currentVideoAssetId: null,
            currentVideoVariantId: null,
            currentVideoSourceAttemptId: null,
            currentVideoSpecHash: null,
            currentVideoInputHash: null,
            currentVideoChecksumSha256: null,
            currentVideoTechnicalChecks: Prisma.DbNull,
            currentVideoRevision: { increment: 1 },
            currentVideoSetByUserId: null,
            currentVideoSetAt: null,
            latestGenerationAttemptId: null,
            updatedByUserId: user.userId,
          },
        });
      } else {
        const asset = await tx.mediaAsset.findFirst({
          where: {
            id: input.assetId,
            workspaceId,
            kind: MediaAssetKind.video,
            status: MediaAssetStatus.ready,
            deletedAt: null,
            moderationStatus: { not: MediaAssetModerationStatus.blocked },
          },
          include: {
            placements: true,
            variants: { include: { placements: true } },
          },
        });
        const variant = asset?.variants.find(
          (candidate) =>
            candidate.id === input.variantId &&
            candidate.assetId === asset.id &&
            candidate.status === MediaAssetVariantStatus.ready &&
            candidate.deletedAt === null,
        );
        const checksum = variant?.checksumSha256;
        if (!asset || !variant || !checksum) {
          throw new UnprocessableEntityException({
            code: 'STORY_TRAILER_CURRENT_VIDEO_ASSET_INVALID',
            message:
              'Select a ready, non-blocked video and one of its ready variants from this Workspace.',
          });
        }
        const trailerSpec = FilmTrailerSpecSchema.parse(trailer.specJson);
        const technicalChecks = storyFilmTechnicalChecks(
          {
            kind: asset.kind,
            width: variant.width ?? asset.width,
            height: variant.height ?? asset.height,
            durationSeconds: variant.durationSeconds ?? asset.durationSeconds,
            checksumSha256: checksum,
          },
          trailerSpec.outputContract,
        );
        if (storyFilmHasFailedTechnicalCheck(technicalChecks)) {
          throw new UnprocessableEntityException({
            code: 'STORY_TRAILER_CURRENT_VIDEO_TECHNICAL_CHECK_FAILED',
            message:
              "The selected video does not satisfy this trailer's output contract.",
            technicalChecks,
          });
        }
        await tx.storyFilmTrailer.update({
          where: { id: trailer.id },
          data: {
            currentVideoAssetId: asset.id,
            currentVideoVariantId: variant.id,
            currentVideoSourceAttemptId: null,
            currentVideoSpecHash: trailer.specHash,
            currentVideoInputHash: trailer.productionInputHash,
            currentVideoChecksumSha256: checksum,
            currentVideoTechnicalChecks: technicalChecks,
            currentVideoRevision: { increment: 1 },
            currentVideoSetByUserId: user.userId,
            currentVideoSetAt: new Date(),
            latestGenerationAttemptId: null,
            updatedByUserId: user.userId,
          },
        });
      }

      return tx.storyFilmTrailer.findUniqueOrThrow({
        where: { id: trailer.id },
        include: TRAILER_SUMMARY_INCLUDE,
      });
    });
    return toTrailerSummary(updated);
  }

  private async prepareProduction(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    revisionId: string,
    input: CreateFilmTrailerGenerationInput,
  ): Promise<PreparedTrailerProduction> {
    const [trailer, filmSpec] = await Promise.all([
      this.prisma.storyFilmTrailer.findFirst({
        where: { storyProjectId: projectId, revisionId },
        include: TRAILER_PRODUCTION_INCLUDE,
      }),
      this.prisma.storyFilmSpec.findFirst({
        where: { storyProjectId: projectId, revisionId },
      }),
    ]);
    if (!trailer) throw trailerNotFound();
    if (!filmSpec) throw revisionNotProductionReady();
    if (trailer.version !== input.expectedTrailerVersion) {
      throw trailerVersionConflict(
        input.expectedTrailerVersion,
        trailer.version,
      );
    }
    const trailerSpec = FilmTrailerSpecSchema.parse(trailer.specJson);
    const canonical = await this.prisma.aiCanonicalModel.findFirst({
      where: {
        ...(input.modelId
          ? { slug: input.modelId }
          : { id: filmSpec.defaultCanonicalModelId }),
        status: 'active',
        archivedAt: null,
      },
      select: { id: true, slug: true },
    });
    if (!canonical) throw modelNotAvailable();
    const models = await this.aiGeneration.listModels(user, workspaceId);
    const model = models.find((candidate) => candidate.id === canonical.slug);
    if (!model || !model.enabled || model.type !== 'video') {
      throw modelNotAvailable();
    }
    assertModelSupportsClip(model, trailerSpec);

    const generationReferences: PreparedTrailerProduction['generationReferences'] =
      [];
    const referenceBindings: AiSubmitReferenceBinding[] = [];
    const referenceInputRows: Array<{
      role: string;
      value: Record<string, string>;
    }> = [];
    for (const binding of trailer.references) {
      const version = binding.referenceSlot.approvedVersion;
      if (!version) {
        if (binding.required) {
          throw new UnprocessableEntityException({
            code: 'STORY_FILM_TRAILER_REFERENCE_APPROVAL_REQUIRED',
            message:
              'Every required trailer reference must have an approved version.',
          });
        }
        continue;
      }
      if (
        version.asset.kind !== MediaAssetKind.image ||
        version.asset.status !== MediaAssetStatus.ready ||
        version.asset.moderationStatus === MediaAssetModerationStatus.blocked ||
        !version.checksumSha256
      ) {
        throw new UnprocessableEntityException({
          code: 'STORY_FILM_TRAILER_REFERENCE_NOT_READY',
          message: 'An approved trailer reference is not production-ready.',
        });
      }
      const url = resolveMediaPublicUrl(version.asset);
      if (!url) {
        throw new UnprocessableEntityException({
          code: 'STORY_FILM_TRAILER_REFERENCE_URL_UNAVAILABLE',
          message: 'An approved trailer reference is not provider-readable.',
        });
      }
      const refId = `${binding.role}:${binding.position}:${version.id}`;
      const value = { url, assetId: version.assetId, refId };
      referenceInputRows.push({ role: binding.role, value });
      referenceBindings.push({
        refId,
        kind: 'image',
        role: binding.role,
        label: `${binding.role}:${binding.position + 1}`,
        order: referenceBindings.length,
        url,
        assetId: version.assetId,
      });
      generationReferences.push({
        referenceSlotId: binding.referenceSlotId,
        referenceVersionId: version.id,
        role: binding.role,
        position: binding.position,
        assetId: version.assetId,
        checksumSha256: version.checksumSha256,
      });
    }

    const submitReferenceBindings = generationReferenceBindingsForClip(
      trailerSpec,
      referenceBindings,
    );
    const promptCompilation = compileStoryFilmPrompt({
      clip: trailerSpec,
      variationNote: input.variationNote,
      maxLength: modelPromptMaxLength(model),
      providerReservedLength: providerImageReferencePromptOverhead(
        submitReferenceBindings.length,
      ),
    });
    const generationConfig = buildGenerationConfig(
      model,
      trailerSpec,
      input.seed,
    );
    const generationConfigJson = generationConfig as Prisma.InputJsonObject;
    const productionManifest = {
      version: 1,
      trailer: { id: trailer.id, specHash: trailer.specHash },
      model: { canonicalModelId: canonical.id, slug: canonical.slug },
      generationConfig: generationConfigJson,
      prompt: {
        compilerVersion: promptCompilation.stats.strategyVersion,
        compiledPromptHash: canonicalJsonHash(promptCompilation.text),
        submittedLength: promptCompilation.stats.submittedLength,
      },
      references: generationReferences,
      outputContract: trailerSpec.outputContract,
    } as Prisma.InputJsonObject;
    const productionInputHash = canonicalJsonHash(productionManifest);
    return {
      trailer,
      trailerSpec,
      model,
      compiledPrompt: promptCompilation.text,
      promptSnapshot: {
        version: 1,
        masterPrompt: trailerSpec.prompt.masterPrompt,
        negativeConstraints: trailerSpec.prompt.negativeConstraints,
        timeline: trailerSpec.prompt.timeline,
        referenceRoleNotes: trailerSpec.referenceRoleNotes,
        continuityNotes: trailerSpec.continuityNotes,
        variationNote: input.variationNote ?? null,
        requestFingerprint: trailerGenerationRequestFingerprint(input),
        compiledPrompt: promptCompilation.text,
        compilerStats: promptCompilation.stats,
      } as Prisma.InputJsonObject,
      generationConfig: generationConfigJson,
      modelSnapshot: {
        version: 1,
        canonicalModelId: canonical.id,
        slug: canonical.slug,
        requestedModelId: input.modelId ?? null,
        displayName: model.name,
        schemaVersion: model.schemaVersion,
        generationModes: model.generationModes,
      } as Prisma.InputJsonObject,
      productionManifest,
      productionInputHash,
      aiInput: {
        prompt: promptCompilation.text,
        ...generationConfig,
        ...referenceInputForClip(trailerSpec, referenceInputRows),
      },
      referenceBindings: submitReferenceBindings,
      generationReferences,
    };
  }

  private async reconcileGeneration(
    row: TrailerGenerationRow,
  ): Promise<TrailerGenerationRow> {
    if (
      row.status === StoryFilmGenerationAttemptStatus.ready ||
      row.status === StoryFilmGenerationAttemptStatus.failed ||
      row.status === StoryFilmGenerationAttemptStatus.cancelled
    ) {
      return row;
    }
    const job = row.aiJob;
    const now = new Date();
    let data: Prisma.StoryFilmTrailerGenerationAttemptUncheckedUpdateManyInput | null =
      null;
    let currentVideoCandidate: {
      assetId: string;
      variantId: string;
      checksumSha256: string;
      technicalChecks: Prisma.InputJsonArray;
    } | null = null;
    if (job.status === 'in_queue') {
      data = { status: StoryFilmGenerationAttemptStatus.queued };
    } else if (job.status === 'in_progress') {
      const processing = [
        'fetching_output',
        'uploading_to_oss',
        'completed',
      ].includes(job.stage.toLowerCase());
      data = {
        status: processing
          ? StoryFilmGenerationAttemptStatus.processing
          : StoryFilmGenerationAttemptStatus.running,
        startedAt: row.startedAt ?? job.startedAt ?? now,
      };
    } else if (job.status === 'failed' || job.status === 'expired') {
      data = {
        status: StoryFilmGenerationAttemptStatus.failed,
        error: (job.error ?? {
          code: 'AI_JOB_FAILED',
          message: 'The trailer generation job failed.',
        }) as Prisma.InputJsonObject,
        completedAt: job.completedAt ?? now,
      };
    } else if (job.status === 'cancelled') {
      data = {
        status: StoryFilmGenerationAttemptStatus.cancelled,
        error: (job.error ?? {
          code: 'AI_JOB_CANCELLED',
          message: 'The trailer generation job was cancelled.',
        }) as Prisma.InputJsonObject,
        cancelledAt: job.completedAt ?? now,
        completedAt: job.completedAt ?? now,
      };
    } else if (job.status === 'completed') {
      const output = job.outputs.find(
        (candidate) =>
          candidate.type === 'video' && candidate.asset?.status === 'ready',
      );
      const asset = output?.asset;
      const original = asset?.variants.find(
        (variant) =>
          variant.variantKey === 'original' &&
          variant.status === MediaAssetVariantStatus.ready,
      );
      if (asset?.moderationStatus === MediaAssetModerationStatus.blocked) {
        data = {
          status: StoryFilmGenerationAttemptStatus.failed,
          error: {
            code: 'STORY_TRAILER_GENERATION_OUTPUT_MODERATION_BLOCKED',
            message: 'The generated trailer was blocked by moderation.',
          },
          completedAt: job.completedAt ?? now,
        };
      } else if (!output || !asset) {
        const completedAt = job.completedAt ?? now;
        const orphaned = now.getTime() - completedAt.getTime() > 60_000;
        data = orphaned
          ? {
              status: StoryFilmGenerationAttemptStatus.failed,
              error: {
                code: 'STORY_TRAILER_GENERATION_OUTPUT_MISSING',
                message:
                  'The completed trailer job has no durable video output.',
              },
              completedAt,
            }
          : { status: StoryFilmGenerationAttemptStatus.processing };
      } else if (!original?.checksumSha256) {
        data = { status: StoryFilmGenerationAttemptStatus.processing };
      } else {
        const trailerSpec = FilmTrailerSpecSchema.parse(
          await this.prisma.storyFilmTrailer
            .findUniqueOrThrow({ where: { id: row.trailerId } })
            .then((trailer) => trailer.specJson),
        );
        const technicalChecks = storyFilmTechnicalChecks(
          {
            kind: asset.kind,
            width: original.width ?? asset.width,
            height: original.height ?? asset.height,
            durationSeconds: original.durationSeconds ?? asset.durationSeconds,
            checksumSha256: original.checksumSha256,
          },
          trailerSpec.outputContract,
        );
        const technicalChecksFailed =
          storyFilmHasFailedTechnicalCheck(technicalChecks);
        data = {
          status: technicalChecksFailed
            ? StoryFilmGenerationAttemptStatus.failed
            : StoryFilmGenerationAttemptStatus.ready,
          aiJobOutputId: output.id,
          outputAssetId: asset.id,
          outputVariantId: original.id,
          outputChecksumSha256: original.checksumSha256,
          technicalChecks,
          ...(technicalChecksFailed
            ? {
                error: {
                  code: 'STORY_TRAILER_GENERATION_TECHNICAL_CHECKS_FAILED',
                  message:
                    'The generated trailer did not satisfy the output contract.',
                },
              }
            : { readyAt: now }),
          completedAt: job.completedAt ?? now,
        };
        if (!technicalChecksFailed) {
          currentVideoCandidate = {
            assetId: asset.id,
            variantId: original.id,
            checksumSha256: original.checksumSha256,
            technicalChecks,
          };
        }
      }
    }
    if (
      !data ||
      (data.status === row.status && Object.keys(data).length === 1)
    ) {
      return row;
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtext(${`story-film-trailer-current-video:${row.revisionId}`})::bigint
        )
      `;
      const generationUpdate =
        await tx.storyFilmTrailerGenerationAttempt.updateMany({
          where: { id: row.id, version: row.version, status: row.status },
          data: { ...data, version: { increment: 1 } },
        });
      if (generationUpdate.count !== 1) return false;
      if (currentVideoCandidate) {
        const applied = await tx.storyFilmTrailer.updateMany({
          where: {
            id: row.trailerId,
            storyProjectId: row.storyProjectId,
            revisionId: row.revisionId,
            latestGenerationAttemptId: row.id,
            specHash: row.trailerSpecHash,
            productionInputHash: row.productionInputHash,
          },
          data: {
            currentVideoAssetId: currentVideoCandidate.assetId,
            currentVideoVariantId: currentVideoCandidate.variantId,
            currentVideoSourceAttemptId: row.id,
            currentVideoSpecHash: row.trailerSpecHash,
            currentVideoInputHash: row.productionInputHash,
            currentVideoChecksumSha256: currentVideoCandidate.checksumSha256,
            currentVideoTechnicalChecks: currentVideoCandidate.technicalChecks,
            currentVideoRevision: { increment: 1 },
            currentVideoSetByUserId: row.createdByUserId,
            currentVideoSetAt: now,
          },
        });
        if (applied.count !== 1) {
          await tx.storyFilmTrailerGenerationAttempt.update({
            where: { id: row.id },
            data: { supersededAt: now },
          });
        }
      }
      return true;
    });
    if (!updated) {
      return this.loadGeneration(row.storyProjectId, row.id);
    }
    return this.loadGeneration(row.storyProjectId, row.id);
  }

  private async loadGeneration(
    projectId: string,
    generationId: string,
  ): Promise<TrailerGenerationRow> {
    const generation =
      await this.prisma.storyFilmTrailerGenerationAttempt.findFirst({
        where: { id: generationId, storyProjectId: projectId },
        include: TRAILER_GENERATION_INCLUDE,
      });
    if (!generation) throw trailerGenerationNotFound();
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

  private toGenerationDto(row: TrailerGenerationRow): FilmVideoGenerationDto {
    return toTrailerGenerationDto(row);
  }
}

function trailerSubmissionKey(
  userId: string,
  projectId: string,
  trailerId: string,
  idempotencyKey: string,
): string {
  return `${userId}:${projectId}:${trailerId}:${canonicalJsonHash(idempotencyKey)}`;
}

function assertIdempotentGenerationInput(
  row: TrailerGenerationRow,
  input: CreateFilmTrailerGenerationInput,
): void {
  const promptSnapshot = jsonRecord(row.promptSnapshot);
  if (
    promptSnapshot.requestFingerprint !==
    trailerGenerationRequestFingerprint(input)
  ) {
    throw new ConflictException({
      code: 'STORY_TRAILER_GENERATION_IDEMPOTENCY_CONFLICT',
      message:
        'Idempotency-Key was already used with another trailer generation input.',
    });
  }
}

export function trailerGenerationRequestFingerprint(
  input: CreateFilmTrailerGenerationInput,
): string {
  return canonicalJsonHash({
    expectedTrailerVersion: input.expectedTrailerVersion,
    modelId: input.modelId ?? null,
    variationNote: input.variationNote ?? null,
    seed: input.seed ?? null,
  });
}

function assertReferenceSnapshotCurrent(
  locked: ProductionTrailerRow,
  prepared: PreparedTrailerProduction,
): void {
  const current = locked.references
    .map((binding) => ({
      referenceSlotId: binding.referenceSlotId,
      referenceVersionId: binding.referenceSlot.approvedVersion?.id ?? null,
      role: binding.role,
      position: binding.position,
    }))
    .filter((binding) => binding.referenceVersionId !== null);
  const expected = prepared.generationReferences.map((binding) => ({
    referenceSlotId: binding.referenceSlotId,
    referenceVersionId: binding.referenceVersionId,
    role: binding.role,
    position: binding.position,
  }));
  if (canonicalJsonHash(current) !== canonicalJsonHash(expected)) {
    throw new ConflictException({
      code: 'STORY_FILM_TRAILER_REFERENCE_SNAPSHOT_CONFLICT',
      message:
        'Approved trailer references changed while the generation was being queued.',
    });
  }
}

function toTrailerSummary(row: TrailerSummaryRow): FilmTrailerSummaryDto {
  const spec = FilmTrailerSpecSchema.parse(row.specJson);
  const hasCurrentVideo = Boolean(
    row.currentVideoAsset &&
    row.currentVideoVariantId &&
    row.currentVideoChecksumSha256 &&
    row.currentVideoSpecHash &&
    row.currentVideoSetAt,
  );
  return {
    ...spec,
    id: row.id,
    projectId: row.storyProjectId,
    revisionId: row.revisionId,
    version: row.version,
    currentVideoRevision: row.currentVideoRevision,
    specHash: row.specHash,
    productionInputHash: row.productionInputHash,
    referenceBindings: row.references.map(toReferenceBinding),
    currentVideo: hasCurrentVideo
      ? {
          asset: toMediaAsset(row.currentVideoAsset!),
          variantId: row.currentVideoVariantId!,
          sourceGenerationId: row.currentVideoSourceAttemptId,
          specHash: row.currentVideoSpecHash,
          inputHash: row.currentVideoInputHash,
          checksumSha256: row.currentVideoChecksumSha256!,
          technicalChecks: storyFilmTechnicalCheckDtos(
            row.currentVideoTechnicalChecks ?? [],
          ),
          revision: row.currentVideoRevision,
          setByUserId: row.currentVideoSetByUserId,
          setAt: row.currentVideoSetAt!.toISOString(),
          outdated:
            row.currentVideoSpecHash !== row.specHash ||
            row.currentVideoInputHash !== row.productionInputHash,
        }
      : null,
    generation: row.latestGenerationAttempt
      ? toTrailerGenerationDto(row.latestGenerationAttempt)
      : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toTrailerGenerationDto(
  row: TrailerGenerationRow,
): FilmVideoGenerationDto {
  return {
    id: row.id,
    projectId: row.storyProjectId,
    revisionId: row.revisionId,
    target: { kind: 'trailer', trailerId: row.trailerId },
    number: row.attemptNumber,
    version: row.version,
    aiJobId: row.aiJobId,
    aiJobOutputId: row.aiJobOutputId,
    status: row.status,
    specHash: row.trailerSpecHash,
    inputHash: row.productionInputHash,
    promptSnapshot: jsonRecord(row.promptSnapshot),
    generationConfig: jsonRecord(row.generationConfig),
    modelSnapshot: jsonRecord(row.modelSnapshot),
    outputAsset: row.outputAsset ? toMediaAsset(row.outputAsset) : null,
    outputVariantId: row.outputVariantId,
    outputChecksumSha256: row.outputChecksumSha256,
    technicalChecks: storyFilmTechnicalCheckDtos(row.technicalChecks),
    error: row.error ? jsonRecord(row.error) : null,
    createdByUserId: row.createdByUserId,
    queuedAt: row.queuedAt?.toISOString() ?? null,
    startedAt: row.startedAt?.toISOString() ?? null,
    readyAt: row.readyAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    supersededAt: row.supersededAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

function toReferenceBinding(row: {
  id: string;
  referenceSlotId: string;
  role: FilmClipReferenceBindingDto['role'];
  position: number;
  required: boolean;
  referenceSlot: { approvedVersionId: string | null };
}): FilmClipReferenceBindingDto {
  return {
    id: row.id,
    referenceSlotId: row.referenceSlotId,
    role: row.role,
    rank: row.position,
    required: row.required,
    approvedReferenceVersionId: row.referenceSlot.approvedVersionId,
  };
}

function sameBindings(
  current: Array<{
    referenceSlotId: string;
    role: string;
    position: number;
    required: boolean;
  }>,
  proposed: PutFilmTrailerReferencesInput['bindings'],
): boolean {
  const normalize = (rows: typeof current) =>
    rows
      .map((row) => ({
        referenceSlotId: row.referenceSlotId,
        role: row.role,
        rank: row.position,
        required: row.required,
      }))
      .sort(bindingOrder);
  return (
    canonicalJsonHash(normalize(current)) ===
    canonicalJsonHash([...proposed].sort(bindingOrder))
  );
}

function assertUniqueBindings(
  bindings: PutFilmTrailerReferencesInput['bindings'],
): void {
  const roleRanks = new Set<string>();
  const slotRoles = new Set<string>();
  for (const binding of bindings) {
    const roleRank = `${binding.role}:${binding.rank}`;
    const slotRole = `${binding.referenceSlotId}:${binding.role}`;
    if (roleRanks.has(roleRank) || slotRoles.has(slotRole)) {
      throw new UnprocessableEntityException({
        code: 'STORY_FILM_TRAILER_REFERENCE_BINDING_DUPLICATE',
        message: 'Trailer reference bindings must be unique.',
      });
    }
    roleRanks.add(roleRank);
    slotRoles.add(slotRole);
  }
}

function bindingOrder(
  a: { role: string; rank: number },
  b: { role: string; rank: number },
): number {
  return a.role.localeCompare(b.role) || a.rank - b.rank;
}

function toMediaAsset(
  row: NonNullable<TrailerGenerationRow['outputAsset']>,
): MediaAssetSummaryDto {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    moderationStatus: row.moderationStatus,
    contentType: row.contentType,
    width: row.width,
    height: row.height,
    durationSeconds: row.durationSeconds,
    checksumSha256: row.checksumSha256,
    previewUrl: resolveMediaPublicUrl(row),
  };
}

function jsonRecord(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function jsonString(value: Prisma.JsonValue, key: string): string | null {
  const candidate = jsonRecord(value)[key];
  return typeof candidate === 'string' ? candidate : null;
}

function trailerNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'STORY_FILM_TRAILER_NOT_FOUND',
    message: 'Story film trailer not found.',
  });
}

function trailerGenerationNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'STORY_TRAILER_GENERATION_NOT_FOUND',
    message: 'Story film trailer generation not found.',
  });
}

function revisionNotProductionReady(): ConflictException {
  return new ConflictException({
    code: 'STORY_FILM_REVISION_NOT_READY',
    message: 'Lock the Story Revision before producing a trailer generation.',
  });
}

function modelNotAvailable(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'STORY_FILM_MODEL_NOT_AVAILABLE',
    message: 'The selected canonical video model is not available.',
  });
}

function trailerVersionConflict(expected: number, actual: number) {
  return new ConflictException({
    code: 'STORY_FILM_TRAILER_VERSION_CONFLICT',
    message: 'The trailer changed. Refresh and try again.',
    expectedVersion: expected,
    actualVersion: actual,
  });
}

function generationVersionConflict(expected: number, actual: number) {
  return new ConflictException({
    code: 'STORY_TRAILER_GENERATION_VERSION_CONFLICT',
    message: 'The trailer generation changed. Refresh and try again.',
    expectedVersion: expected,
    actualVersion: actual,
  });
}

function currentVideoRevisionConflict(expected: number, actual: number) {
  return new ConflictException({
    code: 'STORY_TRAILER_CURRENT_VIDEO_REVISION_CONFLICT',
    message: 'The current trailer video changed. Refresh and try again.',
    expectedRevision: expected,
    actualRevision: actual,
  });
}

function isUniqueConstraintError(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}
