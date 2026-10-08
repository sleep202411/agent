import {
  INTERACTIVE_FILM_RELEASE_SCHEMA_VERSION,
  InteractiveFilmReleaseSchema,
  type InteractiveFilmRelease,
} from '@repo/shared/interactive-film-runtime';
import {
  storyAutoFallbackNodeId,
  storyExitNodeIds,
  storyRouteEndingId,
  storyRouteNodeId,
} from '@repo/shared/story-stats';
import type {
  ExperienceRuntimeManifest,
  ExperienceAppearance,
  GameUIArtifact,
} from '@repo/shared/experience-runtime';
import type {
  StoryBuildDiagnosticDto,
  StoryBuildPathReportDto,
  StoryFrameProfile,
} from './dto';
import {
  collectInteractiveStoryRuntimeLocales,
  type InteractiveStoryDraftContent,
  type StoryBuildScope,
} from './interactive-film.schema';
import {
  compileStoryExperienceManifest,
  type StoryExperienceMediaIdentity,
} from './story-experience-manifest-compiler';
import { storyPlaybackCopy } from './story-playback-copy';

export interface FrozenStoryVideoAsset {
  assetId: string;
  variantId: string;
  checksumSha256: string | null;
  contentType: string;
  sizeBytes: bigint | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  browserSafeMp4: boolean | null;
  url: string;
}

/**
 * One storyboard clip on a node's timeline, frozen for the Build. The
 * storyboard sequence — not any per-node video selection — is the sole source
 * of a node's playable content.
 */
export interface StoryBuildSegmentInput {
  clipId: string;
  clipKey: string;
  /** Creator-facing shot title. Playback identity stays `clipId`. */
  title?: string;
  kind: 'image' | 'video';
  durationMs: number;
  clipVersion: number;
  asset: FrozenStoryVideoAsset | null;
  eligibilityDiagnostics: StoryBuildDiagnosticDto[];
}

export interface StoryBuildNodeTimelineInput {
  graphNodeId: string;
  sequenceId: string | null;
  segments: StoryBuildSegmentInput[];
}

type FrozenStoryBuildSegment = StoryBuildSegmentInput & {
  asset: FrozenStoryVideoAsset;
};

interface FrozenNodeTimeline {
  graphNodeId: string;
  segments: FrozenStoryBuildSegment[];
}

export interface StoryBuildCompilerInput {
  appearance?: ExperienceAppearance;
  gameUi?: GameUIArtifact;
  projectId: string;
  buildId: string;
  sourceDraftRevision: number;
  channel: 'preview' | 'production';
  scope: StoryBuildScope;
  frameProfile: StoryFrameProfile;
  defaultLocale: string;
  metadata: { title: string; summary: string | null };
  draft: InteractiveStoryDraftContent;
  timelines: StoryBuildNodeTimelineInput[];
  /**
   * Playable URL per bound music MediaAsset id — a plain public media URL, not
   * a frozen build asset. A binding missing from this map simply gets no music,
   * which is why nothing here can ever produce a diagnostic.
   */
  musicUrls?: ReadonlyMap<string, string>;
  diagnostics?: StoryBuildDiagnosticDto[];
}

export interface StoryBuildCompilerResult {
  diagnostics: StoryBuildDiagnosticDto[];
  pathReport: StoryBuildPathReportDto;
  runtime: ExperienceRuntimeManifest | null;
  includedGraphNodeIds: string[];
}

/**
 * Deterministically compiles one strict unified-story snapshot and its exact
 * frozen video selections to Runtime Manifest v2. The compiler has no
 * production-plan inputs and never invents media metadata or duration
 * defaults.
 */
