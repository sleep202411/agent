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
  StoryFilmClipReferenceRole,
  StoryFilmFrameMode,
  StoryFilmGenerationMode,
  StoryFilmReferenceKind,
  StoryFilmTakeStatus,
  StoryRevisionSource,
  StoryReviewDecision,
} from '@prisma/client';
import type { AuthUser } from '../auth';
import {
  AiGenerationService,
  type AiJobSubmissionHooks,
} from '../ai-generation/ai-generation.service';
import type { AiModelDefinition } from '../ai-generation/types';
import type { AiSubmitReferenceBinding } from '../ai-generation/prompt-document.types';
import { PrismaService } from '../infra/db/db.module';
import { resolveMediaPublicUrl } from '../infra/storage/media-asset-url-resolver.service';
import { canonicalJsonHash } from './canonical-json';
import {
  FilmClipSpecSchema,
  FilmReferenceKeySchema,
  FilmSpecSchema,
  InteractiveFilmDraftContentSchema,
  STORY_FRAME_PROFILE_CONTRACTS,
  createLockableInteractiveFilmDraftContentSchema,
  type ApproveFilmTakeInput,
  type CancelFilmTakeInput,
  type CreateDraftFilmTakeInput,
  type CreateFilmTakeInput,
  type CreateFilmTakeReviewInput,
  type CursorPageDto,
  type FilmClipSummaryDto,
  type FilmReviewDto,
  type FilmTakeDto,
  type FilmTakeListQuery,
  type MediaAssetSummaryDto,
  type PreparedDraftFilmClipDto,
  type PrepareDraftFilmClipInput,
  type PutFilmClipMasterInput,
  type RetryFilmTakeInput,
} from './dto';
import type {
  FilmClipSpec,
  FilmTrailerSpec,
  StoryClipPromptDraft,
} from './interactive-film.schema';
import { filmClipProductionBlockReasons } from './story-film-production-read-model';
import {
  compileStoryFilmPrompt,
  modelPromptMaxLength,
  providerImageReferencePromptOverhead,
} from './story-film-prompt-compiler';
import {
  projectStoryFilmDraftClip,
  projectStoryFilmRevision,
} from './story-film-revision-projector';
import { StoryPermissionService } from './story-permission.service';

const TAKE_INCLUDE = Prisma.validator<Prisma.StoryFilmTakeInclude>()({
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
  revision: { select: { sourceDraftRevision: true, contentHash: true } },
  clip: {
    select: {
      graphNodeId: true,
      specHash: true,
      productionInputHash: true,
      masterTakeId: true,
    },
  },
  reviews: { orderBy: [{ sequence: 'desc' }, { id: 'desc' }] },
  approval: true,
});

type TakeRow = Prisma.StoryFilmTakeGetPayload<{
  include: typeof TAKE_INCLUDE;
}>;

const CLIP_PRODUCTION_INCLUDE = Prisma.validator<Prisma.StoryFilmClipInclude>()(
  {
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
  },
);

type ProductionClipRow = Prisma.StoryFilmClipGetPayload<{
  include: typeof CLIP_PRODUCTION_INCLUDE;
}>;

interface TakeCursor {
  number: number;
  id: string;
}

interface DraftTakeCursor {
  createdAt: string;
  id: string;
}

interface DraftSourceSnapshot {
  revision: number;
  contentHash: string;
}

interface DraftSourceGuard extends DraftSourceSnapshot {
  submissionSubjectId: string;
  requestFingerprint: string;
  idempotencyFingerprint: string;
}

interface MaterializedDraftClip {
  revisionId: string;
  clipId: string;
  clipVersion: number;
  source: DraftSourceSnapshot;
}

interface CurrentDraftClipSnapshot {
  revision: number;
  contentHash: string;
  specHash: string | null;
}

export interface DraftClipReferenceRequirement {
  key: string;
  kind: StoryFilmReferenceKind;
  label: string;
  description: string;
  role: StoryFilmClipReferenceRole;
  position: number;
  required: true;
  rank: number;
}

export type StoryFilmGenerationSubject = Pick<
  FilmClipSpec | FilmTrailerSpec,
  'generationControl' | 'outputContract'
>;

export interface StoryFilmTechnicalAsset {
  kind: MediaAssetKind;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  checksumSha256: string | null;
}

interface PreparedProduction {
  clip: ProductionClipRow;
  clipSpec: ReturnType<typeof FilmClipSpecSchema.parse>;
  model: AiModelDefinition;
  canonicalModelId: string;
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
    role: ProductionClipRow['references'][number]['role'];
    position: number;
    assetId: string;
    checksumSha256: string;
  }>;
}

