import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  MediaAssetKind,
  MediaAssetModerationStatus,
  MediaAssetStatus,
  MediaAssetVariantStatus,
  Prisma,
  SkillCatalogStatus,
  StoryProductionSpecStatus,
  StoryProjectMemberRole,
  StoryProjectMemberStatus,
  StoryProjectStatus,
  StoryProjectBillingMode,
  StoryFrameProfile,
  StoryRevisionSource,
  StudioDocumentType,
  StudioDocumentStatus,
  StudioDocumentVersionSource,
} from '@prisma/client';
import { storyVisualStyleSkillBySlug } from '@repo/shared';
import type { AuthUser } from '../auth';
import { encodeDocumentSnapshot } from '../documents/document-crdt';
import { rootSchemaFor } from '../documents/document-modes';
import { ensureStoryScriptDocumentInTransaction } from '../documents/story-script-document';
import { PrismaService } from '../infra/db/db.module';
import { resolveMediaPublicUrl } from '../infra/storage/media-asset-url-resolver.service';
import { WorkspacesService } from '../workspaces';
import { canonicalJsonHash } from './canonical-json';
import {
  EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT,
  createLockableInteractiveStoryDraftContentSchema,
  StoryBuildScopeSchema,
  INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
  InteractiveStoryDraftContentSchema,
  STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
  STORY_CHAPTER_COUNT_MAX,
  StoryCanvasNodePositionsSchema,
  StoryVisualStyleSchema,
  StoryUuidSchema,
  type ArchiveStoryProjectInput,
  type CreateStoryChapterInput,
  type CreateStoryProjectInput,
  type CursorPageDto,
  type InteractiveStoryDraftContent,
  type StoryBuildDiagnosticDto,
  type StoryBuildSummaryDto,
  type LockStoryRevisionInput,
  type MediaAssetSummaryDto,
  type PatchStoryProjectInput,
  type PatchStoryChapterInput,
  type PutStoryCanvasLayoutInput,
  type PutStoryDraftInput,
  type StoryCapability,
  type StoryChapterDto,
  type StoryCanvasLayoutDto,
  type StoryCandidateAssetDto,
  type StoryDraftDto,
  type StoryProjectListQuery,
  type StoryProjectSummaryDto,
  type StoryRevisionDto,
  type StoryRevisionListQuery,
  type StoryRevisionSummaryDto,
  type StoryReferenceSlotDto,
  type StoryWorkbenchDto,
  type StoryWorkbenchQuery,
  type ReorderStoryChaptersInput,
} from './dto';
import {
  storyboardClipSnapshotEntry,
  storyVideoSnapshotHash,
} from './story-video-production.schema';
import {
  StoryPermissionService,
  type StoryCapability as PermissionCapability,
} from './story-permission.service';
import { StoryProjectWriteGuardService } from './story-project-write-guard.service';
import { reconcileStoryTimelinesWithDraft } from './story-timeline-reconcile';

const PROJECT_NOT_FOUND = {
  code: 'STORY_PROJECT_NOT_FOUND',
  message: 'Story project not found.',
} as const;

/** Media a story can hold as a candidate. Typed wide so `includes` accepts any kind. */
const CANDIDATE_ASSET_KINDS: MediaAssetKind[] = [
  MediaAssetKind.image,
  MediaAssetKind.video,
  MediaAssetKind.audio,
];