export function compileStoryBuild(
  input: StoryBuildCompilerInput,
): StoryBuildCompilerResult {
  const diagnostics = [...(input.diagnostics ?? [])];
  const nodes = new Map(
    input.draft.graph.nodes.map((node) => [node.nodeId, node]),
  );
  const timelines = new Map<string, StoryBuildNodeTimelineInput>();
  input.timelines.forEach((timeline) => {
    if (timelines.has(timeline.graphNodeId)) {
      diagnostics.push(
        diagnostic(
          'error',
          'STORY_BUILD_TIMELINE_DUPLICATE',
          `Graph node ${timeline.graphNodeId} has more than one frozen storyboard timeline.`,
          'clip',
          timeline.graphNodeId,
        ),
      );
      return;
    }
    timelines.set(timeline.graphNodeId, timeline);
  });

  const entryNodeId = resolveEntryNodeId(input, nodes, diagnostics);
  const selection = selectGraphNodes(
    entryNodeId,
    nodes,
    input.scope,
    diagnostics,
  );
  const reachable = structuralReachability(entryNodeId, nodes, selection);
  const unreachableNodeIds = [...selection]
    .filter((nodeId) => !reachable.has(nodeId))
    .sort();
  unreachableNodeIds.forEach((nodeId) =>
    diagnostics.push(
      diagnostic(
        'warning',
        'STORY_BUILD_UNREACHABLE_NODE',
        `Node ${nodeId} is unreachable from Build entry ${entryNodeId ?? '<missing>'}.`,
        'revision',
        nodeId,
      ),
    ),
  );
  detectStructuralCycles(entryNodeId, nodes, selection, diagnostics);

  // Disconnected canvas work remains editable and is reported above, but it is
  // not part of this playable cut. Compiling it into the runtime would make the
  // manifest invalid even though the connected film itself is ready.
  const runtimeSelection = reachable;
  const requiredGraphNodeIds = requiredVideoNodeIds(runtimeSelection, nodes);
  // Missing footage never stops a compile, on either channel. A creator may
  // ship a work in progress on purpose; the release reports what is unfilled
  // and the publish surface repeats it, so the decision stays theirs instead
  // of the pipeline making it for them. A scene with no footage still plays —
  // the runtime holds an empty sequence and moves on.
  const missingSeverity = 'warning' as const;
  const includedTimelines: FrozenNodeTimeline[] = [...requiredGraphNodeIds]
    .sort()
    .map((graphNodeId) => {
      const node = nodes.get(graphNodeId);
      const scene = sceneTitle(node, graphNodeId);
      const timeline = timelines.get(graphNodeId);
      // The storyboard sequence is the node's production plan; a node without
      // one has never been planned and carries no playable content yet. That
      // is reported, not refused.
      if (!timeline || timeline.sequenceId === null) {
        diagnostics.push(
          diagnostic(
            missingSeverity,
            'STORY_BUILD_SEQUENCE_REQUIRED',
            `"${scene}" has no storyboard yet, so playtest skips that scene.`,
            'node',
            graphNodeId,
            { kind: 'missing-sequence', sceneTitle: scene },
          ),
        );
        return { graphNodeId, segments: [] };
      }
      const segments = timeline.segments.flatMap((segment) => {
        diagnostics.push(...segment.eligibilityDiagnostics);
        if (segment.asset) return [segment as FrozenStoryBuildSegment];
        const shot = shotTitle(segment);
        diagnostics.push(
          diagnostic(
            missingSeverity,
            'STORY_BUILD_CLIP_MEDIA_REQUIRED',
            `"${shot}" in "${scene}" has no selected video, so playtest skips that shot.`,
            'node',
            graphNodeId,
            { kind: 'shot', sceneTitle: scene, shotTitle: shot },
          ),
        );
        return [];
      });
      if (timeline.segments.length === 0) {
        diagnostics.push(
          diagnostic(
            missingSeverity,
            'STORY_BUILD_CLIP_MEDIA_REQUIRED',
            `"${scene}" has an empty storyboard, so playtest skips that scene.`,
            'node',
            graphNodeId,
            { kind: 'missing-sequence', sceneTitle: scene },
          ),
        );
      }
      return { graphNodeId, segments };
    });
  const footageTimelines =
    input.channel === 'preview'
      ? omitUnplayablePreviewShots(includedTimelines, nodes, diagnostics)
      : includedTimelines;
  footageTimelines.forEach((timeline) => {
    const scene = sceneTitle(
      nodes.get(timeline.graphNodeId),
      timeline.graphNodeId,
    );
    timeline.segments.forEach((segment) =>
      validateFrozenSegment(
        segment,
        scene,
        diagnostics,
        input.channel === 'preview' ? 'warning' : 'error',
      ),
    );
  });

  const analysis = analyzePaths(
    entryNodeId,
    nodes,
    timelines,
    runtimeSelection,
    diagnostics,
  );
  const pathReport: StoryBuildPathReportDto = {
    enumeratedPathCount: analysis.pathCount,
    reachableTerminalNodeIds: [...analysis.terminalNodeIds].sort(),
    unreachableNodeIds,
    ambiguousPathCount: analysis.ambiguousPathCount,
    durationMinMs: analysis.durationMinMs ?? 0,
    durationMaxMs: analysis.durationMaxMs ?? 0,
  };
  if (pathReport.reachableTerminalNodeIds.length === 0) {
    diagnostics.push(
      diagnostic(
        'warning',
        'STORY_BUILD_NO_REACHABLE_TERMINAL',
        'This story has no terminal scene and may continue until the player exits.',
        'revision',
        null,
      ),
    );
  }
  let runtime: ExperienceRuntimeManifest | null = null;
  if (!diagnostics.some((item) => item.severity === 'error') && entryNodeId) {
    const playbackSlots = assignStoryPlaybackSlots(footageTimelines);
    const releaseCandidate = compileIntermediateRelease(
      input,
      entryNodeId,
      runtimeSelection,
      nodes,
      footageTimelines,
      playbackSlots,
    );
    const release = InteractiveFilmReleaseSchema.safeParse(releaseCandidate);
    if (!release.success) {
      diagnostics.push(
        ...explainReleaseIssues(
          release.error.issues,
          footageTimelines,
          nodes,
          input.sourceDraftRevision,
        ),
      );
    } else {
      const mediaIdentities: StoryExperienceMediaIdentity[] =
        footageTimelines.flatMap((timeline) =>
          timeline.segments.map((segment, index) => ({
            runtimeAssetId: requiredPlaybackSlot(
              playbackSlots,
              timeline.graphNodeId,
              index,
            ).assetId,
            variantId: segment.asset.variantId,
            mediaType: segment.asset.contentType,
          })),
        );
      const compiled = compileStoryExperienceManifest({
        release: release.data,
        appearance: input.appearance,
        gameUi: input.gameUi,
        experienceProfile: 'cinematic',
        metadata: {
          ...input.metadata,
        },
        mediaIdentities,
        previewSceneCopy:
          input.channel === 'preview'
            ? new Map(
                input.draft.graph.nodes.flatMap((node, index) =>
                  node.kind === 'clip'
                    ? [
                        [
                          node.nodeId,
                          {
                            title:
                              node.name?.trim() ||
                              `${storyPlaybackCopy(input.defaultLocale).scene} ${index + 1}`,
                            description: node.description ?? '',
                          },
                        ] as const,
                      ]
                    : [],
                ),
              )
            : undefined,
      });
      compiled.diagnostics.forEach((item) =>
        diagnostics.push(
          diagnostic(
            'error',
            item.code,
            item.message,
            item.nodeId ? 'node' : 'revision',
            item.nodeId ?? String(input.sourceDraftRevision),
          ),
        ),
      );
      runtime = compiled.manifest;
    }
  }

  return {
    diagnostics: sortAndDedupeDiagnostics(diagnostics),
    pathReport,
    runtime,
    includedGraphNodeIds: footageTimelines
      .filter((timeline) => timeline.segments.length > 0)
      .map((timeline) => timeline.graphNodeId),
  };
}

