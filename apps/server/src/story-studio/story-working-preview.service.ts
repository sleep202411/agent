import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MediaAssetKind,
  MediaAssetModerationStatus,
  MediaAssetStatus,
  MediaAssetVariantStatus,
  Prisma,
  StoryProductionSpecStatus,
} from '@prisma/client';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import { MediaAssetUrlResolverService } from '../infra/storage/media-asset-url-resolver.service';
import type { StoryBuildScope } from './interactive-film.schema';
import { canonicalJsonHash } from './canonical-json';
import {
  createPlayableInteractiveStoryDraftContentSchema,
  InteractiveStoryDraftContentSchema,
  INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
  type StoryBuildDiagnosticDto,
  type StoryWorkingPreviewDto,
} from './dto';
import {
  compileStoryBuild,
  type FrozenStoryVideoAsset,
  type StoryBuildNodeTimelineInput,
  type StoryBuildSegmentInput,
  type StoryBuildWorldInput,
} from './story-build-compiler';
import { resolveStoryCoverUrl } from './story-cover-media';
import { StoryPermissionService } from './story-permission.service';
import { assertStoryChapterGraphPartition } from './story-chapter-graph-invariant';
import {
  chooseStoryboardClipVariant,
  isBrowserSafeMp4Metadata,
  storyboardClipSnapshotEntry,
  storyVideoSnapshotHash,
  StoryVideoSnapshotEntrySchema,
  type StoryVideoSnapshotEntry,
} from './story-video-production.schema';

/** Twin of the Build's timeline include: storyboard clips + selected media. */
const WORKING_PREVIEW_TIMELINE_INCLUDE =
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
            mediaAsset: {
              include: {
                placements: true,
                variants: { include: { placements: true } },
              },
            },
            preferredVariant: { include: { placements: true } },
          },
        },
      },
    },
  });

type WorkingPreviewSequence = Prisma.StoryStoryboardSequenceGetPayload<{
  include: typeof WORKING_PREVIEW_TIMELINE_INCLUDE;
}>;
type WorkingPreviewClip = WorkingPreviewSequence['clips'][number];

interface PreparedWorkingPreviewTimeline {
  timeline: StoryBuildNodeTimelineInput;
  sources: StoryWorkingPreviewDto['sources'];
  snapshotEntries: StoryVideoSnapshotEntry[];
}

