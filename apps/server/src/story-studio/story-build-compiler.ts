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

export interface StoryBuildVideoInput {
  graphNodeId: string;
  selectionVersion: number;
  asset: FrozenStoryVideoAsset | null;
  eligibilityDiagnostics: StoryBuildDiagnosticDto[];
}

export interface StoryBuildWorldInput {
  graphNodeId: string;
  worldId: string;
  status: 'generating' | 'ready' | 'failed';
}

type FrozenStoryBuildVideoInput = StoryBuildVideoInput & {
  asset: FrozenStoryVideoAsset;
};

/**
 * The project cover as a release carries it: a PLAIN MEDIA REFERENCE like a
 * music bed, resolved to the ordinary public media URL, NOT a frozen build
 * asset. Losing a cover costs a title screen its backdrop; it does not break a
 * story, so it must never be able to fail or block a Build.
 *
 * Every field is non-optional because the runtime image contract makes them so:
 * `sha256`, `width` and `height` are all REQUIRED on an image variant (video
 * relaxes exactly those three). An asset that cannot supply them is not a
 * usable cover at all, which is why deciding that is the resolver's job and the
 * compiler only ever sees a complete reference.
 */
export interface StoryCoverMediaReference {
  mediaAssetId: string;
  url: string;
  sha256: string;
  width: number;
  height: number;
  mediaType: string;
}

/**
 * Mirrors {@link StoryBuildVideoInput}: the database layer decides whether the
 * cover can ship and says why when it cannot. `asset: null` with diagnostics is
 * "the creator set a cover that cannot be published"; the diagnostics are
 * WARNINGS, so the Build still succeeds and the creator still learns why their
 * cover is missing instead of silently getting a black title screen.
 */
