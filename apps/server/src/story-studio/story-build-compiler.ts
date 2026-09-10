import {
  INTERACTIVE_FILM_RELEASE_SCHEMA_VERSION,
  InteractiveFilmReleaseSchema,
  type InteractiveFilmRelease,
} from '@repo/shared/interactive-film-runtime';
import type { ExperienceRuntimeManifest } from '@repo/shared/experience-runtime';
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

export interface StoryBuildWorldInput {
  graphNodeId: string;
  worldId: string;
  status: 'generating' | 'ready' | 'failed';
}

type FrozenStoryBuildSegment = StoryBuildSegmentInput & {
  asset: FrozenStoryVideoAsset;
};

interface FrozenNodeTimeline {
  graphNodeId: string;
  segments: FrozenStoryBuildSegment[];
}

export interface StoryBuildCompilerInput {
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
  worlds?: StoryBuildWorldInput[];
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
  const worlds = new Map<string, StoryBuildWorldInput>();
  (input.worlds ?? []).forEach((world) => {
    if (worlds.has(world.graphNodeId)) {
      diagnostics.push(
        diagnostic(
          'error',
          'STORY_BUILD_WORLD_BINDING_DUPLICATE',
          `Graph node ${world.graphNodeId} has more than one world binding.`,
          'revision',
          world.graphNodeId,
        ),
      );
      return;
    }
    worlds.set(world.graphNodeId, world);
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
  validateWorldBindings(runtimeSelection, nodes, worlds, diagnostics);
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
      const nodeLabel = node?.kind === 'clip' ? node.clipKey : graphNodeId;
      const timeline = timelines.get(graphNodeId);
      // The storyboard sequence is the node's production plan; a node without
      // one has never been planned and carries no playable content yet. That
      // is reported, not refused.
      if (!timeline || timeline.sequenceId === null) {
        diagnostics.push(
          diagnostic(
            missingSeverity,
            'STORY_BUILD_SEQUENCE_REQUIRED',
            `Scene ${nodeLabel} has no storyboard sequence to play.`,
            'clip',
            graphNodeId,
          ),
        );
        return { graphNodeId, segments: [] };
      }
      const segments = timeline.segments.flatMap((segment) => {
        diagnostics.push(...segment.eligibilityDiagnostics);
        if (segment.asset) return [segment as FrozenStoryBuildSegment];
        diagnostics.push(
          diagnostic(
            missingSeverity,
            'STORY_BUILD_CLIP_MEDIA_REQUIRED',
            `Storyboard clip ${segment.clipKey} of scene ${nodeLabel} has no selected media.`,
            'clip',
            graphNodeId,
          ),
        );
        return [];
      });
      if (timeline.segments.length === 0) {
        diagnostics.push(
          diagnostic(
            missingSeverity,
            'STORY_BUILD_CLIP_MEDIA_REQUIRED',
            `Scene ${nodeLabel} has an empty storyboard timeline.`,
            'clip',
            graphNodeId,
          ),
        );
      }
      return { graphNodeId, segments };
    });
  const includedSegments = includedTimelines.flatMap(
    (timeline) => timeline.segments,
  );
  includedSegments.forEach((segment) =>
    validateFrozenSegment(segment, diagnostics),
  );

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
    const releaseCandidate = compileIntermediateRelease(
      input,
      entryNodeId,
      runtimeSelection,
      nodes,
      includedTimelines,
    );
    const release = InteractiveFilmReleaseSchema.safeParse(releaseCandidate);
    if (!release.success) {
      release.error.issues.forEach((issue) =>
        diagnostics.push(
          diagnostic(
            'error',
            'STORY_BUILD_INTERMEDIATE_RUNTIME_INVALID',
            `${issue.path.join('.') || 'runtime'}: ${issue.message}`,
            'revision',
            String(input.sourceDraftRevision),
          ),
        ),
      );
    } else {
      const mediaIdentities: StoryExperienceMediaIdentity[] =
        includedSegments.map((segment) => ({
          runtimeAssetId: storyRuntimeAssetId(segment.clipKey),
          variantId: segment.asset.variantId,
          mediaType: segment.asset.contentType,
        }));
      const compiled = compileStoryExperienceManifest({
        release: release.data,
        experienceProfile: 'cinematic',
        metadata: {
          ...input.metadata,
        },
        mediaIdentities,
      });
      compiled.diagnostics.forEach((item) =>
        diagnostics.push(
          diagnostic(
            'error',
            item.code,
            item.message,
            'revision',
            String(input.sourceDraftRevision),
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
    includedGraphNodeIds: includedTimelines
      .filter((timeline) => timeline.segments.length > 0)
      .map((timeline) => timeline.graphNodeId),
  };
}

function validateWorldBindings(
  selection: ReadonlySet<string>,
  nodes: ReadonlyMap<
    string,
    InteractiveStoryDraftContent['graph']['nodes'][number]
  >,
  worlds: ReadonlyMap<string, StoryBuildWorldInput>,
  diagnostics: StoryBuildDiagnosticDto[],
) {
  [...selection].sort().forEach((nodeId) => {
    const node = nodes.get(nodeId);
    if (!node || node.kind !== 'world') return;
    const binding = worlds.get(nodeId);
    if (!node.worldId || !binding || binding.worldId !== node.worldId) {
      diagnostics.push(
        diagnostic(
          'error',
          'STORY_BUILD_WORLD_UNAVAILABLE',
          `World node ${nodeId} does not resolve to a world in this project.`,
          'revision',
          nodeId,
        ),
      );
      return;
    }
    if (binding.status !== 'ready') {
      diagnostics.push(
        diagnostic(
          'error',
          'STORY_BUILD_WORLD_NOT_READY',
          `World node ${nodeId} is ${binding.status}; wait until the world is ready before playtesting or publishing.`,
          'revision',
          nodeId,
        ),
      );
    }
  });
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
  diagnostics: StoryBuildDiagnosticDto[],
): void {
  const asset = segment.asset;
  const expectedPrefix = segment.kind === 'video' ? 'video/' : 'image/';
  if (
    asset.checksumSha256 !== null &&
    !/^[a-f0-9]{64}$/.test(asset.checksumSha256)
  ) {
    diagnostics.push(
      diagnostic(
        'warning',
        'STORY_BUILD_VIDEO_CHECKSUM_INVALID',
        `Storyboard clip ${segment.clipKey} has no valid immutable SHA-256 checksum.`,
        'asset',
        asset.assetId,
      ),
    );
  }
  if (!asset.contentType.toLowerCase().startsWith(expectedPrefix)) {
    diagnostics.push(
      diagnostic(
        'error',
        'STORY_BUILD_VIDEO_CONTENT_TYPE_INVALID',
        `Storyboard clip ${segment.clipKey} resolves to ${asset.contentType}, not a ${segment.kind} media type.`,
        'asset',
        asset.assetId,
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
        `Storyboard clip ${segment.clipKey} has invalid duration metadata.`,
        'asset',
        asset.assetId,
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
        `Storyboard clip ${segment.clipKey} has incomplete technical metadata; the original video will still be published.`,
        'asset',
        asset.assetId,
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
      node.kind === 'world'
        ? node.maxExperienceSeconds * 1_000
        : (timelines
            .get(node.nodeId)
            ?.segments.reduce(
              (total, segment) => total + segment.durationMs,
              0,
            ) ?? 0);

    let facts: NodePathFacts = DEAD_END;
    if (node.exit.kind === 'auto' && node.exit.nextNodeId === null) {
      facts = {
        pathCount: 1,
        terminalNodeIds: new Set([node.nodeId]),
        durationMinMs: selfMs,
        durationMaxMs: selfMs,
      };
    } else {
      const successors: string[] = [];
      if (node.exit.kind === 'choice') {
        node.exit.choices.forEach((choice) => {
          if (choice.nextNodeId) successors.push(choice.nextNodeId);
        });
      } else if (node.exit.nextNodeId) {
        successors.push(node.exit.nextNodeId);
      }
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
): InteractiveFilmRelease {
  // Every clip is pinned to the project's film orientation. A still-image
  // segment carries no duration metadata: its screen time is the clip's
  // hold-last-frame endBehavior, not a media property.
  const segmentMedia = includedTimelines
    .flatMap((timeline) => timeline.segments)
    .map((segment) => {
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
        assetId: storyRuntimeAssetId(segment.clipKey),
        kind: 'video' as const,
        orientationPolicy: 'single-master' as const,
        variants: landscape ? { landscape: variant } : { portrait: variant },
      };
    });
  const media = segmentMedia;
  const timelineByNodeId = new Map(
    includedTimelines.map((timeline) => [timeline.graphNodeId, timeline]),
  );
  const runtimeNodes: InteractiveFilmRelease['nodes'] = [];
  [...selection].sort().forEach((nodeId) => {
    const node = nodes.get(nodeId);
    if (!node) return;
    if (node.kind === 'world') {
      if (!node.worldId) return;
      runtimeNodes.push({
        nodeId: node.nodeId,
        presentation: {
          kind: 'world',
          worldId: node.worldId,
          ...(node.entryInstruction
            ? { entryInstruction: node.entryInstruction }
            : {}),
          maxExperienceSeconds: node.maxExperienceSeconds,
        },
        overlays: [],
        interactions: [],
        exit: compileExit(node),
      });
      return;
    }
    if (node.kind === 'decision') {
      runtimeNodes.push({
        nodeId: node.nodeId,
        presentation: { kind: 'decision' },
        overlays: [],
        interactions: [],
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
    const nextNode =
      node.exit.kind === 'auto' && node.exit.nextNodeId
        ? nodes.get(node.exit.nextNodeId)
        : undefined;
    const exitOwner =
      nextNode?.kind === 'decision' && nextNode.exit.kind === 'choice'
        ? nextNode
        : node;
    runtimeNodes.push({
      nodeId: node.nodeId,
      presentation: {
        kind: 'video',
        // A video segment advances when its footage ends; a still segment
        // "ends" the moment it is shown and holds for its storyboard length.
        sequence: segments.map((segment) => ({
          clipId: segment.clipId,
          assetId: storyRuntimeAssetId(segment.clipKey),
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
        })),
        fit: 'cover',
      },
      overlays: [],
      interactions: node.interactions,
      exit: compileExit(exitOwner),
    });
  });
  const locales = collectInteractiveStoryRuntimeLocales(
    input.draft,
    input.defaultLocale,
  );
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
    if (node.exit.kind === 'auto') {
      if (node.exit.nextNodeId) pending.push(node.exit.nextNodeId);
    } else if (node.exit.kind === 'choice') {
      pending.push(...node.exit.choices.map((choice) => choice.nextNodeId));
    }
    for (const interaction of node.interactions) {
      for (const action of Object.values(interaction.outcomes)) {
        if (action?.kind === 'goto') pending.push(action.nodeId);
      }
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
    nodes: runtimeNodes.filter((node) => reachableRuntimeIds.has(node.nodeId)),
  };
}

function compileExit(
  node: InteractiveStoryDraftContent['graph']['nodes'][number],
): InteractiveFilmRelease['nodes'][number]['exit'] {
  const exit = node.exit;
  if (exit.kind === 'auto') {
    return { kind: 'auto', nextNodeId: exit.nextNodeId };
  }
  return {
    kind: 'choice',
    decisionId: exit.decisionId,
    prompt: exit.prompt,
    choices: exit.choices.flatMap((choice) =>
      choice.nextNodeId
        ? [
            {
              choiceId: choice.choiceId,
              label: choice.label,
              nextNodeId: choice.nextNodeId,
            },
          ]
        : [],
    ),
  };
}

export function storyRuntimeAssetId(clipKey: string): string {
  return `video:${clipKey}`;
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
  const exitTargets =
    node.exit.kind === 'choice'
      ? node.exit.choices.flatMap((choice) =>
          choice.nextNodeId ? [choice.nextNodeId] : [],
        )
      : node.exit.nextNodeId
        ? [node.exit.nextNodeId]
        : [];
  const interactionTargets =
    node.kind === 'clip'
      ? node.interactions.flatMap((interaction) =>
          Object.values(interaction.outcomes).flatMap((action) =>
            action?.kind === 'goto' ? [action.nodeId] : [],
          ),
        )
      : [];
  return [...new Set([...exitTargets, ...interactionTargets])];
}

function diagnostic(
  severity: StoryBuildDiagnosticDto['severity'],
  code: string,
  message: string,
  entityType: StoryBuildDiagnosticDto['entityType'],
  entityId: string | null,
): StoryBuildDiagnosticDto {
  return { severity, code, message, entityType, entityId };
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