const PROJECT_SUMMARY_INCLUDE = Prisma.validator<Prisma.StoryProjectInclude>()({
  cover: {
    include: {
      placements: true,
      variants: { include: { placements: true } },
    },
  },
  draft: true,
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
  storyboardSequences: {
    where: { status: { not: StoryProductionSpecStatus.archived } },
    select: {
      plotNodeId: true,
      clips: {
        where: { status: { not: StoryProductionSpecStatus.archived } },
        select: { selectedMediaVersionId: true },
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

function storyFrameProfileCanChange(row: ProjectSummaryRow): boolean {
  // The frame is part of setup until production has a concrete dependency on
  // it. Media-less storyboard planning and text-only draft work deliberately
  // do not lock the creator into the project's initial ratio.
  return (
    row.builds.length === 0 &&
    row.storyboardSequences.every((sequence) =>
      sequence.clips.every((clip) => clip.selectedMediaVersionId === null),
    )
  );
}

/**
 * The storyboard rows the workbench snapshot hash needs — the SAME entry
 * shape Build and Working Preview hash, so the publish conflict gate compares
 * hashes computed from one implementation.
 */
const STORY_WORKBENCH_TIMELINE_INCLUDE =
  Prisma.validator<Prisma.StoryStoryboardSequenceInclude>()({
    clips: {
      where: { status: { not: StoryProductionSpecStatus.archived } },
      orderBy: [
        { track: 'asc' as const },
        { startMs: 'asc' as const },
        { rank: 'asc' as const },
      ],
      include: {
        selectedMediaVersion: {
          include: {
            mediaAsset: { select: { variants: true } },
            preferredVariant: true,
          },
        },
      },
    },
  });

type WorkbenchTimelineSequenceRow = Prisma.StoryStoryboardSequenceGetPayload<{
  include: typeof STORY_WORKBENCH_TIMELINE_INCLUDE;
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

const STORY_CANDIDATE_ASSET_INCLUDE =
  Prisma.validator<Prisma.StoryCandidateAssetInclude>()({
    asset: {
      include: {
        placements: true,
        variants: {
          where: {
            variantKey: 'original',
            status: MediaAssetVariantStatus.ready,
            contentType: { startsWith: 'video/' },
            deletedAt: null,
          },
          take: 1,
          include: { placements: true },
          orderBy: [{ variantKey: 'asc' }, { id: 'asc' }],
        },
      },
    },
  });

type StoryCandidateAssetRow = Prisma.StoryCandidateAssetGetPayload<{
  include: typeof STORY_CANDIDATE_ASSET_INCLUDE;
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
    private readonly workspaces: WorkspacesService,
    private readonly writeGuard: StoryProjectWriteGuardService,
  ) {}

  async create(
    user: AuthUser,
    input: CreateStoryProjectInput,
  ): Promise<StoryWorkbenchDto> {
    // Story projects are personal-first product roots. Workspace remains an
    // internal storage/media compatibility domain while legacy tables still
    // require it; the active UI workspace never chooses project ownership or
    // billing. ensurePersonalWorkspace also guarantees the existing personal
    // wallet mapping without moving any balance.
    const personalWorkspace =
      await this.workspaces.ensurePersonalWorkspace(user);
    const workspaceId = personalWorkspace.id;

    const contentHash = canonicalJsonHash(
      EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT,
    );
    const initialCanvasState = encodeDocumentSnapshot(
      {},
      rootSchemaFor(StudioDocumentType.canvas)!,
    );
    const { project, chapter, scriptDocument } = await this.prisma.$transaction(
      async (tx) => {
        const project = await tx.storyProject.create({
          data: {
            workspaceId,
            billingMode: StoryProjectBillingMode.actor,
            // The empty canvas needs a projection shape before the Agent intake
            // runs. This value is provisional: the creator's Q1 answer replaces
            // it atomically with duration + visual direction before authoring.
            frameProfile: StoryFrameProfile.landscape_16_9,
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
            writeState: { create: {} },
          },
        });
        const studioDocument = await tx.studioDocument.create({
          data: {
            workspaceId,
            storyProjectId: project.id,
            type: StudioDocumentType.canvas,
            title: project.title,
            contentSnapshot: {
              ...(initialCanvasState.snapshot as Prisma.InputJsonObject),
            },
            crdtState: Buffer.from(initialCanvasState.state),
            createdById: user.userId,
          },
        });
        const studioDocumentVersion = await tx.studioDocumentVersion.create({
          data: {
            documentId: studioDocument.id,
            versionNumber: 1,
            schemaVersion: studioDocument.schemaVersion,
            sequence: 0,
            title: studioDocument.title,
            source: StudioDocumentVersionSource.system,
            snapshot: studioDocument.contentSnapshot as Prisma.InputJsonValue,
            crdtState: studioDocument.crdtState,
            metadata: { reason: 'initial_story_canvas' },
            createdById: user.userId,
          },
        });
        await tx.studioDocument.update({
          where: { id: studioDocument.id },
          data: { currentVersionId: studioDocumentVersion.id },
        });
        const chapter = await tx.storyChapter.create({
          data: {
            storyProjectId: project.id,
            title: defaultStoryChapterTitle(input.defaultLocale, 1),
            rank: 0,
            nodeIds: [],
            entryNodeId: null,
            createdByUserId: user.userId,
          },
        });
        const { document: scriptDocument } =
          await ensureStoryScriptDocumentInTransaction(tx, {
            workspaceId,
            storyProjectId: project.id,
            storyChapterId: chapter.id,
            actorUserId: user.userId,
          });
        await tx.storyCanvasLayout.create({
          data: {
            storyChapterId: chapter.id,
            storyProjectId: project.id,
            workspaceId,
            schemaVersion: STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
            nodePositions: {},
            updatedByUserId: user.userId,
          },
        });
        return {
          project: await this.loadProjectSummary(project.id, tx),
          chapter,
          scriptDocument,
        };
      },
    );

    if (!project.draft) {
      throw new InternalServerErrorException({
        code: 'STORY_DRAFT_CREATE_FAILED',
        message: 'The story project was created without its draft.',
      });
    }

    return {
      project: this.toProjectSummary(project, user.userId),
      chapters: [this.toChapter(chapter)],
      chapter: this.toChapter(chapter),
      draft: this.toChapterDraft(project.draft, project, chapter),
      script: {
        documentId: scriptDocument.id,
        currentSequence: 0,
        sourceVersionId: null,
        sourceSequence: null,
        status: 'missing',
      },
      video: {
        snapshotHash: storyVideoSnapshotHash([]),
      },
      references: [],
      latestBuild: null,
    };
  }

  async list(
    user: AuthUser,
    query: StoryProjectListQuery,
  ): Promise<CursorPageDto<StoryProjectSummaryDto>> {
    const cursor = query.cursor
      ? decodeCursor<ProjectCursor>(query.cursor, isProjectCursor)
      : null;
    const rows = await this.prisma.storyProject.findMany({
      where: {
        status: query.status,
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
    projectId: string,
  ): Promise<StoryProjectSummaryDto> {
    await this.requireProject(user, projectId, 'story.read', {
      allowArchived: true,
    });
    const row = await this.loadProjectSummary(projectId);
    return this.toProjectSummary(row, user.userId);
  }

  async patch(
    user: AuthUser,
    projectId: string,
    input: PatchStoryProjectInput,
  ): Promise<StoryProjectSummaryDto> {
    await this.requireProject(user, projectId, 'story.edit');

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.writeGuard.assertHumanWriteAllowed(tx, projectId);
      const visualStyleSkill = input.confirmCreativeProfile
        ? storyVisualStyleSkillBySlug(input.visualStyle ?? '')
        : undefined;
      if (input.confirmCreativeProfile) {
        if (!visualStyleSkill) {
          throw new UnprocessableEntityException({
            code: 'STORY_VISUAL_STYLE_SKILL_INVALID',
            message: 'Select a published Story visual-style Skill.',
          });
        }
        const published = await tx.skillCatalogItem.findFirst({
          where: {
            id: visualStyleSkill.skillId,
            slug: visualStyleSkill.slug,
            category: 'style',
            status: SkillCatalogStatus.published,
            latestPublishedVersionId: visualStyleSkill.versionId,
          },
          select: { id: true },
        });
        if (!published) {
          throw new UnprocessableEntityException({
            code: 'STORY_VISUAL_STYLE_SKILL_UNAVAILABLE',
            message:
              'The selected Story visual-style Skill is not published in this deployment.',
            visualStyle: visualStyleSkill.slug,
          });
        }
      }
      if (input.confirmCreativeProfile && input.frameProfile !== undefined) {
        const current = await this.loadProjectSummary(projectId, tx);
        if (
          current.version === input.expectedProjectVersion &&
          input.frameProfile !== current.frameProfile &&
          !storyFrameProfileCanChange(current)
        ) {
          throw new ConflictException({
            code: 'STORY_FRAME_PROFILE_LOCKED',
            message:
              'The aspect ratio can change only before a video is selected or a build is created for this project.',
            projectId,
            frameProfile: current.frameProfile,
          });
        }
      }
      if (input.coverAssetId !== undefined && input.coverAssetId !== null) {
        // A cover must be a STILL. Every place a cover is consumed needs one: the
        // player paints it as the pre-playback backdrop from an image asset, the
        // catalogue tile renders it through next/image, and it is the play page's
        // og:image. A video could only ever have appeared on the studio's own
        // library card, so accepting one meant a creator could set a cover that
        // no player and no catalogue would ever show.
        // No workspaceId here either — same reasoning as addCandidateAsset: the
        // caller's right to edit this project is already settled, and uploads
        // carry no workspace, so scoping by it only blocked legitimate covers.
        const cover = await tx.mediaAsset.findFirst({
          where: {
            id: input.coverAssetId,
            status: MediaAssetStatus.ready,
            moderationStatus: {
              not: MediaAssetModerationStatus.blocked,
            },
            deletedAt: null,
            kind: MediaAssetKind.image,
          },
          select: { id: true },
        });
        if (!cover) {
          throw new UnprocessableEntityException({
            code: 'STORY_PROJECT_COVER_INVALID',
            message:
              'A project cover must be a ready image asset in this project workspace.',
          });
        }
      }
      return tx.storyProject.updateMany({
        where: {
          id: projectId,
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
          ...(input.confirmCreativeProfile
            ? {
                frameProfile: input.frameProfile,
                durationPreset: input.durationPreset,
                visualStyle: input.visualStyle,
                visualStyleSkillId: visualStyleSkill?.skillId,
                visualStyleSkillVersionId: visualStyleSkill?.versionId,
                creativeProfileConfirmedAt: new Date(),
              }
            : {}),
          version: { increment: 1 },
        },
      });
    });
    if (updated.count !== 1) {
      await this.throwProjectVersionConflict(
        projectId,
        input.expectedProjectVersion,
      );
    }

    const row = await this.loadProjectSummary(projectId);
    return this.toProjectSummary(row, user.userId);
  }

  async archive(
    user: AuthUser,
    projectId: string,
    input: ArchiveStoryProjectInput,
  ): Promise<StoryProjectSummaryDto> {
    await this.requireProject(user, projectId, 'story.admin');
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.writeGuard.assertHumanWriteAllowed(tx, projectId);
      return tx.storyProject.updateMany({
        where: {
          id: projectId,
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
        projectId,
        input.expectedProjectVersion,
      );
    }

    const row = await this.loadProjectSummary(projectId);
    return this.toProjectSummary(row, user.userId);
  }

  async createChapter(
    user: AuthUser,
    projectId: string,
    input: CreateStoryChapterInput,
  ): Promise<StoryChapterDto> {
    const access = await this.requireProject(user, projectId, 'story.edit');
    const workspaceId = access.project.workspaceId;
    const chapter = await this.prisma.$transaction(async (tx) => {
      await this.writeGuard.assertHumanWriteAllowed(tx, projectId);
      const [count, latest] = await Promise.all([
        tx.storyChapter.count({
          where: { storyProjectId: projectId, archivedAt: null },
        }),
        tx.storyChapter.aggregate({
          where: { storyProjectId: projectId },
          _max: { rank: true },
        }),
      ]);
      if (count >= STORY_CHAPTER_COUNT_MAX) {
        throw new BadRequestException({
          code: 'STORY_CHAPTER_LIMIT_REACHED',
          message: `A story project supports at most ${STORY_CHAPTER_COUNT_MAX} chapters.`,
        });
      }
      const rank = (latest._max.rank ?? -1) + 1;
      const created = await tx.storyChapter.create({
        data: {
          storyProjectId: projectId,
          title: input.title,
          rank,
          nodeIds: [],
          entryNodeId: null,
          createdByUserId: user.userId,
        },
      });
      await ensureStoryScriptDocumentInTransaction(tx, {
        workspaceId,
        storyProjectId: projectId,
        storyChapterId: created.id,
        actorUserId: user.userId,
      });
      await Promise.all([
        tx.storyCanvasLayout.create({
          data: {
            storyChapterId: created.id,
            storyProjectId: projectId,
            workspaceId,
            schemaVersion: STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
            nodePositions: {},
            updatedByUserId: user.userId,
          },
        }),
        tx.storyProject.update({
          where: { id: projectId },
          data: { version: { increment: 1 }, updatedAt: new Date() },
        }),
      ]);
      return created;
    });
    return this.toChapter(chapter);
  }

  async patchChapter(
    user: AuthUser,
    projectId: string,
    chapterId: string,
    input: PatchStoryChapterInput,
  ): Promise<StoryChapterDto> {
    await this.requireProject(user, projectId, 'story.edit');
    const chapter = await this.prisma.$transaction(async (tx) => {
      await this.writeGuard.assertHumanWriteAllowed(tx, projectId);
      await this.loadActiveChapter(projectId, chapterId, tx);
      const saved = await tx.storyChapter.update({
        where: { id: chapterId },
        data: { title: input.title },
      });
      await tx.storyProject.update({
        where: { id: projectId },
        data: { version: { increment: 1 }, updatedAt: new Date() },
      });
      return saved;
    });
    return this.toChapter(chapter);
  }

  async reorderChapters(
    user: AuthUser,
    projectId: string,
    input: ReorderStoryChaptersInput,
  ): Promise<StoryChapterDto[]> {
    await this.requireProject(user, projectId, 'story.edit');
    const reordered = await this.prisma.$transaction(async (tx) => {
      await this.writeGuard.assertHumanWriteAllowed(tx, projectId);
      const projectClaim = await tx.storyProject.updateMany({
        where: {
          id: projectId,
          status: StoryProjectStatus.active,
          version: input.expectedProjectVersion,
        },
        data: { version: { increment: 1 }, updatedAt: new Date() },
      });
      if (projectClaim.count !== 1) return null;

      const chapters = await tx.storyChapter.findMany({
        where: { storyProjectId: projectId, archivedAt: null },
        orderBy: [{ rank: 'asc' }, { id: 'asc' }],
      });
      const existingIds = chapters.map((chapter) => chapter.id).sort();
      const requestedIds = [...input.chapterIds].sort();
      if (
        existingIds.length !== requestedIds.length ||
        existingIds.some((id, index) => id !== requestedIds[index])
      ) {
        throw new BadRequestException({
          code: 'STORY_CHAPTER_ORDER_INCOMPLETE',
          message:
            'Chapter order must contain every active chapter exactly once.',
        });
      }

      const rankOffset =
        Math.max(0, ...chapters.map((chapter) => chapter.rank)) +
        chapters.length +
        1;
      await tx.storyChapter.updateMany({
        where: { storyProjectId: projectId, archivedAt: null },
        data: { rank: { increment: rankOffset } },
      });
      await Promise.all(
        input.chapterIds.map((id, rank) =>
          tx.storyChapter.update({
            where: { id },
            data: { rank },
          }),
        ),
      );
      const firstChapter = chapters.find(
        (chapter) => chapter.id === input.chapterIds[0],
      );
      const draft = await tx.storyDraft.findUnique({
        where: { storyProjectId: projectId },
      });
      if (draft && firstChapter) {
        const content = parseDraftContent(draft.content, 'STORY_DRAFT_CORRUPT');
        if (content.graph.entryNodeId !== firstChapter.entryNodeId) {
          const reorderedContent = {
            ...content,
            graph: { ...content.graph, entryNodeId: firstChapter.entryNodeId },
          };
          await tx.storyDraft.update({
            where: { storyProjectId: projectId },
            data: {
              content: reorderedContent as Prisma.InputJsonObject,
              contentHash: canonicalJsonHash(reorderedContent),
              revision: { increment: 1 },
              updatedByUserId: user.userId,
            },
          });
        }
      }
      return tx.storyChapter.findMany({
        where: { storyProjectId: projectId, archivedAt: null },
        orderBy: [{ rank: 'asc' }, { id: 'asc' }],
      });
    });
    if (!reordered) {
      return this.throwProjectVersionConflict(
        projectId,
        input.expectedProjectVersion,
      );
    }
    return reordered.map((chapter) => this.toChapter(chapter));
  }

  async archiveChapter(
    user: AuthUser,
    projectId: string,
    chapterId: string,
  ): Promise<StoryChapterDto> {
    await this.requireProject(user, projectId, 'story.edit');
    const archived = await this.prisma.$transaction(async (tx) => {
      await this.writeGuard.assertHumanWriteAllowed(tx, projectId);
      const chapters = await tx.storyChapter.findMany({
        where: { storyProjectId: projectId, archivedAt: null },
        orderBy: [{ rank: 'asc' }, { id: 'asc' }],
      });
      const chapter = chapters.find((candidate) => candidate.id === chapterId);
      if (!chapter) throwChapterNotFound();
      if (chapters.length === 1) {
        throw new BadRequestException({
          code: 'STORY_CHAPTER_LAST_ACTIVE',
          message: 'A story project must keep at least one active chapter.',
        });
      }
      if (stringArray(chapter.nodeIds).length > 0) {
        throw new BadRequestException({
          code: 'STORY_CHAPTER_NOT_EMPTY',
          message: 'Move or delete every scene before archiving this chapter.',
        });
      }
      const result = await tx.storyChapter.update({
        where: { id: chapterId },
        data: { archivedAt: new Date() },
      });
      if (chapters[0]?.id === chapterId) {
        const nextFirstChapter = chapters.find(
          (candidate) => candidate.id !== chapterId,
        );
        const draft = await tx.storyDraft.findUnique({
          where: { storyProjectId: projectId },
        });
        if (draft && nextFirstChapter) {
          const content = parseDraftContent(
            draft.content,
            'STORY_DRAFT_CORRUPT',
          );
          if (content.graph.entryNodeId !== nextFirstChapter.entryNodeId) {
            const nextContent = {
              ...content,
              graph: {
                ...content.graph,
                entryNodeId: nextFirstChapter.entryNodeId,
              },
            };
            await tx.storyDraft.update({
              where: { storyProjectId: projectId },
              data: {
                content: nextContent as Prisma.InputJsonObject,
                contentHash: canonicalJsonHash(nextContent),
                revision: { increment: 1 },
                updatedByUserId: user.userId,
              },
            });
          }
        }
      }
      await tx.storyProject.update({
        where: { id: projectId },
        data: { version: { increment: 1 }, updatedAt: new Date() },
      });
      return result;
    });
    return this.toChapter(archived);
  }

  async putDraft(
    user: AuthUser,
    projectId: string,
    input: PutStoryDraftInput,
    chapterId: string,
  ): Promise<StoryDraftDto> {
    const access = await this.requireProject(user, projectId, 'story.edit');
    const saved = await this.prisma.$transaction(async (tx) => {
      await this.writeGuard.assertHumanWriteAllowed(tx, projectId);
      const [current, chapters] = await Promise.all([
        tx.storyDraft.findUnique({ where: { storyProjectId: projectId } }),
        tx.storyChapter.findMany({
          where: { storyProjectId: projectId, archivedAt: null },
          orderBy: [{ rank: 'asc' }, { id: 'asc' }],
        }),
      ]);
      if (!current || current.revision !== input.expectedRevision) return null;
      const chapter = chapters.find((candidate) => candidate.id === chapterId);
      if (!chapter) throwChapterNotFound();

      const currentActualHash = canonicalJsonHash(current.content);
      if (currentActualHash !== current.contentHash) {
        throw new ConflictException({
          code: 'DRAFT_INTEGRITY_ERROR',
          message: 'The stored draft content does not match its hash.',
          expectedHash: current.contentHash,
          actualHash: currentActualHash,
        });
      }
      const currentContent = parseDraftContent(
        current.content,
        'STORY_DRAFT_CORRUPT',
      );
      assertActiveChapterGraphPartition(currentContent, chapters);
      const previousChapterNodeIds = new Set(stringArray(chapter.nodeIds));
      const nextChapterNodeIds = input.content.graph.nodes.map(
        (node) => node.nodeId,
      );
      const otherChapterNodeIds = new Set(
        chapters.flatMap((candidate) =>
          candidate.id === chapter.id ? [] : stringArray(candidate.nodeIds),
        ),
      );
      const collision = nextChapterNodeIds.find((nodeId) =>
        otherChapterNodeIds.has(nodeId),
      );
      if (collision) {
        throw new BadRequestException({
          code: 'STORY_CHAPTER_NODE_OWNERSHIP_CONFLICT',
          message: `Scene ${collision} already belongs to another chapter.`,
          nodeId: collision,
        });
      }

      const mergedContent = InteractiveStoryDraftContentSchema.parse({
        storyBible: input.content.storyBible,
        graph: {
          entryNodeId:
            chapters[0]?.id === chapter.id
              ? input.content.graph.entryNodeId
              : currentContent.graph.entryNodeId,
          nodes: [
            ...currentContent.graph.nodes.filter(
              (node) => !previousChapterNodeIds.has(node.nodeId),
            ),
            ...input.content.graph.nodes,
          ],
        },
        productionNotes: input.content.productionNotes,
      });
      const contentHash = canonicalJsonHash(mergedContent);
      const membershipUnchanged = arraysEqual(
        stringArray(chapter.nodeIds),
        nextChapterNodeIds,
      );
      // Autosave, navigation flush and retry may legitimately converge on the
      // same canonical payload. Treat that as an idempotent read of the saved
      // head: revisions represent content changes, not transport attempts.
      if (
        current.schemaVersion === input.schemaVersion &&
        current.contentHash === contentHash &&
        membershipUnchanged &&
        chapter.entryNodeId === input.content.graph.entryNodeId
      ) {
        return { draft: current, chapter };
      }

      const claimed = await tx.storyDraft.updateMany({
        where: {
          storyProjectId: projectId,
          revision: input.expectedRevision,
        },
        data: {
          schemaVersion: input.schemaVersion,
          content: mergedContent as Prisma.InputJsonObject,
          contentHash,
          revision: { increment: 1 },
          updatedByUserId: user.userId,
          updatedBySessionId: input.sessionId,
        },
      });
      if (claimed.count !== 1) return null;

      // The database Plot-node guard reads both the canonical draft and the
      // chapter membership. Update the membership before materializing a new
      // empty timeline; the transaction still rolls both writes back together.
      await tx.storyChapter.update({
        where: { id: chapter.id },
        data: {
          nodeIds: nextChapterNodeIds,
          entryNodeId: input.content.graph.entryNodeId,
        },
      });

      // Plot tree and storyboard stay 1:1 on save: deleted nodes archive
      // their sequences immediately, undone deletions revive them.
      await reconcileStoryTimelinesWithDraft(
        tx,
        projectId,
        mergedContent as {
          graph: { nodes: Array<{ kind: string; nodeId: string }> };
        },
        {
          storyChapterId: chapter.id,
          chapterNodeIds: nextChapterNodeIds,
          actorUserId: user.userId,
        },
      );

      await tx.storyProject.update({
        where: { id: projectId },
        data: { updatedAt: new Date() },
      });
      const [draft, savedChapter] = await Promise.all([
        tx.storyDraft.findUnique({ where: { storyProjectId: projectId } }),
        tx.storyChapter.findUnique({ where: { id: chapter.id } }),
      ]);
      return draft && savedChapter ? { draft, chapter: savedChapter } : null;
    });

    if (!saved) {
      return this.throwDraftConflict(
        projectId,
        input.expectedRevision,
        chapterId,
      );
    }
    return this.toChapterDraft(saved.draft, access.project, saved.chapter);
  }

  async getCanvasLayout(
    user: AuthUser,
    projectId: string,
    chapterId: string,
  ): Promise<StoryCanvasLayoutDto> {
    await this.requireProject(user, projectId, 'story.read', {
      allowArchived: true,
    });
    const chapter = await this.loadActiveChapter(projectId, chapterId);
    const layout = await this.prisma.storyCanvasLayout.findUnique({
      where: { storyChapterId: chapter.id },
    });
    if (!layout) throwCanvasLayoutNotFound();
    return this.toCanvasLayout(layout);
  }

  async putCanvasLayout(
    user: AuthUser,
    projectId: string,
    input: PutStoryCanvasLayoutInput,
    chapterId: string,
  ): Promise<StoryCanvasLayoutDto> {
    await this.requireProject(user, projectId, 'story.edit');
    const chapter = await this.loadActiveChapter(projectId, chapterId);

    const layout = await this.prisma.$transaction(async (tx) => {
      await this.writeGuard.assertHumanWriteAllowed(tx, projectId);
      const claimed = await tx.storyCanvasLayout.updateMany({
        where: {
          storyChapterId: chapter.id,
          storyProjectId: projectId,
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
        where: { storyChapterId: chapter.id },
      });
    });
    if (!layout) {
      return this.throwCanvasLayoutConflict(
        projectId,
        chapter.id,
        input.expectedRevision,
      );
    }
    return this.toCanvasLayout(layout);
  }

  async listCandidateAssets(
    user: AuthUser,
    projectId: string,
  ): Promise<StoryCandidateAssetDto[]> {
    await this.requireProject(user, projectId, 'story.read', {
      allowArchived: true,
    });
    const rows = await this.prisma.storyCandidateAsset.findMany({
      where: {
        storyProjectId: projectId,
        asset: {
          is: {
            status: MediaAssetStatus.ready,
            moderationStatus: { not: MediaAssetModerationStatus.blocked },
            deletedAt: null,
            kind: {
              in: [
                MediaAssetKind.image,
                MediaAssetKind.video,
                MediaAssetKind.audio,
              ],
            },
          },
        },
      },
      include: STORY_CANDIDATE_ASSET_INCLUDE,
      orderBy: [{ addedAt: 'desc' }, { mediaAssetId: 'desc' }],
    });
    return rows.map(toCandidateAsset);
  }

  async addCandidateAsset(
    user: AuthUser,
    projectId: string,
    mediaAssetId: string,
  ): Promise<StoryCandidateAssetDto> {
    await this.requireProject(user, projectId, 'story.edit');

    const candidate = await this.prisma.$transaction(async (tx) => {
      await this.writeGuard.assertHumanWriteAllowed(tx, projectId);
      // Deliberately NOT scoped by workspaceId. The id can only reach here from
      // the project's own canvas, and `requireProject` above already
      // decided whether the caller may edit that project — re-checking the
      // asset's workspace is a second lock on a door that is already shut.
      //
      // What it did instead was break real work: uploads never recorded a
      // workspace (the client omits `x-fizz-workspace-id`, so the server stores
      // null), which equality can never match, so 4,210 uploaded assets could
      // not be used as candidates and the creator was told their media "must be
      // ready" — a message about a condition that was already satisfied.
      //
      // Recording the workspace on upload is worth fixing on its own terms; it
      // is not a reason to keep this check.
      const asset = await tx.mediaAsset.findUnique({
        where: { id: mediaAssetId },
        select: {
          id: true,
          kind: true,
          status: true,
          moderationStatus: true,
          deletedAt: true,
        },
      });
      // One reason per rejection. These used to be a single `findFirst` whose
      // miss said "must be a ready … asset", which reads as "wait for the
      // upload" no matter which condition actually failed.
      const invalid = (message: string): never => {
        throw new UnprocessableEntityException({
          code: 'STORY_CANDIDATE_ASSET_INVALID',
          message,
        });
      };
      if (!asset || asset.deletedAt) {
        invalid('That media no longer exists.');
      } else if (!CANDIDATE_ASSET_KINDS.includes(asset.kind)) {
        invalid(
          `Candidate media must be an image, video, or audio file — this one is ${asset.kind}.`,
        );
      } else if (asset.status !== MediaAssetStatus.ready) {
        invalid(
          `That media is still ${asset.status}. Wait for it to finish, then add it again.`,
        );
      } else if (
        asset.moderationStatus === MediaAssetModerationStatus.blocked
      ) {
        invalid('That media was blocked by moderation and cannot be used.');
      }
      await tx.storyCandidateAsset.upsert({
        where: {
          storyProjectId_mediaAssetId: {
            storyProjectId: projectId,
            mediaAssetId,
          },
        },
        create: {
          storyProjectId: projectId,
          mediaAssetId,
          addedByUserId: user.userId,
        },
        update: {},
      });
      await tx.storyProject.update({
        where: { id: projectId },
        data: { updatedAt: new Date() },
      });
      return tx.storyCandidateAsset.findUniqueOrThrow({
        where: {
          storyProjectId_mediaAssetId: {
            storyProjectId: projectId,
            mediaAssetId,
          },
        },
        include: STORY_CANDIDATE_ASSET_INCLUDE,
      });
    });

    return toCandidateAsset(candidate);
  }

  async removeCandidateAsset(
    user: AuthUser,
    projectId: string,
    mediaAssetId: string,
  ): Promise<{ mediaAssetId: string }> {
    await this.requireProject(user, projectId, 'story.edit');
    await this.prisma.$transaction(async (tx) => {
      await this.writeGuard.assertHumanWriteAllowed(tx, projectId);
      await tx.storyCandidateAsset.deleteMany({
        where: { storyProjectId: projectId, mediaAssetId },
      });
      await tx.storyProject.update({
        where: { id: projectId },
        data: { updatedAt: new Date() },
      });
    });
    return { mediaAssetId };
  }

  async listRevisions(
    user: AuthUser,
    projectId: string,
    query: StoryRevisionListQuery,
  ): Promise<CursorPageDto<StoryRevisionSummaryDto>> {
    await this.requireProject(user, projectId, 'story.read', {
      allowArchived: true,
    });
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
    projectId: string,
    revisionId: string,
  ): Promise<StoryRevisionDto> {
    await this.requireProject(user, projectId, 'story.read', {
      allowArchived: true,
    });
    const revision = await this.prisma.storyRevision.findFirst({
      where: { id: revisionId, storyProjectId: projectId },
    });
    if (!revision) throwRevisionNotFound();
    return this.toRevision(revision);
  }

  async lockRevision(
    user: AuthUser,
    projectId: string,
    input: LockStoryRevisionInput,
  ): Promise<StoryRevisionDto> {
    const access = await this.requireProject(user, projectId, 'story.edit');

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await this.prisma.$transaction(
          async (tx) => {
            await this.writeGuard.assertHumanWriteAllowed(tx, projectId);
            const [draft, chapters] = await Promise.all([
              tx.storyDraft.findUnique({
                where: { storyProjectId: projectId },
              }),
              tx.storyChapter.findMany({
                where: {
                  storyProjectId: projectId,
                  archivedAt: null,
                },
                orderBy: [{ rank: 'asc' }, { id: 'asc' }],
              }),
            ]);
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

            const canonicalContent = parseDraftContent(
              draft.content,
              'STORY_DRAFT_CORRUPT',
            );
            assertActiveChapterGraphPartition(canonicalContent, chapters);

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
          throwDraftConflict(input.expectedDraftRevision, result.draft);
        }
        return this.toRevision(result.revision);
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
    projectId: string,
    query: StoryWorkbenchQuery,
  ): Promise<StoryWorkbenchDto> {
    await this.requireProject(user, projectId, 'story.read', {
      allowArchived: true,
    });

    const {
      project,
      chapters,
      chapter,
      draft,
      script,
      video,
      references,
      latestBuild,
    } = await this.prisma.$transaction(
      async (tx) => {
        const [project, chapters, sequences, references, latestBuild] =
          await Promise.all([
            this.loadProjectSummary(projectId, tx),
            tx.storyChapter.findMany({
              where: {
                storyProjectId: projectId,
                archivedAt: null,
              },
              orderBy: [{ rank: 'asc' }, { id: 'asc' }],
            }),
            tx.storyStoryboardSequence.findMany({
              where: {
                storyProjectId: projectId,
                status: { not: StoryProductionSpecStatus.archived },
              },
              include: STORY_WORKBENCH_TIMELINE_INCLUDE,
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
        const draft = project.draft;
        if (!draft) throwDraftNotFound();
        const chapter = query.chapterId
          ? chapters.find((candidate) => candidate.id === query.chapterId)
          : chapters[0];
        if (!chapter) throwChapterNotFound();
        const scriptDocument = await tx.studioDocument.findFirst({
          where: {
            storyProjectId: projectId,
            storyChapterId: chapter.id,
            type: StudioDocumentType.script,
            status: StudioDocumentStatus.active,
            deletedAt: null,
          },
          orderBy: { createdAt: 'asc' },
          select: { id: true, currentSequence: true },
        });
        if (draft.schemaVersion !== INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION) {
          throw unsupportedStorySchema('draft', draft.schemaVersion);
        }
        const projectContent = parseDraftContent(
          draft.content,
          'STORY_DRAFT_CORRUPT',
        );
        assertActiveChapterGraphPartition(projectContent, chapters);
        return {
          project,
          chapters,
          chapter,
          draft,
          script: storyScriptFreshness(chapter, scriptDocument),
          video: projectStoryVideoWorkbench(projectContent, sequences),
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
      chapters: chapters.map((item) => this.toChapter(item)),
      chapter: this.toChapter(chapter),
      draft: this.toChapterDraft(draft, project, chapter),
      script,
      video,
      references,
      latestBuild,
    };
  }

  private async requireProject(
    user: AuthUser,
    projectId: string,
    capability: PermissionCapability,
    options: { allowArchived?: boolean } = {},
  ) {
    return this.permissions.requireProject(
      user.userId,
      projectId,
      capability,
      options,
    );
  }

  private async loadActiveChapter(
    projectId: string,
    chapterId: string,
    client: Pick<Prisma.TransactionClient, 'storyChapter'> = this.prisma,
  ) {
    const chapter = await client.storyChapter.findFirst({
      where: {
        id: chapterId,
        storyProjectId: projectId,
        archivedAt: null,
      },
    });
    if (!chapter) throwChapterNotFound();
    return chapter;
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
    projectId: string,
    expectedVersion: number,
  ): Promise<never> {
    const current = await this.prisma.storyProject.findUnique({
      where: { id: projectId },
      select: { status: true, version: true },
    });
    if (!current || current.status !== StoryProjectStatus.active) {
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
    chapterId: string,
  ): Promise<never> {
    const [current, chapter] = await Promise.all([
      this.prisma.storyDraft.findUnique({
        where: { storyProjectId: projectId },
      }),
      this.loadActiveChapter(projectId, chapterId),
    ]);
    if (!current) throwDraftNotFound();
    throw new ConflictException({
      code: 'DRAFT_REVISION_CONFLICT',
      message: 'The story draft changed. Refresh it before saving again.',
      expectedRevision,
      actualRevision: current.revision,
      current: this.toChapterDraft(current, { id: projectId }, chapter),
    });
  }

  private async throwCanvasLayoutConflict(
    projectId: string,
    chapterId: string,
    expectedRevision: number,
  ): Promise<never> {
    const current = await this.prisma.storyCanvasLayout.findUnique({
      where: { storyChapterId: chapterId },
    });
    if (!current || current.storyProjectId !== projectId) {
      throwCanvasLayoutNotFound();
    }
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
    const liveSequences = row.storyboardSequences.filter((sequence) =>
      currentClipNodeIds.has(sequence.plotNodeId),
    );
    const approvedReferenceCount = row.referenceSlots.filter(
      (slot) => slot.approvedVersionId !== null,
    ).length;
    // A scene counts as "has footage" once every storyboard clip on its
    // timeline carries selected media — the release-readiness definition.
    const currentVideoCount = liveSequences.filter(
      (sequence) =>
        sequence.clips.length > 0 &&
        sequence.clips.every((clip) => clip.selectedMediaVersionId !== null),
    ).length;
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      frameProfile: row.frameProfile,
      frameProfileMutable: storyFrameProfileCanChange(row),
      durationPreset: row.durationPreset,
      visualStyle: StoryVisualStyleSchema.safeParse(row.visualStyle).success
        ? StoryVisualStyleSchema.parse(row.visualStyle)
        : null,
      creativeProfileConfirmedAt:
        row.creativeProfileConfirmedAt?.toISOString() ?? null,
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

  private toChapter(row: {
    id: string;
    storyProjectId: string;
    title: string;
    rank: number;
    nodeIds: Prisma.JsonValue;
    entryNodeId: string | null;
    createdByUserId: string;
    createdAt: Date;
    updatedAt: Date;
  }): StoryChapterDto {
    return {
      id: row.id,
      projectId: row.storyProjectId,
      title: row.title,
      rank: row.rank,
      entryNodeId: row.entryNodeId,
      nodeCount: stringArray(row.nodeIds).length,
      createdByUserId: row.createdByUserId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toChapterDraft(
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
    project: { id: string },
    chapter: {
      id: string;
      nodeIds: Prisma.JsonValue;
      entryNodeId: string | null;
    },
  ): StoryDraftDto {
    if (row.schemaVersion !== INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION) {
      throw unsupportedStorySchema('draft', row.schemaVersion);
    }
    const projectContent = parseDraftContent(
      row.content,
      'STORY_DRAFT_CORRUPT',
    );
    const chapterNodeIds = new Set(stringArray(chapter.nodeIds));
    const content = {
      ...projectContent,
      graph: {
        entryNodeId: chapter.entryNodeId,
        nodes: projectContent.graph.nodes.filter((node) =>
          chapterNodeIds.has(node.nodeId),
        ),
      },
    };
    return {
      projectId: row.storyProjectId,
      chapterId: chapter.id,
      schemaVersion: INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
      content,
      contentHash: canonicalJsonHash(content),
      revision: row.revision,
      updatedByUserId: row.updatedByUserId,
      updatedBySessionId: row.updatedBySessionId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toCanvasLayout(row: {
    storyChapterId: string;
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
      chapterId: row.storyChapterId,
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
    if (row.schemaVersion !== INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION) {
      throw unsupportedStorySchema('revision', row.schemaVersion);
    }
    return {
      ...this.toRevisionSummary(row),
      projectId: row.storyProjectId,
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

function throwChapterNotFound(): never {
  throw new NotFoundException({
    code: 'STORY_CHAPTER_NOT_FOUND',
    message: 'Story chapter not found.',
  });
}

function defaultStoryChapterTitle(locale: string, chapterNumber: number) {
  return locale.trim().toLowerCase().startsWith('zh')
    ? `第 ${chapterNumber} 章`
    : `Chapter ${chapterNumber}`;
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
): never {
  if (current.schemaVersion !== INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION) {
    throw unsupportedStorySchema('draft', current.schemaVersion);
  }
  const content = parseDraftContent(current.content, 'STORY_DRAFT_CORRUPT');
  const dto: StoryDraftDto = {
    projectId: current.storyProjectId,
    chapterId: null,
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

function arraysEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
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

function toCandidateAsset(row: StoryCandidateAssetRow): StoryCandidateAssetDto {
  const videoVariant =
    row.asset.kind === MediaAssetKind.video
      ? (row.asset.variants.find(isReusableCandidateVideoVariant) ?? null)
      : null;
  return {
    asset: toMediaAsset(row.asset),
    videoVariant: videoVariant
      ? {
          id: videoVariant.id,
          variantKey: videoVariant.variantKey,
          contentType: videoVariant.contentType,
          width: videoVariant.width,
          height: videoVariant.height,
          durationSeconds:
            videoVariant.durationSeconds ??
            (videoVariant.durationMs
              ? Math.max(1, Math.ceil(videoVariant.durationMs / 1_000))
              : null),
          checksumSha256: videoVariant.checksumSha256,
        }
      : null,
    addedByUserId: row.addedByUserId,
    addedAt: row.addedAt.toISOString(),
  };
}

function isReusableCandidateVideoVariant(
  variant: StoryCandidateAssetRow['asset']['variants'][number],
): boolean {
  return (
    variant.variantKey === 'original' &&
    variant.status === MediaAssetVariantStatus.ready &&
    variant.deletedAt === null &&
    variant.contentType.toLowerCase().startsWith('video/')
  );
}

function projectStoryVideoWorkbench(
  draft: ReturnType<typeof parseDraftContent>,
  sequences: WorkbenchTimelineSequenceRow[],
): StoryWorkbenchDto['video'] {
  // Hash over the whole project draft — the exact clip set Build and Working
  // Preview hash — so the publish conflict gate compares like with like.
  const liveNodeIds = new Set(
    draft.graph.nodes.flatMap((node) =>
      node.kind === 'clip' ? [node.nodeId] : [],
    ),
  );
  const entries = sequences
    .filter((sequence) => liveNodeIds.has(sequence.plotNodeId))
    .flatMap((sequence) =>
      sequence.clips.map((clip) => storyboardClipSnapshotEntry(clip)),
    );
  return { snapshotHash: storyVideoSnapshotHash(entries) };
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

function assertActiveChapterGraphPartition(
  content: InteractiveStoryDraftContent,
  chapters: Array<{
    id: string;
    nodeIds: Prisma.JsonValue;
    entryNodeId: string | null;
  }>,
): void {
  const issues: string[] = [];
  const graphNodeIds = new Set(content.graph.nodes.map((node) => node.nodeId));
  const ownerByNodeId = new Map<string, string>();

  if (chapters.length === 0) issues.push('The project has no active chapter.');
  for (const chapter of chapters) {
    const nodeIds = stringArray(chapter.nodeIds);
    if (
      !Array.isArray(chapter.nodeIds) ||
      nodeIds.length !== chapter.nodeIds.length
    ) {
      issues.push(`Chapter ${chapter.id} has invalid scene membership data.`);
    }
    const localNodeIds = new Set<string>();
    for (const nodeId of nodeIds) {
      if (localNodeIds.has(nodeId)) {
        issues.push(
          `Scene ${nodeId} is repeated inside chapter ${chapter.id}.`,
        );
      }
      localNodeIds.add(nodeId);
      const owner = ownerByNodeId.get(nodeId);
      if (owner && owner !== chapter.id) {
        issues.push(
          `Scene ${nodeId} belongs to both ${owner} and ${chapter.id}.`,
        );
      } else {
        ownerByNodeId.set(nodeId, chapter.id);
      }
      if (!graphNodeIds.has(nodeId)) {
        issues.push(`Chapter ${chapter.id} owns missing scene ${nodeId}.`);
      }
    }
    if (
      (nodeIds.length === 0 && chapter.entryNodeId !== null) ||
      (nodeIds.length > 0 &&
        (!chapter.entryNodeId || !localNodeIds.has(chapter.entryNodeId)))
    ) {
      issues.push(`Chapter ${chapter.id} has an invalid entry scene.`);
    }
  }

  for (const nodeId of graphNodeIds) {
    if (!ownerByNodeId.has(nodeId)) {
      issues.push(`Scene ${nodeId} does not belong to an active chapter.`);
    }
  }
  if (chapters[0] && content.graph.entryNodeId !== chapters[0].entryNodeId) {
    issues.push('The project entry scene does not match its first chapter.');
  }
  if (issues.length > 0) {
    throw new ConflictException({
      code: 'STORY_CHAPTER_GRAPH_PARTITION_INVALID',
      message:
        'The story graph and chapter structure are inconsistent. Repair the chapter structure before continuing.',
      issues: issues.slice(0, 50),
    });
  }
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

function storyScriptFreshness(
  chapter: {
    sourceScriptDocumentId: string | null;
    sourceScriptVersionId: string | null;
    sourceScriptSequence: number | null;
  },
  document: { id: string; currentSequence: number } | null,
): StoryWorkbenchDto['script'] {
  if (!document || document.currentSequence === 0) {
    return {
      documentId: document?.id ?? null,
      currentSequence: document?.currentSequence ?? 0,
      sourceVersionId: chapter.sourceScriptVersionId,
      sourceSequence: chapter.sourceScriptSequence,
      status: 'missing',
    };
  }
  if (
    chapter.sourceScriptDocumentId === null ||
    chapter.sourceScriptSequence === null ||
    chapter.sourceScriptVersionId === null
  ) {
    return {
      documentId: document.id,
      currentSequence: document.currentSequence,
      sourceVersionId: null,
      sourceSequence: null,
      status: 'unlinked',
    };
  }
  return {
    documentId: document.id,
    currentSequence: document.currentSequence,
    sourceVersionId: chapter.sourceScriptVersionId,
    sourceSequence: chapter.sourceScriptSequence,
    status:
      chapter.sourceScriptDocumentId === document.id &&
      chapter.sourceScriptSequence === document.currentSequence
        ? 'current'
        : 'stale',
  };
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