function resolveEntryNodeId(
  input: StoryBuildCompilerInput,
  nodes: ReadonlyMap<
    string,
    InteractiveStoryDraftContent['graph']['nodes'][number]
  >,
  diagnostics: StoryBuildDiagnosticDto[],
): string | null {
  const entryNodeId =
    input.scope.kind === 'subgraph'
      ? input.scope.entryNodeId
      : input.draft.graph.entryNodeId;
  if (!entryNodeId) {
    diagnostics.push(
      diagnostic(
        'error',
        'STORY_BUILD_ENTRY_NODE_MISSING',
        'The saved story has no Build entry node.',
        'revision',
        String(input.sourceDraftRevision),
      ),
    );
    return null;
  }
  if (!nodes.has(entryNodeId)) {
    diagnostics.push(
      diagnostic(
        'error',
        'STORY_BUILD_SCOPE_ENTRY_NODE_NOT_FOUND',
        `Build entry node ${entryNodeId} does not exist in the saved story.`,
        'revision',
        entryNodeId,
      ),
    );
    return null;
  }
  return entryNodeId;
}

function selectGraphNodes(
  entryNodeId: string | null,
  nodes: ReadonlyMap<
    string,
    InteractiveStoryDraftContent['graph']['nodes'][number]
  >,
  scope: StoryBuildScope,
  diagnostics: StoryBuildDiagnosticDto[],
): Set<string> {
  if (scope.kind === 'full') return new Set(nodes.keys());
  if (!entryNodeId) return new Set();
  const selected = new Set<string>();
  const pending: Array<{ nodeId: string; depth: number }> = [
    { nodeId: entryNodeId, depth: 0 },
  ];
  const maxDepth = scope.maxDepth ?? 100;
  let truncated = false;
  while (pending.length > 0) {
    const current = pending.shift();
    if (!current || selected.has(current.nodeId)) continue;
    if (current.depth > maxDepth) {
      truncated = true;
      continue;
    }
    selected.add(current.nodeId);
    const node = nodes.get(current.nodeId);
    if (!node) continue;
    nextNodeIds(node).forEach((nodeId) =>
      pending.push({ nodeId, depth: current.depth + 1 }),
    );
  }
  if (truncated) {
    diagnostics.push(
      diagnostic(
        'error',
        'STORY_BUILD_SCOPE_MAX_DEPTH_EXCEEDED',
        `The requested subgraph exceeds maxDepth ${maxDepth}; Build will not silently truncate it.`,
        'revision',
        entryNodeId,
      ),
    );
  }
  return selected;
}

function requiredVideoNodeIds(
  selection: ReadonlySet<string>,
  nodes: ReadonlyMap<
    string,
    InteractiveStoryDraftContent['graph']['nodes'][number]
  >,
): Set<string> {
  const required = new Set<string>();
  [...selection].forEach((nodeId) => {
    const node = nodes.get(nodeId);
    if (node?.kind === 'clip') required.add(node.nodeId);
  });
  return required;
}

/**
 * Only playback identity and a video MIME type are release requirements.
 * Probe-derived metadata improves integrity reporting and path estimates, but
 * browsers can play the original media without it, so missing values warn and
 * never block publication.
 */
