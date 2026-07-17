import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AiControlPlaneStatus,
  AiJobType,
  Prisma,
  StoryFilmFrameMode,
  StoryFilmGenerationAttemptStatus,
  StoryFilmGenerationMode,
  StoryFormat,
  StoryProjectMemberRole,
  StoryProjectMemberStatus,
  StoryProjectStatus,
  StoryRevisionSource,
  WorkspaceMemberRole,
} from '@prisma/client';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import { resolveMediaPublicUrl } from '../infra/storage/media-asset-url-resolver.service';
import { WorkspacePermissionService } from '../workspaces/workspace-permission.service';
import { canonicalJsonHash } from './canonical-json';
import {
  EMPTY_INTERACTIVE_FILM_DRAFT_CONTENT,
  createLockableInteractiveFilmDraftContentSchema,
  FilmBuildScopeSchema,
  FilmClipSpecSchema,
  FilmSpecSchema,
  FilmTrailerSpecSchema,
  INTERACTIVE_FILM_DRAFT_SCHEMA_VERSION,
  InteractiveFilmDraftContentSchema,
  STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
  StoryCanvasNodePositionsSchema,
  StoryUuidSchema,
  type ArchiveStoryProjectInput,
  type CreateStoryProjectInput,
  type CursorPageDto,
  type FilmBuildDiagnosticDto,
  type FilmBuildSummaryDto,
  type FilmClipSummaryDto,
  type FilmCurrentVideoDto,
  type FilmDefaultModelDto,
  type FilmReferenceSlotDto,
  type FilmSpecDto,
  type FilmTrailerSummaryDto,
  type FilmVideoGenerationDto,
  type LockStoryRevisionInput,
  type MediaAssetSummaryDto,
  type PatchStoryProjectInput,
  type PutStoryCanvasLayoutInput,
  type PutStoryDraftInput,
  type StoryCapability,
  type StoryCanvasLayoutDto,
  type StoryDraftDto,
  type StoryProjectListQuery,
  type StoryProjectSummaryDto,
  type StoryRevisionDto,
  type StoryRevisionListQuery,
  type StoryRevisionSummaryDto,
  type StoryWorkbenchDto,
  type StoryWorkbenchQuery,
} from './dto';
import { projectStoryFilmRevision } from './story-film-revision-projector';
import { storyFilmTechnicalCheckDtos } from './story-film-production.service';
import {
  StoryPermissionService,
  type StoryCapability as PermissionCapability,
} from './story-permission.service';

const PROJECT_NOT_FOUND = {
  code: 'STORY_PROJECT_NOT_FOUND',
  message: 'Story project not found.',
} as const;

const PROJECT_SUMMARY_INCLUDE = Prisma.validator<Prisma.StoryProjectInclude>()({
  cover: {
    include: {
      placements: true,
      variants: { include: { placements: true } },
    },
  },
  draft: { select: { revision: true, contentHash: true, content: true } },
  revisions: { orderBy: [{ number: 'desc' }, { id: 'desc' }], take: 1 },
  members: {
    where: {
      status: StoryProjectMemberStatus.active,
      removedAt: null,
    },
    select: { userId: true, role: true },
  },
  filmReferenceSlots: {
    where: { archivedAt: null },
    select: { revisionId: true, required: true, approvedVersionId: true },
  },
  filmClipHeads: {
    select: {
      clip: {
        select: {
          graphNodeId: true,
          currentVideoAssetId: true,
          latestGenerationAttempt: { select: { status: true } },
        },
      },
    },
  },
  builds: {
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 1,
    select: { sourceRevisionId: true, status: true },
  },
});

type ProjectSummaryRow = Prisma.StoryProjectGetPayload<{
  include: typeof PROJECT_SUMMARY_INCLUDE;
}>;

const FILM_CLIP_INCLUDE = Prisma.validator<Prisma.StoryFilmClipInclude>()({
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
  currentVideoAsset: {
    include: {
      placements: true,
      variants: { include: { placements: true } },
    },
  },
  latestGenerationAttempt: {
    include: {
      outputAsset: {
        include: {
          placements: true,
          variants: { include: { placements: true } },
        },
      },
    },
  },
});

type FilmClipRow = Prisma.StoryFilmClipGetPayload<{
  include: typeof FILM_CLIP_INCLUDE;
}>;

const FILM_TRAILER_INCLUDE = Prisma.validator<Prisma.StoryFilmTrailerInclude>()(
  {
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
    currentVideoAsset: {
      include: {
        placements: true,
        variants: { include: { placements: true } },
      },
    },
    latestGenerationAttempt: {
      include: {
        outputAsset: {
          include: {
            placements: true,
            variants: { include: { placements: true } },
          },
        },
      },
    },
  },
);

type FilmTrailerRow = Prisma.StoryFilmTrailerGetPayload<{
  include: typeof FILM_TRAILER_INCLUDE;
}>;

const FILM_REFERENCE_INCLUDE =
  Prisma.validator<Prisma.StoryFilmReferenceSlotInclude>()({
    versions: {
      orderBy: [{ versionNumber: 'desc' }, { id: 'desc' }],
      include: {
        asset: {
          include: {
            placements: true,
            variants: { include: { placements: true } },
          },
        },
        approval: true,
      },
    },
  });

type FilmReferenceRow = Prisma.StoryFilmReferenceSlotGetPayload<{
  include: typeof FILM_REFERENCE_INCLUDE;
}>;

type FilmMediaAssetRow = Prisma.MediaAssetGetPayload<{
  include: {
    placements: true;
    variants: { include: { placements: true } };
  };
}>;

interface ProjectCursor {
  id: string;
  updatedAt: string;
}

interface RevisionCursor {
  id: string;
  number: number;
}

interface CurrentVideoCarrySource {
  currentVideoAssetId: string | null;
  currentVideoVariantId: string | null;
  currentVideoSpecHash: string | null;
  currentVideoInputHash: string | null;
  currentVideoChecksumSha256: string | null;
  currentVideoTechnicalChecks: Prisma.JsonValue | null;
  currentVideoRevision: number;
  currentVideoSetByUserId: string | null;
  currentVideoSetAt: Date | null;
}