export interface StoryBuildCoverInput {
  asset: StoryCoverMediaReference | null;
  eligibilityDiagnostics: StoryBuildDiagnosticDto[];
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
  videos: StoryBuildVideoInput[];
  worlds?: StoryBuildWorldInput[];
  /**
   * Playable URL per bound music MediaAsset id — a plain public media URL, not
   * a frozen build asset. A binding missing from this map simply gets no music,
   * which is why nothing here can ever produce a diagnostic.
   */
  musicUrls?: ReadonlyMap<string, string>;
  /** Absent for a project with no cover — the common case, and no diagnostic. */
  cover?: StoryBuildCoverInput;
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
  const diagnostics = [
    ...(input.diagnostics ?? []),
    ...(input.cover?.eligibilityDiagnostics ?? []),
  ];
  const nodes = new Map(
    input.draft.graph.nodes.map((node) => [node.nodeId, node]),
  );
  const videos = new Map<string, StoryBuildVideoInput>();
  input.videos.forEach((video) => {
    if (videos.has(video.graphNodeId)) {
      diagnostics.push(
        diagnostic(
          'error',
          'STORY_BUILD_VIDEO_SELECTION_DUPLICATE',
          `Graph node ${video.graphNodeId} has more than one frozen current video.`,
          'clip',
          video.graphNodeId,
        ),
      );
      return;
    }
    videos.set(video.graphNodeId, video);
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
  const includedVideos = [...requiredGraphNodeIds]
    .flatMap((graphNodeId) => {
      const video = videos.get(graphNodeId);
      if (video) diagnostics.push(...video.eligibilityDiagnostics);
      if (video?.asset) return [video as FrozenStoryBuildVideoInput];
      const node = nodes.get(graphNodeId);
      // Missing footage stops a release and only annotates a preview: the whole
      // point of a preview is to walk a work that is not finished yet.
      diagnostics.push(
        diagnostic(
          input.channel === 'preview' ? 'warning' : 'error',
          'STORY_BUILD_CURRENT_VIDEO_REQUIRED',
          `Clip ${node?.kind === 'clip' ? node.clipKey : graphNodeId} has no current video selection.`,
          'clip',
          graphNodeId,
        ),
      );
      return [];
    })
    .sort((left, right) => left.graphNodeId.localeCompare(right.graphNodeId));
  includedVideos.forEach((video) => validateFrozenVideo(video, diagnostics));

  const analysis = analyzePaths(
    entryNodeId,
    nodes,
    videos,
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
      videos,
      includedVideos,
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
      const cover = input.cover?.asset ?? null;
      const mediaIdentities: StoryExperienceMediaIdentity[] = [
        ...includedVideos.map((video) => ({
          runtimeAssetId: storyRuntimeAssetId(
            clipNodeById(nodes, video.graphNodeId).clipKey,
          ),
          variantId: video.asset.variantId,
          mediaType: video.asset.contentType,
        })),
        ...(cover
          ? [
              {
                runtimeAssetId: storyCoverAssetId(cover.mediaAssetId),
                variantId: storyCoverVariantId(cover.mediaAssetId),
                mediaType: cover.mediaType,
              },
            ]
          : []),
      ];
      const compiled = compileStoryExperienceManifest({
        release: release.data,
        experienceProfile: 'cinematic',
        metadata: {
          ...input.metadata,
          // Set together with the `media` entry above or not at all: a manifest
          // whose coverAssetId does not resolve fails its own validation, so the
          // pair is only ever emitted as a pair.
          ...(cover
            ? { coverAssetId: storyCoverAssetId(cover.mediaAssetId) }
            : {}),
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
    includedGraphNodeIds: includedVideos.map((video) => video.graphNodeId),
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
function validateFrozenVideo(
  video: FrozenStoryBuildVideoInput,
  diagnostics: StoryBuildDiagnosticDto[],
): void {
  const asset = video.asset;
  if (
    asset.checksumSha256 !== null &&
    !/^[a-f0-9]{64}$/.test(asset.checksumSha256)
  ) {
    diagnostics.push(
      diagnostic(
        'warning',
        'STORY_BUILD_VIDEO_CHECKSUM_INVALID',
        `Current video for ${video.graphNodeId} has no valid immutable SHA-256 checksum.`,
        'asset',
        asset.assetId,
      ),
    );
  }
  if (!asset.contentType.toLowerCase().startsWith('video/')) {
    diagnostics.push(
      diagnostic(
        'error',
        'STORY_BUILD_VIDEO_CONTENT_TYPE_INVALID',
        `Current video for ${video.graphNodeId} has non-video content type ${asset.contentType}.`,
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
        `Current video for ${video.graphNodeId} has invalid duration metadata.`,
        'asset',
        asset.assetId,
      ),
    );
  }
  if (
    asset.checksumSha256 === null ||
    asset.durationMs === null ||
    asset.width === null ||
    asset.height === null ||
    asset.browserSafeMp4 !== true
  ) {
    diagnostics.push(
      diagnostic(
        'warning',
        'STORY_BUILD_VIDEO_METADATA_INCOMPLETE',
        `Current video for ${video.graphNodeId} has incomplete technical metadata; the original video will still be published.`,
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
  videos: ReadonlyMap<string, StoryBuildVideoInput>,
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
        : (videos.get(node.nodeId)?.asset?.durationMs ?? 0);

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
          successors.push(choice.nextNodeId);
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
  videos: ReadonlyMap<string, StoryBuildVideoInput>,
  includedVideos: FrozenStoryBuildVideoInput[],
): InteractiveFilmRelease {
  // Every clip is pinned to the project's film orientation.
  const videoMedia = includedVideos.map((video) => {
    const node = clipNodeById(nodes, video.graphNodeId);
    const variant = {
      sourceAssetId: video.asset.assetId,
      src: video.asset.url,
      ...(video.asset.checksumSha256
        ? { sha256: video.asset.checksumSha256 }
        : {}),
      ...(video.asset.width ? { width: video.asset.width } : {}),
      ...(video.asset.height ? { height: video.asset.height } : {}),
      ...(video.asset.durationMs
        ? { durationSeconds: video.asset.durationMs / 1_000 }
        : {}),
    };
    const landscape = input.frameProfile === 'landscape_16_9';
    return {
      assetId: storyRuntimeAssetId(node.clipKey),
      kind: 'video' as const,
      orientationPolicy: 'single-master' as const,
      variants: landscape ? { landscape: variant } : { portrait: variant },
    };
  });
  const media = [...videoMedia, ...coverMedia(input.cover?.asset ?? null)];
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
    const video = videos.get(node.nodeId);
    // A preview keeps the shot in the story with an empty sequence so the work
    // stays playable end to end while its footage is still being made; the
    // player stands in for it and finishes on the same `media-ended` outcome, so
    // every exit downstream is unaffected. A release still requires the clip —
    // `STORY_BUILD_CURRENT_VIDEO_REQUIRED` is raised for it either way, and it
    // is an error only on the release path.
    const hasFootage = Boolean(video?.asset);
    if (!video && input.channel !== 'preview') return;
    runtimeNodes.push({
      nodeId: node.nodeId,
      presentation: {
        kind: 'video',
        sequence: hasFootage
          ? [
              {
                clipId: node.nodeId,
                assetId: storyRuntimeAssetId(node.clipKey),
                endBehavior: { behavior: 'advance' },
              },
            ]
          : [],
        fit: 'cover',
      },
      overlays: [],
      interactions: node.interactions,
      exit: compileExit(node),
    });
  });
  const locales = collectInteractiveStoryRuntimeLocales(
    input.draft,
    input.defaultLocale,
  );
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
    nodes: runtimeNodes,
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
    choices: exit.choices.map((choice) => ({
      choiceId: choice.choiceId,
      label: choice.label,
      nextNodeId: choice.nextNodeId,
    })),
  };
}

function clipNodeById(
  nodes: ReadonlyMap<
    string,
    InteractiveStoryDraftContent['graph']['nodes'][number]
  >,
  graphNodeId: string,
): Extract<
  InteractiveStoryDraftContent['graph']['nodes'][number],
  { kind: 'clip' }
> {
  const node = nodes.get(graphNodeId);
  if (!node || node.kind !== 'clip') {
    throw new Error(
      `Frozen video ${graphNodeId} does not identify a clip node.`,
    );
  }
  return node;
}

/**
 * The cover as an intermediate-release image asset, or nothing at all.
 *
 * `single-master`: one authored rendition, the asset's own public object. The
 * intermediate layer keys visual variants by `landscape`/`portrait` only, so the
 * orientation is read off the real pixels — a square cover lands under
 * `landscape`, which costs nothing because a single-variant asset is what every
 * consumer resolves to regardless of the viewport (the player falls back to the
 * first variant when no orientation matches).
 */
function coverMedia(
  cover: StoryCoverMediaReference | null,
): InteractiveFilmRelease['media'] {
  if (!cover) return [];
  const variant = {
    sourceAssetId: cover.mediaAssetId,
    sha256: cover.sha256,
    src: cover.url,
    width: cover.width,
    height: cover.height,
  };
  return [
    {
      assetId: storyCoverAssetId(cover.mediaAssetId),
      kind: 'image' as const,
      orientationPolicy: 'single-master' as const,
      variants:
        cover.width >= cover.height
          ? { landscape: variant }
          : { portrait: variant },
    },
  ];
}

export function storyRuntimeAssetId(clipKey: string): string {
  return `video:${clipKey}`;
}

/**
 * A cover is identified by its MediaAsset for the same reason a music track is
 * (see {@link storyMusicTrackId}): the file is the identity, so the same image
 * used twice is one asset. Namespaced by WHAT it is rather than by the role it
 * plays here, so if a scene ever presents that same image it resolves to this
 * one entry instead of publishing the bytes twice under two names.
 */
export function storyCoverAssetId(mediaAssetId: string): string {
  return `image:${mediaAssetId}`;
}

/**
 * A plain media reference has no frozen `MediaAssetVariant` row to borrow an id
 * from — that is the whole point of not putting the cover on the build-asset
 * route — so the single rendition is named after the asset and the object it
 * resolves to.
 */
export function storyCoverVariantId(mediaAssetId: string): string {
  return `${storyCoverAssetId(mediaAssetId)}:original`;
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
      ? node.exit.choices.map((choice) => choice.nextNodeId)
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
