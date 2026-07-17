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
import { canonicalJsonHash } from './canonical-json';
import {
  createPlayableInteractiveFilmDraftContentSchema,
  InteractiveFilmDraftContentSchema,
  INTERACTIVE_FILM_DRAFT_SCHEMA_VERSION,
  type StoryBuildDiagnosticDto,
  type StoryWorkingPreviewDto,
} from './dto';
import {
  compileStoryBuild,
  type FrozenStoryVideoAsset,
  type StoryBuildVideoInput,
} from './story-build-compiler';
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
  snapshotEntry: StoryVideoSnapshotEntry | null;
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
      (tx) => this.compileLatestSavedDraft(tx, access.project, projectId),
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
    },
    projectId: string,
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

    if (draft.schemaVersion !== INTERACTIVE_FILM_DRAFT_SCHEMA_VERSION) {
      return emptyWorkingPreview(
        draft.revision,
        draft.contentHash,
        null,
        previewDiagnostic(
          'error',
          'STORY_WORKING_PREVIEW_DRAFT_SCHEMA_UNSUPPORTED',
          `This saved draft uses unsupported schema ${draft.schemaVersion}; Working Preview requires ${INTERACTIVE_FILM_DRAFT_SCHEMA_VERSION}.`,
          'revision',
          projectId,
        ),
      );
    }

    const draftShape = InteractiveFilmDraftContentSchema.safeParse(
      draft.content,
    );
    const playableDraft = createPlayableInteractiveFilmDraftContentSchema(
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
    const selections =
      clipNodes.length === 0
        ? []
        : await tx.storyVideoSelection.findMany({
            where: {
              storyProjectId: projectId,
              targetKind: 'clip',
              targetKey: { in: clipNodes.map((node) => node.nodeId) },
            },
            include: WORKING_PREVIEW_SELECTION_INCLUDE,
          });
    const selectionByNodeId = new Map(
      selections.map((selection) => [selection.targetKey, selection]),
    );
    const prepared = clipNodes.map((node) =>
      prepareWorkingPreviewVideo(
        project.workspaceId,
        node.nodeId,
        selectionByNodeId.get(node.nodeId) ?? null,
        this.assetUrls,
      ),
    );

    const snapshotEntries = prepared.map((item) => item.snapshotEntry);
    if (
      !snapshotEntries.every(
        (entry): entry is StoryVideoSnapshotEntry => entry !== null,
      )
    ) {
      return {
        ...emptyWorkingPreview(draft.revision, draft.contentHash, null),
        diagnostics: prepared
          .flatMap((item) => item.video.eligibilityDiagnostics)
          .concat(
            previewDiagnostic(
              'error',
              'STORY_WORKING_PREVIEW_VIDEO_SNAPSHOT_INVALID',
              'At least one current video selection is partial or corrupt and cannot form an exact Preview identity.',
              'revision',
              projectId,
            ),
          ),
      };
    }
    const videoSnapshotHash = storyVideoSnapshotHash(snapshotEntries);
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
      scope: { kind: 'full' },
      frameProfile: project.frameProfile,
      defaultLocale: project.defaultLocale,
      metadata: {
        title: project.title,
        summary:
          project.summary?.trim() || playableDraft.data.storyBible.logline,
      },
      draft: playableDraft.data,
      videos: prepared.map((item) => item.video),
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
  workspaceId: string,
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
        'error',
        'STORY_WORKING_PREVIEW_CURRENT_VIDEO_MISSING',
        `Graph clip ${graphNodeId} has no current video selection.`,
        'clip',
        graphNodeId,
      ),
    );
  } else if (
    !selection.currentVariantId ||
    !selection.currentChecksumSha256 ||
    !selection.currentContentType?.trim() ||
    selection.currentDurationMs === null ||
    selection.currentWidth === null ||
    selection.currentHeight === null ||
    selection.currentHasAudio === null ||
    selection.currentBrowserSafeMp4 === null
  ) {
    diagnostics.push(
      previewDiagnostic(
        'error',
        'STORY_WORKING_PREVIEW_CURRENT_VIDEO_SELECTION_INCOMPLETE',
        `Graph clip ${graphNodeId} current selection is missing frozen video identity or metadata.`,
        'clip',
        graphNodeId,
      ),
    );
  } else if (!selection.currentAsset || !selection.currentVariant) {
    diagnostics.push(
      previewDiagnostic(
        'error',
        'STORY_WORKING_PREVIEW_OUTPUT_MISSING',
        `Graph clip ${graphNodeId} current video no longer has its exact asset and variant.`,
        'clip',
        graphNodeId,
      ),
    );
  } else {
    const source = selection.currentAsset;
    const variant = selection.currentVariant;
    if (
      source.id !== selection.currentAssetId ||
      source.workspaceId !== workspaceId ||
      source.kind !== MediaAssetKind.video ||
      source.status !== MediaAssetStatus.ready ||
      source.deletedAt !== null ||
      source.moderationStatus === MediaAssetModerationStatus.blocked ||
      variant.id !== selection.currentVariantId ||
      variant.assetId !== source.id ||
      variant.status !== MediaAssetVariantStatus.ready ||
      variant.deletedAt !== null
    ) {
      diagnostics.push(
        previewDiagnostic(
          'error',
          'STORY_WORKING_PREVIEW_OUTPUT_INELIGIBLE',
          `Graph clip ${graphNodeId} current video is not a ready, usable asset in this workspace.`,
          'asset',
          source.id,
        ),
      );
    } else if (
      !variant.checksumSha256 ||
      !variant.contentType.trim() ||
      variant.durationMs === null ||
      variant.width === null ||
      variant.height === null ||
      variant.hasAudio === null ||
      !isBrowserSafeMp4Metadata(variant.metadata)
    ) {
      diagnostics.push(
        previewDiagnostic(
          'error',
          'STORY_WORKING_PREVIEW_OUTPUT_METADATA_MISSING',
          `Graph clip ${graphNodeId} current video variant is missing probed playback metadata.`,
          'asset',
          source.id,
        ),
      );
    } else {
      const durationMs = variant.durationMs;
      if (
        variant.checksumSha256 !== selection.currentChecksumSha256 ||
        variant.contentType !== selection.currentContentType ||
        durationMs !== selection.currentDurationMs ||
        variant.width !== selection.currentWidth ||
        variant.height !== selection.currentHeight ||
        variant.hasAudio !== selection.currentHasAudio ||
        selection.currentBrowserSafeMp4 !== true
      ) {
        diagnostics.push(
          previewDiagnostic(
            'error',
            'STORY_WORKING_PREVIEW_OUTPUT_METADATA_MISMATCH',
            `Graph clip ${graphNodeId} current selection no longer matches the exact probed video variant.`,
            'asset',
            source.id,
          ),
        );
      } else {
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
              'error',
              'STORY_WORKING_PREVIEW_OUTPUT_URL_UNAVAILABLE',
              `Graph clip ${graphNodeId} current video variant has no resolvable playback URL.`,
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
            durationMs,
            hasAudio: variant.hasAudio,
            browserSafeMp4: true,
            url,
          };
        }
      }
    }
  }

  return {
    video: {
      graphNodeId,
      sourceGenerationId: selection?.currentSourceGenerationAttemptId ?? null,
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
            sourceGenerationId: selection.currentSourceGenerationAttemptId,
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
): StoryVideoSnapshotEntry | null {
  if (!selection) return emptyVideoSnapshotEntry(graphNodeId, 0);
  const mediaValues = [
    selection.currentAssetId,
    selection.currentVariantId,
    selection.currentChecksumSha256,
    selection.currentContentType,
    selection.currentDurationMs,
    selection.currentWidth,
    selection.currentHeight,
    selection.currentHasAudio,
    selection.currentBrowserSafeMp4,
  ];
  const populated = mediaValues.filter((value) => value !== null).length;
  if (populated === 0) {
    return selection.currentSourceGenerationAttemptId === null
      ? emptyVideoSnapshotEntry(graphNodeId, selection.version)
      : null;
  }
  if (populated !== mediaValues.length) return null;
  const parsed = StoryVideoSnapshotEntrySchema.safeParse({
    graphNodeId,
    selectionVersion: selection.version,
    sourceGenerationAttemptId: selection.currentSourceGenerationAttemptId,
    assetId: selection.currentAssetId,
    variantId: selection.currentVariantId,
    checksumSha256: selection.currentChecksumSha256,
    contentType: selection.currentContentType,
    durationMs: selection.currentDurationMs,
    width: selection.currentWidth,
    height: selection.currentHeight,
    hasAudio: selection.currentHasAudio,
    browserSafeMp4: selection.currentBrowserSafeMp4,
  });
  return parsed.success ? parsed.data : null;
}

function emptyVideoSnapshotEntry(
  graphNodeId: string,
  selectionVersion: number,
): StoryVideoSnapshotEntry {
  return StoryVideoSnapshotEntrySchema.parse({
    graphNodeId,
    selectionVersion,
    sourceGenerationAttemptId: null,
    assetId: null,
    variantId: null,
    checksumSha256: null,
    contentType: null,
    durationMs: null,
    width: null,
    height: null,
    hasAudio: null,
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