@Injectable()
export class StoryFilmProductionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: StoryPermissionService,
    private readonly aiGeneration: AiGenerationService,
  ) {}

  async prepareDraftClip(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    graphNodeId: string,
    input: PrepareDraftFilmClipInput,
  ): Promise<PreparedDraftFilmClipDto> {
    const scope = await this.requireProjectScope(
      user,
      workspaceId,
      projectId,
      'story.generate',
    );
    const materialized = await this.materializeDraftClip(
      user,
      scope.project,
      graphNodeId,
      input,
    );
    const [clip, filmSpec] = await this.prisma.$transaction(
      async (tx) =>
        Promise.all([
          tx.storyFilmClip.findFirst({
            where: {
              id: materialized.clipId,
              storyProjectId: projectId,
              revisionId: materialized.revisionId,
              archivedAt: null,
            },
            include: {
              references: {
                select: {
                  id: true,
                  referenceSlotId: true,
                  role: true,
                  position: true,
                  required: true,
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
            },
          }),
          tx.storyFilmSpec.findUnique({
            where: { revisionId: materialized.revisionId },
            select: { productionRevision: true },
          }),
        ]),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    if (!clip || !filmSpec) {
      throw new ConflictException({
        code: 'STORY_DRAFT_PRODUCTION_PREPARATION_INCOMPLETE',
        message: 'The current shot production plan could not be prepared.',
      });
    }
    return {
      draftRevision: materialized.source.revision,
      revisionId: materialized.revisionId,
      productionRevision: filmSpec.productionRevision,
      clip: toClipSummary(clip),
    };
  }

  async createDraftTake(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    graphNodeId: string,
    input: CreateDraftFilmTakeInput,
    idempotencyKey: string,
  ): Promise<FilmTakeDto> {
    const scope = await this.requireProjectScope(
      user,
      workspaceId,
      projectId,
      'story.generate',
    );
    const submissionSubjectId = draftTakeSubmissionSubject(graphNodeId);
    const idempotencyFingerprint = draftTakeIdempotencyFingerprint(
      graphNodeId,
      input,
    );
    const submissionKey = storySubmissionKey(
      user.userId,
      projectId,
      submissionSubjectId,
      idempotencyKey,
    );
    const existing = await this.prisma.storyFilmTake.findUnique({
      where: { submissionKey },
      include: TAKE_INCLUDE,
    });
    if (existing) {
      assertIdempotentTakeFingerprint(existing, idempotencyFingerprint);
      return this.toTakeDto(await this.reconcileTake(existing));
    }
    const materialized = await this.materializeDraftClip(
      user,
      scope.project,
      graphNodeId,
      input,
    );
    return this.createTake(
      user,
      workspaceId,
      projectId,
      materialized.revisionId,
      materialized.clipId,
      {
        expectedClipVersion: materialized.clipVersion,
        modelId: input.modelId,
        variationNote: input.variationNote,
        seed: input.seed,
      },
      idempotencyKey,
      {
        ...materialized.source,
        submissionSubjectId,
        idempotencyFingerprint,
        requestFingerprint: draftTakeRequestFingerprint(
          graphNodeId,
          input,
          materialized.source.contentHash,
        ),
      },
    );
  }

  async listDraftTakes(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    graphNodeId: string,
    query: FilmTakeListQuery,
  ): Promise<CursorPageDto<FilmTakeDto>> {
    const scope = await this.requireProjectScope(
      user,
      workspaceId,
      projectId,
      'story.read',
    );
    const currentSnapshot = await this.currentDraftClipSnapshot(
      scope.project,
      graphNodeId,
    );
    const cursor = query.cursor ? decodeDraftTakeCursor(query.cursor) : null;
    const rows = await this.prisma.storyFilmTake.findMany({
      where: {
        storyProjectId: projectId,
        clip: { graphNodeId },
        ...(query.status ? { status: query.status } : {}),
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: new Date(cursor.createdAt) } },
                {
                  createdAt: new Date(cursor.createdAt),
                  id: { lt: cursor.id },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      include: TAKE_INCLUDE,
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const reconciled = await Promise.all(
      page.map((row) => this.reconcileTake(row)),
    );
    const last = reconciled.at(-1);
    return {
      items: reconciled.map((row) =>
        markDraftStale(this.toTakeDto(row), row, currentSnapshot),
      ),
      nextCursor:
        hasMore && last
          ? encodeDraftTakeCursor({
              createdAt: last.createdAt.toISOString(),
              id: last.id,
            })
          : null,
    };
  }

  async createTake(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    revisionId: string,
    clipId: string,
    input: CreateFilmTakeInput,
    idempotencyKey: string,
    draftSource?: DraftSourceGuard,
  ): Promise<FilmTakeDto> {
    const scope = await this.requireProjectScope(
      user,
      workspaceId,
      projectId,
      'story.generate',
    );
    const effectiveDraftSource =
      draftSource ??
      (await this.bindCurrentDraftSourceToRevision(
        projectId,
        revisionId,
        clipId,
        input,
      ));
    const submissionKey = storySubmissionKey(
      user.userId,
      projectId,
      effectiveDraftSource.submissionSubjectId,
      idempotencyKey,
    );
    const existing = await this.prisma.storyFilmTake.findUnique({
      where: { submissionKey },
      include: TAKE_INCLUDE,
    });
    if (existing) {
      assertIdempotentTakeFingerprint(
        existing,
        effectiveDraftSource.idempotencyFingerprint,
      );
      return this.toTakeDto(await this.reconcileTake(existing));
    }

    const prepared = await this.prepareProduction(
      user,
      scope.project.workspaceId,
      projectId,
      revisionId,
      clipId,
      input,
      effectiveDraftSource,
    );
    const jobKey = `story-take:${canonicalJsonHash(submissionKey)}`;
    let createdTakeId: string | null = null;
    const hooks: AiJobSubmissionHooks = {
      afterJobCreate: async (tx, job) => {
        const currentDraft = await tx.storyDraft.findUnique({
          where: { storyProjectId: projectId },
          select: { revision: true, contentHash: true },
        });
        if (
          !currentDraft ||
          currentDraft.revision !== effectiveDraftSource.revision
        ) {
          throw draftRevisionConflict(
            effectiveDraftSource.revision,
            currentDraft?.revision ?? null,
          );
        }
        if (currentDraft.contentHash !== effectiveDraftSource.contentHash) {
          throw new ConflictException({
            code: 'DRAFT_INTEGRITY_ERROR',
            message: 'The saved draft content no longer matches its hash.',
          });
        }
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(
            hashtext(${`story-film-take:${clipId}`})::bigint
          )
        `;
        const lockedClip = await tx.storyFilmClip.findFirst({
          where: {
            id: clipId,
            storyProjectId: projectId,
            revisionId,
            archivedAt: null,
          },
          include: CLIP_PRODUCTION_INCLUDE,
        });
        if (!lockedClip) throw clipNotFound();
        if (lockedClip.version !== input.expectedClipVersion) {
          throw clipVersionConflict(
            input.expectedClipVersion,
            lockedClip.version,
          );
        }
        assertReferenceSnapshotCurrent(lockedClip, prepared);

        const manifestChanged =
          lockedClip.productionInputHash !== prepared.productionInputHash;
        if (manifestChanged) {
          await tx.storyFilmClip.update({
            where: { id: lockedClip.id },
            data: {
              productionInputManifest: prepared.productionManifest,
              productionInputHash: prepared.productionInputHash,
              version: { increment: 1 },
              ...(lockedClip.masterTakeId
                ? {
                    masterTakeId: null,
                    masterSelectedByUserId: null,
                    masterSelectedAt: null,
                    masterRevision: { increment: 1 },
                  }
                : {}),
              updatedByUserId: user.userId,
            },
          });
        }

        const latest = await tx.storyFilmTake.findFirst({
          where: { clipId },
          orderBy: [{ takeNumber: 'desc' }, { id: 'desc' }],
          select: { takeNumber: true },
        });
        const take = await tx.storyFilmTake.create({
          data: {
            storyProjectId: projectId,
            revisionId,
            clipId,
            takeNumber: (latest?.takeNumber ?? 0) + 1,
            submissionKey,
            status: StoryFilmTakeStatus.queued,
            clipSpecHash: prepared.clip.specHash,
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
            documentBlockId: clipId,
            sourceSurface: 'story-studio',
          },
          idempotencyKey: jobKey,
          input: prepared.aiInput,
          promptDocument: {
            version: 1,
            nodes: [
              {
                type: 'text',
                text: prepared.compiledPrompt,
              },
            ],
          },
          referenceBindings: prepared.referenceBindings,
        },
        workspaceId,
        hooks,
      );
      const take = await this.prisma.storyFilmTake.findFirst({
        where: {
          OR: [
            { submissionKey },
            { aiJobId: submitted.request_id },
            ...(createdTakeId ? [{ id: createdTakeId }] : []),
          ],
        },
        include: TAKE_INCLUDE,
      });
      if (!take) {
        throw new ConflictException({
          code: 'STORY_TAKE_BINDING_MISSING',
          message: 'The generation job has no StoryFilmTake binding.',
        });
      }
      return this.toTakeDto(await this.reconcileTake(take));
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const winner = await this.prisma.storyFilmTake.findUnique({
          where: { submissionKey },
          include: TAKE_INCLUDE,
        });
        if (winner) {
          assertIdempotentTakeFingerprint(
            winner,
            effectiveDraftSource.idempotencyFingerprint,
          );
          return this.toTakeDto(await this.reconcileTake(winner));
        }
      }
      throw error;
    }
  }

  private async bindCurrentDraftSourceToRevision(
    projectId: string,
    revisionId: string,
    clipId: string,
    input: CreateFilmTakeInput,
  ): Promise<DraftSourceGuard> {
    const [revision, draft] = await Promise.all([
      this.prisma.storyRevision.findFirst({
        where: { id: revisionId, storyProjectId: projectId },
        select: { sourceDraftRevision: true, contentHash: true },
      }),
      this.prisma.storyDraft.findUnique({
        where: { storyProjectId: projectId },
        select: { revision: true, content: true, contentHash: true },
      }),
    ]);
    if (!revision) {
      throw new NotFoundException({
        code: 'STORY_REVISION_NOT_FOUND',
        message: 'Story revision not found.',
      });
    }
    if (!draft) {
      throw new NotFoundException({
        code: 'STORY_DRAFT_NOT_FOUND',
        message: 'Story draft not found.',
      });
    }
    if (canonicalJsonHash(draft.content) !== draft.contentHash) {
      throw new ConflictException({
        code: 'DRAFT_INTEGRITY_ERROR',
        message: 'The saved draft content does not match its hash.',
      });
    }
    if (
      revision.sourceDraftRevision !== draft.revision ||
      revision.contentHash !== draft.contentHash
    ) {
      throw new ConflictException({
        code: 'STORY_REVISION_STALE_DRAFT',
        message:
          'This production snapshot belongs to an earlier story draft. Prepare the current shot before generating video.',
        sourceDraftRevision: revision.sourceDraftRevision,
        currentDraftRevision: draft.revision,
      });
    }
    const idempotencyFingerprint = clipTakeRequestFingerprint(input);
    return {
      revision: draft.revision,
      contentHash: draft.contentHash,
      submissionSubjectId: clipId,
      idempotencyFingerprint,
      requestFingerprint: canonicalJsonHash({
        kind: 'revision_clip_take',
        revisionId,
        clipId,
        sourceDraftRevision: draft.revision,
        sourceContentHash: draft.contentHash,
        idempotencyFingerprint,
      }),
    };
  }

  private async materializeDraftClip(
    user: AuthUser,
    project: {
      id: string;
      frameProfile: keyof typeof STORY_FRAME_PROFILE_CONTRACTS;
      defaultLocale: string;
    },
    graphNodeId: string,
    input: CreateDraftFilmTakeInput,
  ): Promise<MaterializedDraftClip> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(
            hashtext(${`story-draft-production:${project.id}`})::bigint
          )
        `;
        const draft = await tx.storyDraft.findUnique({
          where: { storyProjectId: project.id },
        });
        if (!draft) {
          throw new NotFoundException({
            code: 'STORY_DRAFT_NOT_FOUND',
            message: 'Story draft not found.',
          });
        }
        if (draft.revision !== input.expectedDraftRevision) {
          throw draftRevisionConflict(
            input.expectedDraftRevision,
            draft.revision,
          );
        }
        const actualHash = canonicalJsonHash(draft.content);
        if (actualHash !== draft.contentHash) {
          throw new ConflictException({
            code: 'DRAFT_INTEGRITY_ERROR',
            message: 'The saved draft content does not match its hash.',
            expectedHash: draft.contentHash,
            actualHash,
          });
        }
        const parsedDraft = InteractiveFilmDraftContentSchema.safeParse(
          draft.content,
        );
        if (!parsedDraft.success) {
          throw new ConflictException({
            code: 'STORY_DRAFT_CORRUPT',
            message: 'The saved story draft is invalid.',
          });
        }

        let clipSpec: ReturnType<typeof FilmClipSpecSchema.parse>;
        try {
          clipSpec = projectStoryFilmDraftClip({
            draft: parsedDraft.data,
            frameProfile: project.frameProfile,
            graphNodeId,
          });
        } catch (error) {
          throw new UnprocessableEntityException({
            code: 'STORY_FILM_CLIP_NOT_GENERATABLE',
            message:
              error instanceof Error
                ? error.message
                : 'Complete this shot prompt before generating video.',
          });
        }
        const clipSpecHash = canonicalJsonHash(clipSpec);
        const clipPrompt = parsedDraft.data.clipPrompts.find(
          (prompt) => prompt.graphNodeId === graphNodeId,
        );
        if (!clipPrompt) {
          throw new UnprocessableEntityException({
            code: 'STORY_FILM_CLIP_NOT_GENERATABLE',
            message: 'Complete this shot prompt before preparing video.',
          });
        }
        const referencePlan = requiredDraftClipReferencePlan(
          clipSpec,
          clipPrompt,
        );

        let revision = await tx.storyRevision.findUnique({
          where: {
            storyProjectId_sourceDraftRevision: {
              storyProjectId: project.id,
              sourceDraftRevision: draft.revision,
            },
          },
        });
        if (revision && revision.contentHash !== draft.contentHash) {
          throw new ConflictException({
            code: 'STORY_REVISION_INTEGRITY_ERROR',
            message:
              'The immutable input snapshot does not match its saved draft.',
          });
        }
        if (!revision) {
          const latest = await tx.storyRevision.aggregate({
            where: { storyProjectId: project.id },
            _max: { number: true },
          });
          revision = await tx.storyRevision.create({
            data: {
              storyProjectId: project.id,
              number: (latest._max.number ?? 0) + 1,
              sourceDraftRevision: draft.revision,
              schemaVersion: draft.schemaVersion,
              content: parsedDraft.data as Prisma.InputJsonObject,
              contentHash: draft.contentHash,
              source: StoryRevisionSource.creator,
              createdByUserId: user.userId,
            },
          });
        }

        let filmSpec = await tx.storyFilmSpec.findUnique({
          where: { revisionId: revision.id },
        });
        if (!filmSpec) {
          const modelSlug =
            input.modelId ??
            process.env.STORY_STUDIO_DEFAULT_VIDEO_MODEL_SLUG?.trim();
          if (!modelSlug) {
            throw new UnprocessableEntityException({
              code: 'STORY_DEFAULT_VIDEO_MODEL_NOT_CONFIGURED',
              message:
                'Select a video model or configure the Story Studio default video model.',
            });
          }
          const canonicalModel = await tx.aiCanonicalModel.findFirst({
            where: {
              slug: modelSlug,
              modality: 'video',
              status: 'active',
              archivedAt: null,
            },
            select: { id: true },
          });
          if (!canonicalModel) {
            throw new UnprocessableEntityException({
              code: 'STORY_FILM_MODEL_NOT_AVAILABLE',
              message: 'The selected canonical video model is not active.',
            });
          }
          const snapshotSpec = draftFilmSpecSnapshot({
            draft: parsedDraft.data,
            project,
            selectedClip: clipSpec,
            defaultCanonicalModelId: canonicalModel.id,
          });
          const snapshotSpecHash = canonicalJsonHash(snapshotSpec);
          filmSpec = await tx.storyFilmSpec.create({
            data: {
              revisionId: revision.id,
              storyProjectId: project.id,
              runtimeSchemaVersion: snapshotSpec.runtimeSchemaVersion,
              targetDurationMs: snapshotSpec.duration.targetMs,
              durationToleranceMs: snapshotSpec.duration.toleranceMs,
              maxContinuousDurationMs: snapshotSpec.duration.maxContinuousMs,
              maxGeneratedClipDurationMs:
                snapshotSpec.duration.maxGeneratedClipMs,
              targetClipCount: snapshotSpec.targets.clipCount,
              targetChoiceCount: snapshotSpec.targets.choiceCount,
              targetEndingCount: snapshotSpec.targets.endingCount,
              frameWidth: snapshotSpec.frame.width,
              frameHeight: snapshotSpec.frame.height,
              frameRateNumerator: snapshotSpec.frame.framesPerSecond.numerator,
              frameRateDenominator:
                snapshotSpec.frame.framesPerSecond.denominator,
              audioSampleRate: snapshotSpec.audioSampleRateHz,
              defaultLocale: snapshotSpec.locales.defaultLocale,
              enabledLocales: snapshotSpec.locales.enabledLocales,
              defaultCanonicalModelId: canonicalModel.id,
              reviewPolicy: snapshotSpec.reviewPolicy,
              specJson: snapshotSpec as Prisma.InputJsonObject,
              specHash: snapshotSpecHash,
              createdByUserId: user.userId,
              updatedByUserId: user.userId,
            },
          });
        }

        const existingClip = await tx.storyFilmClip.findFirst({
          where: {
            storyProjectId: project.id,
            revisionId: revision.id,
            graphNodeId,
            archivedAt: null,
          },
        });
        let materializedClip = existingClip;
        if (materializedClip) {
          if (
            materializedClip.specHash !== clipSpecHash ||
            canonicalJsonHash(materializedClip.specJson) !== clipSpecHash
          ) {
            throw new ConflictException({
              code: 'STORY_DRAFT_SNAPSHOT_CLIP_MISMATCH',
              message:
                'The materialized shot does not match its immutable draft input.',
            });
          }
        } else {
          materializedClip = await tx.storyFilmClip.create({
            data: {
              storyProjectId: project.id,
              revisionId: revision.id,
              key: clipSpec.key,
              graphNodeId: clipSpec.graphNodeId,
              title: clipSpec.title,
              generationMode:
                clipSpec.generationControl.mode === 'omni_reference'
                  ? StoryFilmGenerationMode.omni_reference
                  : StoryFilmGenerationMode.frame_lock,
              frameMode:
                clipSpec.generationControl.mode === 'frame_lock'
                  ? clipSpec.generationControl.frameMode === 'first_last_frame'
                    ? StoryFilmFrameMode.first_last_frame
                    : StoryFilmFrameMode.first_frame
                  : null,
              targetDurationMs: clipSpec.targetDurationMs,
              specJson: clipSpec as Prisma.InputJsonObject,
              specHash: clipSpecHash,
              rank: clipSpec.rank,
              createdByUserId: user.userId,
              updatedByUserId: user.userId,
            },
          });
        }
        const referencePlanChanged = await this.ensureMinimumDraftReferencePlan(
          tx,
          {
            projectId: project.id,
            revisionId: revision.id,
            clipId: materializedClip.id,
            userId: user.userId,
            requirements: referencePlan,
          },
        );
        if (referencePlanChanged) {
          materializedClip = await tx.storyFilmClip.findUniqueOrThrow({
            where: { id: materializedClip.id },
          });
        }
        return {
          revisionId: revision.id,
          clipId: materializedClip.id,
          clipVersion: materializedClip.version,
          source: {
            revision: draft.revision,
            contentHash: draft.contentHash,
          },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async ensureMinimumDraftReferencePlan(
    tx: Prisma.TransactionClient,
    input: {
      projectId: string;
      revisionId: string;
      clipId: string;
      userId: string;
      requirements: DraftClipReferenceRequirement[];
    },
  ): Promise<boolean> {
    const existingPlan = await tx.storyFilmClipReference.findMany({
      where: { clipId: input.clipId },
      select: { id: true, role: true },
    });
    // Draft notes initialize a new production target. Once a creator has a
    // binding plan, the explicit reference editor owns it; prepare/generate
    // must never restore an earlier auto-derived slot behind their back.
    if (existingPlan.length > 0) {
      const existingRoles = new Set(
        existingPlan.map((binding) => binding.role),
      );
      const requiredRoles = new Set(
        input.requirements.map((requirement) => requirement.role),
      );
      if ([...requiredRoles].some((role) => !existingRoles.has(role))) {
        throw new ConflictException({
          code: 'STORY_FILM_REFERENCE_PLAN_INCOMPLETE',
          message:
            'The saved reference plan is incomplete. Repair it in the reference editor before generating video.',
        });
      }
      return false;
    }

    let changed = false;
    for (const requirement of input.requirements) {
      let slot = await tx.storyFilmReferenceSlot.findFirst({
        where: {
          storyProjectId: input.projectId,
          revisionId: input.revisionId,
          key: requirement.key,
        },
      });
      if (slot) {
        if (slot.archivedAt || slot.kind !== requirement.kind) {
          throw new ConflictException({
            code: 'STORY_FILM_REFERENCE_PLAN_CONFLICT',
            message: `Reference ${requirement.key} conflicts with the current shot requirement.`,
          });
        }
        if (!slot.required) {
          slot = await tx.storyFilmReferenceSlot.update({
            where: { id: slot.id },
            data: { required: true, version: { increment: 1 } },
          });
          changed = true;
        }
      } else {
        slot = await tx.storyFilmReferenceSlot.create({
          data: {
            storyProjectId: input.projectId,
            revisionId: input.revisionId,
            key: requirement.key,
            kind: requirement.kind,
            label: requirement.label,
            description: requirement.description,
            required: requirement.required,
            rank: requirement.rank,
          },
        });
        changed = true;
      }

      const binding = await tx.storyFilmClipReference.findFirst({
        where: {
          clipId: input.clipId,
          role: requirement.role,
          position: requirement.position,
        },
      });
      if (binding) {
        if (binding.referenceSlotId !== slot.id) {
          throw new ConflictException({
            code: 'STORY_FILM_REFERENCE_PLAN_CONFLICT',
            message: `The ${requirement.role} input is already bound to another reference.`,
          });
        }
        if (!binding.required) {
          await tx.storyFilmClipReference.update({
            where: { id: binding.id },
            data: { required: true },
          });
          changed = true;
        }
      } else {
        await tx.storyFilmClipReference.create({
          data: {
            storyProjectId: input.projectId,
            revisionId: input.revisionId,
            clipId: input.clipId,
            referenceSlotId: slot.id,
            role: requirement.role,
            position: requirement.position,
            required: requirement.required,
          },
        });
        changed = true;
      }
    }
    return changed;
  }

  async listTakes(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    revisionId: string,
    clipId: string,
    query: FilmTakeListQuery,
  ): Promise<CursorPageDto<FilmTakeDto>> {
    await this.requireProjectScope(user, workspaceId, projectId, 'story.read');
    const clip = await this.prisma.storyFilmClip.findFirst({
      where: { id: clipId, storyProjectId: projectId, revisionId },
      select: { id: true },
    });
    if (!clip) throw clipNotFound();
    const cursor = query.cursor ? decodeTakeCursor(query.cursor) : null;
    const rows = await this.prisma.storyFilmTake.findMany({
      where: {
        storyProjectId: projectId,
        revisionId,
        clipId,
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
      include: TAKE_INCLUDE,
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
  ): Promise<FilmTakeDto> {
    const scope = await this.requireProjectScope(
      user,
      workspaceId,
      projectId,
      'story.read',
    );
    const take = await this.loadTake(projectId, takeId);
    const reconciled = await this.reconcileTake(take);
    const currentSnapshot = await this.currentDraftClipSnapshot(
      scope.project,
      reconciled.clip.graphNodeId,
    );
    return markDraftStale(
      this.toTakeDto(reconciled),
      reconciled,
      currentSnapshot,
    );
  }

  async cancelTake(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    takeId: string,
    input: CancelFilmTakeInput,
  ): Promise<FilmTakeDto> {
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
  ): Promise<FilmTakeDto> {
    const scope = await this.requireProjectScope(
      user,
      workspaceId,
      projectId,
      'story.generate',
    );
    const take = await this.reconcileTake(
      await this.loadTake(projectId, takeId),
    );
    await this.assertDraftTakeIsCurrent(scope.project, take);
    if (take.version !== input.expectedTakeVersion) {
      throw takeVersionConflict(input.expectedTakeVersion, take.version);
    }
    if (
      take.status !== StoryFilmTakeStatus.failed &&
      take.status !== StoryFilmTakeStatus.cancelled
    ) {
      throw new ConflictException({
        code: 'STORY_TAKE_NOT_RETRYABLE',
        message: 'Only a failed or cancelled Take may be retried.',
      });
    }
    const modelId = jsonString(take.modelSnapshot, 'slug');
    if (!modelId) {
      throw new ConflictException({
        code: 'STORY_TAKE_MODEL_SNAPSHOT_CORRUPT',
        message: 'The Take model snapshot cannot be resolved for retry.',
      });
    }
    const clip = await this.prisma.storyFilmClip.findUnique({
      where: { id: take.clipId },
      select: { version: true },
    });
    if (!clip) throw clipNotFound();
    return this.createTake(
      user,
      workspaceId,
      projectId,
      take.revisionId,
      take.clipId,
      {
        expectedClipVersion: clip.version,
        modelId,
        variationNote: input.variationNote,
      },
      idempotencyKey,
      {
        revision: take.revision.sourceDraftRevision,
        contentHash: take.revision.contentHash,
        submissionSubjectId: `retry:${canonicalJsonHash(take.id)}`,
        idempotencyFingerprint: canonicalJsonHash({
          kind: 'story_film_take_retry',
          takeId: take.id,
          expectedTakeVersion: input.expectedTakeVersion,
          modelId,
          variationNote: input.variationNote ?? null,
        }),
        requestFingerprint: canonicalJsonHash({
          kind: 'story_film_take_retry',
          takeId: take.id,
          sourceDraftRevision: take.revision.sourceDraftRevision,
          sourceContentHash: take.revision.contentHash,
          expectedTakeVersion: input.expectedTakeVersion,
          modelId,
          variationNote: input.variationNote ?? null,
        }),
      },
    );
  }

  async reviewTake(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    takeId: string,
    input: CreateFilmTakeReviewInput,
  ): Promise<{ take: FilmTakeDto; review: FilmReviewDto }> {
    const scope = await this.requireProjectScope(
      user,
      workspaceId,
      projectId,
      'story.review',
    );
    const reconciled = await this.reconcileTake(
      await this.loadTake(projectId, takeId),
    );
    await this.assertDraftTakeIsCurrent(scope.project, reconciled);
    const review = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtext(${`story-film-take-review:${takeId}`})::bigint
        )
      `;
      const current = await tx.storyFilmTake.findFirst({
        where: { id: takeId, storyProjectId: projectId },
        select: {
          status: true,
          reviewRevision: true,
          approval: { select: { takeId: true } },
        },
      });
      if (!current) {
        throw new NotFoundException({
          code: 'STORY_TAKE_NOT_FOUND',
          message: 'Story film Take not found.',
        });
      }
      if (current.reviewRevision !== input.expectedReviewRevision) {
        throw new ConflictException({
          code: 'STORY_TAKE_REVIEW_REVISION_CONFLICT',
          message: 'The Take review history changed. Refresh and try again.',
          expectedRevision: input.expectedReviewRevision,
          actualRevision: current.reviewRevision,
        });
      }
      if (current.status !== StoryFilmTakeStatus.ready) {
        throw new ConflictException({
          code: 'STORY_TAKE_NOT_READY',
          message: 'Only a ready Take may be reviewed.',
        });
      }
      if (current.approval) {
        throw new ConflictException({
          code: 'STORY_TAKE_ALREADY_APPROVED',
          message: 'An approved Take cannot receive another review.',
        });
      }
      // The database trigger owns the reviewRevision increment. Keeping that
      // counter trigger-managed makes the sequence claim and append atomic;
      // application code must never increment it separately.
      return tx.storyFilmTakeReview.create({
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
    return { take: this.toTakeDto(refreshed), review: toReviewDto(review) };
  }

  async approveTake(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    takeId: string,
    input: ApproveFilmTakeInput,
  ): Promise<FilmTakeDto> {
    const scope = await this.requireProjectScope(
      user,
      workspaceId,
      projectId,
      'story.review',
    );
    const reconciled = await this.reconcileTake(
      await this.loadTake(projectId, takeId),
    );
    await this.assertDraftTakeIsCurrent(scope.project, reconciled);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtext(${`story-film-take-approval:${takeId}`})::bigint
        )
      `;
      const current = await tx.storyFilmTake.findFirst({
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
      if (!current) {
        throw new NotFoundException({
          code: 'STORY_TAKE_NOT_FOUND',
          message: 'Story film Take not found.',
        });
      }
      if (current.version !== input.expectedTakeVersion) {
        throw takeVersionConflict(input.expectedTakeVersion, current.version);
      }
      if (
        current.outputAsset?.moderationStatus ===
        MediaAssetModerationStatus.blocked
      ) {
        throw new UnprocessableEntityException({
          code: 'STORY_TAKE_OUTPUT_MODERATION_BLOCKED',
          message: 'A moderation-blocked output cannot be approved.',
        });
      }
      if (current.approval) {
        if (current.approval.reviewId === input.approveReviewId) return;
        throw new ConflictException({
          code: 'STORY_TAKE_ALREADY_APPROVED',
          message: 'The Take was already approved using another review.',
        });
      }
      if (current.status !== StoryFilmTakeStatus.ready) {
        throw new ConflictException({
          code: 'STORY_TAKE_NOT_READY',
          message: 'Only a ready Take may be approved.',
        });
      }
      if (storyFilmHasFailedTechnicalCheck(current.technicalChecks)) {
        throw new UnprocessableEntityException({
          code: 'STORY_TAKE_TECHNICAL_CHECKS_FAILED',
          message: 'A Take with failed technical checks cannot be approved.',
        });
      }
      const review = await tx.storyFilmTakeReview.findFirst({
        where: { id: input.approveReviewId, takeId },
      });
      if (
        !review ||
        review.sequence !== current.reviewRevision ||
        review.decision !== StoryReviewDecision.approve ||
        !review.technicalPassed ||
        !review.safetyPassed ||
        review.reviewerUserId !== user.userId
      ) {
        throw new UnprocessableEntityException({
          code: 'STORY_TAKE_APPROVAL_REVIEW_INVALID',
          message:
            'Approval requires this Take’s latest passing approve review.',
        });
      }
      await tx.storyFilmTakeApproval.create({
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
    clipId: string,
    input: PutFilmClipMasterInput,
  ): Promise<FilmClipSummaryDto> {
    const scope = await this.requireProjectScope(
      user,
      workspaceId,
      projectId,
      'story.generate',
    );
    if (input.takeId) {
      const selectedTake = await this.loadTake(projectId, input.takeId);
      await this.assertDraftTakeIsCurrent(scope.project, selectedTake);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtext(${`story-film-master:${clipId}`})::bigint
        )
      `;
      const spec = await tx.storyFilmSpec.findFirst({
        where: { storyProjectId: projectId, revisionId },
        select: { productionRevision: true },
      });
      if (!spec) throw revisionNotProductionReady();
      if (spec.productionRevision !== input.expectedProductionRevision) {
        throw new ConflictException({
          code: 'STORY_FILM_PRODUCTION_REVISION_CONFLICT',
          message: 'The film production plan changed. Refresh and try again.',
          expectedRevision: input.expectedProductionRevision,
          actualRevision: spec.productionRevision,
        });
      }
      const clip = await tx.storyFilmClip.findFirst({
        where: { id: clipId, storyProjectId: projectId, revisionId },
        include: CLIP_PRODUCTION_INCLUDE,
      });
      if (!clip) throw clipNotFound();
      if (clip.masterRevision !== input.expectedMasterRevision) {
        throw new ConflictException({
          code: 'STORY_FILM_MASTER_REVISION_CONFLICT',
          message: 'The clip Master changed. Refresh and try again.',
          expectedRevision: input.expectedMasterRevision,
          actualRevision: clip.masterRevision,
        });
      }
      if (input.takeId) {
        const candidate = await tx.storyFilmTake.findFirst({
          where: {
            id: input.takeId,
            clipId,
            storyProjectId: projectId,
            revisionId,
            status: StoryFilmTakeStatus.ready,
            supersededAt: null,
            clipSpecHash: clip.specHash,
            productionInputHash: clip.productionInputHash ?? undefined,
            approval: { isNot: null },
          },
          select: {
            id: true,
            technicalChecks: true,
            outputAsset: { select: { moderationStatus: true } },
          },
        });
        if (!candidate || clip.productionInputHash === null) {
          throw new UnprocessableEntityException({
            code: 'STORY_FILM_MASTER_INELIGIBLE',
            message:
              'Master must be an approved, ready, current Take of this clip.',
          });
        }
        if (storyFilmHasFailedTechnicalCheck(candidate.technicalChecks)) {
          throw new UnprocessableEntityException({
            code: 'STORY_FILM_MASTER_TECHNICAL_CHECKS_FAILED',
            message:
              'A Take with failed technical checks cannot become Master.',
          });
        }
        if (
          candidate.outputAsset?.moderationStatus ===
          MediaAssetModerationStatus.blocked
        ) {
          throw new UnprocessableEntityException({
            code: 'STORY_FILM_MASTER_OUTPUT_MODERATION_BLOCKED',
            message: 'A moderation-blocked output cannot become Master.',
          });
        }
      }
      await tx.storyFilmClip.update({
        where: { id: clipId },
        data: {
          masterTakeId: input.takeId,
          masterRevision: { increment: 1 },
          masterSelectedByUserId: input.takeId ? user.userId : null,
          masterSelectedAt: input.takeId ? new Date() : null,
        },
      });
      return tx.storyFilmClip.findUniqueOrThrow({
        where: { id: clipId },
        include: {
          references: {
            select: {
              id: true,
              referenceSlotId: true,
              role: true,
              position: true,
              required: true,
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
        },
      });
    });
    return toClipSummary(updated);
  }

  private async prepareProduction(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    revisionId: string,
    clipId: string,
    input: CreateFilmTakeInput,
    draftSource?: DraftSourceGuard,
  ): Promise<PreparedProduction> {
    const [clip, filmSpec] = await Promise.all([
      this.prisma.storyFilmClip.findFirst({
        where: {
          id: clipId,
          storyProjectId: projectId,
          revisionId,
          archivedAt: null,
        },
        include: CLIP_PRODUCTION_INCLUDE,
      }),
      this.prisma.storyFilmSpec.findFirst({
        where: { storyProjectId: projectId, revisionId },
      }),
    ]);
    if (!clip) throw clipNotFound();
    if (!filmSpec) throw revisionNotProductionReady();
    if (clip.version !== input.expectedClipVersion) {
      throw clipVersionConflict(input.expectedClipVersion, clip.version);
    }
    const clipSpec = FilmClipSpecSchema.parse(clip.specJson);
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
    if (!canonical) {
      throw new UnprocessableEntityException({
        code: 'STORY_FILM_MODEL_NOT_AVAILABLE',
        message: 'The selected canonical video model is not active.',
      });
    }
    const models = await this.aiGeneration.listModels(user, workspaceId);
    const model = models.find((candidate) => candidate.id === canonical.slug);
    if (!model || !model.enabled || model.type !== 'video') {
      throw new UnprocessableEntityException({
        code: 'STORY_FILM_MODEL_NOT_AVAILABLE',
        message: 'The selected canonical video model is not available.',
      });
    }
    assertModelSupportsClip(model, clipSpec);

    const takeReferences: PreparedProduction['takeReferences'] = [];
    const referenceBindings: AiSubmitReferenceBinding[] = [];
    const referenceInputRows: Array<{
      role: string;
      value: Record<string, string>;
    }> = [];
    for (const binding of clip.references) {
      const version = binding.referenceSlot.approvedVersion;
      if (!version) {
        if (binding.required) {
          throw new UnprocessableEntityException({
            code: 'STORY_FILM_REFERENCE_APPROVAL_REQUIRED',
            message: 'Every required reference must have an approved version.',
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
          code: 'STORY_FILM_REFERENCE_NOT_READY',
          message: 'An approved reference asset is not production-ready.',
        });
      }
      const url = resolveMediaPublicUrl(version.asset);
      if (!url) {
        throw new UnprocessableEntityException({
          code: 'STORY_FILM_REFERENCE_URL_UNAVAILABLE',
          message: 'An approved reference asset is not provider-readable.',
        });
      }
      const refId = `${binding.role}:${binding.position}:${version.id}`;
      const value = {
        url,
        assetId: version.assetId,
        refId,
      };
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
      clipSpec,
      referenceBindings,
    );
    const promptCompilation = compileStoryFilmPrompt({
      clip: clipSpec,
      variationNote: input.variationNote,
      maxLength: modelPromptMaxLength(model),
      providerReservedLength: providerImageReferencePromptOverhead(
        submitReferenceBindings.length,
      ),
    });
    const compiledPrompt = promptCompilation.text;
    const generationConfig = buildGenerationConfig(model, clipSpec, input.seed);
    const aiInput: Record<string, unknown> = {
      prompt: compiledPrompt,
      ...generationConfig,
      ...referenceInputForClip(clipSpec, referenceInputRows),
    };
    const generationConfigJson = generationConfig as Prisma.InputJsonObject;
    const productionManifest = {
      version: 1,
      clip: {
        id: clip.id,
        specHash: clip.specHash,
      },
      model: { canonicalModelId: canonical.id, slug: canonical.slug },
      generationConfig: generationConfigJson,
      prompt: {
        compilerVersion: promptCompilation.stats.strategyVersion,
        compiledPromptHash: canonicalJsonHash(compiledPrompt),
        submittedLength: promptCompilation.stats.submittedLength,
      },
      references: takeReferences.map((reference) => ({
        referenceSlotId: reference.referenceSlotId,
        referenceVersionId: reference.referenceVersionId,
        role: reference.role,
        position: reference.position,
        assetId: reference.assetId,
        checksumSha256: reference.checksumSha256,
      })),
      outputContract: clipSpec.outputContract,
    } as Prisma.InputJsonObject;
    const productionInputHash = canonicalJsonHash(productionManifest);
    return {
      clip,
      clipSpec,
      model,
      canonicalModelId: canonical.id,
      compiledPrompt,
      promptSnapshot: {
        version: 1,
        requestFingerprint:
          draftSource?.requestFingerprint ?? clipTakeRequestFingerprint(input),
        idempotencyFingerprint:
          draftSource?.idempotencyFingerprint ??
          clipTakeRequestFingerprint(input),
        ...(draftSource
          ? {
              draftSource: {
                revision: draftSource.revision,
                contentHash: draftSource.contentHash,
              },
            }
          : {}),
        masterPrompt: clipSpec.prompt.masterPrompt,
        negativeConstraints: clipSpec.prompt.negativeConstraints,
        timeline: clipSpec.prompt.timeline,
        continuityNotes: clipSpec.continuityNotes,
        variationNote: input.variationNote ?? null,
        compiledPrompt,
        compilerStats: promptCompilation.stats,
      } as Prisma.InputJsonObject,
      generationConfig: generationConfigJson,
      modelSnapshot: {
        version: 1,
        canonicalModelId: canonical.id,
        slug: canonical.slug,
        displayName: model.name,
        schemaVersion: model.schemaVersion,
        generationModes: model.generationModes,
      } as Prisma.InputJsonObject,
      productionManifest,
      productionInputHash,
      aiInput,
      referenceBindings: submitReferenceBindings,
      takeReferences,
    };
  }

  private async reconcileTake(row: TakeRow): Promise<TakeRow> {
    if (
      row.status === StoryFilmTakeStatus.ready ||
      row.status === StoryFilmTakeStatus.failed ||
      row.status === StoryFilmTakeStatus.cancelled
    ) {
      return row;
    }
    const job = row.aiJob;
    const now = new Date();
    let data: Prisma.StoryFilmTakeUncheckedUpdateManyInput | null = null;
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
          message: 'The generation job failed.',
        }) as Prisma.InputJsonObject,
        completedAt: job.completedAt ?? now,
      };
    } else if (job.status === 'cancelled') {
      data = {
        status: StoryFilmTakeStatus.cancelled,
        error: (job.error ?? {
          code: 'AI_JOB_CANCELLED',
          message: 'The generation job was cancelled.',
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
            code: 'STORY_TAKE_OUTPUT_MODERATION_BLOCKED',
            message: 'The generated video was blocked by moderation.',
          },
          completedAt: job.completedAt ?? now,
        };
      } else if (!output || !asset) {
        // AiGenerationRepository currently commits the terminal job status
        // immediately before it persists output rows. Treat that short window
        // as processing; only diagnose a genuinely orphaned completion after
        // a grace period, otherwise a fast poll could permanently fail a Take
        // whose MediaAsset is about to be committed.
        const completedAt = job.completedAt ?? now;
        const orphaned = now.getTime() - completedAt.getTime() > 60_000;
        data = orphaned
          ? {
              status: StoryFilmTakeStatus.failed,
              error: {
                code: 'STORY_TAKE_OUTPUT_MISSING',
                message: 'The completed AI job has no durable video output.',
              },
              completedAt,
            }
          : { status: StoryFilmTakeStatus.processing };
      } else if (!original || !asset.checksumSha256) {
        data = { status: StoryFilmTakeStatus.processing };
      } else {
        const clipSpec = FilmClipSpecSchema.parse(
          await this.prisma.storyFilmClip
            .findUniqueOrThrow({ where: { id: row.clipId } })
            .then((clip) => clip.specJson),
        );
        data = {
          status: StoryFilmTakeStatus.ready,
          aiJobOutputId: output.id,
          outputAssetId: asset.id,
          outputVariantId: original.id,
          outputChecksumSha256: asset.checksumSha256,
          technicalChecks: storyFilmTechnicalChecks(
            asset,
            clipSpec.outputContract,
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
    const updated = await this.prisma.storyFilmTake.updateMany({
      where: { id: row.id, version: row.version, status: row.status },
      data: { ...data, version: { increment: 1 } },
    });
    if (updated.count === 0) return this.loadTake(row.storyProjectId, row.id);
    return this.loadTake(row.storyProjectId, row.id);
  }

  private async loadTake(projectId: string, takeId: string): Promise<TakeRow> {
    const take = await this.prisma.storyFilmTake.findFirst({
      where: { id: takeId, storyProjectId: projectId },
      include: TAKE_INCLUDE,
    });
    if (!take) {
      throw new NotFoundException({
        code: 'STORY_TAKE_NOT_FOUND',
        message: 'Story film Take not found.',
      });
    }
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

  private async currentDraftClipSnapshot(
    project: {
      id: string;
      frameProfile: keyof typeof STORY_FRAME_PROFILE_CONTRACTS;
    },
    graphNodeId: string,
  ): Promise<CurrentDraftClipSnapshot | null> {
    const draft = await this.prisma.storyDraft.findUnique({
      where: { storyProjectId: project.id },
      select: { content: true, contentHash: true, revision: true },
    });
    if (!draft) return null;
    if (canonicalJsonHash(draft.content) !== draft.contentHash) {
      throw new ConflictException({
        code: 'DRAFT_INTEGRITY_ERROR',
        message: 'The saved draft content does not match its hash.',
      });
    }
    const parsed = InteractiveFilmDraftContentSchema.safeParse(draft.content);
    if (!parsed.success) {
      return {
        revision: draft.revision,
        contentHash: draft.contentHash,
        specHash: null,
      };
    }
    try {
      return {
        revision: draft.revision,
        contentHash: draft.contentHash,
        specHash: canonicalJsonHash(
          projectStoryFilmDraftClip({
            draft: parsed.data,
            frameProfile: project.frameProfile,
            graphNodeId,
          }),
        ),
      };
    } catch {
      return {
        revision: draft.revision,
        contentHash: draft.contentHash,
        specHash: null,
      };
    }
  }

  private async assertDraftTakeIsCurrent(
    project: {
      id: string;
      frameProfile: keyof typeof STORY_FRAME_PROFILE_CONTRACTS;
    },
    take: TakeRow,
  ): Promise<void> {
    const promptSnapshot = jsonRecord(take.promptSnapshot);
    const draftSource =
      promptSnapshot.draftSource === undefined
        ? null
        : jsonRecord(promptSnapshot.draftSource as Prisma.JsonValue);
    const currentSnapshot = await this.currentDraftClipSnapshot(
      project,
      take.clip.graphNodeId,
    );
    if (
      !currentSnapshot?.specHash ||
      take.clipSpecHash !== currentSnapshot.specHash ||
      (draftSource !== null &&
        (draftSource.revision !== currentSnapshot.revision ||
          draftSource.contentHash !== currentSnapshot.contentHash)) ||
      take.revision.sourceDraftRevision !== currentSnapshot.revision ||
      take.revision.contentHash !== currentSnapshot.contentHash
    ) {
      throw new ConflictException({
        code: 'STORY_TAKE_STALE_DRAFT',
        message:
          'This Take belongs to an earlier shot design. Generate a new Take from the current draft.',
      });
    }
  }

  private toTakeDto(row: TakeRow): FilmTakeDto {
    const latestReview = row.reviews[0] ?? null;
    const staleReasons: string[] = [];
    if (row.clipSpecHash !== row.clip.specHash) staleReasons.push('clip_spec');
    if (row.productionInputHash !== row.clip.productionInputHash) {
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
      clipId: row.clipId,
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
      clipSpecHash: row.clipSpecHash,
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

export function requiredDraftClipReferencePlan(
  clip: FilmClipSpec,
  prompt: Pick<StoryClipPromptDraft, 'referenceRoleNotes'>,
): DraftClipReferenceRequirement[] {
  if (clip.generationControl.mode === 'omni_reference') {
    const notes: Array<
      StoryClipPromptDraft['referenceRoleNotes'][number] | undefined
    > =
      prompt.referenceRoleNotes.length > 0
        ? prompt.referenceRoleNotes
        : [undefined];
    const seenKeys = new Set<string>();
    const requirements: DraftClipReferenceRequirement[] = [];
    notes.forEach((note, index) => {
      const requirement = draftReferenceRequirement(clip, note, {
        role: StoryFilmClipReferenceRole.omni,
        kind: referenceKindForOmniNote(note),
        suffix: notes.length === 1 ? 'OMNI' : `OMNI_${index + 1}`,
        fallbackLabel: `${clip.title} Omni reference ${index + 1}`,
        position: requirements.length,
      });
      if (seenKeys.has(requirement.key)) return;
      seenKeys.add(requirement.key);
      requirements.push(requirement);
    });
    return requirements;
  }

  const requirements = [
    draftReferenceRequirement(
      clip,
      prompt.referenceRoleNotes.find(
        (candidate) => candidate.role === 'first_frame',
      ),
      {
        role: StoryFilmClipReferenceRole.first_frame,
        kind: StoryFilmReferenceKind.first_frame,
        suffix: 'FIRST',
        fallbackLabel: `${clip.title} first frame`,
        position: 0,
      },
    ),
  ];
  if (clip.generationControl.frameMode === 'first_last_frame') {
    requirements.push(
      draftReferenceRequirement(
        clip,
        prompt.referenceRoleNotes.find(
          (candidate) => candidate.role === 'last_frame',
        ),
        {
          role: StoryFilmClipReferenceRole.last_frame,
          kind: StoryFilmReferenceKind.last_frame,
          suffix: 'LAST',
          fallbackLabel: `${clip.title} last frame`,
          position: 0,
        },
      ),
    );
  }
  return requirements;
}

function draftReferenceRequirement(
  clip: FilmClipSpec,
  note: StoryClipPromptDraft['referenceRoleNotes'][number] | undefined,
  input: {
    role: StoryFilmClipReferenceRole;
    kind: StoryFilmReferenceKind;
    suffix: string;
    fallbackLabel: string;
    position: number;
  },
): DraftClipReferenceRequirement {
  const candidateKey = note?.referenceId.trim() ?? '';
  const key = FilmReferenceKeySchema.safeParse(candidateKey).success
    ? candidateKey
    : generatedDraftReferenceKey(clip.key, input.suffix);
  return {
    key,
    kind: input.kind,
    label: candidateKey || input.fallbackLabel,
    description: note?.note.trim() || input.fallbackLabel,
    role: input.role,
    position: input.position,
    required: true,
    rank: clip.rank * 100 + input.position,
  };
}

function generatedDraftReferenceKey(clipKey: string, suffix: string): string {
  const maximumPrefixLength = 40 - suffix.length - 1;
  return FilmReferenceKeySchema.parse(
    `${clipKey.slice(0, maximumPrefixLength)}_${suffix}`,
  );
}

function referenceKindForOmniNote(
  note: StoryClipPromptDraft['referenceRoleNotes'][number] | undefined,
): StoryFilmReferenceKind {
  switch (note?.role) {
    case 'subject':
      return StoryFilmReferenceKind.character;
    case 'location':
      return StoryFilmReferenceKind.location;
    case 'prop':
      return StoryFilmReferenceKind.prop;
    case 'style':
      return StoryFilmReferenceKind.style;
    default:
      return StoryFilmReferenceKind.graphic;
  }
}

export function draftFilmSpecSnapshot(input: {
  draft: ReturnType<typeof InteractiveFilmDraftContentSchema.parse>;
  project: {
    frameProfile: keyof typeof STORY_FRAME_PROFILE_CONTRACTS;
    defaultLocale: string;
  };
  selectedClip: FilmClipSpec;
  defaultCanonicalModelId: string;
}) {
  const lockable = createLockableInteractiveFilmDraftContentSchema(
    input.project.defaultLocale,
  ).safeParse(input.draft);
  if (lockable.success) {
    try {
      return projectStoryFilmRevision({
        draft: lockable.data,
        frameProfile: input.project.frameProfile,
        defaultLocale: input.project.defaultLocale,
        defaultCanonicalModelId: input.defaultCanonicalModelId,
      }).filmSpec;
    } catch {
      // Full-graph diagnostics belong to working preview/build. A cycle or
      // incomplete neighbouring branch must not block strict production of
      // the selected shot.
    }
  }
  return generationSnapshotFilmSpec(input);
}

function generationSnapshotFilmSpec(input: {
  draft: ReturnType<typeof InteractiveFilmDraftContentSchema.parse>;
  project: {
    frameProfile: keyof typeof STORY_FRAME_PROFILE_CONTRACTS;
    defaultLocale: string;
  };
  selectedClip: FilmClipSpec;
  defaultCanonicalModelId: string;
}) {
  const frame = STORY_FRAME_PROFILE_CONTRACTS[input.project.frameProfile];
  const maximumAuthoredClipDuration = Math.max(
    input.selectedClip.targetDurationMs,
    ...input.draft.clipPrompts.map((prompt) => prompt.targetDurationMs),
  );
  const choiceCount = new Set(
    input.draft.graph.nodes.flatMap((node) =>
      node.exit.kind === 'choice' ? [node.exit.decisionId] : [],
    ),
  ).size;
  return FilmSpecSchema.parse({
    runtimeSchemaVersion: 1,
    frame: {
      ...frame,
      framesPerSecond: { numerator: 24, denominator: 1 },
    },
    audioSampleRateHz: 48_000,
    duration: {
      // Generation snapshots are not playable Builds. This duration is only
      // the strict upper bound needed by the selected shot production plane;
      // Build computes the real path contract from the complete graph.
      targetMs: input.selectedClip.targetDurationMs,
      toleranceMs: 0,
      maxContinuousMs: maximumAuthoredClipDuration,
      maxGeneratedClipMs: maximumAuthoredClipDuration,
    },
    targets: {
      clipCount: Math.max(
        1,
        input.draft.graph.nodes.filter((node) => node.kind === 'clip').length,
      ),
      choiceCount,
      // FilmSpec's storage contract predates partial authoring and requires a
      // positive planned ending count. It is never used as preview truth;
      // working preview diagnoses the mutable graph directly.
      endingCount: Math.max(1, input.draft.storyBible.endings.length),
    },
    locales: {
      defaultLocale: input.project.defaultLocale,
      enabledLocales: [input.project.defaultLocale],
    },
    generation: {
      defaultCanonicalModelId: input.defaultCanonicalModelId,
    },
    reviewPolicy: 'explicit_approval',
  });
}

function clipTakeRequestFingerprint(input: CreateFilmTakeInput): string {
  return canonicalJsonHash({
    expectedClipVersion: input.expectedClipVersion,
    modelId: input.modelId ?? null,
    variationNote: input.variationNote ?? null,
    seed: input.seed ?? null,
  });
}

function draftTakeSubmissionSubject(graphNodeId: string): string {
  return `d:${canonicalJsonHash(graphNodeId)}`;
}

function draftTakeIdempotencyFingerprint(
  graphNodeId: string,
  input: CreateDraftFilmTakeInput,
): string {
  return canonicalJsonHash({
    graphNodeId,
    expectedDraftRevision: input.expectedDraftRevision,
    modelId: input.modelId ?? null,
    variationNote: input.variationNote ?? null,
    seed: input.seed ?? null,
  });
}

function draftTakeRequestFingerprint(
  graphNodeId: string,
  input: CreateDraftFilmTakeInput,
  sourceContentHash: string,
): string {
  return canonicalJsonHash({
    graphNodeId,
    expectedDraftRevision: input.expectedDraftRevision,
    sourceContentHash,
    modelId: input.modelId ?? null,
    variationNote: input.variationNote ?? null,
    seed: input.seed ?? null,
  });
}

function assertIdempotentTakeFingerprint(
  take: { promptSnapshot: Prisma.JsonValue },
  expectedFingerprint: string,
): void {
  if (
    (jsonString(take.promptSnapshot, 'idempotencyFingerprint') ??
      jsonString(take.promptSnapshot, 'requestFingerprint')) !==
    expectedFingerprint
  ) {
    throw new ConflictException({
      code: 'STORY_TAKE_IDEMPOTENCY_CONFLICT',
      message:
        'This Idempotency-Key is already bound to a different video generation request.',
    });
  }
}

function draftRevisionConflict(
  expectedRevision: number,
  actualRevision: number | null,
) {
  return new ConflictException({
    code: 'DRAFT_REVISION_CONFLICT',
    message: 'The saved draft changed before video generation started.',
    expectedRevision,
    actualRevision,
  });
}

function markDraftStale(
  take: FilmTakeDto,
  row: Pick<TakeRow, 'clipSpecHash' | 'revision'>,
  current: CurrentDraftClipSnapshot | null,
): FilmTakeDto {
  if (
    current?.specHash &&
    row.clipSpecHash === current.specHash &&
    row.revision.sourceDraftRevision === current.revision &&
    row.revision.contentHash === current.contentHash
  ) {
    return take;
  }
  return {
    ...take,
    stale: true,
    staleReasons: [...new Set([...take.staleReasons, 'draft_clip'])],
  };
}

function storySubmissionKey(
  userId: string,
  projectId: string,
  clipId: string,
  idempotencyKey: string,
): string {
  return `${userId}:${projectId}:${clipId}:${canonicalJsonHash(idempotencyKey)}`;
}

function assertReferenceSnapshotCurrent(
  locked: ProductionClipRow,
  prepared: PreparedProduction,
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
      code: 'STORY_FILM_REFERENCE_SNAPSHOT_CONFLICT',
      message: 'Approved references changed while the Take was being queued.',
    });
  }
}

export function assertModelSupportsClip(
  model: AiModelDefinition,
  clip: StoryFilmGenerationSubject,
): void {
  const requiredMode =
    clip.generationControl.mode === 'omni_reference'
      ? 'multimodal_to_video'
      : clip.generationControl.frameMode === 'first_last_frame'
        ? 'first_last_frame_to_video'
        : 'image_to_video';
  if (!model.generationModes.includes(requiredMode)) {
    throw new UnprocessableEntityException({
      code: 'STORY_FILM_MODEL_MODE_UNSUPPORTED',
      message: `The selected model does not support ${requiredMode}.`,
    });
  }
}

export function buildGenerationConfig(
  model: AiModelDefinition,
  clip: StoryFilmGenerationSubject,
  seed?: string,
): Record<string, unknown> {
  const properties = model.input_schema.properties ?? {};
  const output = clip.outputContract;
  const config: Record<string, unknown> = {};
  assignSupportedEnum(properties, config, 'aspectRatio', output.aspectRatio);
  const resolution = `${Math.min(output.width, output.height)}p`;
  assignSupportedEnum(properties, config, 'resolution', resolution);
  const seconds = output.durationMs / 1_000;
  if (!Number.isInteger(seconds)) {
    throw new UnprocessableEntityException({
      code: 'STORY_FILM_DURATION_UNSUPPORTED',
      message: 'The selected model requires whole-second clip durations.',
    });
  }
  if (properties.duration) {
    assignSupportedEnum(properties, config, 'duration', String(seconds));
  } else if (properties.durationSeconds) {
    config.durationSeconds = seconds;
  }
  if (properties.generateAudio) {
    config.generateAudio = output.audio !== 'none';
  }
  if (seed) {
    if (!properties.seed) {
      throw new UnprocessableEntityException({
        code: 'STORY_FILM_MODEL_SEED_UNSUPPORTED',
        message: 'The selected model does not accept a deterministic seed.',
      });
    }
    config.seed = seed;
  }
  return config;
}

function assignSupportedEnum(
  properties: AiModelDefinition['input_schema']['properties'],
  target: Record<string, unknown>,
  key: string,
  value: string,
): void {
  const property = properties?.[key];
  if (!property) return;
  const allowed = property.enum;
  const matched = allowed?.find(
    (candidate) =>
      typeof candidate === 'string' &&
      candidate.toLowerCase() === value.toLowerCase(),
  );
  if (allowed && !matched) {
    throw new UnprocessableEntityException({
      code: 'STORY_FILM_OUTPUT_CONTRACT_UNSUPPORTED',
      message: `The selected model cannot produce ${key}=${value}.`,
    });
  }
  target[key] = matched ?? value;
}

export function referenceInputForClip(
  clip: StoryFilmGenerationSubject,
  rows: Array<{ role: string; value: Record<string, string> }>,
): Record<string, unknown> {
  if (clip.generationControl.mode === 'omni_reference') {
    if (!rows.some((row) => row.role === 'omni')) {
      throw new UnprocessableEntityException({
        code: 'STORY_FILM_OMNI_REFERENCE_REQUIRED',
        message: 'Omni Reference generation requires an approved Omni input.',
      });
    }
    return { referenceImages: rows.map((row) => row.value) };
  }
  const first = rows.find((row) => row.role === 'first_frame');
  if (!first) {
    throw new UnprocessableEntityException({
      code: 'STORY_FILM_FIRST_FRAME_REQUIRED',
      message: 'Frame Lock generation requires an approved first frame.',
    });
  }
  const result: Record<string, unknown> = { startFrame: first.value };
  if (clip.generationControl.frameMode === 'first_last_frame') {
    const last = rows.find((row) => row.role === 'last_frame');
    if (!last) {
      throw new UnprocessableEntityException({
        code: 'STORY_FILM_LAST_FRAME_REQUIRED',
        message:
          'First + Last Frame generation requires an approved last frame.',
      });
    }
    result.endFrame = last.value;
  }
  return result;
}

/** Frame inputs already live in startFrame/endFrame and must never be copied
 * into generic referenceImages by the prompt compiler. */
export function generationReferenceBindingsForClip(
  clip: StoryFilmGenerationSubject,
  bindings: AiSubmitReferenceBinding[],
): AiSubmitReferenceBinding[] {
  return clip.generationControl.mode === 'omni_reference' ? bindings : [];
}

export function compileClipPrompt(
  clip: ReturnType<typeof FilmClipSpecSchema.parse>,
  variationNote?: string,
): string {
  return compileStoryFilmPrompt({
    clip,
    variationNote,
    maxLength: null,
  }).text;
}

export function storyFilmTechnicalChecks(
  asset: StoryFilmTechnicalAsset,
  contract: StoryFilmGenerationSubject['outputContract'],
): Prisma.InputJsonArray {
  const durationMs =
    asset.durationSeconds == null ? null : asset.durationSeconds * 1_000;
  return [
    check('kind', asset.kind === MediaAssetKind.video, 'Output must be video.'),
    check(
      'dimensions',
      asset.width === contract.width && asset.height === contract.height,
      `Expected ${contract.width}×${contract.height}.`,
    ),
    check(
      'duration',
      durationMs !== null &&
        Math.abs(durationMs - contract.durationMs) <=
          contract.durationToleranceMs,
      `Expected ${contract.durationMs}ms ± ${contract.durationToleranceMs}ms.`,
    ),
    check(
      'checksum',
      Boolean(asset.checksumSha256),
      'Output checksum is required.',
    ),
  ];
}

function check(key: string, passed: boolean, message: string) {
  return {
    key,
    status: passed ? 'passed' : 'failed',
    message: passed ? null : message,
  };
}

export function storyFilmTechnicalCheckDtos(
  value: Prisma.JsonValue,
): FilmTakeDto['technicalChecks'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))
      return [];
    const row = candidate as Record<string, unknown>;
    if (
      typeof row.key !== 'string' ||
      !['pending', 'passed', 'failed'].includes(String(row.status))
    )
      return [];
    return [
      {
        key: row.key,
        status: row.status as 'pending' | 'passed' | 'failed',
        message: typeof row.message === 'string' ? row.message : null,
      },
    ];
  });
}

export function storyFilmHasFailedTechnicalCheck(
  value: Prisma.JsonValue,
): boolean {
  return storyFilmTechnicalCheckDtos(value).some(
    (check) => check.status === 'failed',
  );
}

function toMediaAsset(
  row: NonNullable<TakeRow['outputAsset']>,
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

function toClipSummary(
  row: Prisma.StoryFilmClipGetPayload<{
    include: {
      references: {
        select: {
          id: true;
          referenceSlotId: true;
          role: true;
          position: true;
          required: true;
          referenceSlot: { select: { approvedVersionId: true } };
        };
      };
      takes: {
        select: {
          status: true;
          productionInputHash: true;
          approval: { select: { takeId: true } };
        };
      };
      masterTake: {
        select: {
          productionInputHash: true;
          status: true;
          outputAsset: {
            include: {
              placements: true;
              variants: { include: { placements: true } };
            };
          };
        };
      };
    };
  }>,
): FilmClipSummaryDto {
  const spec = FilmClipSpecSchema.parse(row.specJson);
  const runningStatuses = new Set<StoryFilmTakeStatus>([
    StoryFilmTakeStatus.queued,
    StoryFilmTakeStatus.running,
    StoryFilmTakeStatus.processing,
  ]);
  const running = row.takes.filter((take) =>
    runningStatuses.has(take.status),
  ).length;
  const ready = row.takes.filter(
    (take) => take.status === StoryFilmTakeStatus.ready,
  ).length;
  const approved = row.takes.filter((take) => take.approval).length;
  const stale = Boolean(
    row.masterTake &&
    row.masterTake.productionInputHash !== row.productionInputHash,
  );
  const blockReasons = filmClipProductionBlockReasons(
    spec,
    row.references.map((binding) => ({
      role: binding.role,
      required: binding.required,
      approvedReferenceVersionId: binding.referenceSlot.approvedVersionId,
    })),
  );
  return {
    ...spec,
    id: row.id,
    version: row.version,
    productionInputHash: row.productionInputHash,
    productionStatus: stale
      ? 'stale'
      : blockReasons.length > 0
        ? 'blocked'
        : row.masterTakeId
          ? 'approved'
          : running > 0
            ? 'generating'
            : ready > 0
              ? 'in_review'
              : 'ready',
    blockReasons,
    referenceBindings: row.references.map((binding) => ({
      id: binding.id,
      referenceSlotId: binding.referenceSlotId,
      role: binding.role,
      rank: binding.position,
      required: binding.required,
      approvedReferenceVersionId: binding.referenceSlot.approvedVersionId,
    })),
    master:
      row.masterTakeId && row.masterSelectedByUserId && row.masterSelectedAt
        ? {
            takeId: row.masterTakeId,
            status: row.masterTake?.status ?? StoryFilmTakeStatus.ready,
            outputAsset: row.masterTake?.outputAsset
              ? toMediaAsset(row.masterTake.outputAsset)
              : null,
            masterRevision: row.masterRevision,
            selectedByUserId: row.masterSelectedByUserId,
            selectedAt: row.masterSelectedAt.toISOString(),
          }
        : null,
    takeCounts: { total: row.takes.length, running, ready, approved },
    updatedAt: row.updatedAt.toISOString(),
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

function encodeTakeCursor(cursor: TakeCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeTakeCursor(value: string): TakeCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as TakeCursor;
    if (
      !Number.isInteger(parsed.number) ||
      parsed.number < 1 ||
      typeof parsed.id !== 'string'
    )
      throw new Error();
    return parsed;
  } catch {
    throw new BadRequestException({
      code: 'INVALID_CURSOR',
      message: 'Invalid Take cursor.',
    });
  }
}

function encodeDraftTakeCursor(cursor: DraftTakeCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeDraftTakeCursor(value: string): DraftTakeCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as DraftTakeCursor;
    const createdAt = new Date(parsed.createdAt);
    if (
      typeof parsed.createdAt !== 'string' ||
      Number.isNaN(createdAt.getTime()) ||
      typeof parsed.id !== 'string' ||
      parsed.id.length === 0
    ) {
      throw new Error();
    }
    return { createdAt: createdAt.toISOString(), id: parsed.id };
  } catch {
    throw new BadRequestException({
      code: 'INVALID_CURSOR',
      message: 'Invalid draft Take cursor.',
    });
  }
}

function clipNotFound() {
  return new NotFoundException({
    code: 'STORY_FILM_CLIP_NOT_FOUND',
    message: 'Story film clip not found.',
  });
}

function revisionNotProductionReady() {
  return new ConflictException({
    code: 'STORY_FILM_REVISION_NOT_READY',
    message: 'Prepare the current shot before producing video Takes.',
  });
}

function clipVersionConflict(expected: number, actual: number) {
  return new ConflictException({
    code: 'STORY_FILM_CLIP_VERSION_CONFLICT',
    message: 'The clip changed. Refresh and try again.',
    expectedVersion: expected,
    actualVersion: actual,
  });
}

function takeVersionConflict(expected: number, actual: number) {
  return new ConflictException({
    code: 'STORY_TAKE_VERSION_CONFLICT',
    message: 'The Take changed. Refresh and try again.',
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
