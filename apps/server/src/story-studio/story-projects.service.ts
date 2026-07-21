import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  Prisma,
  StoryFormat,
  StoryProjectMemberRole,
  StoryProjectMemberStatus,
  StoryProjectStatus,
  StoryRevisionSource,
  StoryVideoGenerationAttemptStatus,
  WorkspaceMemberRole,
} from '@prisma/client';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import { resolveMediaPublicUrl } from '../infra/storage/media-asset-url-resolver.service';
import { WorkspacePermissionService } from '../workspaces/workspace-permission.service';
import { canonicalJsonHash } from './canonical-json';
import {
  EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT,
  createLockableInteractiveStoryDraftContentSchema,
  StoryBuildScopeSchema,
  INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
  InteractiveStoryDraftContentSchema,
  STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
  STORY_WORLD_CANVAS_NODE_ID,
  StoryCanvasNodePositionsSchema,
  StoryUuidSchema,
  type ArchiveStoryProjectInput,
  type CreateStoryProjectInput,
  type CursorPageDto,
  type StoryBuildDiagnosticDto,
  type StoryBuildSummaryDto,
  type StoryVideoTechnicalCheckDto,
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
  type StoryCurrentVideoDto,
  type StoryReferenceSlotDto,
  type StoryVideoGenerationDto,
  type StoryWorkbenchDto,
  type StoryWorkbenchQuery,
} from './dto';
import {
  StoryVideoRecipeSnapshotSchema,
  storyVideoSnapshotHash,
  type StoryVideoSnapshotEntry,
} from './story-video-production.schema';
import {
  StoryPermissionService,
  type StoryCapability as PermissionCapability,
} from './story-permission.service';
import { StoryProjectWriteGuardService } from './story-project-write-guard.service';

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
  referenceSlots: {
    where: { archivedAt: null },
    select: { required: true, approvedVersionId: true },
  },
  videoSelections: {
    where: { targetKind: 'clip' },
    select: {
      targetKey: true,
      currentAssetId: true,
      generationAttempts: {
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 1,
        select: { status: true },
      },
    },
  },
  builds: {
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 1,
    select: { sourceDraftRevision: true, status: true },
  },
});

type ProjectSummaryRow = Prisma.StoryProjectGetPayload<{
  include: typeof PROJECT_SUMMARY_INCLUDE;
}>;

