import { ExperienceAppearanceSchema } from '@repo/shared/experience-runtime';
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
    sceneId?: string,
  ): Promise<StoryWorkingPreviewDto> {
    const access = await this.permissions.requireProject(
      user.userId,
      projectId,
      'story.read',
    );
    return this.prisma.$transaction(
      (tx) =>
        this.compileLatestSavedDraft(
          tx,
          access.project,
          projectId,
          chapterId,
          sceneId,
        ),
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
      appearance?: Prisma.JsonValue;
    },
    projectId: string,
    chapterId: string | undefined,
    sceneId: string | undefined,
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
        diagnostics: playableDraft.error.issues.map((issue) => {
          const nodeIndex =
            issue.path[0] === 'graph' &&
            issue.path[1] === 'nodes' &&
            typeof issue.path[2] === 'number'
              ? issue.path[2]
              : null;
          const node =
            draftShape.success && nodeIndex !== null
              ? draftShape.data.graph.nodes[nodeIndex]
              : undefined;
          const choiceIndex =
            issue.path[3] === 'exit' &&
            issue.path[4] === 'choices' &&
            typeof issue.path[5] === 'number'
              ? issue.path[5]
              : null;
          const choice =
            node?.exit.kind === 'choice' && choiceIndex !== null
              ? node.exit.choices[choiceIndex]
              : undefined;
          const effectIndex =
            choice &&
            issue.path[6] === 'effects' &&
            typeof issue.path[7] === 'number'
              ? issue.path[7]
              : null;
          const effect =
            effectIndex !== null ? choice?.effects?.[effectIndex] : undefined;
          const variable =
            effect && draftShape.success
              ? draftShape.data.storyBible.stateVariables?.find(
                  (candidate) => candidate.key === effect.key,
                )
              : undefined;
          const nodeTitle = node
            ? node.kind === 'decision'
              ? localizedDraftText(
                  node.exit.kind === 'choice' ? node.exit.prompt : {},
                  project.defaultLocale,
                ) || node.nodeId
              : node.name || node.nodeId
            : null;
          const choiceLabel = choice
            ? localizedDraftText(choice.label, project.defaultLocale) ||
              choice.choiceId
            : null;
          const variableName = variable
            ? localizedDraftText(variable.name, project.defaultLocale) ||
              variable.key
            : null;
          const location = [
            nodeTitle,
            choiceLabel ? `choice ${choiceIndex! + 1} "${choiceLabel}"` : null,
            effectIndex !== null
              ? `effect ${effectIndex + 1}${variableName ? ` "${variableName}"` : ''}`
              : null,
          ]
            .filter(Boolean)
            .join(' · ');
          const diagnostic = previewDiagnostic(
            'error',
            effect && variable
              ? 'STORY_WORKING_PREVIEW_EFFECT_TYPE_MISMATCH'
              : 'STORY_WORKING_PREVIEW_DRAFT_INCOMPLETE',
            `${location || issue.path.join('.') || 'draft'}: ${issue.message}`,
            node ? 'node' : 'revision',
            node?.nodeId ?? projectId,
          );
          if (node) {
            const chapter = chapters.find(
              (candidate) =>
                Array.isArray(candidate.nodeIds) &&
                candidate.nodeIds.includes(node.nodeId),
            );
            if (chapter) diagnostic.chapterId = chapter.id;
          }
          if (
            nodeTitle &&
            variable &&
            variableName &&
            effect &&
            effectIndex !== null
          ) {
            diagnostic.details = {
              kind: 'state-effect-type',
              nodeTitle,
              choiceLabel,
              effectIndex: effectIndex + 1,
              variableName,
              operation: effect.kind,
              variableType: variable.valueType,
            };
          }
          return diagnostic;
        }),
      };
    }

    const clipNodes = playableDraft.data.graph.nodes.filter(
      (node) => node.kind === 'clip',
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
        node.kind === 'clip' ? node.name?.trim() || node.clipKey : node.nodeId,
        sequenceByNodeId.get(node.nodeId) ?? null,
        this.assetUrls,
      ),
    );

    const snapshotEntries = prepared.flatMap((item) => item.snapshotEntries);
    const videoSnapshotHash = storyVideoSnapshotHash(snapshotEntries);
    const chapter = chapterId
      ? chapters.find((candidate) => candidate.id === chapterId)
      : null;
    if (chapterId && !chapter) {
      throw new NotFoundException({
        code: 'STORY_CHAPTER_NOT_FOUND',
        message: 'The selected Story chapter was not found.',
      });
    }
    const graphNodeIds = new Set(
      playableDraft.data.graph.nodes.map((node) => node.nodeId),
    );
    const chapterStart = chapter
      ? chapterPlayStart(chapter, graphNodeIds, sceneId)
      : null;
    if (chapter && !chapterStart) {
      return emptyWorkingPreview(
        draft.revision,
        draft.contentHash,
        videoSnapshotHash,
        previewDiagnostic(
          'error',
          'STORY_WORKING_PREVIEW_CHAPTER_EMPTY',
          'This chapter has no scene to play.',
          'revision',
          chapter.id,
        ),
      );
    }
    // A clicked scene is the start of this play. An empty chapter entry stays
    // inside that chapter. Neither case may borrow another chapter's node.
    const scope: StoryBuildScope =
      chapter && chapterStart
        ? { kind: 'subgraph', entryNodeId: chapterStart }
        : sceneId && graphNodeIds.has(sceneId)
          ? { kind: 'subgraph', entryNodeId: sceneId }
          : { kind: 'full' };
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
      // Playing a node starts at that node. Playing a chapter starts at its
      // own entry, or its own first scene when the entry was never saved.
      scope,
      frameProfile: project.frameProfile,
      defaultLocale: project.defaultLocale,
      metadata,
      draft: playableDraft.data,
      timelines: prepared.map((item) => item.timeline),
      appearance:
        project.appearance == null
          ? undefined
          : ExperienceAppearanceSchema.parse(project.appearance),
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
  sceneTitle: string,
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
    prepareWorkingPreviewSegment(graphNodeId, sceneTitle, clip, assetUrls),
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
  sceneTitle: string,
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
  const shot = readableShotTitle(clip);
  const label = `"${shot}" in "${sceneTitle}"`;
  const shotDetails: StoryBuildDiagnosticDto['details'] = {
    kind: 'shot',
    sceneTitle,
    shotTitle: shot,
  };
  const snapshotEntry = previewClipSnapshotEntry(clip);

  if (media && !variant) {
    diagnostics.push(
      previewDiagnostic(
        'warning',
        'STORY_WORKING_PREVIEW_OUTPUT_MISSING',
        `${label} does not resolve to a playable media variant, so playtest skips that shot.`,
        'asset',
        media.mediaAssetId,
        shotDetails,
      ),
    );
  } else if (media && variant) {
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
          `${label} selected media ${ineligible}, so playtest skips that shot.`,
          'asset',
          source.id,
          shotDetails,
        ),
      );
    } else if (!variant.contentType.toLowerCase().startsWith(expectedPrefix)) {
      diagnostics.push(
        previewDiagnostic(
          'warning',
          'STORY_WORKING_PREVIEW_OUTPUT_CONTENT_TYPE_INVALID',
          `${label} does not resolve to a ${clip.kind} media type, so playtest skips that shot.`,
          'asset',
          source.id,
          shotDetails,
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
            `${label} is missing some technical metadata. Playback still uses the original video.`,
            'asset',
            source.id,
            shotDetails,
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
            `${label} has no playback URL, so playtest skips that shot.`,
            'asset',
            source.id,
            shotDetails,
          ),
        );
      } else {
        if (source.moderationStatus !== MediaAssetModerationStatus.approved) {
          diagnostics.push(
            previewDiagnostic(
              'warning',
              'STORY_WORKING_PREVIEW_MODERATION_PENDING',
              `${label} is still in moderation review. Playback uses it anyway.`,
              'asset',
              source.id,
              shotDetails,
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
      title: shot,
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

/**
 * Where a chapter preview starts. The pressed play button wins. Otherwise the
 * chapter's own entry, then its own first scene. Never a node from elsewhere.
 */
function chapterPlayStart(
  chapter: { nodeIds: Prisma.JsonValue; entryNodeId: string | null },
  graphNodeIds: ReadonlySet<string>,
  sceneId: string | undefined,
): string | null {
  const owned = jsonStringIds(chapter.nodeIds).filter((id) =>
    graphNodeIds.has(id),
  );
  if (sceneId && owned.includes(sceneId)) return sceneId;
  if (chapter.entryNodeId && owned.includes(chapter.entryNodeId)) {
    return chapter.entryNodeId;
  }
  return owned[0] ?? null;
}

function jsonStringIds(value: Prisma.JsonValue): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
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
  details?: StoryBuildDiagnosticDto['details'],
): StoryBuildDiagnosticDto {
  return details
    ? { severity, code, message, entityType, entityId, details }
    : { severity, code, message, entityType, entityId };
}

function readableShotTitle(clip: {
  title?: string | null;
  stableKey: string;
}): string {
  const title = clip.title?.trim();
  return title || clip.stableKey;
}

function localizedDraftText(
  value: Record<string, string>,
  locale: string,
): string {
  return (
    value[locale]?.trim() ||
    Object.values(value)
      .find((text) => text.trim())
      ?.trim() ||
    ''
  );
}