@Injectable()
export class StoryWorkingPreviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: StoryPermissionService,
    private readonly assetUrls: MediaAssetUrlResolverService,
  ) {}

  async getWorkingPreview(
    user: AuthUser,
    projectId: string,
    chapterId?: string,
  ): Promise<StoryWorkingPreviewDto> {
    const access = await this.permissions.requireProject(
      user.userId,
      projectId,
      'story.read',
    );
    return this.prisma.$transaction(
      (tx) =>
        this.compileLatestSavedDraft(tx, access.project, projectId, chapterId),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private async compileLatestSavedDraft(
    tx: Prisma.TransactionClient,
    project: {
      id: string;
      workspaceId: string;
      frameProfile: 'landscape_16_9' | 'portrait_9_16';
      defaultLocale: string;
      title: string;
      summary: string | null;
      coverAssetId: string | null;
    },
    projectId: string,
    chapterId: string | undefined,
  ): Promise<StoryWorkingPreviewDto> {
    const [draft, chapters] = [
      await tx.storyDraft.findUnique({ where: { storyProjectId: projectId } }),
      await tx.storyChapter.findMany({
        where: { storyProjectId: projectId, archivedAt: null },
        orderBy: [{ rank: 'asc' }, { id: 'asc' }],
      }),
    ];
    if (!draft) {
      throw new NotFoundException({
        code: 'STORY_DRAFT_NOT_FOUND',
        message: 'Story draft not found.',
      });
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

    if (draft.schemaVersion !== INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION) {
      return emptyWorkingPreview(
        draft.revision,
        draft.contentHash,
        null,
        previewDiagnostic(
          'error',
          'STORY_WORKING_PREVIEW_DRAFT_SCHEMA_UNSUPPORTED',
          `This saved draft uses unsupported schema ${draft.schemaVersion}; Working Preview requires ${INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION}.`,
          'revision',
          projectId,
        ),
      );
    }

    const draftShape = InteractiveStoryDraftContentSchema.safeParse(
      draft.content,
    );
    if (draftShape.success) {
      assertStoryChapterGraphPartition(draftShape.data, chapters);
    }
    const playableDraft = createPlayableInteractiveStoryDraftContentSchema(
      project.defaultLocale,
      { preserveUnfinishedChoices: true },
    ).safeParse(draft.content);
    if (!playableDraft.success) {
      const emptySnapshotHash = draftShape.success
        ? storyVideoSnapshotHash(
            // The playable parse is what rejects duplicate node ids, so the
            // permissive shape may still carry them; a snapshot may list each
            // node at most once.
            [
              ...new Map(
                draftShape.data.graph.nodes
                  .filter((node) => node.kind === 'clip')
                  .map(
                    (node) =>
                      [
                        node.nodeId,
                        emptyVideoSnapshotEntry(node.nodeId, 0),
                      ] as const,
                  ),
              ).values(),
            ],
          )
        : null;
      return {
        ...emptyWorkingPreview(
          draft.revision,
          draft.contentHash,
          emptySnapshotHash,
        ),
        diagnostics: playableDraft.error.issues.map((issue) =>
          previewDiagnostic(
            'error',
            'STORY_WORKING_PREVIEW_DRAFT_INCOMPLETE',
            `${issue.path.join('.') || 'draft'}: Complete this field before playtesting.`,
            'revision',
            projectId,
          ),
        ),
      };
    }

    const clipNodes = playableDraft.data.graph.nodes.filter(
      (node) => node.kind === 'clip',
    );
    const worldNodes = playableDraft.data.graph.nodes.filter(
      (
        node,
      ): node is Extract<
        (typeof playableDraft.data.graph.nodes)[number],
        { kind: 'world' }
      > => node.kind === 'world' && node.worldId !== null,
    );
    const sequences =
      clipNodes.length === 0
        ? []
        : await tx.storyStoryboardSequence.findMany({
            where: {
              storyProjectId: projectId,
              plotNodeId: { in: clipNodes.map((node) => node.nodeId) },
              status: { not: StoryProductionSpecStatus.archived },
            },
            include: WORKING_PREVIEW_TIMELINE_INCLUDE,
          });
    const sequenceByNodeId = new Map(
      sequences.map((sequence) => [sequence.plotNodeId, sequence]),
    );
    const prepared = clipNodes.map((node) =>
      prepareWorkingPreviewTimeline(
        node.nodeId,
        sequenceByNodeId.get(node.nodeId) ?? null,
        this.assetUrls,
      ),
    );
    const worldRows =
      worldNodes.length === 0
        ? []
        : await tx.worldModelWorld.findMany({
            where: {
              storyProjectId: projectId,
              workspaceId: project.workspaceId,
              id: { in: worldNodes.map((node) => node.worldId as string) },
            },
            select: { id: true, status: true },
          });
    const worldStatusById = new Map(
      worldRows.map((world) => [world.id, world.status]),
    );
    const worlds: StoryBuildWorldInput[] = worldNodes.flatMap((node) => {
      const status = worldStatusById.get(node.worldId as string);
      return status
        ? [
            {
              graphNodeId: node.nodeId,
              worldId: node.worldId as string,
              status,
            },
          ]
        : [];
    });

    const snapshotEntries = prepared.flatMap((item) => item.snapshotEntries);
    const videoSnapshotHash = storyVideoSnapshotHash(snapshotEntries);
    // A chapter owns its own entry scene; the story-level entry belongs to the
    // first chapter only. Preview validates the complete saved projection
    // before compiling a chapter-scoped subgraph.
    const chapter = chapterId
      ? chapters.find((candidate) => candidate.id === chapterId)
      : null;
    if (chapterId && !chapter) {
      throw new NotFoundException({
        code: 'STORY_CHAPTER_NOT_FOUND',
        message: 'The selected Story chapter was not found.',
      });
    }
    const chapterScope: StoryBuildScope | null = chapter?.entryNodeId
      ? { kind: 'subgraph', entryNodeId: chapter.entryNodeId }
      : null;

    const scope: StoryBuildScope = chapterScope ?? { kind: 'full' };
    const metadata = {
      title: project.title,
      summary: project.summary?.trim() || playableDraft.data.storyBible.logline,
    };
    const previewBuildId = workingPreviewBuildId(
      projectId,
      draft.contentHash,
      videoSnapshotHash,
      {
        scope,
        frameProfile: project.frameProfile,
        defaultLocale: project.defaultLocale,
        metadata,
      },
    );
    const coverUrl = await resolveStoryCoverUrl(tx, project.coverAssetId);

    const compiled = compileStoryBuild({
      projectId,
      buildId: previewBuildId,
      sourceDraftRevision: draft.revision,
      channel: 'preview',
      // Previewing a chapter starts at that chapter, not at the story's first
      // scene. Without this a multi-chapter work could only ever be walked from
      // the top, which is why the canvas play-test entry was closed off.
      scope,
      frameProfile: project.frameProfile,
      defaultLocale: project.defaultLocale,
      metadata,
      draft: playableDraft.data,
      timelines: prepared.map((item) => item.timeline),
      worlds,
    });

    return {
      draftRevision: draft.revision,
      contentHash: draft.contentHash,
      videoSnapshotHash,
      runtimeSchemaVersion: 2,
      runtime: compiled.runtime as Record<string, unknown> | null,
      coverUrl,
      diagnostics: compiled.diagnostics,
      pathReport: compiled.pathReport,
      sources: prepared.flatMap((item) =>
        item.sources.filter((source) =>
          compiled.includedGraphNodeIds.includes(source.graphNodeId),
        ),
      ),
    };
  }
}

function prepareWorkingPreviewTimeline(
  graphNodeId: string,
  sequence: WorkingPreviewSequence | null,
  assetUrls: MediaAssetUrlResolverService,
): PreparedWorkingPreviewTimeline {
  if (!sequence) {
    return {
      timeline: { graphNodeId, sequenceId: null, segments: [] },
      sources: [],
      snapshotEntries: [],
    };
  }
  const segments = sequence.clips.map((clip) =>
    prepareWorkingPreviewSegment(graphNodeId, clip, assetUrls),
  );
  return {
    timeline: {
      graphNodeId,
      sequenceId: sequence.id,
      segments: segments.map((item) => item.segment),
    },
    sources: segments.flatMap((item) => (item.source ? [item.source] : [])),
    snapshotEntries: segments.map((item) => item.snapshotEntry),
  };
}

const choosePreviewClipVariant = chooseStoryboardClipVariant;

function prepareWorkingPreviewSegment(
  graphNodeId: string,
  clip: WorkingPreviewClip,
  assetUrls: MediaAssetUrlResolverService,
): {
  segment: StoryBuildSegmentInput;
  source: StoryWorkingPreviewDto['sources'][number] | null;
  snapshotEntry: StoryVideoSnapshotEntry;
} {
  const diagnostics: StoryBuildDiagnosticDto[] = [];
  let asset: FrozenStoryVideoAsset | null = null;
  const media =
    clip.selectedMediaVersion && clip.selectedMediaVersion.archivedAt === null
      ? clip.selectedMediaVersion
      : null;
  const variant = media ? choosePreviewClipVariant(media) : null;
  const label = `Storyboard clip ${clip.stableKey}`;
  const snapshotEntry = previewClipSnapshotEntry(clip);

  if (!media) {
    diagnostics.push(
      previewDiagnostic(
        'warning',
        'STORY_WORKING_PREVIEW_CLIP_MEDIA_MISSING',
        `${label} has no selected media yet; Preview is using an empty shot placeholder.`,
        'clip',
        graphNodeId,
      ),
    );
  } else if (!variant) {
    diagnostics.push(
      previewDiagnostic(
        'warning',
        'STORY_WORKING_PREVIEW_OUTPUT_MISSING',
        `${label} does not resolve to a playable media variant; Preview is using an empty shot placeholder.`,
        'asset',
        media.mediaAssetId,
      ),
    );
  } else {
    const source = media.mediaAsset;
    const expectedKind =
      clip.kind === 'video' ? MediaAssetKind.video : MediaAssetKind.image;
    const expectedPrefix = clip.kind === 'video' ? 'video/' : 'image/';
    const ineligible =
      source.kind !== expectedKind
        ? `is a ${source.kind} asset, not ${clip.kind}`
        : source.deletedAt !== null || variant.deletedAt !== null
          ? 'has been deleted'
          : source.moderationStatus === MediaAssetModerationStatus.blocked
            ? 'was blocked by moderation'
            : source.status !== MediaAssetStatus.ready
              ? `is still ${source.status}`
              : variant.status !== MediaAssetVariantStatus.ready
                ? `has a variant that is still ${variant.status}`
                : null;
    if (ineligible) {
      diagnostics.push(
        previewDiagnostic(
          'warning',
          'STORY_WORKING_PREVIEW_OUTPUT_INELIGIBLE',
          `${label} selected media ${ineligible}; Preview is using an empty shot placeholder.`,
          'asset',
          source.id,
        ),
      );
    } else if (!variant.contentType.toLowerCase().startsWith(expectedPrefix)) {
      diagnostics.push(
        previewDiagnostic(
          'warning',
          'STORY_WORKING_PREVIEW_OUTPUT_CONTENT_TYPE_INVALID',
          `${label} does not resolve to a ${clip.kind} media type; Preview is using an empty shot placeholder.`,
          'asset',
          source.id,
        ),
      );
    } else {
      if (
        clip.kind === 'video' &&
        (!variant.checksumSha256 ||
          variant.durationMs === null ||
          variant.width === null ||
          variant.height === null ||
          !isBrowserSafeMp4Metadata(variant.metadata))
      ) {
        diagnostics.push(
          previewDiagnostic(
            'warning',
            'STORY_WORKING_PREVIEW_OUTPUT_METADATA_INCOMPLETE',
            `${label} has incomplete technical metadata; browser playback remains available.`,
            'asset',
            source.id,
          ),
        );
      }
      let url: string | null = null;
      try {
        url = assetUrls.resolveVariant(source, variant.variantKey);
      } catch {
        // Missing delivery configuration is reported as a Preview diagnostic;
        // it must never escape as a process-level playback failure.
      }
      if (!url) {
        diagnostics.push(
          previewDiagnostic(
            'warning',
            'STORY_WORKING_PREVIEW_OUTPUT_URL_UNAVAILABLE',
            `${label} has no resolvable playback URL; Preview is using an empty shot placeholder.`,
            'asset',
            source.id,
          ),
        );
      } else {
        if (source.moderationStatus !== MediaAssetModerationStatus.approved) {
          diagnostics.push(
            previewDiagnostic(
              'warning',
              'STORY_WORKING_PREVIEW_MODERATION_PENDING',
              `${label} selected media has not completed moderation review.`,
              'asset',
              source.id,
            ),
          );
        }
        asset = {
          assetId: source.id,
          variantId: variant.id,
          checksumSha256: variant.checksumSha256,
          contentType: variant.contentType,
          sizeBytes: variant.sizeBytes,
          width: variant.width,
          height: variant.height,
          durationMs: variant.durationMs,
          browserSafeMp4: isBrowserSafeMp4Metadata(variant.metadata),
          url,
        };
      }
    }
  }

  return {
    segment: {
      clipId: clip.id,
      clipKey: clip.stableKey,
      kind: clip.kind as 'image' | 'video',
      durationMs: clip.durationMs,
      clipVersion: clip.version,
      asset,
      eligibilityDiagnostics: diagnostics,
    },
    source:
      media && variant && asset
        ? {
            graphNodeId,
            assetId: media.mediaAssetId,
            variantId: variant.id,
            selectionVersion: clip.version,
            selection: 'current',
          }
        : null,
    snapshotEntry,
  };
}

const previewClipSnapshotEntry = (
  clip: WorkingPreviewClip,
): StoryVideoSnapshotEntry => storyboardClipSnapshotEntry(clip);

function emptyVideoSnapshotEntry(
  graphNodeId: string,
  selectionVersion: number,
): StoryVideoSnapshotEntry {
  return StoryVideoSnapshotEntrySchema.parse({
    graphNodeId,
    selectionVersion,
    assetId: null,
    variantId: null,
    checksumSha256: null,
    contentType: null,
    durationMs: null,
    width: null,
    height: null,
    browserSafeMp4: null,
  });
}

function workingPreviewBuildId(
  projectId: string,
  draftContentHash: string,
  videoSnapshotHash: string,
  presentation: {
    scope: StoryBuildScope;
    frameProfile: string;
    defaultLocale: string;
    metadata: { title: string; summary: string };
  },
): string {
  // Hosts use this identity to replace the playback session. Scope and project
  // presentation can change independently of the draft and media selections.
  return `preview:${canonicalJsonHash({
    projectId,
    draftContentHash,
    videoSnapshotHash,
    presentation,
  })}`;
}

function emptyWorkingPreview(
  draftRevision: number,
  contentHash: string,
  videoSnapshotHash: string | null,
  diagnostic?: StoryBuildDiagnosticDto,
): StoryWorkingPreviewDto {
  return {
    draftRevision,
    contentHash,
    videoSnapshotHash,
    runtimeSchemaVersion: 2,
    runtime: null,
    coverUrl: null,
    diagnostics: diagnostic ? [diagnostic] : [],
    pathReport: null,
    sources: [],
  };
}

function previewDiagnostic(
  severity: StoryBuildDiagnosticDto['severity'],
  code: string,
  message: string,
  entityType: StoryBuildDiagnosticDto['entityType'],
  entityId: string | null,
): StoryBuildDiagnosticDto {
  return { severity, code, message, entityType, entityId };
}