const STORY_VIDEO_SELECTION_INCLUDE =
  Prisma.validator<Prisma.StoryVideoSelectionInclude>()({
    currentAsset: {
      include: {
        placements: true,
        variants: { include: { placements: true } },
      },
    },
    generationAttempts: {
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 1,
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

type StoryVideoSelectionRow = Prisma.StoryVideoSelectionGetPayload<{
  include: typeof STORY_VIDEO_SELECTION_INCLUDE;
}>;

const STORY_REFERENCE_INCLUDE =
  Prisma.validator<Prisma.StoryReferenceSlotInclude>()({
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

type StoryReferenceRow = Prisma.StoryReferenceSlotGetPayload<{
  include: typeof STORY_REFERENCE_INCLUDE;
}>;

type StoryMediaAssetRow = Prisma.MediaAssetGetPayload<{
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

@Injectable()
export class StoryProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: StoryPermissionService,
    private readonly workspacePermissions: WorkspacePermissionService,
    private readonly writeGuard: StoryProjectWriteGuardService,
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

    const contentHash = canonicalJsonHash(
      EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT,
    );
    const project = await this.prisma.storyProject.create({
      data: {
        workspaceId,
        format: input.format,
        frameProfile: input.frameProfile ?? null,
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
            schemaVersion: INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
            content:
              EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT as Prisma.InputJsonObject,
            contentHash,
            updatedByUserId: user.userId,
          },
        },
        canvasLayout: {
          create: {
            schemaVersion: STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
            nodePositions: {},
            // A fresh project opens on the empty-canvas agent launcher (idea +
            // director skills); the Story World card is summoned later, not
            // pre-seeded.
            storyWorldNodePresent: false,
            updatedByUserId: user.userId,
          },
        },
        writeState: { create: {} },
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
      video: {
        snapshotHash: storyVideoSnapshotHash([]),
        clips: [],
        trailer: {
          selectionVersion: 0,
          currentVideo: null,
          generation: null,
        },
      },
      references: [],
      latestBuild: null,
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
        format: query.format
          ? query.format
          : {
              in: [StoryFormat.interactive_film, StoryFormat.text_adventure],
            },
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
    const access = await this.requireScopedProject(
      user,
      workspaceId,
      projectId,
      'story.read',
      {
        allowArchived: true,
      },
    );
    this.requireSupportedStoryFormat(access.project.format);
    const row = await this.loadProjectSummary(projectId);
    return this.toProjectSummary(row, user.userId);
  }

  async patch(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    input: PatchStoryProjectInput,
  ): Promise<StoryProjectSummaryDto> {
    const access = await this.requireScopedProject(
      user,
      workspaceId,
      projectId,
      'story.edit',
    );
    this.requireSupportedStoryFormat(access.project.format);

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.writeGuard.assertHumanWriteAllowed(tx, projectId);
      return tx.storyProject.updateMany({
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
    const access = await this.requireScopedProject(
      user,
      workspaceId,
      projectId,
      'story.admin',
    );
    this.requireSupportedStoryFormat(access.project.format);
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.writeGuard.assertHumanWriteAllowed(tx, projectId);
      return tx.storyProject.updateMany({
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
    this.requireSupportedStoryFormat(access.project.format);
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
    this.requireSupportedStoryFormat(access.project.format);
    const contentHash = canonicalJsonHash(input.content);

    const saved = await this.prisma.$transaction(async (tx) => {
      await this.writeGuard.assertHumanWriteAllowed(tx, projectId);
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
      await this.writeGuard.assertHumanWriteAllowed(tx, projectId);
      const claimed = await tx.storyCanvasLayout.updateMany({
        where: {
          storyProjectId: projectId,
          workspaceId,
          revision: input.expectedRevision,
        },
        data: {
          schemaVersion: input.schemaVersion,
          nodePositions: input.nodePositions as Prisma.InputJsonObject,
          storyWorldNodePresent: input.storyWorldNodePresent,
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
    const access = await this.requireScopedProject(
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
    return this.toRevision(revision, access.project.format);
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
    this.requireSupportedStoryFormat(access.project.format);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await this.prisma.$transaction(
          async (tx) => {
            await this.writeGuard.assertHumanWriteAllowed(tx, projectId);
            const draft = await tx.storyDraft.findUnique({
              where: { storyProjectId: projectId },
            });
            if (!draft) return { kind: 'missing' } as const;
            if (draft.revision !== input.expectedDraftRevision) {
              return { kind: 'conflict', draft } as const;
            }
            if (
              draft.schemaVersion !== INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION
            ) {
              throw unsupportedStorySchema('draft', draft.schemaVersion);
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

            const lockable = createLockableInteractiveStoryDraftContentSchema(
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
            // Hash exactly the validated interactive-story document written to the
            // immutable revision. Video selection remains project-scoped.
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
        return this.toRevision(result.revision, access.project.format);
      } catch (error) {
        if (!isUniqueConstraintError(error) || attempt > 0) throw error;
        // A concurrent lock won. Retry the serializable transaction so the
        // immutable revision number is allocated exactly once.
      }
    }

    throw new InternalServerErrorException({
      code: 'STORY_REVISION_LOCK_RETRY_EXHAUSTED',
      message: 'Could not lock the story revision after a concurrent update.',
    });
  }

  async workbench(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    _query: StoryWorkbenchQuery,
  ): Promise<StoryWorkbenchDto> {
    void _query;
    const access = await this.requireScopedProject(
      user,
      workspaceId,
      projectId,
      'story.read',
      { allowArchived: true },
    );
    this.requireSupportedStoryFormat(access.project.format);

    const { project, draft, video, references, latestBuild } =
      await this.prisma.$transaction(
        async (tx) => {
          const [project, draft, selections, references, latestBuild] =
            await Promise.all([
              this.loadProjectSummary(projectId, tx),
              tx.storyDraft.findUnique({
                where: { storyProjectId: projectId },
              }),
              tx.storyVideoSelection.findMany({
                where: { storyProjectId: projectId },
                include: STORY_VIDEO_SELECTION_INCLUDE,
              }),
              tx.storyReferenceSlot.findMany({
                where: { storyProjectId: projectId, archivedAt: null },
                orderBy: [{ rank: 'asc' }, { id: 'asc' }],
                include: STORY_REFERENCE_INCLUDE,
              }),
              tx.storyBuild.findFirst({
                where: { storyProjectId: projectId },
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
          if (!draft) throwDraftNotFound();
          if (draft.schemaVersion !== INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION) {
            throw unsupportedStorySchema('draft', draft.schemaVersion);
          }
          const content = parseDraftContent(
            draft.content,
            'STORY_DRAFT_CORRUPT',
          );
          return {
            project,
            draft,
            video: projectStoryVideoWorkbench(content, selections),
            references: references.map((slot) => this.toStoryReference(slot)),
            latestBuild: latestBuild
              ? this.toStoryBuildSummary(latestBuild)
              : null,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );

    return {
      project: this.toProjectSummary(project, user.userId),
      draft: this.toDraft(draft, project),
      video,
      references,
      latestBuild,
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

  private requireSupportedStoryFormat(
    format: StoryFormat,
  ): asserts format is 'interactive_film' | 'text_adventure' {
    if (
      format !== StoryFormat.interactive_film &&
      format !== StoryFormat.text_adventure
    ) {
      throw new UnprocessableEntityException({
        code: 'STORY_FORMAT_UNSUPPORTED',
        message:
          'This endpoint supports interactive-film and text-adventure story profiles.',
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
    this.requireSupportedStoryFormat(row.format);
    const membership = row.members.find((member) => member.userId === userId);
    const capabilities = membership
      ? (this.permissions.capabilities(membership.role) as StoryCapability[])
      : [];
    const parsedDraft = row.draft
      ? InteractiveStoryDraftContentSchema.safeParse(row.draft.content)
      : null;
    const draftClipCount = parsedDraft?.success
      ? parsedDraft.data.graph.nodes.filter((node) => node.kind === 'clip')
          .length
      : 0;
    const currentClipNodeIds = new Set(
      parsedDraft?.success
        ? parsedDraft.data.graph.nodes.flatMap((node) =>
            node.kind === 'clip' ? [node.nodeId] : [],
          )
        : [],
    );
    const selections = row.videoSelections.filter((selection) =>
      currentClipNodeIds.has(selection.targetKey),
    );
    const approvedReferenceCount = row.referenceSlots.filter(
      (slot) => slot.approvedVersionId !== null,
    ).length;
    const currentVideoCount = selections.filter(
      (selection) => selection.currentAssetId !== null,
    ).length;
    const generatingClipCount = selections.filter((selection) =>
      isGenerationActive(selection.generationAttempts[0]?.status ?? null),
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
        referenceSlotCount: row.referenceSlots.length,
        approvedReferenceCount,
        clipCount: draftClipCount,
        currentVideoCount,
        generatingClipCount,
        latestBuildStatus:
          row.builds.find(
            (build) => build.sourceDraftRevision === row.draft?.revision,
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
    this.requireSupportedStoryFormat(project.format);
    if (row.schemaVersion !== INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION) {
      throw unsupportedStorySchema('draft', row.schemaVersion);
    }
    const content = parseDraftContent(row.content, 'STORY_DRAFT_CORRUPT');
    return {
      projectId: row.storyProjectId,
      format: project.format,
      schemaVersion: INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
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
    storyWorldNodePresent: boolean;
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
    if (
      !row.storyWorldNodePresent &&
      Object.prototype.hasOwnProperty.call(
        nodePositions.data,
        STORY_WORLD_CANVAS_NODE_ID,
      )
    ) {
      throw corruptData('STORY_CANVAS_LAYOUT_CORRUPT', 'canvas layout');
    }
    return {
      projectId: row.storyProjectId,
      schemaVersion: STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
      nodePositions: nodePositions.data,
      storyWorldNodePresent: row.storyWorldNodePresent,
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

  private toRevision(
    row: {
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
    },
    format: StoryFormat,
  ): StoryRevisionDto {
    this.requireSupportedStoryFormat(format);
    if (row.schemaVersion !== INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION) {
      throw unsupportedStorySchema('revision', row.schemaVersion);
    }
    return {
      ...this.toRevisionSummary(row),
      projectId: row.storyProjectId,
      format,
      content: parseDraftContent(row.content, 'STORY_REVISION_CORRUPT'),
    };
  }

  private toStoryReference(row: StoryReferenceRow): StoryReferenceSlotDto {
    return {
      id: row.id,
      projectId: row.storyProjectId,
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
        variantId: version.variantId,
        sourceRecipeSnapshot: jsonRecordOrNull(version.sourceRecipeSnapshot),
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

  private toStoryBuildSummary(row: {
    id: string;
    buildNumber: number;
    kind: StoryBuildSummaryDto['kind'];
    scope: Prisma.JsonValue;
    status: StoryBuildSummaryDto['status'];
    sourceDraftRevision: number;
    videoSnapshotHash: string;
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
  }): StoryBuildSummaryDto {
    const scope = StoryBuildScopeSchema.safeParse(row.scope);
    if (!scope.success) {
      throw corruptData('STORY_BUILD_CORRUPT', 'story build scope');
    }
    return {
      id: row.id,
      number: row.buildNumber,
      kind: row.kind,
      scope: scope.data,
      status: row.status,
      sourceDraftRevision: row.sourceDraftRevision,
      videoSnapshotHash: row.videoSnapshotHash,
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
    (project.format !== StoryFormat.interactive_film &&
      project.format !== StoryFormat.text_adventure) ||
    current.schemaVersion !== INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION
  ) {
    throw unsupportedStorySchema('draft', current.schemaVersion);
  }
  const content = parseDraftContent(current.content, 'STORY_DRAFT_CORRUPT');
  const dto: StoryDraftDto = {
    projectId: current.storyProjectId,
    format: project.format,
    schemaVersion: INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
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

function toMediaAsset(row: StoryMediaAssetRow): MediaAssetSummaryDto {
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

function projectStoryVideoWorkbench(
  draft: ReturnType<typeof parseDraftContent>,
  selections: StoryVideoSelectionRow[],
): StoryWorkbenchDto['video'] {
  const selectionByTarget = new Map(
    selections.map((selection) => [
      `${selection.targetKind}:${selection.targetKey}`,
      selection,
    ]),
  );
  const clips = draft.graph.nodes.flatMap((node) => {
    if (node.kind !== 'clip') return [];
    const selection = selectionByTarget.get(`clip:${node.nodeId}`) ?? null;
    return [
      {
        graphNodeId: node.nodeId,
        selectionVersion: selection?.version ?? 0,
        currentVideo: selectionCurrentVideo(selection),
        generation: selectionGeneration(selection),
      },
    ];
  });
  const snapshot: StoryVideoSnapshotEntry[] = clips.map((clip) => {
    const video = clip.currentVideo;
    return {
      graphNodeId: clip.graphNodeId,
      selectionVersion: clip.selectionVersion,
      sourceGenerationAttemptId: video?.sourceGenerationId ?? null,
      assetId: video?.asset.id ?? null,
      variantId: video?.variantId ?? null,
      checksumSha256: video?.checksumSha256 ?? null,
      contentType: video ? exactStoryVideoContentType(video.contentType) : null,
      durationMs: video?.durationMs ?? null,
      width: video?.width ?? null,
      height: video?.height ?? null,
      browserSafeMp4: video?.browserSafeMp4 ?? null,
    };
  });
  const trailerSelection = selectionByTarget.get('trailer:trailer') ?? null;
  return {
    snapshotHash: storyVideoSnapshotHash(snapshot),
    clips,
    trailer: {
      selectionVersion: trailerSelection?.version ?? 0,
      currentVideo: selectionCurrentVideo(trailerSelection),
      generation: selectionGeneration(trailerSelection),
    },
  };
}

function selectionCurrentVideo(
  selection: StoryVideoSelectionRow | null,
): StoryCurrentVideoDto | null {
  if (!selection?.currentAssetId) return null;
  if (
    !selection.currentAsset ||
    !selection.currentVariantId ||
    !selection.currentChecksumSha256 ||
    selection.currentDurationMs === null ||
    selection.currentWidth === null ||
    selection.currentHeight === null ||
    !selection.currentContentType ||
    selection.currentBrowserSafeMp4 === null ||
    !selection.setAt
  ) {
    throw corruptData('STORY_VIDEO_SELECTION_CORRUPT', 'story video selection');
  }
  return {
    asset: toMediaAsset(selection.currentAsset),
    variantId: selection.currentVariantId,
    sourceGenerationId: selection.currentSourceGenerationAttemptId,
    checksumSha256: selection.currentChecksumSha256,
    contentType: selection.currentContentType,
    durationMs: selection.currentDurationMs,
    width: selection.currentWidth,
    height: selection.currentHeight,
    browserSafeMp4: selection.currentBrowserSafeMp4,
    selectionVersion: selection.version,
    setByUserId: selection.setByUserId,
    setAt: selection.setAt.toISOString(),
  };
}

function exactStoryVideoContentType(value: string): string {
  if (!value.toLowerCase().startsWith('video/')) {
    throw corruptData(
      'STORY_VIDEO_SELECTION_CORRUPT',
      'story video content type',
    );
  }
  return value;
}

function selectionGeneration(
  selection: StoryVideoSelectionRow | null,
): StoryVideoGenerationDto | null {
  const generation = selection?.generationAttempts[0];
  if (!selection || !generation) return null;
  const recipe = StoryVideoRecipeSnapshotSchema.safeParse(
    generation.recipeSnapshot,
  );
  if (!recipe.success) {
    throw corruptData(
      'STORY_VIDEO_GENERATION_CORRUPT',
      'story video generation recipe',
    );
  }
  return {
    id: generation.id,
    projectId: generation.storyProjectId,
    target:
      selection.targetKind === 'clip'
        ? { kind: 'clip', graphNodeId: selection.targetKey }
        : { kind: 'trailer' },
    number: generation.attemptNumber,
    version: generation.version,
    selectionVersionAtSubmit: generation.selectionVersionAtSubmit,
    aiJobId: generation.aiJobId,
    aiJobOutputId: generation.aiJobOutputId,
    status: generation.status,
    recipeSnapshot: recipe.data,
    outputAsset: generation.outputAsset
      ? toMediaAsset(generation.outputAsset)
      : null,
    outputVariantId: generation.outputVariantId,
    outputChecksumSha256: generation.outputChecksumSha256,
    technicalChecks: technicalCheckDtos(generation.technicalChecks),
    error: jsonRecordOrNull(generation.error),
    createdByUserId: generation.createdByUserId,
    queuedAt: generation.queuedAt?.toISOString() ?? null,
    startedAt: generation.startedAt?.toISOString() ?? null,
    readyAt: generation.readyAt?.toISOString() ?? null,
    cancelledAt: generation.cancelledAt?.toISOString() ?? null,
    supersededAt: generation.supersededAt?.toISOString() ?? null,
    completedAt: generation.completedAt?.toISOString() ?? null,
    createdAt: generation.createdAt.toISOString(),
    updatedAt: generation.updatedAt.toISOString(),
  };
}

function technicalCheckDtos(
  value: Prisma.JsonValue,
): StoryVideoTechnicalCheckDto[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const check = item as Record<string, unknown>;
    if (
      typeof check.key !== 'string' ||
      (check.status !== 'pending' &&
        check.status !== 'passed' &&
        check.status !== 'failed') ||
      (check.message !== null && typeof check.message !== 'string')
    ) {
      return [];
    }
    return [
      {
        key: check.key,
        status: check.status,
        message: check.message,
      },
    ];
  });
}

function parseDraftContent(
  value: unknown,
  code: 'STORY_DRAFT_CORRUPT' | 'STORY_REVISION_CORRUPT',
) {
  const parsed = InteractiveStoryDraftContentSchema.safeParse(value);
  if (!parsed.success) throw corruptData(code, 'interactive story');
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

function unsupportedStorySchema(
  resource: 'draft' | 'revision',
  actualSchemaVersion: string,
): ConflictException {
  return new ConflictException({
    code:
      resource === 'draft'
        ? 'STORY_DRAFT_SCHEMA_UNSUPPORTED'
        : 'STORY_REVISION_SCHEMA_UNSUPPORTED',
    message: `This ${resource} uses an unsupported schema and can no longer be opened.`,
    actualSchemaVersion,
    expectedSchemaVersion: INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
  });
}

function stringArray(value: Prisma.JsonValue): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function jsonRecordOrNull(
  value: Prisma.JsonValue | null,
): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function buildDiagnostics(value: Prisma.JsonValue): StoryBuildDiagnosticDto[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    isStoryBuildDiagnostic,
  ) as unknown as StoryBuildDiagnosticDto[];
}

function isGenerationActive(
  status: StoryVideoGenerationAttemptStatus | null,
): boolean {
  return (
    status === StoryVideoGenerationAttemptStatus.queued ||
    status === StoryVideoGenerationAttemptStatus.running ||
    status === StoryVideoGenerationAttemptStatus.processing
  );
}

function isStoryBuildDiagnostic(
  value: unknown,
): value is StoryBuildDiagnosticDto {
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