function validateFrozenSegment(
  segment: FrozenStoryBuildSegment,
  scene: string,
  diagnostics: StoryBuildDiagnosticDto[],
  contentTypeSeverity: StoryBuildDiagnosticDto['severity'],
): void {
  const asset = segment.asset;
  const shot = shotTitle(segment);
  const shotDetails = {
    kind: 'shot' as const,
    sceneTitle: scene,
    shotTitle: shot,
  };
  const expectedPrefix = segment.kind === 'video' ? 'video/' : 'image/';
  if (
    asset.checksumSha256 !== null &&
    !/^[a-f0-9]{64}$/.test(asset.checksumSha256)
  ) {
    diagnostics.push(
      diagnostic(
        'warning',
        'STORY_BUILD_VIDEO_CHECKSUM_INVALID',
        `"${shot}" in "${scene}" has no valid immutable SHA-256 checksum.`,
        'asset',
        asset.assetId,
        shotDetails,
      ),
    );
  }
  if (!asset.contentType.toLowerCase().startsWith(expectedPrefix)) {
    diagnostics.push(
      diagnostic(
        contentTypeSeverity,
        'STORY_BUILD_VIDEO_CONTENT_TYPE_INVALID',
        `"${shot}" in "${scene}" resolves to ${asset.contentType}, not a ${segment.kind} media type.`,
        'asset',
        asset.assetId,
        shotDetails,
      ),
    );
  }
  if (
    asset.durationMs !== null &&
    (!Number.isInteger(asset.durationMs) || asset.durationMs <= 0)
  ) {
    diagnostics.push(
      diagnostic(
        'warning',
        'STORY_BUILD_VIDEO_DURATION_INVALID',
        `"${shot}" in "${scene}" has invalid duration metadata.`,
        'asset',
        asset.assetId,
        shotDetails,
      ),
    );
  }
  if (
    segment.kind === 'video' &&
    (asset.checksumSha256 === null ||
      asset.durationMs === null ||
      asset.width === null ||
      asset.height === null ||
      asset.browserSafeMp4 !== true)
  ) {
    diagnostics.push(
      diagnostic(
        'warning',
        'STORY_BUILD_VIDEO_METADATA_INCOMPLETE',
        `"${shot}" in "${scene}" is missing some technical metadata. Playback still uses the original video.`,
        'asset',
        asset.assetId,
        shotDetails,
      ),
    );
  }
}

function structuralReachability(
  entryNodeId: string | null,
  nodes: ReadonlyMap<
    string,
    InteractiveStoryDraftContent['graph']['nodes'][number]
  >,
  selection: ReadonlySet<string>,
): Set<string> {
  const reachable = new Set<string>();
  const pending = entryNodeId ? [entryNodeId] : [];
  while (pending.length > 0) {
    const nodeId = pending.pop();
    if (!nodeId || reachable.has(nodeId) || !selection.has(nodeId)) continue;
    reachable.add(nodeId);
    const node = nodes.get(nodeId);
    if (node) nextNodeIds(node).forEach((next) => pending.push(next));
  }
  return reachable;
}

