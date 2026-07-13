import {
  BadRequestException,
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
  StoryFilmTakeStatus,
  StoryReviewDecision,
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
  FilmTrailerTakeReviewChecklistSchema,
  ValidateFilmClipReferencePlanSchema,
  filmTrailerChecklistAllowsApproval,
  type ApproveFilmTakeInput,
  type CancelFilmTakeInput,
  type CreateFilmTrailerTakeInput,
  type CreateFilmTrailerTakeReviewInput,
  type CursorPageDto,
  type FilmClipReferenceBindingDto,
  type FilmReviewDto,
  type FilmTakeListQuery,
  type FilmTrailerReferencesDto,
  type FilmTrailerSummaryDto,
  type FilmTrailerTakeDto,
  type MediaAssetSummaryDto,
  type PutFilmTrailerMasterInput,
  type PutFilmTrailerReferencesInput,
  type RetryFilmTakeInput,
} from './dto';
import { filmTrailerProductionReadModel } from './story-film-production-read-model';
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

const TRAILER_TAKE_INCLUDE =
  Prisma.validator<Prisma.StoryFilmTrailerTakeInclude>()({
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
        masterTakeId: true,
      },
    },
    reviews: { orderBy: [{ sequence: 'desc' }, { id: 'desc' }] },
    approval: true,
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
    takes: {
      select: {
        status: true,
        productionInputHash: true,
        approval: { select: { takeId: true } },
      },
    },
    masterTake: {
      select: {
        productionInputHash: true,
        status: true,
        outputAsset: {
          include: {
            placements: true,
            variants: { include: { placements: true } },
          },
        },
      },
    },
  });

type TrailerTakeRow = Prisma.StoryFilmTrailerTakeGetPayload<{
  include: typeof TRAILER_TAKE_INCLUDE;
}>;
type ProductionTrailerRow = Prisma.StoryFilmTrailerGetPayload<{
  include: typeof TRAILER_PRODUCTION_INCLUDE;
}>;
type TrailerSummaryRow = Prisma.StoryFilmTrailerGetPayload<{
  include: typeof TRAILER_SUMMARY_INCLUDE;
}>;

