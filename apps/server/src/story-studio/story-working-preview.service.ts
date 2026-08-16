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
  type StoryBuildVideoInput,
  type StoryBuildWorldInput,
} from './story-build-compiler';
import { resolveStoryCover } from './story-cover-media';
import { StoryPermissionService } from './story-permission.service';
import {
  StoryVideoSnapshotEntrySchema,
  storyVideoSnapshotHash,
  type StoryVideoSnapshotEntry,
} from './story-video-production.schema';

const WORKING_PREVIEW_SELECTION_INCLUDE =
  Prisma.validator<Prisma.StoryVideoSelectionInclude>()({
    currentAsset: {
      include: {
        placements: true,
        variants: { include: { placements: true } },
      },
    },
    currentVariant: { include: { placements: true } },
  });

type WorkingPreviewSelection = Prisma.StoryVideoSelectionGetPayload<{
  include: typeof WORKING_PREVIEW_SELECTION_INCLUDE;
}>;

interface PreparedWorkingPreviewVideo {
  video: StoryBuildVideoInput;
  source: StoryWorkingPreviewDto['sources'][number] | null;
  snapshotEntry: StoryVideoSnapshotEntry;
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
    workspaceId: string,
    projectId: string,
    chapterId?: string,
  ): Promise<StoryWorkingPreviewDto> {
    const access = await this.permissions.requireProject(
      user.userId,
      projectId,
      'story.read',
    );
    if (access.project.workspaceId !== workspaceId) {
      throw new NotFoundException({
        code: 'STORY_PROJECT_NOT_FOUND',
        message: 'Story project not found.',
      });
    }
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
    const draft = await tx.storyDraft.findUnique({
      where: { storyProjectId: projectId },
    });
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
    const playableDraft = createPlayableInteractiveStoryDraftContentSchema(
      project.defaultLocale,
    ).safeParse(draft.content);
    if (!playableDraft.success) {
      const emptySnapshotHash = draftShape.success
        ? storyVideoSnapshotHash(
            draftShape.data.graph.nodes.flatMap((node) =>
              node.kind === 'clip'
                ? [emptyVideoSnapshotEntry(node.nodeId, 0)]
                : [],
            ),
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
    const selections =
      clipNodes.length === 0
        ? []
        : await tx.storyVideoSelection.findMany({
            where: {
              storyProjectId: projectId,
              graphNodeId: { in: clipNodes.map((node) => node.nodeId) },
            },
            include: WORKING_PREVIEW_SELECTION_INCLUDE,
          });
    const selectionByNodeId = new Map(
      selections.map((selection) => [selection.graphNodeId, selection]),
    );
    const prepared = clipNodes.map((node) =>
      prepareWorkingPreviewVideo(
        node.nodeId,
        selectionByNodeId.get(node.nodeId) ?? null,
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

    const snapshotEntries = prepared.map((item) => item.snapshotEntry);
    const videoSnapshotHash = storyVideoSnapshotHash(snapshotEntries);
    // A chapter owns its own entry scene; the story-level entry belongs to the
    // first chapter only. An unknown or entry-less chapter falls back to the
    // whole story rather than failing a play-test.
    const chapter = chapterId
      ? await tx.storyChapter.findFirst({
          where: { id: chapterId, storyProjectId: projectId },
          select: { entryNodeId: true },
        })
      : null;
    const chapterScope: StoryBuildScope | null = chapter?.entryNodeId
      ? { kind: 'subgraph', entryNodeId: chapter.entryNodeId }
      : null;

    const previewBuildId = workingPreviewBuildId(
      projectId,
      draft.contentHash,
      videoSnapshotHash,
    );

    const compiled = compileStoryBuild({
      projectId,
      buildId: previewBuildId,
      sourceDraftRevision: draft.revision,
      channel: 'preview',
      // Previewing a chapter starts at that chapter, not at the story's first
      // scene. Without this a multi-chapter work could only ever be walked from
      // the top, which is why the canvas play-test entry was closed off.
      scope: chapterScope ?? { kind: 'full' },
      frameProfile: project.frameProfile,
      defaultLocale: project.defaultLocale,
      metadata: {
        title: project.title,
        summary:
          project.summary?.trim() || playableDraft.data.storyBible.logline,
      },
      draft: playableDraft.data,
      videos: prepared.map((item) => item.video),
      worlds,
      // Preview validates and paints the selected cover through ExperiencePlayer.
      cover: await resolveStoryCover(
        tx,
        project.workspaceId,
        project.coverAssetId,
      ),
    });

    return {
      draftRevision: draft.revision,
      contentHash: draft.contentHash,
      videoSnapshotHash,
      runtimeSchemaVersion: 2,
      runtime: compiled.runtime as Record<string, unknown> | null,
      diagnostics: compiled.diagnostics,
      pathReport: compiled.pathReport,
      sources: prepared.flatMap((item) =>
        item.source &&
        compiled.includedGraphNodeIds.includes(item.source.graphNodeId)
          ? [item.source]
          : [],
      ),
    };
  }
}

function prepareWorkingPreviewVideo(
  graphNodeId: string,
  selection: WorkingPreviewSelection | null,
  assetUrls: MediaAssetUrlResolverService,
): PreparedWorkingPreviewVideo {
  const diagnostics: StoryBuildDiagnosticDto[] = [];
  let asset: FrozenStoryVideoAsset | null = null;
  const snapshotEntry = workingPreviewSnapshotEntry(graphNodeId, selection);

  if (!selection?.currentAssetId) {
    diagnostics.push(
      previewDiagnostic(
        'warning',
        'STORY_WORKING_PREVIEW_CURRENT_VIDEO_MISSING',
        `Clip ${graphNodeId} has no video yet; Preview is using an empty shot placeholder.`,
        'clip',
        graphNodeId,
      ),
    );
  } else if (
    !selection.currentVariantId ||
    !selection.currentContentType?.trim()
  ) {
    diagnostics.push(
      previewDiagnostic(
        'warning',
        'STORY_WORKING_PREVIEW_CURRENT_VIDEO_SELECTION_INCOMPLETE',
        `Clip ${graphNodeId} has a partial video selection; Preview is using an empty shot placeholder.`,
        'clip',
        graphNodeId,
      ),
    );
  } else if (!selection.currentAsset || !selection.currentVariant) {
    diagnostics.push(
      previewDiagnostic(
        'warning',
        'STORY_WORKING_PREVIEW_OUTPUT_MISSING',
        `Clip ${graphNodeId} current video is unavailable; Preview is using an empty shot placeholder.`,
        'clip',
        graphNodeId,
      ),
    );
  } else {
    const source = selection.currentAsset;
    const variant = selection.currentVariant;
    // Workspace is deliberately not compared here: uploads record none, so an
    // uploaded cut sitting ready on the canvas was reported as "not a ready,
    // usable asset in this workspace" — a sentence with no actionable part.
    // The reason, when there is one, now names itself.
    const ineligible =
      source.id !== selection.currentAssetId ||
      variant.id !== selection.currentVariantId ||
      variant.assetId !== source.id
        ? 'no longer matches the selected asset and variant'
        : source.kind !== MediaAssetKind.video
          ? `is a ${source.kind} asset, not a video`
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
          `Clip ${graphNodeId} current video ${ineligible}; Preview is using an empty shot placeholder.`,
          'asset',
          source.id,
        ),
      );
    } else if (!variant.contentType.toLowerCase().startsWith('video/')) {
      diagnostics.push(
        previewDiagnostic(
          'warning',
          'STORY_WORKING_PREVIEW_OUTPUT_CONTENT_TYPE_INVALID',
          `Clip ${graphNodeId} current variant is not video media; Preview is using an empty shot placeholder.`,
          'asset',
          source.id,
        ),
      );
    } else {
      if (
        variant.checksumSha256 !== selection.currentChecksumSha256 ||
        variant.contentType !== selection.currentContentType ||
        variant.durationMs !== selection.currentDurationMs ||
        variant.width !== selection.currentWidth ||
        variant.height !== selection.currentHeight
      ) {
        diagnostics.push(
          previewDiagnostic(
            'warning',
            'STORY_WORKING_PREVIEW_OUTPUT_METADATA_MISMATCH',
            `Graph clip ${graphNodeId} technical metadata changed after selection; the latest metadata will be used.`,
            'asset',
            source.id,
          ),
        );
      }
      if (
        !variant.checksumSha256 ||
        variant.durationMs === null ||
        variant.width === null ||
        variant.height === null ||
        !isBrowserSafeMp4Metadata(variant.metadata)
      ) {
        diagnostics.push(
          previewDiagnostic(
            'warning',
            'STORY_WORKING_PREVIEW_OUTPUT_METADATA_INCOMPLETE',
            `Graph clip ${graphNodeId} has incomplete technical metadata; browser playback remains available.`,
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
            `Clip ${graphNodeId} current video has no resolvable playback URL; Preview is using an empty shot placeholder.`,
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
              `Graph clip ${graphNodeId} current video has not completed moderation review.`,
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
    video: {
      graphNodeId,
      selectionVersion: selection?.version ?? 0,
      asset,
      eligibilityDiagnostics: diagnostics,
    },
    source:
      selection?.currentAssetId && selection.currentVariantId && asset
        ? {
            graphNodeId,
            assetId: selection.currentAssetId,
            variantId: selection.currentVariantId,
            selectionVersion: selection.version,
            selection: 'current',
          }
        : null,
    snapshotEntry,
  };
}

function workingPreviewSnapshotEntry(
  graphNodeId: string,
  selection: WorkingPreviewSelection | null,
): StoryVideoSnapshotEntry {
  if (!selection) return emptyVideoSnapshotEntry(graphNodeId, 0);
  if (selection.currentAssetId === null) {
    return emptyVideoSnapshotEntry(graphNodeId, selection.version);
  }
  const parsed = StoryVideoSnapshotEntrySchema.safeParse({
    graphNodeId,
    selectionVersion: selection.version,
    assetId: selection.currentAssetId,
    variantId: selection.currentVariantId,
    checksumSha256: selection.currentChecksumSha256,
    contentType: selection.currentContentType,
    durationMs: selection.currentDurationMs,
    width: selection.currentWidth,
    height: selection.currentHeight,
    browserSafeMp4: selection.currentBrowserSafeMp4,
  });
  // A partial selection still needs a deterministic Preview identity. Its
  // selection version changes whenever the creator edits it, while the empty
  // media fields accurately describe what this Preview can currently play.
  return parsed.success
    ? parsed.data
    : emptyVideoSnapshotEntry(graphNodeId, selection.version);
}

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
): string {
  return `preview:${canonicalJsonHash({
    projectId,
    draftContentHash,
    videoSnapshotHash,
  })}`;
}

function isBrowserSafeMp4Metadata(value: Prisma.JsonValue): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value.browserSafeMp4 === true) return true;
  const probe = value.videoProbe;
  return (
    probe !== null &&
    probe !== undefined &&
    typeof probe === 'object' &&
    !Array.isArray(probe) &&
    probe.browserSafeMp4 === true
  );
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