function detectStructuralCycles(
  entryNodeId: string | null,
  nodes: ReadonlyMap<
    string,
    InteractiveStoryDraftContent['graph']['nodes'][number]
  >,
  selection: ReadonlySet<string>,
  diagnostics: StoryBuildDiagnosticDto[],
): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const reported = new Set<string>();
  const visit = (nodeId: string): void => {
    if (!selection.has(nodeId) || visited.has(nodeId)) return;
    visiting.add(nodeId);
    const node = nodes.get(nodeId);
    if (node) {
      nextNodeIds(node).forEach((next) => {
        if (!selection.has(next)) return;
        if (visiting.has(next)) {
          const edge = `${nodeId}->${next}`;
          if (!reported.has(edge)) {
            reported.add(edge);
            diagnostics.push(
              diagnostic(
                'warning',
                'STORY_BUILD_GRAPH_CYCLE',
                `The story contains a replay loop (${edge}).`,
                'revision',
                nodeId,
              ),
            );
          }
          return;
        }
        visit(next);
      });
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  if (entryNodeId) visit(entryNodeId);
}

/** Per-node roll-up: what every complete route *from this node onward* looks like. */
interface NodePathFacts {
  /** Distinct complete routes from here to a terminal clip. 0 means dead end. */
  pathCount: number;
  terminalNodeIds: ReadonlySet<string>;
  /**
   * Shortest / longest remaining runtime, this node's own clip included. Null
   * when `pathCount === 0` — a dead end must not read as a 0 ms route, which is
   * exactly what would happen if these defaulted to zero.
   */
  durationMinMs: number | null;
  durationMaxMs: number | null;
}

const DEAD_END: NodePathFacts = {
  pathCount: 0,
  terminalNodeIds: new Set(),
  durationMinMs: null,
  durationMaxMs: null,
};

/**
 * Path facts for the whole selection, computed over the graph instead of by
 * walking every route through it.
 *
 * The report only ever needed three scalars — shortest runtime, longest runtime,
 * and which terminal clips are reachable — but this used to materialise every distinct
 * path to derive them. Route count is the *product* of the branch factors, so a
 * story that offers a choice per scene explodes: nine 3-to-4-way choices over 55
 * nodes is 46,656 routes, which blew the old safety budget and reported
 * PATH_LIMIT_EXCEEDED on a graph that is perfectly well-formed.
 *
 * Memoising per node makes it one pass over nodes and edges: each node resolves
 * once and every route through it reuses the answer. The count stays exact — it
 * is summed, never enumerated — so the report is unchanged while the work stops
 * being exponential. There is deliberately no budget left to exceed.
 *
 * Dead-end diagnostics are still emitted from here (route out of scope, missing
 * target, scene with no continuation), deduplicated because a bad node is now
 * visited once rather than once per route through it.
 */
function analyzePaths(
  entryNodeId: string | null,
  nodes: ReadonlyMap<
    string,
    InteractiveStoryDraftContent['graph']['nodes'][number]
  >,
  timelines: ReadonlyMap<string, StoryBuildNodeTimelineInput>,
  selection: ReadonlySet<string>,
  diagnostics: StoryBuildDiagnosticDto[],
): NodePathFacts & { ambiguousPathCount: number } {
  if (!entryNodeId || !selection.has(entryNodeId)) {
    return { ...DEAD_END, ambiguousPathCount: 0 };
  }
  const reported = new Set<string>();
  const reportOnce = (item: StoryBuildDiagnosticDto) => {
    const key = JSON.stringify([item.code, item.entityId ?? '', item.message]);
    if (reported.has(key)) return;
    reported.add(key);
    diagnostics.push(item);
  };

  const memo = new Map<string, NodePathFacts>();
  const onStack = new Set<string>();

  const factsFor = (nodeId: string): NodePathFacts => {
    const cached = memo.get(nodeId);
    if (cached) return cached;
    // A cycle is already reported as STORY_BUILD_GRAPH_CYCLE by the reachability
    // pass, and route counts are meaningless on one. Treating the back edge as a
    // dead end only keeps this terminating; it is not a second opinion.
    if (onStack.has(nodeId)) return DEAD_END;

    if (!selection.has(nodeId)) {
      reportOnce(
        diagnostic(
          'error',
          'STORY_BUILD_ROUTE_OUTSIDE_SCOPE',
          `Route target ${nodeId} falls outside the selected Build scope.`,
          'revision',
          nodeId,
        ),
      );
      return DEAD_END;
    }
    const node = nodes.get(nodeId);
    if (!node) {
      reportOnce(
        diagnostic(
          'error',
          'STORY_BUILD_ROUTE_TARGET_MISSING',
          `Route target ${nodeId} does not exist.`,
          'revision',
          nodeId,
        ),
      );
      return DEAD_END;
    }

    onStack.add(nodeId);
    const selfMs =
      timelines
        .get(node.nodeId)
        ?.segments.reduce((total, segment) => total + segment.durationMs, 0) ??
      0;

    let facts: NodePathFacts = DEAD_END;
    if (
      node.exit.kind === 'auto' &&
      storyAutoFallbackNodeId(node.exit) === null
    ) {
      facts = {
        pathCount: 1,
        terminalNodeIds: new Set([node.nodeId]),
        durationMinMs: selfMs,
        durationMaxMs: selfMs,
      };
    } else {
      const successors = storyExitNodeIds(node.exit);
      if (successors.length > 0) {
        facts = combineSuccessorFacts(
          successors.map((next) => factsFor(next)),
          selfMs,
        );
      }
    }
    onStack.delete(nodeId);
    memo.set(nodeId, facts);
    return facts;
  };

  return { ...factsFor(entryNodeId), ambiguousPathCount: 0 };
}

/** Fold successor roll-ups into this node's, adding this node's own runtime. */
function combineSuccessorFacts(
  parts: readonly NodePathFacts[],
  selfMs: number,
): NodePathFacts {
  const live = parts.filter((part) => part.pathCount > 0);
  if (live.length === 0) return DEAD_END;
  const terminalNodeIds = new Set<string>();
  let pathCount = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  live.forEach((part) => {
    // Clamp so a pathological graph reports a huge count rather than drifting
    // out of the exact-integer range.
    pathCount = Math.min(Number.MAX_SAFE_INTEGER, pathCount + part.pathCount);
    part.terminalNodeIds.forEach((id) => terminalNodeIds.add(id));
    min = Math.min(min, part.durationMinMs ?? 0);
    max = Math.max(max, part.durationMaxMs ?? 0);
  });
  return {
    pathCount,
    terminalNodeIds,
    durationMinMs: selfMs + min,
    durationMaxMs: selfMs + max,
  };
}

function compileIntermediateRelease(
  input: StoryBuildCompilerInput,
  entryNodeId: string,
  selection: ReadonlySet<string>,
  nodes: ReadonlyMap<
    string,
    InteractiveStoryDraftContent['graph']['nodes'][number]
  >,
  includedTimelines: FrozenNodeTimeline[],
  playbackSlots: ReadonlyMap<string, StoryPlaybackSlot>,
): InteractiveFilmRelease {
  // Every clip is pinned to the project's film orientation. A still-image
  // segment carries no duration metadata: its screen time is the clip's
  // hold-last-frame endBehavior, not a media property.
  const segmentMedia = includedTimelines
    .flatMap((timeline) =>
      timeline.segments.map((segment, index) => ({
        segment,
        slot: requiredPlaybackSlot(playbackSlots, timeline.graphNodeId, index),
      })),
    )
    .map(({ segment, slot }) => {
      const variant = {
        sourceAssetId: segment.asset.assetId,
        src: segment.asset.url,
        ...(segment.asset.checksumSha256
          ? { sha256: segment.asset.checksumSha256 }
          : {}),
        ...(segment.asset.width ? { width: segment.asset.width } : {}),
        ...(segment.asset.height ? { height: segment.asset.height } : {}),
        ...(segment.kind === 'video' && segment.asset.durationMs
          ? { durationSeconds: segment.asset.durationMs / 1_000 }
          : {}),
      };
      const landscape = input.frameProfile === 'landscape_16_9';
      return {
        assetId: slot.assetId,
        kind: 'video' as const,
        orientationPolicy: 'single-master' as const,
        variants: landscape ? { landscape: variant } : { portrait: variant },
      };
    });
  const media = segmentMedia;
  const timelineByNodeId = new Map(
    includedTimelines.map((timeline) => [timeline.graphNodeId, timeline]),
  );
  const locales = collectInteractiveStoryRuntimeLocales(
    input.draft,
    input.defaultLocale,
  );
  const runtimeNodes: InteractiveFilmRelease['nodes'] = [];
  [...selection].sort().forEach((nodeId) => {
    const node = nodes.get(nodeId);
    if (!node) return;
    if (node.kind === 'decision') {
      runtimeNodes.push({
        nodeId: node.nodeId,
        title: Object.fromEntries(
          locales.map((locale) => [
            locale,
            storyNodeTitle(node, locale, input.defaultLocale),
          ]),
        ),
        presentation: { kind: 'decision' },
        overlays: [],
        interactions: [],
        ...(node.onEnterEffects ? { onEnterEffects: node.onEnterEffects } : {}),
        exit: compileExit(node),
      });
      return;
    }
    const timeline = timelineByNodeId.get(node.nodeId);
    // A scene with no footage yet stays in the story with an empty sequence,
    // on both channels. The player stands in for it and finishes on the same
    // `media-ended` outcome, so every exit downstream is unaffected — whereas
    // dropping the scene would leave the scenes that point at it referring to
    // a node the manifest no longer contains.
    const segments = timeline?.segments ?? [];
    // A choice immediately after footage still opens over that footage. Keep
    // the standalone scene too, for entry points and other incoming routes.
    const nextNodeId =
      node.exit.kind === 'auto' ? storyAutoFallbackNodeId(node.exit) : null;
    const nextNode = nextNodeId ? nodes.get(nextNodeId) : undefined;
    const exitOwner =
      nextNode?.kind === 'decision' && nextNode.exit.kind === 'choice'
        ? nextNode
        : node;
    runtimeNodes.push({
      nodeId: node.nodeId,
      communityPointPrice: node.communityPointPrice,
      title: Object.fromEntries(
        locales.map((locale) => [locale, node.name || node.clipKey]),
      ),
      presentation: {
        kind: 'video',
        // A video segment advances when its footage ends; a still segment
        // "ends" the moment it is shown and holds for its storyboard length.
        sequence: segments.map((segment, index) => {
          const slot = requiredPlaybackSlot(playbackSlots, node.nodeId, index);
          return {
            clipId: slot.sequenceClipId,
            assetId: slot.assetId,
            endBehavior:
              segment.kind === 'video'
                ? ({ behavior: 'advance' } as const)
                : ({
                    behavior: 'hold-last-frame',
                    durationMs: Math.min(
                      120_000,
                      Math.max(100, segment.durationMs),
                    ),
                  } as const),
          };
        }),
        fit: 'contain',
      },
      overlays: [],
      interactions: node.interactions,
      ...(node.onEnterEffects ? { onEnterEffects: node.onEnterEffects } : {}),
      exit: compileExit(exitOwner),
    });
  });

  // Inlining a decision over its preceding video can make its standalone
  // scene unnecessary. Prune only the compiled release, never authored nodes.
  const runtimeById = new Map(runtimeNodes.map((node) => [node.nodeId, node]));
  const reachableRuntimeIds = new Set<string>();
  const pending = [entryNodeId];
  while (pending.length > 0) {
    const nodeId = pending.pop();
    if (!nodeId || reachableRuntimeIds.has(nodeId)) continue;
    const node = runtimeById.get(nodeId);
    if (!node) continue;
    reachableRuntimeIds.add(nodeId);
    pending.push(...storyExitNodeIds(node.exit));
    for (const interaction of node.interactions) {
      for (const action of Object.values(interaction.outcomes)) {
        if (action?.kind === 'goto') {
          const targetNodeId = storyRouteNodeId(action.target);
          if (targetNodeId) pending.push(targetNodeId);
        }
      }
    }
  }
  const referencedEndingIds = new Set<string>();
  for (const node of runtimeNodes) {
    if (!reachableRuntimeIds.has(node.nodeId)) continue;
    const targets =
      node.exit.kind === 'choice'
        ? node.exit.choices.map((choice) => choice.target)
        : node.exit.routes.map((route) => route.target);
    for (const target of targets) {
      const endingId = storyRouteEndingId(target);
      if (endingId) referencedEndingIds.add(endingId);
    }
  }
  return {
    schemaVersion: INTERACTIVE_FILM_RELEASE_SCHEMA_VERSION,
    channel: input.channel,
    gameId: input.projectId,
    releaseId: input.buildId,
    contentVersion: input.buildId,
    entryNodeId,
    defaultLocale: input.defaultLocale,
    locales,
    media,
    stateVariables: (input.draft.storyBible.stateVariables ?? []).map(
      (variable) => ({
        key: variable.key,
        name: variable.name,
        valueType: variable.valueType,
        initialValue: variable.initialValue,
      }),
    ),
    endings: (input.draft.storyBible.endings ?? [])
      .filter((ending) => referencedEndingIds.has(ending.endingId))
      .map((ending) => ({
        endingId: ending.endingId,
        title: ending.title,
        kind: ending.kind,
      })),
    nodes: runtimeNodes.filter((node) => reachableRuntimeIds.has(node.nodeId)),
  };
}

function compileExit(
  node: InteractiveStoryDraftContent['graph']['nodes'][number],
): InteractiveFilmRelease['nodes'][number]['exit'] {
  const exit = node.exit;
  if (exit.kind === 'auto') {
    return { kind: 'auto', routes: exit.routes };
  }
  const prompt = releaseChoicePrompt(exit.prompt);
  return {
    kind: 'choice',
    decisionId: exit.decisionId,
    ...(prompt ? { prompt } : {}),
    choices: exit.choices.flatMap((choice) =>
      choice.target
        ? [
            {
              choiceId: choice.choiceId,
              label: choice.label,
              ...(choice.effects ? { effects: choice.effects } : {}),
              ...(choice.visibleWhen
                ? { visibleWhen: choice.visibleWhen }
                : {}),
              target: choice.target,
            },
          ]
        : [],
    ),
  };
}

/** Clip keys are only unique within a storyboard sequence; database clip IDs
 * are unique across every scene included in a build. Keep this identity shared
 * by the media table, renderer references and persisted frozen asset records.
 * Never pass an imported shot label or a canvas node id here. */
export function storyRuntimeAssetId(clipId: string): string {
  return `video:${clipId}`;
}

export type StoryPlaybackSlot = {
  assetId: string;
  sequenceClipId: string;
};

export function storyPlaybackSlotKey(
  graphNodeId: string,
  segmentIndex: number,
): string {
  return `${graphNodeId}\u0000${segmentIndex}`;
}

/** Playback ids come from clip rows. A repeated row id gets a suffix so an
 * imported shot label, or one clip attached twice, cannot fail the film. */
export function assignStoryPlaybackSlots(
  timelines: ReadonlyArray<{
    graphNodeId: string;
    segments: ReadonlyArray<{ clipId: string }>;
  }>,
): Map<string, StoryPlaybackSlot> {
  const usedAssetIds = new Set<string>();
  const slots = new Map<string, StoryPlaybackSlot>();
  timelines.forEach((timeline) => {
    const usedSequenceClipIds = new Set<string>();
    timeline.segments.forEach((segment, index) => {
      slots.set(storyPlaybackSlotKey(timeline.graphNodeId, index), {
        assetId: takeUniquePlaybackId(
          storyRuntimeAssetId(segment.clipId),
          usedAssetIds,
        ),
        sequenceClipId: takeUniquePlaybackId(
          segment.clipId,
          usedSequenceClipIds,
        ),
      });
    });
  });
  return slots;
}

function takeUniquePlaybackId(base: string, used: Set<string>): string {
  const normalized = base.trim().slice(0, 120);
  if (!used.has(normalized)) {
    used.add(normalized);
    return normalized;
  }
  let n = 2;
  while (n < 10_000) {
    const suffix = `:${n}`;
    const candidate = `${normalized.slice(0, 120 - suffix.length)}${suffix}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
    n += 1;
  }
  throw new Error(`Unable to assign a unique playback id for ${base}.`);
}

function requiredPlaybackSlot(
  slots: ReadonlyMap<string, StoryPlaybackSlot>,
  graphNodeId: string,
  segmentIndex: number,
): StoryPlaybackSlot {
  const slot = slots.get(storyPlaybackSlotKey(graphNodeId, segmentIndex));
  if (!slot) {
    throw new Error(
      `Missing playback id for ${graphNodeId} segment ${segmentIndex}.`,
    );
  }
  return slot;
}

function omitUnplayablePreviewShots(
  timelines: FrozenNodeTimeline[],
  nodes: ReadonlyMap<
    string,
    InteractiveStoryDraftContent['graph']['nodes'][number]
  >,
  diagnostics: StoryBuildDiagnosticDto[],
): FrozenNodeTimeline[] {
  return timelines.map((timeline) => {
    const scene = sceneTitle(
      nodes.get(timeline.graphNodeId),
      timeline.graphNodeId,
    );
    return {
      ...timeline,
      segments: timeline.segments.filter((segment) => {
        const url = segment.asset.url.trim();
        if (url.startsWith('/') || url.startsWith('https://')) return true;
        const shot = shotTitle(segment);
        diagnostics.push(
          diagnostic(
            'warning',
            'STORY_BUILD_VIDEO_STORAGE_UNAVAILABLE',
            `"${shot}" in "${scene}" has no playable file, so playtest skips that shot.`,
            'node',
            timeline.graphNodeId,
            { kind: 'shot', sceneTitle: scene, shotTitle: shot },
          ),
        );
        return false;
      }),
    };
  });
}

/**
 * A track is identified by its MediaAsset, not by the node that plays it: the
 * same theme bound to several scenes must carry ONE id so the player preloads
 * and crossfades a single file. Prefixed for the same reason
 * `storyRuntimeAssetId` prefixes with `video:`: every id a manifest publishes is
 * namespaced by WHAT it names, so an id read out of a cue, a log line or a
 * support ticket is self-describing and no two id spaces can be mistaken for
 * one another. (A bare UUID would pass ExperienceStableIdSchema perfectly well —
 * the pattern admits a digit-initial id — so validation is not what asks for
 * this.)
 */
export function storyMusicTrackId(mediaAssetId: string): string {
  return `audio:${mediaAssetId}`;
}

function nextNodeIds(
  node: InteractiveStoryDraftContent['graph']['nodes'][number],
): string[] {
  const interactionTargets =
    node.kind === 'clip'
      ? node.interactions.flatMap((interaction) =>
          Object.values(interaction.outcomes).flatMap((action) => {
            if (action?.kind !== 'goto') return [];
            const nodeId = storyRouteNodeId(action.target);
            return nodeId ? [nodeId] : [];
          }),
        )
      : [];
  return [...new Set([...storyExitNodeIds(node.exit), ...interactionTargets])];
}

function diagnostic(
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

function sceneTitle(
  node: InteractiveStoryDraftContent['graph']['nodes'][number] | undefined,
  fallback: string,
): string {
  if (node?.kind === 'clip' && node.name?.trim()) return node.name.trim();
  if (node?.kind === 'clip') return node.clipKey;
  return fallback;
}

function shotTitle(segment: { title?: string; clipKey: string }): string {
  const title = segment.title?.trim();
  return title || segment.clipKey;
}

function explainReleaseIssues(
  issues: ReadonlyArray<{ message: string; path: PropertyKey[] }>,
  includedTimelines: readonly FrozenNodeTimeline[],
  nodes: ReadonlyMap<
    string,
    InteractiveStoryDraftContent['graph']['nodes'][number]
  >,
  sourceDraftRevision: number,
): StoryBuildDiagnosticDto[] {
  const owners = new Map<
    string,
    Array<{ sceneTitle: string; shotTitle: string }>
  >();
  includedTimelines.forEach((timeline) => {
    const scene = sceneTitle(
      nodes.get(timeline.graphNodeId),
      timeline.graphNodeId,
    );
    timeline.segments.forEach((segment) => {
      const playbackId = storyRuntimeAssetId(segment.clipId);
      const shots = owners.get(playbackId) ?? [];
      shots.push({ sceneTitle: scene, shotTitle: shotTitle(segment) });
      owners.set(playbackId, shots);
    });
  });
  const reported = new Set<string>();
  const diagnostics: StoryBuildDiagnosticDto[] = [];
  issues.forEach((issue) => {
    const duplicate = /^Duplicate stable id (.+)$/.exec(issue.message);
    if (!duplicate) {
      diagnostics.push(
        diagnostic(
          'error',
          'STORY_BUILD_INTERMEDIATE_RUNTIME_INVALID',
          `${issue.path.join('.') || 'runtime'}: ${issue.message}`,
          'revision',
          String(sourceDraftRevision),
        ),
      );
      return;
    }
    const playbackId = duplicate[1] ?? issue.message;
    if (reported.has(playbackId)) return;
    reported.add(playbackId);
    const shots = owners.get(playbackId) ?? [];
    const described = shots
      .map((shot) => `"${shot.shotTitle}" in "${shot.sceneTitle}"`)
      .join(', ');
    diagnostics.push(
      diagnostic(
        'error',
        'STORY_BUILD_INTERMEDIATE_RUNTIME_INVALID',
        shots.length > 0
          ? `${described} share playback id ${playbackId}.`
          : `Playback id ${playbackId} was used more than once.`,
        'revision',
        String(sourceDraftRevision),
        { kind: 'duplicate-playback', playbackId, shots },
      ),
    );
  });
  return diagnostics;
}

/** A blank question is a valid choice. Drop whitespace-only copy so the release can omit it. */
function releaseChoicePrompt(
  prompt: Record<string, string>,
): Record<string, string> | undefined {
  const entries = Object.entries(prompt).filter(
    ([, text]) => text.trim().length > 0,
  );
  if (entries.length === 0) return undefined;
  return Object.fromEntries(
    entries.map(([locale, text]) => [locale, text.trim()]),
  );
}

function storyNodeTitle(
  node: InteractiveStoryDraftContent['graph']['nodes'][number],
  locale: string,
  defaultLocale: string,
): string {
  if (node.kind !== 'decision') return node.name || node.nodeId;
  return (
    (node.exit.kind === 'choice' &&
      (node.exit.prompt[locale] || node.exit.prompt[defaultLocale])) ||
    node.nodeId
  );
}

function sortAndDedupeDiagnostics(
  diagnostics: StoryBuildDiagnosticDto[],
): StoryBuildDiagnosticDto[] {
  const unique = new Map<string, StoryBuildDiagnosticDto>();
  diagnostics.forEach((item) => {
    unique.set(
      [
        item.severity,
        item.code,
        item.entityType ?? '',
        item.entityId ?? '',
        item.message,
      ].join('\u0000'),
      item,
    );
  });
  return [...unique.values()].sort(
    (left, right) =>
      Number(left.severity === 'warning') -
        Number(right.severity === 'warning') ||
      left.code.localeCompare(right.code) ||
      (left.entityId ?? '').localeCompare(right.entityId ?? '') ||
      left.message.localeCompare(right.message),
  );
}