interface TrailerTakeCursor {
  number: number;
  id: string;
}

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
  takeReferences: Array<{
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
          masterRevision: trailer.masterRevision,
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
          ...(trailer.masterTakeId
            ? {
                masterTakeId: null,
                masterRevision: { increment: 1 },
                masterSelectedByUserId: null,
                masterSelectedAt: null,
              }
            : {}),
          updatedByUserId: user.userId,
        },
        select: { version: true, masterRevision: true },
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
        masterRevision: updated.masterRevision,
        bindings: bindings.map(toReferenceBinding),
      };
    });
  }

  async createTake(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    revisionId: string,
    input: CreateFilmTrailerTakeInput,
    idempotencyKey: string,
  ): Promise<FilmTrailerTakeDto> {
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
    const existing = await this.prisma.storyFilmTrailerTake.findUnique({
      where: { submissionKey },
      include: TRAILER_TAKE_INCLUDE,
    });
    if (existing) {
      assertIdempotentTakeInput(existing, input);
      return this.toTakeDto(await this.reconcileTake(existing));
    }

    const prepared = await this.prepareProduction(
      user,
      scope.project.workspaceId,
      projectId,
      revisionId,
      input,
    );
    const jobKey = `story-trailer-take:${canonicalJsonHash(submissionKey)}`;
    let createdTakeId: string | null = null;
    const hooks: AiJobSubmissionHooks = {
      afterJobCreate: async (tx, job) => {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(
            hashtext(${`story-film-trailer-take:${prepared.trailer.id}`})::bigint
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
        if (locked.productionInputHash !== prepared.productionInputHash) {
          await tx.storyFilmTrailer.update({
            where: { id: locked.id },
            data: {
              productionInputManifest: prepared.productionManifest,
              productionInputHash: prepared.productionInputHash,
              version: { increment: 1 },
              ...(locked.masterTakeId
                ? {
                    masterTakeId: null,
                    masterRevision: { increment: 1 },
                    masterSelectedByUserId: null,
                    masterSelectedAt: null,
                  }
                : {}),
              updatedByUserId: user.userId,
            },
          });
        }
        const latest = await tx.storyFilmTrailerTake.findFirst({
          where: { trailerId: locked.id },
          orderBy: [{ takeNumber: 'desc' }, { id: 'desc' }],
          select: { takeNumber: true },
        });
        const take = await tx.storyFilmTrailerTake.create({
          data: {
            storyProjectId: projectId,
            revisionId,
            trailerId: locked.id,
            takeNumber: (latest?.takeNumber ?? 0) + 1,
            submissionKey,
            status: StoryFilmTakeStatus.queued,
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
                data: prepared.takeReferences.map((reference) => ({
                  storyProjectId: projectId,
                  revisionId,
                  ...reference,
                })),
              },
            },
          },
        });
        createdTakeId = take.id;
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
      const take = await this.prisma.storyFilmTrailerTake.findFirst({
        where: {
          OR: [
            { submissionKey },
            { aiJobId: submitted.request_id },
            ...(createdTakeId ? [{ id: createdTakeId }] : []),
          ],
        },
        include: TRAILER_TAKE_INCLUDE,
      });
      if (!take) {
        throw new ConflictException({
          code: 'STORY_TRAILER_TAKE_BINDING_MISSING',
          message: 'The generation job has no trailer Take binding.',
        });
      }
      return this.toTakeDto(await this.reconcileTake(take));
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const winner = await this.prisma.storyFilmTrailerTake.findUnique({
          where: { submissionKey },
          include: TRAILER_TAKE_INCLUDE,
        });
        if (winner) {
          assertIdempotentTakeInput(winner, input);
          return this.toTakeDto(await this.reconcileTake(winner));
        }
      }
      throw error;
    }
  }

  async listTakes(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    revisionId: string,
    query: FilmTakeListQuery,
  ): Promise<CursorPageDto<FilmTrailerTakeDto>> {
    await this.requireProjectScope(user, workspaceId, projectId, 'story.read');
    const trailer = await this.prisma.storyFilmTrailer.findFirst({
      where: { storyProjectId: projectId, revisionId },
      select: { id: true },
    });
    if (!trailer) throw trailerNotFound();
    const cursor = query.cursor ? decodeTakeCursor(query.cursor) : null;
    const rows = await this.prisma.storyFilmTrailerTake.findMany({
      where: {
        storyProjectId: projectId,
        revisionId,
        trailerId: trailer.id,
        ...(query.status ? { status: query.status } : {}),
        ...(cursor
          ? {
              OR: [
                { takeNumber: { lt: cursor.number } },
                { takeNumber: cursor.number, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ takeNumber: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      include: TRAILER_TAKE_INCLUDE,
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const reconciled = await Promise.all(
      page.map((row) => this.reconcileTake(row)),
    );
    const last = reconciled.at(-1);
    return {
      items: reconciled.map((row) => this.toTakeDto(row)),
      nextCursor:
        hasMore && last
          ? encodeTakeCursor({ number: last.takeNumber, id: last.id })
          : null,
    };
  }

  async getTake(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    takeId: string,
  ): Promise<FilmTrailerTakeDto> {
    await this.requireProjectScope(user, workspaceId, projectId, 'story.read');
    return this.toTakeDto(
      await this.reconcileTake(await this.loadTake(projectId, takeId)),
    );
  }

  async cancelTake(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    takeId: string,
    input: CancelFilmTakeInput,
  ): Promise<FilmTrailerTakeDto> {
    await this.requireProjectScope(
      user,
      workspaceId,
      projectId,
      'story.generate',
    );
    const take = await this.reconcileTake(
      await this.loadTake(projectId, takeId),
    );
    if (take.version !== input.expectedTakeVersion) {
      throw takeVersionConflict(input.expectedTakeVersion, take.version);
    }
    await this.aiGeneration.cancelJob(user, take.aiJobId);
    return this.toTakeDto(
      await this.reconcileTake(await this.loadTake(projectId, takeId)),
    );
  }

  async retryTake(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    takeId: string,
    input: RetryFilmTakeInput,
    idempotencyKey: string,
  ): Promise<FilmTrailerTakeDto> {
    await this.requireProjectScope(
      user,
      workspaceId,
      projectId,
      'story.generate',
    );
    const take = await this.reconcileTake(
      await this.loadTake(projectId, takeId),
    );
    if (take.version !== input.expectedTakeVersion) {
      throw takeVersionConflict(input.expectedTakeVersion, take.version);
    }
    if (
      take.status !== StoryFilmTakeStatus.failed &&
      take.status !== StoryFilmTakeStatus.cancelled
    ) {
      throw new ConflictException({
        code: 'STORY_TRAILER_TAKE_NOT_RETRYABLE',
        message: 'Only a failed or cancelled trailer Take may be retried.',
      });
    }
    const modelId = jsonString(take.modelSnapshot, 'slug');
    if (!modelId) {
      throw new ConflictException({
        code: 'STORY_TRAILER_TAKE_MODEL_SNAPSHOT_CORRUPT',
        message: 'The trailer Take model snapshot cannot be resolved.',
      });
    }
    const trailer = await this.prisma.storyFilmTrailer.findUnique({
      where: { id: take.trailerId },
      select: { version: true },
    });
    if (!trailer) throw trailerNotFound();
    return this.createTake(
      user,
      workspaceId,
      projectId,
      take.revisionId,
      {
        expectedTrailerVersion: trailer.version,
        modelId,
        variationNote: input.variationNote,
      },
      idempotencyKey,
    );
  }

  async reviewTake(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    takeId: string,
    input: CreateFilmTrailerTakeReviewInput,
  ): Promise<{ take: FilmTrailerTakeDto; review: FilmReviewDto }> {
    await this.requireProjectScope(
      user,
      workspaceId,
      projectId,
      'story.review',
    );
    await this.reconcileTake(await this.loadTake(projectId, takeId));
    const review = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtext(${`story-film-trailer-take-review:${takeId}`})::bigint
        )
      `;
      const current = await tx.storyFilmTrailerTake.findFirst({
        where: { id: takeId, storyProjectId: projectId },
        select: {
          status: true,
          reviewRevision: true,
          approval: { select: { takeId: true } },
        },
      });
      if (!current) throw trailerTakeNotFound();
      if (current.reviewRevision !== input.expectedReviewRevision) {
        throw new ConflictException({
          code: 'STORY_TRAILER_TAKE_REVIEW_REVISION_CONFLICT',
          message:
            'The trailer Take review history changed. Refresh and try again.',
          expectedRevision: input.expectedReviewRevision,
          actualRevision: current.reviewRevision,
        });
      }
      if (current.status !== StoryFilmTakeStatus.ready) {
        throw new ConflictException({
          code: 'STORY_TRAILER_TAKE_NOT_READY',
          message: 'Only a ready trailer Take may be reviewed.',
        });
      }
      if (current.approval) {
        throw new ConflictException({
          code: 'STORY_TRAILER_TAKE_ALREADY_APPROVED',
          message: 'An approved trailer Take cannot receive another review.',
        });
      }
      return tx.storyFilmTrailerTakeReview.create({
        data: {
          takeId,
          sequence: input.expectedReviewRevision + 1,
          decision: input.decision,
          technicalPassed: input.checklist.technical === 'pass',
          safetyPassed: input.checklist.safety === 'pass',
          checklist: input.checklist,
          notes: input.comment,
          reviewerUserId: user.userId,
        },
      });
    });
    const refreshed = await this.loadTake(projectId, takeId);
    return {
      take: this.toTakeDto(refreshed),
      review: toReviewDto(review),
    };
  }

  async approveTake(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    takeId: string,
    input: ApproveFilmTakeInput,
  ): Promise<FilmTrailerTakeDto> {
    await this.requireProjectScope(
      user,
      workspaceId,
      projectId,
      'story.review',
    );
    await this.reconcileTake(await this.loadTake(projectId, takeId));
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtext(${`story-film-trailer-take-approval:${takeId}`})::bigint
        )
      `;
      const current = await tx.storyFilmTrailerTake.findFirst({
        where: { id: takeId, storyProjectId: projectId },
        select: {
          version: true,
          status: true,
          reviewRevision: true,
          technicalChecks: true,
          outputAsset: { select: { moderationStatus: true } },
          approval: true,
        },
      });
      if (!current) throw trailerTakeNotFound();
      if (current.version !== input.expectedTakeVersion) {
        throw takeVersionConflict(input.expectedTakeVersion, current.version);
      }
      if (
        current.outputAsset?.moderationStatus ===
        MediaAssetModerationStatus.blocked
      ) {
        throw new UnprocessableEntityException({
          code: 'STORY_TRAILER_TAKE_OUTPUT_MODERATION_BLOCKED',
          message: 'A moderation-blocked trailer output cannot be approved.',
        });
      }
      if (current.approval) {
        if (current.approval.reviewId === input.approveReviewId) return;
        throw new ConflictException({
          code: 'STORY_TRAILER_TAKE_ALREADY_APPROVED',
          message:
            'The trailer Take was already approved using another review.',
        });
      }
      if (current.status !== StoryFilmTakeStatus.ready) {
        throw new ConflictException({
          code: 'STORY_TRAILER_TAKE_NOT_READY',
          message: 'Only a ready trailer Take may be approved.',
        });
      }
      if (storyFilmHasFailedTechnicalCheck(current.technicalChecks)) {
        throw new UnprocessableEntityException({
          code: 'STORY_TRAILER_TAKE_TECHNICAL_CHECKS_FAILED',
          message:
            'A trailer Take with failed technical checks cannot be approved.',
        });
      }
      const review = await tx.storyFilmTrailerTakeReview.findFirst({
        where: { id: input.approveReviewId, takeId },
      });
      const checklist = review
        ? FilmTrailerTakeReviewChecklistSchema.safeParse(review.checklist)
        : null;
      if (
        !review ||
        review.sequence !== current.reviewRevision ||
        review.decision !== StoryReviewDecision.approve ||
        !review.technicalPassed ||
        !review.safetyPassed ||
        !checklist?.success ||
        !filmTrailerChecklistAllowsApproval(checklist.data) ||
        review.reviewerUserId !== user.userId
      ) {
        throw new UnprocessableEntityException({
          code: 'STORY_TRAILER_TAKE_APPROVAL_REVIEW_INVALID',
          message:
            'Approval requires this trailer Take’s latest passing approve review.',
        });
      }
      await tx.storyFilmTrailerTakeApproval.create({
        data: {
          takeId,
          reviewId: review.id,
          approvedByUserId: user.userId,
        },
      });
    });
    return this.toTakeDto(await this.loadTake(projectId, takeId));
  }

  async putMaster(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    revisionId: string,
    input: PutFilmTrailerMasterInput,
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
          hashtext(${`story-film-trailer-master:${revisionId}`})::bigint
        )
      `;
      const trailer = await tx.storyFilmTrailer.findFirst({
        where: { storyProjectId: projectId, revisionId },
      });
      if (!trailer) throw trailerNotFound();
      if (trailer.masterTakeId === input.takeId) {
        return tx.storyFilmTrailer.findUniqueOrThrow({
          where: { id: trailer.id },
          include: TRAILER_SUMMARY_INCLUDE,
        });
      }
      if (trailer.masterRevision !== input.expectedMasterRevision) {
        throw new ConflictException({
          code: 'STORY_FILM_TRAILER_MASTER_REVISION_CONFLICT',
          message: 'The trailer Master changed. Refresh and try again.',
          expectedRevision: input.expectedMasterRevision,
          actualRevision: trailer.masterRevision,
        });
      }
      if (input.takeId) {
        const candidate = await tx.storyFilmTrailerTake.findFirst({
          where: {
            id: input.takeId,
            trailerId: trailer.id,
            storyProjectId: projectId,
            revisionId,
            status: StoryFilmTakeStatus.ready,
            supersededAt: null,
            trailerSpecHash: trailer.specHash,
            productionInputHash: trailer.productionInputHash ?? undefined,
            approval: { isNot: null },
          },
          select: {
            id: true,
            technicalChecks: true,
            outputAsset: { select: { moderationStatus: true } },
          },
        });
        if (!candidate || trailer.productionInputHash === null) {
          throw new UnprocessableEntityException({
            code: 'STORY_FILM_TRAILER_MASTER_INELIGIBLE',
            message: 'Master must be an approved, ready, current trailer Take.',
          });
        }
        if (storyFilmHasFailedTechnicalCheck(candidate.technicalChecks)) {
          throw new UnprocessableEntityException({
            code: 'STORY_FILM_TRAILER_MASTER_TECHNICAL_CHECKS_FAILED',
            message:
              'A trailer Take with failed technical checks cannot become Master.',
          });
        }
        if (
          candidate.outputAsset?.moderationStatus ===
          MediaAssetModerationStatus.blocked
        ) {
          throw new UnprocessableEntityException({
            code: 'STORY_FILM_TRAILER_MASTER_OUTPUT_MODERATION_BLOCKED',
            message:
              'A moderation-blocked trailer output cannot become Master.',
          });
        }
      }
      await tx.storyFilmTrailer.update({
        where: { id: trailer.id },
        data: {
          masterTakeId: input.takeId,
          masterRevision: { increment: 1 },
          version: { increment: 1 },
          masterSelectedByUserId: input.takeId ? user.userId : null,
          masterSelectedAt: input.takeId ? new Date() : null,
          updatedByUserId: user.userId,
        },
      });
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
    input: CreateFilmTrailerTakeInput,
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

    const takeReferences: PreparedTrailerProduction['takeReferences'] = [];
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
      takeReferences.push({
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
      references: takeReferences,
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
        requestFingerprint: trailerTakeRequestFingerprint(input),
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
      takeReferences,
    };
  }

  private async reconcileTake(row: TrailerTakeRow): Promise<TrailerTakeRow> {
    if (
      row.status === StoryFilmTakeStatus.ready ||
      row.status === StoryFilmTakeStatus.failed ||
      row.status === StoryFilmTakeStatus.cancelled
    ) {
      return row;
    }
    const job = row.aiJob;
    const now = new Date();
    let data: Prisma.StoryFilmTrailerTakeUncheckedUpdateManyInput | null = null;
    if (job.status === 'in_queue') {
      data = { status: StoryFilmTakeStatus.queued };
    } else if (job.status === 'in_progress') {
      const processing = [
        'fetching_output',
        'uploading_to_oss',
        'completed',
      ].includes(job.stage.toLowerCase());
      data = {
        status: processing
          ? StoryFilmTakeStatus.processing
          : StoryFilmTakeStatus.running,
        startedAt: row.startedAt ?? job.startedAt ?? now,
      };
    } else if (job.status === 'failed' || job.status === 'expired') {
      data = {
        status: StoryFilmTakeStatus.failed,
        error: (job.error ?? {
          code: 'AI_JOB_FAILED',
          message: 'The trailer generation job failed.',
        }) as Prisma.InputJsonObject,
        completedAt: job.completedAt ?? now,
      };
    } else if (job.status === 'cancelled') {
      data = {
        status: StoryFilmTakeStatus.cancelled,
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
          status: StoryFilmTakeStatus.failed,
          error: {
            code: 'STORY_TRAILER_TAKE_OUTPUT_MODERATION_BLOCKED',
            message: 'The generated trailer was blocked by moderation.',
          },
          completedAt: job.completedAt ?? now,
        };
      } else if (!output || !asset) {
        const completedAt = job.completedAt ?? now;
        const orphaned = now.getTime() - completedAt.getTime() > 60_000;
        data = orphaned
          ? {
              status: StoryFilmTakeStatus.failed,
              error: {
                code: 'STORY_TRAILER_TAKE_OUTPUT_MISSING',
                message:
                  'The completed trailer job has no durable video output.',
              },
              completedAt,
            }
          : { status: StoryFilmTakeStatus.processing };
      } else if (!original || !asset.checksumSha256) {
        data = { status: StoryFilmTakeStatus.processing };
      } else {
        const trailerSpec = FilmTrailerSpecSchema.parse(
          await this.prisma.storyFilmTrailer
            .findUniqueOrThrow({ where: { id: row.trailerId } })
            .then((trailer) => trailer.specJson),
        );
        data = {
          status: StoryFilmTakeStatus.ready,
          aiJobOutputId: output.id,
          outputAssetId: asset.id,
          outputVariantId: original.id,
          outputChecksumSha256: asset.checksumSha256,
          technicalChecks: storyFilmTechnicalChecks(
            asset,
            trailerSpec.outputContract,
          ),
          readyAt: now,
          completedAt: job.completedAt ?? now,
        };
      }
    }
    if (
      !data ||
      (data.status === row.status && Object.keys(data).length === 1)
    ) {
      return row;
    }
    const updated = await this.prisma.storyFilmTrailerTake.updateMany({
      where: { id: row.id, version: row.version, status: row.status },
      data: { ...data, version: { increment: 1 } },
    });
    if (updated.count === 0) return this.loadTake(row.storyProjectId, row.id);
    return this.loadTake(row.storyProjectId, row.id);
  }

  private async loadTake(
    projectId: string,
    takeId: string,
  ): Promise<TrailerTakeRow> {
    const take = await this.prisma.storyFilmTrailerTake.findFirst({
      where: { id: takeId, storyProjectId: projectId },
      include: TRAILER_TAKE_INCLUDE,
    });
    if (!take) throw trailerTakeNotFound();
    return take;
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

  private toTakeDto(row: TrailerTakeRow): FilmTrailerTakeDto {
    const latestReview = row.reviews[0] ?? null;
    const staleReasons: string[] = [];
    if (row.trailerSpecHash !== row.trailer.specHash) {
      staleReasons.push('trailer_spec');
    }
    if (row.productionInputHash !== row.trailer.productionInputHash) {
      staleReasons.push('production_inputs');
    }
    if (
      row.outputAsset?.moderationStatus === MediaAssetModerationStatus.blocked
    ) {
      staleReasons.push('output_moderation_blocked');
    }
    return {
      id: row.id,
      projectId: row.storyProjectId,
      revisionId: row.revisionId,
      trailerId: row.trailerId,
      number: row.takeNumber,
      version: row.version,
      aiJobId: row.aiJobId,
      aiJobOutputId: row.aiJobOutputId,
      status: row.status,
      reviewStatus: row.approval
        ? 'approved'
        : latestReview?.decision === StoryReviewDecision.request_changes
          ? 'changes_requested'
          : latestReview?.decision === StoryReviewDecision.reject
            ? 'rejected'
            : 'unreviewed',
      reviewRevision: row.reviewRevision,
      trailerSpecHash: row.trailerSpecHash,
      productionInputHash: row.productionInputHash,
      promptSnapshot: jsonRecord(row.promptSnapshot),
      generationConfig: jsonRecord(row.generationConfig),
      modelSnapshot: jsonRecord(row.modelSnapshot),
      stale: staleReasons.length > 0,
      staleReasons,
      outputAsset: row.outputAsset ? toMediaAsset(row.outputAsset) : null,
      technicalChecks: storyFilmTechnicalCheckDtos(row.technicalChecks),
      error: row.error ? jsonRecord(row.error) : null,
      createdByUserId: row.createdByUserId,
      queuedAt: row.queuedAt?.toISOString() ?? null,
      startedAt: row.startedAt?.toISOString() ?? null,
      readyAt: row.readyAt?.toISOString() ?? null,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
    };
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

function assertIdempotentTakeInput(
  row: TrailerTakeRow,
  input: CreateFilmTrailerTakeInput,
): void {
  const promptSnapshot = jsonRecord(row.promptSnapshot);
  if (
    promptSnapshot.requestFingerprint !== trailerTakeRequestFingerprint(input)
  ) {
    throw new ConflictException({
      code: 'STORY_TRAILER_TAKE_IDEMPOTENCY_CONFLICT',
      message:
        'Idempotency-Key was already used with another trailer generation input.',
    });
  }
}

export function trailerTakeRequestFingerprint(
  input: CreateFilmTrailerTakeInput,
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
  const expected = prepared.takeReferences.map((binding) => ({
    referenceSlotId: binding.referenceSlotId,
    referenceVersionId: binding.referenceVersionId,
    role: binding.role,
    position: binding.position,
  }));
  if (canonicalJsonHash(current) !== canonicalJsonHash(expected)) {
    throw new ConflictException({
      code: 'STORY_FILM_TRAILER_REFERENCE_SNAPSHOT_CONFLICT',
      message:
        'Approved trailer references changed while the Take was being queued.',
    });
  }
}

function toTrailerSummary(row: TrailerSummaryRow): FilmTrailerSummaryDto {
  const spec = FilmTrailerSpecSchema.parse(row.specJson);
  const production = filmTrailerProductionReadModel({
    trailer: spec,
    references: row.references.map((binding) => ({
      role: binding.role,
      required: binding.required,
      approvedReferenceVersionId: binding.referenceSlot.approvedVersionId,
    })),
    takes: row.takes,
    productionInputHash: row.productionInputHash,
    masterTakeId: row.masterTakeId,
    masterTake: row.masterTake,
  });
  return {
    ...spec,
    id: row.id,
    projectId: row.storyProjectId,
    revisionId: row.revisionId,
    version: row.version,
    masterRevision: row.masterRevision,
    specHash: row.specHash,
    productionInputHash: row.productionInputHash,
    productionStatus: production.productionStatus,
    blockReasons: production.blockReasons,
    referenceBindings: row.references.map(toReferenceBinding),
    master:
      row.masterTakeId &&
      row.masterTake &&
      row.masterSelectedByUserId &&
      row.masterSelectedAt
        ? {
            takeId: row.masterTakeId,
            status: row.masterTake.status,
            outputAsset: row.masterTake.outputAsset
              ? toMediaAsset(row.masterTake.outputAsset)
              : null,
            masterRevision: row.masterRevision,
            selectedByUserId: row.masterSelectedByUserId,
            selectedAt: row.masterSelectedAt.toISOString(),
          }
        : null,
    takeCounts: production.takeCounts,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
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
  row: NonNullable<TrailerTakeRow['outputAsset']>,
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

function toReviewDto(row: {
  id: string;
  decision: StoryReviewDecision;
  checklist: Prisma.JsonValue;
  notes: string | null;
  reviewerUserId: string;
  createdAt: Date;
}): FilmReviewDto {
  return {
    id: row.id,
    decision: row.decision,
    checklist: jsonRecord(row.checklist) as Record<
      string,
      'pass' | 'fail' | 'na'
    >,
    comment: row.notes,
    reviewerUserId: row.reviewerUserId,
    createdAt: row.createdAt.toISOString(),
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

function encodeTakeCursor(cursor: TrailerTakeCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeTakeCursor(value: string): TrailerTakeCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as TrailerTakeCursor;
    if (
      !Number.isInteger(parsed.number) ||
      parsed.number < 1 ||
      typeof parsed.id !== 'string'
    ) {
      throw new Error();
    }
    return parsed;
  } catch {
    throw new BadRequestException({
      code: 'INVALID_CURSOR',
      message: 'Invalid trailer Take cursor.',
    });
  }
}

function trailerNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'STORY_FILM_TRAILER_NOT_FOUND',
    message: 'Story film trailer not found.',
  });
}

function trailerTakeNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'STORY_TRAILER_TAKE_NOT_FOUND',
    message: 'Story film trailer Take not found.',
  });
}

function revisionNotProductionReady(): ConflictException {
  return new ConflictException({
    code: 'STORY_FILM_REVISION_NOT_READY',
    message: 'Lock the Story Revision before producing a trailer Take.',
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

function takeVersionConflict(expected: number, actual: number) {
  return new ConflictException({
    code: 'STORY_TRAILER_TAKE_VERSION_CONFLICT',
    message: 'The trailer Take changed. Refresh and try again.',
    expectedVersion: expected,
    actualVersion: actual,
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