@Injectable()
export class StoryProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: StoryPermissionService,
    private readonly workspacePermissions: WorkspacePermissionService,
  ) {}

  async create(
    user: AuthUser,
    workspaceId: string,
    input: CreateStoryProjectInput,
  ): Promise<StoryWorkbenchDto> {
    await this.workspacePermissions.requireWorkspaceRole(
      user.userId,
      workspaceId,
      WorkspaceMemberRole.editor,
    );

    const contentHash = canonicalJsonHash(EMPTY_INTERACTIVE_FILM_DRAFT_CONTENT);
    const project = await this.prisma.storyProject.create({
      data: {
        workspaceId,
        format: StoryFormat.interactive_film,
        frameProfile: input.frameProfile,
        status: StoryProjectStatus.active,
        visibility: input.visibility,
        title: input.title,
        summary: input.summary,
        defaultLocale: input.defaultLocale,
        sourceIpId: input.sourceIpId,
        createdByUserId: user.userId,
        members: {
          create: {
            userId: user.userId,
            role: StoryProjectMemberRole.owner,
            status: StoryProjectMemberStatus.active,
            grantedByUserId: user.userId,
          },
        },
        draft: {
          create: {
            schemaVersion: INTERACTIVE_FILM_DRAFT_SCHEMA_VERSION,
            content:
              EMPTY_INTERACTIVE_FILM_DRAFT_CONTENT as Prisma.InputJsonObject,
            contentHash,
            updatedByUserId: user.userId,
          },
        },
        canvasLayout: {
          create: {
            schemaVersion: STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
            nodePositions: {},
            updatedByUserId: user.userId,
          },
        },
      },
      include: {
        ...PROJECT_SUMMARY_INCLUDE,
        draft: true,
      },
    });

    if (!project.draft) {
      throw new InternalServerErrorException({
        code: 'STORY_DRAFT_CREATE_FAILED',
        message: 'The story project was created without its draft.',
      });
    }

    return {
      project: this.toProjectSummary(project, user.userId),
      draft: this.toDraft(project.draft, project),
      selectedRevision: null,
      film: null,
    };
  }

  async list(
    user: AuthUser,
    workspaceId: string,
    query: StoryProjectListQuery,
  ): Promise<CursorPageDto<StoryProjectSummaryDto>> {
    await this.workspacePermissions.requireWorkspaceRole(
      user.userId,
      workspaceId,
      WorkspaceMemberRole.viewer,
    );

    const cursor = query.cursor
      ? decodeCursor<ProjectCursor>(query.cursor, isProjectCursor)
      : null;
    const rows = await this.prisma.storyProject.findMany({
      where: {
        workspaceId,
        status: query.status,
        ...(query.format ? { format: query.format } : {}),
        members: {
          some: {
            userId: user.userId,
            status: StoryProjectMemberStatus.active,
            removedAt: null,
          },
        },
        ...(cursor
          ? {
              OR: [
                { updatedAt: { lt: new Date(cursor.updatedAt) } },
                {
                  updatedAt: new Date(cursor.updatedAt),
                  id: { lt: cursor.id },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      include: PROJECT_SUMMARY_INCLUDE,
    });

    const hasMore = rows.length > query.limit;
    const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
    const last = pageRows.at(-1);
    return {
      items: pageRows.map((row) => this.toProjectSummary(row, user.userId)),
      nextCursor:
        hasMore && last
          ? encodeCursor({
              id: last.id,
              updatedAt: last.updatedAt.toISOString(),
            })
          : null,
    };
  }

  async get(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
  ): Promise<StoryProjectSummaryDto> {
    await this.requireScopedProject(
      user,
      workspaceId,
      projectId,
      'story.read',
      {
        allowArchived: true,
      },
    );
    const row = await this.loadProjectSummary(projectId);
    return this.toProjectSummary(row, user.userId);
  }

  async patch(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    input: PatchStoryProjectInput,
  ): Promise<StoryProjectSummaryDto> {
    await this.requireScopedProject(user, workspaceId, projectId, 'story.edit');

    const updated = await this.prisma.storyProject.updateMany({
      where: {
        id: projectId,
        workspaceId,
        status: StoryProjectStatus.active,
        version: input.expectedProjectVersion,
      },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.summary !== undefined ? { summary: input.summary } : {}),
        ...(input.coverAssetId !== undefined
          ? { coverAssetId: input.coverAssetId }
          : {}),
        ...(input.defaultLocale !== undefined
          ? { defaultLocale: input.defaultLocale }
          : {}),
        ...(input.visibility !== undefined
          ? { visibility: input.visibility }
          : {}),
        ...(input.tags !== undefined
          ? { tags: input.tags as Prisma.InputJsonArray }
          : {}),
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      await this.throwProjectVersionConflict(
        workspaceId,
        projectId,
        input.expectedProjectVersion,
      );
    }

    const row = await this.loadProjectSummary(projectId);
    return this.toProjectSummary(row, user.userId);
  }

  async archive(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    input: ArchiveStoryProjectInput,
  ): Promise<StoryProjectSummaryDto> {
    await this.requireScopedProject(
      user,
      workspaceId,
      projectId,
      'story.admin',
    );
    const updated = await this.prisma.storyProject.updateMany({
      where: {
        id: projectId,
        workspaceId,
        status: StoryProjectStatus.active,
        version: input.expectedProjectVersion,
      },
      data: {
        status: StoryProjectStatus.archived,
        archivedAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      await this.throwProjectVersionConflict(
        workspaceId,
        projectId,
        input.expectedProjectVersion,
      );
    }

    const row = await this.loadProjectSummary(projectId);
    return this.toProjectSummary(row, user.userId);
  }

  async getDraft(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
  ): Promise<StoryDraftDto> {
    const access = await this.requireScopedProject(
      user,
      workspaceId,
      projectId,
      'story.read',
      { allowArchived: true },
    );
    this.requireInteractiveFilm(access.project.format);
    const draft = await this.prisma.storyDraft.findUnique({
      where: { storyProjectId: projectId },
    });
    if (!draft) throwDraftNotFound();
    return this.toDraft(draft, access.project);
  }

  async putDraft(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    input: PutStoryDraftInput,
  ): Promise<StoryDraftDto> {
    const access = await this.requireScopedProject(
      user,
      workspaceId,
      projectId,
      'story.edit',
    );
    this.requireInteractiveFilm(access.project.format);
    const contentHash = canonicalJsonHash(input.content);

    const saved = await this.prisma.$transaction(async (tx) => {
      const current = await tx.storyDraft.findUnique({
        where: { storyProjectId: projectId },
      });
      if (!current || current.revision !== input.expectedRevision) return null;

      const currentActualHash = canonicalJsonHash(current.content);
      if (currentActualHash !== current.contentHash) {
        throw new ConflictException({
          code: 'DRAFT_INTEGRITY_ERROR',
          message: 'The stored draft content does not match its hash.',
          expectedHash: current.contentHash,
          actualHash: currentActualHash,
        });
      }
      // Autosave, navigation flush and retry may legitimately converge on the
      // same canonical payload. Treat that as an idempotent read of the saved
      // head: revisions represent content changes, not transport attempts.
      if (
        current.schemaVersion === input.schemaVersion &&
        current.contentHash === contentHash
      ) {
        return current;
      }

      const claimed = await tx.storyDraft.updateMany({
        where: {
          storyProjectId: projectId,
          revision: input.expectedRevision,
        },
        data: {
          schemaVersion: input.schemaVersion,
          content: input.content as Prisma.InputJsonObject,
          contentHash,
          revision: { increment: 1 },
          updatedByUserId: user.userId,
          updatedBySessionId: input.sessionId,
        },
      });
      if (claimed.count !== 1) return null;

      await tx.storyProject.update({
        where: { id: projectId },
        data: { updatedAt: new Date() },
      });
      return tx.storyDraft.findUnique({ where: { storyProjectId: projectId } });
    });

    if (!saved) {
      return this.throwDraftConflict(
        projectId,
        input.expectedRevision,
        access.project,
      );
    }
    return this.toDraft(saved, access.project);
  }

  async getCanvasLayout(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
  ): Promise<StoryCanvasLayoutDto> {
    await this.requireScopedProject(
      user,
      workspaceId,
      projectId,
      'story.read',
      { allowArchived: true },
    );
    const layout = await this.prisma.storyCanvasLayout.findUnique({
      where: {
        storyProjectId_workspaceId: { storyProjectId: projectId, workspaceId },
      },
    });
    if (!layout) throwCanvasLayoutNotFound();
    return this.toCanvasLayout(layout);
  }

  async putCanvasLayout(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    input: PutStoryCanvasLayoutInput,
  ): Promise<StoryCanvasLayoutDto> {
    await this.requireScopedProject(user, workspaceId, projectId, 'story.edit');

    const layout = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.storyCanvasLayout.updateMany({
        where: {
          storyProjectId: projectId,
          workspaceId,
          revision: input.expectedRevision,
        },
        data: {
          schemaVersion: input.schemaVersion,
          nodePositions: input.nodePositions as Prisma.InputJsonObject,
          revision: { increment: 1 },
          updatedByUserId: user.userId,
          updatedBySessionId: input.sessionId,
        },
      });
      if (claimed.count !== 1) return null;

      return tx.storyCanvasLayout.findUnique({
        where: {
          storyProjectId_workspaceId: {
            storyProjectId: projectId,
            workspaceId,
          },
        },
      });
    });
    if (!layout) {
      return this.throwCanvasLayoutConflict(
        workspaceId,
        projectId,
        input.expectedRevision,
      );
    }
    return this.toCanvasLayout(layout);
  }

  async listRevisions(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    query: StoryRevisionListQuery,
  ): Promise<CursorPageDto<StoryRevisionSummaryDto>> {
    await this.requireScopedProject(
      user,
      workspaceId,
      projectId,
      'story.read',
      {
        allowArchived: true,
      },
    );
    const cursor = query.cursor
      ? decodeCursor<RevisionCursor>(query.cursor, isRevisionCursor)
      : null;
    const rows = await this.prisma.storyRevision.findMany({
      where: {
        storyProjectId: projectId,
        ...(cursor
          ? {
              OR: [
                { number: { lt: cursor.number } },
                { number: cursor.number, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ number: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const hasMore = rows.length > query.limit;
    const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
    const last = pageRows.at(-1);
    return {
      items: pageRows.map((row) => this.toRevisionSummary(row)),
      nextCursor:
        hasMore && last
          ? encodeCursor({ id: last.id, number: last.number })
          : null,
    };
  }

  async getRevision(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    revisionId: string,
  ): Promise<StoryRevisionDto> {
    await this.requireScopedProject(
      user,
      workspaceId,
      projectId,
      'story.read',
      {
        allowArchived: true,
      },
    );
    const revision = await this.prisma.storyRevision.findFirst({
      where: { id: revisionId, storyProjectId: projectId },
    });
    if (!revision) throwRevisionNotFound();
    return this.toRevision(revision);
  }

  async lockRevision(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    input: LockStoryRevisionInput,
  ): Promise<StoryRevisionDto> {
    const access = await this.requireScopedProject(
      user,
      workspaceId,
      projectId,
      'story.edit',
    );
    this.requireInteractiveFilm(access.project.format);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await this.prisma.$transaction(
          async (tx) => {
            const draft = await tx.storyDraft.findUnique({
              where: { storyProjectId: projectId },
            });
            if (!draft) return { kind: 'missing' } as const;
            if (draft.revision !== input.expectedDraftRevision) {
              return { kind: 'conflict', draft } as const;
            }

            const actualHash = canonicalJsonHash(draft.content);
            if (actualHash !== draft.contentHash) {
              throw new ConflictException({
                code: 'DRAFT_INTEGRITY_ERROR',
                message: 'The stored draft content does not match its hash.',
                expectedHash: draft.contentHash,
                actualHash,
              });
            }

            const lockable = createLockableInteractiveFilmDraftContentSchema(
              access.project.defaultLocale,
            ).safeParse(draft.content);
            if (!lockable.success) {
              throw new UnprocessableEntityException({
                code: 'STORY_REVISION_NOT_LOCKABLE',
                message: 'Complete and connect the story before locking it.',
                issues: lockable.error.issues.map((issue) => ({
                  code: issue.code,
                  path: issue.path,
                  message: issue.message,
                })),
              });
            }
            // Clip-prompt normalization is part of the immutable Revision
            // contract. Hash the exact canonical v2 JSON written to the
            // revision; malformed or incomplete stored drafts fail above.
            const revisionContentHash = canonicalJsonHash(lockable.data);

            const existing = await tx.storyRevision.findUnique({
              where: {
                storyProjectId_sourceDraftRevision: {
                  storyProjectId: projectId,
                  sourceDraftRevision: draft.revision,
                },
              },
            });
            if (existing) {
              if (existing.contentHash !== revisionContentHash) {
                throw new ConflictException({
                  code: 'STORY_REVISION_INTEGRITY_ERROR',
                  message:
                    'The existing immutable revision does not match its source draft.',
                });
              }
              await this.ensureRevisionFilmProjection(tx, {
                project: access.project,
                revision: existing,
                draft: lockable.data,
                userId: user.userId,
              });
              return { kind: 'revision', revision: existing } as const;
            }

            const latest = await tx.storyRevision.aggregate({
              where: { storyProjectId: projectId },
              _max: { number: true },
            });
            const revision = await tx.storyRevision.create({
              data: {
                storyProjectId: projectId,
                number: (latest._max.number ?? 0) + 1,
                sourceDraftRevision: draft.revision,
                schemaVersion: draft.schemaVersion,
                content: lockable.data as Prisma.InputJsonObject,
                contentHash: revisionContentHash,
                label: input.label,
                source:
                  input.source === 'import'
                    ? StoryRevisionSource.import
                    : StoryRevisionSource.creator,
                createdByUserId: user.userId,
              },
            });
            await this.ensureRevisionFilmProjection(tx, {
              project: access.project,
              revision,
              draft: lockable.data,
              userId: user.userId,
            });
            return { kind: 'revision', revision } as const;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );

        if (result.kind === 'missing') throwDraftNotFound();
        if (result.kind === 'conflict') {
          throwDraftConflict(
            input.expectedDraftRevision,
            result.draft,
            access.project,
          );
        }
        return this.toRevision(result.revision);
      } catch (error) {
        if (!isUniqueConstraintError(error) || attempt > 0) throw error;
        // A concurrent lock/projection won. Retry the whole serializable
        // transaction so the immutable revision and its production plane are
        // verified together instead of returning a partially-created row.
      }
    }

    throw new InternalServerErrorException({
      code: 'STORY_REVISION_LOCK_RETRY_EXHAUSTED',
      message: 'Could not lock the story revision after a concurrent update.',
    });
  }

  private async ensureRevisionFilmProjection(
    tx: Prisma.TransactionClient,
    input: {
      project: {
        id: string;
        frameProfile: import('@prisma/client').StoryFrameProfile;
        defaultLocale: string;
      };
      revision: { id: string };
      draft: import('./interactive-film.schema').InteractiveFilmDraftContent;
      userId: string;
    },
  ): Promise<void> {
    const existingSpec = await tx.storyFilmSpec.findUnique({
      where: { revisionId: input.revision.id },
    });
    const defaultModel = existingSpec
      ? await tx.aiCanonicalModel.findUnique({
          where: { id: existingSpec.defaultCanonicalModelId },
          select: {
            id: true,
            slug: true,
            modality: true,
            status: true,
            archivedAt: true,
            generationModes: true,
          },
        })
      : await this.resolveStoryDefaultVideoModel(tx);
    if (!defaultModel) {
      throw new ConflictException({
        code: 'STORY_REVISION_PRODUCTION_PROJECTION_CONFLICT',
        message:
          'The immutable film specification references a missing canonical model.',
      });
    }

    let projection: ReturnType<typeof projectStoryFilmRevision>;
    try {
      projection = projectStoryFilmRevision({
        draft: input.draft,
        frameProfile: input.project.frameProfile,
        defaultLocale: input.project.defaultLocale,
        defaultCanonicalModelId: defaultModel.id,
      });
    } catch (error) {
      throw new UnprocessableEntityException({
        code: 'STORY_REVISION_PROJECTION_INVALID',
        message:
          error instanceof Error
            ? error.message
            : 'The locked revision cannot be projected for film production.',
      });
    }
    const filmSpecHash = canonicalJsonHash(projection.filmSpec);

    if (existingSpec) {
      if (
        existingSpec.storyProjectId !== input.project.id ||
        existingSpec.specHash !== filmSpecHash ||
        canonicalJsonHash(existingSpec.specJson) !== filmSpecHash
      ) {
        throwProjectionConflict(
          'The existing film specification does not match its immutable revision.',
        );
      }
    } else {
      const spec = projection.filmSpec;
      await tx.storyFilmSpec.create({
        data: {
          revisionId: input.revision.id,
          storyProjectId: input.project.id,
          runtimeSchemaVersion: spec.runtimeSchemaVersion,
          targetDurationMs: spec.duration.targetMs,
          durationToleranceMs: spec.duration.toleranceMs,
          maxContinuousDurationMs: spec.duration.maxContinuousMs,
          maxGeneratedClipDurationMs: spec.duration.maxGeneratedClipMs,
          targetClipCount: spec.targets.clipCount,
          targetChoiceCount: spec.targets.choiceCount,
          targetEndingCount: spec.targets.endingCount,
          frameWidth: spec.frame.width,
          frameHeight: spec.frame.height,
          frameRateNumerator: spec.frame.framesPerSecond.numerator,
          frameRateDenominator: spec.frame.framesPerSecond.denominator,
          audioSampleRate: spec.audioSampleRateHz,
          defaultLocale: spec.locales.defaultLocale,
          enabledLocales: spec.locales.enabledLocales,
          defaultCanonicalModelId: defaultModel.id,
          specJson: spec as Prisma.InputJsonObject,
          specHash: filmSpecHash,
          createdByUserId: input.userId,
          updatedByUserId: input.userId,
        },
      });
    }

    const existingClips = await tx.storyFilmClip.findMany({
      where: { revisionId: input.revision.id },
    });
    const existingTrailer = await tx.storyFilmTrailer.findUnique({
      where: { revisionId: input.revision.id },
    });
    // `trailerSpec: null` is an intentional production disposition: the
    // Revision's full gameplay is valid, while its optional trailer is absent
    // or still an authoring draft. Only a projector-validated trailer may
    // create or inherit trailer-production state.
    const productionReadyTrailer = projection.trailerSpec
      ? {
          spec: projection.trailerSpec,
          specHash: canonicalJsonHash(projection.trailerSpec),
        }
      : null;
    const priorTrailer =
      existingTrailer || !productionReadyTrailer
        ? null
        : await tx.storyFilmTrailer.findFirst({
            where: {
              storyProjectId: input.project.id,
              revisionId: { not: input.revision.id },
              currentVideoAssetId: { not: null },
            },
            orderBy: [
              { revision: { number: 'desc' } },
              { updatedAt: 'desc' },
              { id: 'desc' },
            ],
          });
    if (existingTrailer) {
      if (
        !productionReadyTrailer ||
        existingTrailer.storyProjectId !== input.project.id ||
        existingTrailer.specHash !== productionReadyTrailer.specHash ||
        canonicalJsonHash(existingTrailer.specJson) !==
          productionReadyTrailer.specHash
      ) {
        throwProjectionConflict(
          'The existing film trailer does not match its immutable revision.',
        );
      }
    } else if (productionReadyTrailer) {
      const trailer = productionReadyTrailer.spec;
      await tx.storyFilmTrailer.create({
        data: {
          storyProjectId: input.project.id,
          revisionId: input.revision.id,
          title: trailer.title,
          generationMode:
            trailer.generationControl.mode === 'omni_reference'
              ? StoryFilmGenerationMode.omni_reference
              : StoryFilmGenerationMode.frame_lock,
          frameMode:
            trailer.generationControl.mode === 'frame_lock'
              ? trailer.generationControl.frameMode === 'first_last_frame'
                ? StoryFilmFrameMode.first_last_frame
                : StoryFilmFrameMode.first_frame
              : null,
          targetDurationMs: trailer.targetDurationMs,
          specJson: trailer as Prisma.InputJsonObject,
          specHash: productionReadyTrailer.specHash,
          ...carriedCurrentVideoData(priorTrailer),
          createdByUserId: input.userId,
          updatedByUserId: input.userId,
        },
      });
    }
    const expectedByKey = new Map(
      projection.clipSpecs.map((clip) => [clip.key, clip]),
    );
    const existingByKey = new Map(
      existingClips.map((clip) => [clip.key, clip]),
    );
    const missingClipKeys = projection.clipSpecs
      .filter((clip) => !existingByKey.has(clip.key))
      .map((clip) => clip.key);
    const priorClips =
      missingClipKeys.length === 0
        ? []
        : await tx.storyFilmClip.findMany({
            where: {
              storyProjectId: input.project.id,
              revisionId: { not: input.revision.id },
              key: { in: missingClipKeys },
              archivedAt: null,
              currentVideoAssetId: { not: null },
            },
            orderBy: [
              { revision: { number: 'desc' } },
              { updatedAt: 'desc' },
              { id: 'desc' },
            ],
          });
    const priorClipByKey = new Map<string, (typeof priorClips)[number]>();
    priorClips.forEach((clip) => {
      if (!priorClipByKey.has(clip.key)) priorClipByKey.set(clip.key, clip);
    });
    for (const existing of existingClips) {
      const expected = expectedByKey.get(existing.key);
      const expectedHash = expected ? canonicalJsonHash(expected) : null;
      if (
        !expected ||
        existing.storyProjectId !== input.project.id ||
        existing.graphNodeId !== expected.graphNodeId ||
        existing.archivedAt !== null ||
        existing.specHash !== expectedHash ||
        canonicalJsonHash(existing.specJson) !== expectedHash
      ) {
        throwProjectionConflict(
          `The existing film clip ${existing.key} does not match its immutable revision.`,
        );
      }
    }

    for (const clip of projection.clipSpecs) {
      if (existingByKey.has(clip.key)) continue;
      const specHash = canonicalJsonHash(clip);
      await tx.storyFilmClip.create({
        data: {
          storyProjectId: input.project.id,
          revisionId: input.revision.id,
          key: clip.key,
          graphNodeId: clip.graphNodeId,
          title: clip.title,
          generationMode:
            clip.generationControl.mode === 'omni_reference'
              ? StoryFilmGenerationMode.omni_reference
              : StoryFilmGenerationMode.frame_lock,
          frameMode:
            clip.generationControl.mode === 'frame_lock'
              ? clip.generationControl.frameMode === 'first_last_frame'
                ? StoryFilmFrameMode.first_last_frame
                : StoryFilmFrameMode.first_frame
              : null,
          targetDurationMs: clip.targetDurationMs,
          specJson: clip as Prisma.InputJsonObject,
          specHash,
          rank: clip.rank,
          ...carriedCurrentVideoData(priorClipByKey.get(clip.key) ?? null),
          createdByUserId: input.userId,
          updatedByUserId: input.userId,
        },
      });
    }
  }

  private async resolveStoryDefaultVideoModel(tx: Prisma.TransactionClient) {
    const slug = process.env.STORY_STUDIO_DEFAULT_VIDEO_MODEL_SLUG?.trim();
    if (!slug) {
      throw new UnprocessableEntityException({
        code: 'STORY_DEFAULT_VIDEO_MODEL_NOT_CONFIGURED',
        message:
          'Configure STORY_STUDIO_DEFAULT_VIDEO_MODEL_SLUG before locking the revision.',
      });
    }
    const model = await tx.aiCanonicalModel.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        modality: true,
        status: true,
        archivedAt: true,
        generationModes: true,
      },
    });
    if (
      !model ||
      model.modality !== AiJobType.video ||
      model.status !== AiControlPlaneStatus.active ||
      model.archivedAt !== null
    ) {
      throw new UnprocessableEntityException({
        code: 'STORY_DEFAULT_VIDEO_MODEL_UNAVAILABLE',
        message: `The configured Story Studio video model "${slug}" is missing or inactive.`,
        modelSlug: slug,
      });
    }
    const availableModes = stringArray(model.generationModes);
    const missingModes = requiredStoryGenerationModes().filter(
      (mode) => !availableModes.includes(mode),
    );
    if (missingModes.length > 0) {
      throw new UnprocessableEntityException({
        code: 'STORY_DEFAULT_VIDEO_MODEL_CAPABILITY_MISMATCH',
        message: `The configured Story Studio video model does not support: ${missingModes.join(', ')}.`,
        modelSlug: slug,
        requiredModes: missingModes,
        availableModes,
      });
    }
    return model;
  }

  async workbench(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    query: StoryWorkbenchQuery,
  ): Promise<StoryWorkbenchDto> {
    const access = await this.requireScopedProject(
      user,
      workspaceId,
      projectId,
      'story.read',
      { allowArchived: true },
    );
    this.requireInteractiveFilm(access.project.format);

    const { project, draft, selectedRevision, film } =
      await this.prisma.$transaction(
        async (tx) => {
          const [project, draft, selectedRevision] = await Promise.all([
            this.loadProjectSummary(projectId, tx),
            tx.storyDraft.findUnique({
              where: { storyProjectId: projectId },
            }),
            query.revisionId
              ? tx.storyRevision.findFirst({
                  where: { id: query.revisionId, storyProjectId: projectId },
                })
              : tx.storyRevision.findFirst({
                  where: { storyProjectId: projectId },
                  orderBy: [{ number: 'desc' }, { id: 'desc' }],
                }),
          ]);
          if (!draft) throwDraftNotFound();
          if (query.revisionId && !selectedRevision) {
            throwRevisionNotFound();
          }
          const parsedDraft = InteractiveFilmDraftContentSchema.safeParse(
            draft.content,
          );
          const currentGraphNodeIds = parsedDraft.success
            ? new Set(parsedDraft.data.graph.nodes.map((node) => node.nodeId))
            : null;

          let film: StoryWorkbenchDto['film'] = null;
          if (selectedRevision) {
            const [spec, trailerHead, clipHeads, references, latestBuild] =
              await Promise.all([
                tx.storyFilmSpec.findUnique({
                  where: { revisionId: selectedRevision.id },
                  include: {
                    defaultCanonicalModel: {
                      select: {
                        id: true,
                        slug: true,
                        displayName: true,
                        generationModes: true,
                      },
                    },
                  },
                }),
                tx.storyFilmTrailerHead.findUnique({
                  where: { storyProjectId: projectId },
                  include: {
                    trailer: { include: FILM_TRAILER_INCLUDE },
                  },
                }),
                tx.storyFilmClipHead.findMany({
                  where: { storyProjectId: projectId },
                  include: {
                    clip: { include: FILM_CLIP_INCLUDE },
                  },
                }),
                tx.storyFilmReferenceSlot.findMany({
                  where: {
                    storyProjectId: projectId,
                    revisionId: selectedRevision.id,
                    archivedAt: null,
                  },
                  orderBy: [{ rank: 'asc' }, { id: 'asc' }],
                  include: FILM_REFERENCE_INCLUDE,
                }),
                tx.storyBuild.findFirst({
                  where: {
                    storyProjectId: projectId,
                    sourceRevisionId: selectedRevision.id,
                  },
                  orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                  include: {
                    experiencePublication: {
                      select: {
                        status: true,
                        gameId: true,
                        contentVersion: true,
                        manifestUrl: true,
                        publishedAt: true,
                        mediaAuthorizedAt: true,
                        mediaAuthorizationRevokedAt: true,
                        authorityIsCurrent: true,
                        authorityGameExists: true,
                        authorityCurrentVersion: true,
                        authorityCheckedAt: true,
                        lastErrorCode: true,
                        lastErrorDetail: true,
                      },
                    },
                  },
                }),
              ]);
            film = {
              productionRevision: spec?.productionRevision ?? 0,
              spec: spec ? this.toFilmSpec(spec) : null,
              defaultModel: spec
                ? this.toFilmDefaultModel(spec.defaultCanonicalModel)
                : null,
              trailer: trailerHead
                ? this.toFilmTrailerSummary(trailerHead.trailer)
                : null,
              clips: clipHeads
                .map((head) => head.clip)
                .filter(
                  (clip) => currentGraphNodeIds?.has(clip.graphNodeId) ?? true,
                )
                .sort(
                  (left, right) =>
                    left.rank - right.rank || left.id.localeCompare(right.id),
                )
                .map((clip) => this.toFilmClipSummary(clip)),
              references: references.map((slot) => this.toFilmReference(slot)),
              latestBuild: latestBuild
                ? this.toFilmBuildSummary(latestBuild)
                : null,
            };
          }

          return { project, draft, selectedRevision, film };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );

    return {
      project: this.toProjectSummary(project, user.userId),
      draft: this.toDraft(draft, project),
      selectedRevision: selectedRevision
        ? this.toRevision(selectedRevision)
        : null,
      film,
    };
  }

  private async requireScopedProject(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    capability: PermissionCapability,
    options: { allowArchived?: boolean } = {},
  ) {
    const access = await this.permissions.requireProject(
      user.userId,
      projectId,
      capability,
      options,
    );
    if (access.project.workspaceId !== workspaceId) {
      throw new NotFoundException(PROJECT_NOT_FOUND);
    }
    return access;
  }

  private requireInteractiveFilm(format: StoryFormat): void {
    if (format !== StoryFormat.interactive_film) {
      throw new UnprocessableEntityException({
        code: 'STORY_FORMAT_UNSUPPORTED',
        message: 'This endpoint currently supports interactive-film stories.',
      });
    }
  }

  private async loadProjectSummary(
    projectId: string,
    client: Pick<Prisma.TransactionClient, 'storyProject'> = this.prisma,
  ): Promise<ProjectSummaryRow> {
    const row = await client.storyProject.findUnique({
      where: { id: projectId },
      include: PROJECT_SUMMARY_INCLUDE,
    });
    if (!row) throw new NotFoundException(PROJECT_NOT_FOUND);
    return row;
  }

  private async throwProjectVersionConflict(
    workspaceId: string,
    projectId: string,
    expectedVersion: number,
  ): Promise<never> {
    const current = await this.prisma.storyProject.findUnique({
      where: { id: projectId },
      select: { workspaceId: true, status: true, version: true },
    });
    if (
      !current ||
      current.workspaceId !== workspaceId ||
      current.status !== StoryProjectStatus.active
    ) {
      throw new NotFoundException(PROJECT_NOT_FOUND);
    }
    throw new ConflictException({
      code: 'PROJECT_VERSION_CONFLICT',
      message: 'The story project changed. Refresh it before saving again.',
      expectedVersion,
      actualVersion: current.version,
    });
  }

  private async throwDraftConflict(
    projectId: string,
    expectedRevision: number,
    project: { id: string; format: StoryFormat },
  ): Promise<never> {
    const current = await this.prisma.storyDraft.findUnique({
      where: { storyProjectId: projectId },
    });
    if (!current) throwDraftNotFound();
    throwDraftConflict(expectedRevision, current, project);
  }

  private async throwCanvasLayoutConflict(
    workspaceId: string,
    projectId: string,
    expectedRevision: number,
  ): Promise<never> {
    const current = await this.prisma.storyCanvasLayout.findUnique({
      where: {
        storyProjectId_workspaceId: { storyProjectId: projectId, workspaceId },
      },
    });
    if (!current) throwCanvasLayoutNotFound();
    throw new ConflictException({
      code: 'CANVAS_LAYOUT_REVISION_CONFLICT',
      message: 'The canvas layout changed. Refresh it before saving again.',
      expectedRevision,
      actualRevision: current.revision,
      current: this.toCanvasLayout(current),
    });
  }

  private toProjectSummary(
    row: ProjectSummaryRow,
    userId: string,
  ): StoryProjectSummaryDto {
    const membership = row.members.find((member) => member.userId === userId);
    const capabilities = membership
      ? (this.permissions.capabilities(membership.role) as StoryCapability[])
      : [];
    const latestRevision = row.revisions[0] ?? null;
    const currentProductionRevision =
      latestRevision &&
      row.draft &&
      latestRevision.sourceDraftRevision === row.draft.revision &&
      latestRevision.contentHash === row.draft.contentHash
        ? latestRevision
        : null;
    const activeRevisionId = currentProductionRevision?.id ?? null;
    const parsedDraft = row.draft
      ? InteractiveFilmDraftContentSchema.safeParse(row.draft.content)
      : null;
    const draftClipCount = parsedDraft?.success
      ? parsedDraft.data.clipPrompts.length
      : 0;
    const references = activeRevisionId
      ? row.filmReferenceSlots.filter(
          (slot) => slot.revisionId === activeRevisionId,
        )
      : [];
    const currentGraphNodeIds = parsedDraft?.success
      ? new Set(parsedDraft.data.graph.nodes.map((node) => node.nodeId))
      : null;
    const clips = row.filmClipHeads
      .map((head) => head.clip)
      .filter((clip) => currentGraphNodeIds?.has(clip.graphNodeId) ?? true);
    const approvedReferenceCount = references.filter(
      (slot) => slot.approvedVersionId !== null,
    ).length;
    const currentVideoCount = clips.filter(
      (clip) => clip.currentVideoAssetId !== null,
    ).length;
    const generatingClipCount = clips.filter((clip) =>
      isGenerationActive(clip.latestGenerationAttempt?.status ?? null),
    ).length;

    return {
      id: row.id,
      workspaceId: row.workspaceId,
      format: row.format,
      frameProfile: row.frameProfile,
      status: row.status,
      visibility: row.visibility,
      title: row.title,
      summary: row.summary,
      defaultLocale: row.defaultLocale,
      cover: row.cover ? toMediaAsset(row.cover) : null,
      tags: stringArray(row.tags),
      sourceIpId: row.sourceIpId,
      projectVersion: row.version,
      draftRevision: row.draft?.revision ?? 0,
      activeRevision: row.revisions[0]
        ? this.toRevisionSummary(row.revisions[0])
        : null,
      production: {
        referenceSlotCount: references.length,
        approvedReferenceCount,
        clipCount: draftClipCount,
        currentVideoCount,
        generatingClipCount,
        latestBuildStatus:
          row.builds.find(
            (build) => build.sourceRevisionId === activeRevisionId,
          )?.status ?? null,
      },
      capabilities,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toDraft(
    row: {
      storyProjectId: string;
      schemaVersion: string;
      content: Prisma.JsonValue;
      contentHash: string;
      revision: number;
      updatedByUserId: string;
      updatedBySessionId: string | null;
      createdAt: Date;
      updatedAt: Date;
    },
    project: { id: string; format: StoryFormat },
  ): StoryDraftDto {
    this.requireInteractiveFilm(project.format);
    if (row.schemaVersion !== INTERACTIVE_FILM_DRAFT_SCHEMA_VERSION) {
      throw corruptData('STORY_DRAFT_SCHEMA_UNSUPPORTED', 'draft schema');
    }
    const content = parseDraftContent(row.content, 'STORY_DRAFT_CORRUPT');
    return {
      projectId: row.storyProjectId,
      format: 'interactive_film',
      schemaVersion: INTERACTIVE_FILM_DRAFT_SCHEMA_VERSION,
      content,
      contentHash: row.contentHash,
      revision: row.revision,
      updatedByUserId: row.updatedByUserId,
      updatedBySessionId: row.updatedBySessionId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toCanvasLayout(row: {
    storyProjectId: string;
    schemaVersion: string;
    nodePositions: Prisma.JsonValue;
    revision: number;
    updatedByUserId: string;
    updatedBySessionId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): StoryCanvasLayoutDto {
    if (row.schemaVersion !== STORY_CANVAS_LAYOUT_SCHEMA_VERSION) {
      throw corruptData(
        'STORY_CANVAS_LAYOUT_SCHEMA_UNSUPPORTED',
        'canvas layout schema',
      );
    }
    const nodePositions = StoryCanvasNodePositionsSchema.safeParse(
      row.nodePositions,
    );
    if (!nodePositions.success) {
      throw corruptData('STORY_CANVAS_LAYOUT_CORRUPT', 'canvas layout');
    }
    return {
      projectId: row.storyProjectId,
      schemaVersion: STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
      nodePositions: nodePositions.data,
      revision: row.revision,
      updatedByUserId: row.updatedByUserId,
      updatedBySessionId: row.updatedBySessionId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toRevisionSummary(row: {
    id: string;
    number: number;
    sourceDraftRevision: number;
    schemaVersion: string;
    contentHash: string;
    label: string | null;
    source: StoryRevisionSource;
    createdByUserId: string;
    createdAt: Date;
  }): StoryRevisionSummaryDto {
    return {
      id: row.id,
      number: row.number,
      sourceDraftRevision: row.sourceDraftRevision,
      schemaVersion: row.schemaVersion,
      contentHash: row.contentHash,
      label: row.label,
      source: row.source === StoryRevisionSource.import ? 'import' : 'creator',
      createdByUserId: row.createdByUserId,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toRevision(row: {
    id: string;
    storyProjectId: string;
    number: number;
    sourceDraftRevision: number;
    schemaVersion: string;
    content: Prisma.JsonValue;
    contentHash: string;
    label: string | null;
    source: StoryRevisionSource;
    createdByUserId: string;
    createdAt: Date;
  }): StoryRevisionDto {
    if (row.schemaVersion !== INTERACTIVE_FILM_DRAFT_SCHEMA_VERSION) {
      throw corruptData('STORY_REVISION_SCHEMA_UNSUPPORTED', 'revision schema');
    }
    return {
      ...this.toRevisionSummary(row),
      projectId: row.storyProjectId,
      format: 'interactive_film',
      content: parseDraftContent(row.content, 'STORY_REVISION_CORRUPT'),
    };
  }

  private toFilmSpec(row: {
    storyProjectId: string;
    revisionId: string;
    specJson: Prisma.JsonValue;
    version: number;
    productionRevision: number;
    updatedByUserId: string;
    createdAt: Date;
    updatedAt: Date;
  }): FilmSpecDto {
    const parsed = FilmSpecSchema.safeParse(row.specJson);
    if (!parsed.success) {
      throw corruptData('STORY_FILM_SPEC_CORRUPT', 'film specification');
    }
    return {
      ...parsed.data,
      projectId: row.storyProjectId,
      revisionId: row.revisionId,
      version: row.version,
      productionRevision: row.productionRevision,
      updatedByUserId: row.updatedByUserId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toFilmDefaultModel(row: {
    id: string;
    slug: string;
    displayName: string;
    generationModes: Prisma.JsonValue;
  }): FilmDefaultModelDto {
    return {
      id: row.id,
      slug: row.slug,
      displayName: row.displayName,
      generationModes: stringArray(row.generationModes),
    };
  }

  private toFilmTrailerSummary(row: FilmTrailerRow): FilmTrailerSummaryDto {
    const parsed = FilmTrailerSpecSchema.safeParse(row.specJson);
    if (!parsed.success) {
      throw corruptData('STORY_FILM_TRAILER_CORRUPT', 'film trailer');
    }
    return {
      ...parsed.data,
      id: row.id,
      projectId: row.storyProjectId,
      revisionId: row.revisionId,
      version: row.version,
      currentVideoRevision: row.currentVideoRevision,
      specHash: row.specHash,
      productionInputHash: row.productionInputHash,
      referenceBindings: row.references.map((binding) => ({
        id: binding.id,
        referenceSlotId: binding.referenceSlotId,
        role: binding.role,
        rank: binding.position,
        required: binding.required,
        approvedReferenceVersionId: binding.referenceSlot.approvedVersionId,
      })),
      currentVideo: toCurrentVideoDto(row),
      generation: row.latestGenerationAttempt
        ? toVideoGenerationDto(row.latestGenerationAttempt, {
            kind: 'trailer',
            trailerId: row.id,
          })
        : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toFilmClipSummary(row: FilmClipRow): FilmClipSummaryDto {
    const parsed = FilmClipSpecSchema.safeParse(row.specJson);
    if (!parsed.success) {
      throw corruptData('STORY_FILM_CLIP_CORRUPT', 'film clip');
    }
    return {
      id: row.id,
      revisionId: row.revisionId,
      key: parsed.data.key,
      graphNodeId: parsed.data.graphNodeId,
      kind: parsed.data.kind,
      title: parsed.data.title,
      description: parsed.data.description,
      rank: parsed.data.rank,
      targetDurationMs: parsed.data.targetDurationMs,
      generationControl: parsed.data.generationControl,
      prompt: parsed.data.prompt,
      dialogueWindows: parsed.data.dialogueWindows,
      outputContract: parsed.data.outputContract,
      continuityNotes: parsed.data.continuityNotes,
      version: row.version,
      currentVideoRevision: row.currentVideoRevision,
      productionInputHash: row.productionInputHash,
      referenceBindings: row.references.map((binding) => ({
        id: binding.id,
        referenceSlotId: binding.referenceSlotId,
        role: binding.role,
        rank: binding.position,
        required: binding.required,
        approvedReferenceVersionId: binding.referenceSlot.approvedVersionId,
      })),
      currentVideo: toCurrentVideoDto(row),
      generation: row.latestGenerationAttempt
        ? toVideoGenerationDto(row.latestGenerationAttempt, {
            kind: 'clip',
            clipId: row.id,
          })
        : null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toFilmReference(row: FilmReferenceRow): FilmReferenceSlotDto {
    return {
      id: row.id,
      projectId: row.storyProjectId,
      revisionId: row.revisionId,
      key: row.key,
      kind: row.kind,
      label: row.label,
      description: row.description ?? '',
      required: row.required,
      rank: row.rank,
      version: row.version,
      status: row.approvedVersionId
        ? 'approved'
        : row.versions.length > 0
          ? 'candidate'
          : 'empty',
      approvedVersionId: row.approvedVersionId,
      versions: row.versions.map((version) => ({
        id: version.id,
        slotId: version.referenceSlotId,
        number: version.versionNumber,
        source: version.source,
        aiJobId: version.aiJobId,
        aiJobOutputId: version.aiJobOutputId,
        sourceGenerationId: version.sourceGenerationAttemptId,
        sourceFrameIndex: version.sourceFrameIndex,
        sourceOutputChecksumSha256: version.sourceOutputChecksumSha256,
        asset: toMediaAsset(version.asset),
        promptSnapshot: jsonRecordOrNull(version.promptSnapshot),
        configSnapshot: jsonRecordOrNull(version.generationConfig),
        checksumSha256: version.checksumSha256,
        reviewRevision: version.reviewRevision,
        approved: version.approval !== null,
        createdByUserId: version.createdByUserId,
        createdAt: version.createdAt.toISOString(),
      })),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toFilmBuildSummary(row: {
    id: string;
    buildNumber: number;
    kind: 'preview' | 'production';
    scope: Prisma.JsonValue;
    status: FilmBuildSummaryDto['status'];
    sourceProductionRevision: number;
    diagnostics: Prisma.JsonValue;
    experiencePublication: {
      status: 'pending' | 'confirmed' | 'uncertain' | 'rejected';
      gameId: string;
      contentVersion: string;
      manifestUrl: string | null;
      publishedAt: Date | null;
      mediaAuthorizedAt: Date;
      mediaAuthorizationRevokedAt: Date | null;
      authorityIsCurrent: boolean | null;
      authorityGameExists: boolean | null;
      authorityCurrentVersion: string | null;
      authorityCheckedAt: Date | null;
      lastErrorCode: string | null;
      lastErrorDetail: string | null;
    } | null;
    createdAt: Date;
    completedAt: Date | null;
  }): FilmBuildSummaryDto {
    const scope = FilmBuildScopeSchema.safeParse(row.scope);
    if (!scope.success) {
      throw corruptData('STORY_FILM_BUILD_CORRUPT', 'film build scope');
    }
    return {
      id: row.id,
      number: row.buildNumber,
      profile: row.kind,
      scope: scope.data,
      status: row.status,
      sourceProductionRevision: row.sourceProductionRevision,
      diagnostics: buildDiagnostics(row.diagnostics),
      publication: row.experiencePublication
        ? {
            status: row.experiencePublication.status,
            gameId: row.experiencePublication.gameId,
            contentVersion: row.experiencePublication.contentVersion,
            manifestUrl: row.experiencePublication.manifestUrl,
            publishedAt:
              row.experiencePublication.publishedAt?.toISOString() ?? null,
            mediaAuthorizedAt:
              row.experiencePublication.mediaAuthorizedAt.toISOString(),
            mediaAuthorizationRevokedAt:
              row.experiencePublication.mediaAuthorizationRevokedAt?.toISOString() ??
              null,
            authorityIsCurrent: row.experiencePublication.authorityIsCurrent,
            authorityGameExists: row.experiencePublication.authorityGameExists,
            authorityCurrentVersion:
              row.experiencePublication.authorityCurrentVersion,
            authorityCheckedAt:
              row.experiencePublication.authorityCheckedAt?.toISOString() ??
              null,
            lastErrorCode: row.experiencePublication.lastErrorCode,
            lastErrorDetail: row.experiencePublication.lastErrorDetail,
          }
        : null,
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
    };
  }
}

function throwDraftNotFound(): never {
  throw new NotFoundException({
    code: 'STORY_DRAFT_NOT_FOUND',
    message: 'Story draft not found.',
  });
}

function throwCanvasLayoutNotFound(): never {
  throw new NotFoundException({
    code: 'STORY_CANVAS_LAYOUT_NOT_FOUND',
    message: 'Story canvas layout not found.',
  });
}

function throwRevisionNotFound(): never {
  throw new NotFoundException({
    code: 'STORY_REVISION_NOT_FOUND',
    message: 'Story revision not found.',
  });
}

function throwDraftConflict(
  expectedRevision: number,
  current: {
    storyProjectId: string;
    schemaVersion: string;
    content: Prisma.JsonValue;
    contentHash: string;
    revision: number;
    updatedByUserId: string;
    updatedBySessionId: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
  project: { format: StoryFormat },
): never {
  if (
    project.format !== StoryFormat.interactive_film ||
    current.schemaVersion !== INTERACTIVE_FILM_DRAFT_SCHEMA_VERSION
  ) {
    throw corruptData('STORY_DRAFT_SCHEMA_UNSUPPORTED', 'draft schema');
  }
  const content = parseDraftContent(current.content, 'STORY_DRAFT_CORRUPT');
  const dto: StoryDraftDto = {
    projectId: current.storyProjectId,
    format: 'interactive_film',
    schemaVersion: INTERACTIVE_FILM_DRAFT_SCHEMA_VERSION,
    content,
    contentHash: current.contentHash,
    revision: current.revision,
    updatedByUserId: current.updatedByUserId,
    updatedBySessionId: current.updatedBySessionId,
    createdAt: current.createdAt.toISOString(),
    updatedAt: current.updatedAt.toISOString(),
  };
  throw new ConflictException({
    code: 'DRAFT_REVISION_CONFLICT',
    message: 'The draft changed. Refresh it before saving or locking again.',
    expectedRevision,
    actualRevision: current.revision,
    current: dto,
  });
}

function toMediaAsset(row: FilmMediaAssetRow): MediaAssetSummaryDto {
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

function carriedCurrentVideoData(source: CurrentVideoCarrySource | null) {
  if (!source?.currentVideoAssetId) return {};
  if (
    !source.currentVideoVariantId ||
    !source.currentVideoChecksumSha256 ||
    !source.currentVideoSetAt
  ) {
    throwProjectionConflict(
      'A previous revision contains an incomplete current-video pointer.',
    );
  }
  return {
    currentVideoAssetId: source.currentVideoAssetId,
    currentVideoVariantId: source.currentVideoVariantId,
    currentVideoSourceAttemptId: null,
    currentVideoSpecHash: source.currentVideoSpecHash,
    currentVideoInputHash: source.currentVideoInputHash,
    currentVideoChecksumSha256: source.currentVideoChecksumSha256,
    currentVideoTechnicalChecks:
      source.currentVideoTechnicalChecks ?? Prisma.JsonNull,
    currentVideoRevision: Math.max(source.currentVideoRevision, 1),
    currentVideoSetByUserId: source.currentVideoSetByUserId,
    currentVideoSetAt: source.currentVideoSetAt,
    latestGenerationAttemptId: null,
  };
}

function toCurrentVideoDto(
  row: FilmClipRow | FilmTrailerRow,
): FilmCurrentVideoDto | null {
  if (row.currentVideoAssetId === null) {
    if (
      row.currentVideoVariantId !== null ||
      row.currentVideoSourceAttemptId !== null ||
      row.currentVideoSpecHash !== null ||
      row.currentVideoInputHash !== null ||
      row.currentVideoChecksumSha256 !== null ||
      row.currentVideoTechnicalChecks !== null ||
      row.currentVideoSetByUserId !== null ||
      row.currentVideoSetAt !== null ||
      row.currentVideoAsset !== null
    ) {
      throw corruptData(
        'STORY_FILM_CURRENT_VIDEO_CORRUPT',
        'film current video',
      );
    }
    return null;
  }
  if (
    !row.currentVideoAsset ||
    !row.currentVideoVariantId ||
    !row.currentVideoChecksumSha256 ||
    !row.currentVideoSetAt
  ) {
    throw corruptData('STORY_FILM_CURRENT_VIDEO_CORRUPT', 'film current video');
  }
  return {
    asset: toMediaAsset(row.currentVideoAsset),
    variantId: row.currentVideoVariantId,
    sourceGenerationId: row.currentVideoSourceAttemptId,
    specHash: row.currentVideoSpecHash,
    inputHash: row.currentVideoInputHash,
    checksumSha256: row.currentVideoChecksumSha256,
    technicalChecks: storyFilmTechnicalCheckDtos(
      row.currentVideoTechnicalChecks ?? [],
    ),
    revision: row.currentVideoRevision,
    setByUserId: row.currentVideoSetByUserId,
    setAt: row.currentVideoSetAt.toISOString(),
    outdated:
      row.currentVideoSpecHash !== row.specHash ||
      row.currentVideoInputHash !== row.productionInputHash,
  };
}

function toVideoGenerationDto(
  row:
    | NonNullable<FilmClipRow['latestGenerationAttempt']>
    | NonNullable<FilmTrailerRow['latestGenerationAttempt']>,
  target: FilmVideoGenerationDto['target'],
): FilmVideoGenerationDto {
  return {
    id: row.id,
    projectId: row.storyProjectId,
    revisionId: row.revisionId,
    target,
    number: row.attemptNumber,
    version: row.version,
    aiJobId: row.aiJobId,
    aiJobOutputId: row.aiJobOutputId,
    status: row.status,
    specHash: 'clipSpecHash' in row ? row.clipSpecHash : row.trailerSpecHash,
    inputHash: row.productionInputHash,
    promptSnapshot: requiredJsonRecord(
      row.promptSnapshot,
      'film generation prompt snapshot',
    ),
    generationConfig: requiredJsonRecord(
      row.generationConfig,
      'film generation configuration',
    ),
    modelSnapshot: requiredJsonRecord(
      row.modelSnapshot,
      'film generation model snapshot',
    ),
    outputAsset: row.outputAsset ? toMediaAsset(row.outputAsset) : null,
    outputVariantId: row.outputVariantId,
    outputChecksumSha256: row.outputChecksumSha256,
    technicalChecks: storyFilmTechnicalCheckDtos(row.technicalChecks),
    error: jsonRecordOrNull(row.error),
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

function parseDraftContent(
  value: unknown,
  code: 'STORY_DRAFT_CORRUPT' | 'STORY_REVISION_CORRUPT',
) {
  const parsed = InteractiveFilmDraftContentSchema.safeParse(value);
  if (!parsed.success) throw corruptData(code, 'interactive-film story');
  return parsed.data;
}

function corruptData(
  code: string,
  resource: string,
): InternalServerErrorException {
  return new InternalServerErrorException({
    code,
    message: `Stored ${resource} data is invalid.`,
  });
}

function stringArray(value: Prisma.JsonValue): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function requiredStoryGenerationModes(): string[] {
  // Story Studio exposes a single full-capability default model. A revision
  // may use only one lane today, but creators must be able to switch between
  // First Frame, First + Last Frame and Omni Reference without changing the
  // product-level model contract.
  return ['first_last_frame_to_video', 'image_to_video', 'multimodal_to_video'];
}

function throwProjectionConflict(message: string): never {
  throw new ConflictException({
    code: 'STORY_REVISION_PRODUCTION_PROJECTION_CONFLICT',
    message,
  });
}

function jsonRecordOrNull(
  value: Prisma.JsonValue | null,
): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function requiredJsonRecord(
  value: Prisma.JsonValue,
  resource: string,
): Record<string, unknown> {
  const record = jsonRecordOrNull(value);
  if (!record) throw corruptData('STORY_FILM_GENERATION_CORRUPT', resource);
  return record;
}

function buildDiagnostics(value: Prisma.JsonValue): FilmBuildDiagnosticDto[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    isFilmBuildDiagnostic,
  ) as unknown as FilmBuildDiagnosticDto[];
}

function isGenerationActive(
  status: StoryFilmGenerationAttemptStatus | null,
): boolean {
  return (
    status === StoryFilmGenerationAttemptStatus.queued ||
    status === StoryFilmGenerationAttemptStatus.running ||
    status === StoryFilmGenerationAttemptStatus.processing
  );
}

function isFilmBuildDiagnostic(
  value: unknown,
): value is FilmBuildDiagnosticDto {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    (item.severity === 'error' || item.severity === 'warning') &&
    typeof item.code === 'string' &&
    typeof item.message === 'string' &&
    (item.entityType === null || typeof item.entityType === 'string') &&
    (item.entityId === null || typeof item.entityId === 'string')
  );
}

function encodeCursor(value: ProjectCursor | RevisionCursor): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeCursor<T>(
  value: string,
  validate: (candidate: unknown) => candidate is T,
): T {
  try {
    const candidate: unknown = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    );
    if (validate(candidate)) return candidate;
  } catch {
    // Converted into the stable API error below.
  }
  throw new BadRequestException({
    code: 'STORY_CURSOR_INVALID',
    message: 'The pagination cursor is invalid or expired.',
  });
}

function isProjectCursor(value: unknown): value is ProjectCursor {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    StoryUuidSchema.safeParse(candidate.id).success &&
    typeof candidate.updatedAt === 'string' &&
    Number.isFinite(Date.parse(candidate.updatedAt))
  );
}

function isRevisionCursor(value: unknown): value is RevisionCursor {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    StoryUuidSchema.safeParse(candidate.id).success &&
    typeof candidate.number === 'number' &&
    Number.isInteger(candidate.number) &&
    candidate.number > 0
  );
}

function isUniqueConstraintError(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}
