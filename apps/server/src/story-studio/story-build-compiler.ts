import {
  INTERACTIVE_FILM_RELEASE_SCHEMA_VERSION,
  InteractiveFilmReleaseSchema,
  STORY_CHECKPOINT_CONTINUE_ACTION_ID,
  STORY_CHECKPOINT_RENDERER_ID,
  type InteractiveFilmRelease,
  type RuntimeSessionEffect,
} from '@repo/shared/interactive-film-runtime';
import type { ExperienceRuntimeManifest } from '@repo/shared/experience-runtime';
import type {
  StoryBuildDiagnosticDto,
  StoryBuildPathReportDto,
  StoryFrameProfile,
} from './dto';
import {
  collectInteractiveFilmRuntimeLocales,
  type FilmCondition,
  type FilmEffect,
  type InteractiveFilmDraftContent,
  type StoryBuildScope,
  type StoryScalarValue,
  type StoryStateVariable,
} from './interactive-film.schema';
import {
  compileStoryExperienceManifest,
  type StoryExperienceMediaIdentity,
} from './story-experience-manifest-compiler';

const MAX_ENUMERATED_PATHS = 10_000;
const MAX_EXPLORED_PATH_STATES = 10_000;
const MAX_PATH_STEPS = 2_000;

export interface FrozenStoryVideoAsset {
  assetId: string;
  variantId: string;
  checksumSha256: string;
  contentType: string;
  sizeBytes: bigint | null;
  width: number;
  height: number;
  durationMs: number;
  hasAudio: boolean;
  browserSafeMp4: true;
  url: string;
}

export interface StoryBuildVideoInput {
  graphNodeId: string;
  sourceGenerationId: string | null;
  selectionVersion: number;
  asset: FrozenStoryVideoAsset | null;
  eligibilityDiagnostics: StoryBuildDiagnosticDto[];
}

type FrozenStoryBuildVideoInput = StoryBuildVideoInput & {
  asset: FrozenStoryVideoAsset;
};

export interface StoryBuildCompilerInput {
  projectId: string;
  buildId: string;
  sourceDraftRevision: number;
  channel: 'preview' | 'production';
  scope: StoryBuildScope;
  frameProfile: StoryFrameProfile;
  defaultLocale: string;
  metadata: { title: string; summary: string | null };
  draft: InteractiveFilmDraftContent;
  videos: StoryBuildVideoInput[];
  diagnostics?: StoryBuildDiagnosticDto[];
}

export interface StoryBuildCompilerResult {
  diagnostics: StoryBuildDiagnosticDto[];
  pathReport: StoryBuildPathReportDto;
  runtime: ExperienceRuntimeManifest | null;
  includedGraphNodeIds: string[];
}

interface RuntimeState {
  variables: Record<string, StoryScalarValue>;
  flags: Record<string, boolean>;
  relationships: Record<string, number>;
  unlockedEndings: Set<string>;
}

interface EnumeratedPath {
  endingId: string;
  durationMs: number;
}

/**
 * Deterministically compiles one v3 story snapshot and its exact frozen video
 * selections to Runtime Manifest v2. The compiler has no production-plan
 * inputs and never invents media metadata or duration defaults.
 */
export function compileStoryBuild(
  input: StoryBuildCompilerInput,
): StoryBuildCompilerResult {
  const diagnostics = [...(input.diagnostics ?? [])];
  const nodes = new Map(
    input.draft.graph.nodes.map((node) => [node.nodeId, node]),
  );
  const clipNodeByKey = new Map(
    input.draft.graph.nodes.flatMap((node) =>
      node.kind === 'clip' ? [[node.clipKey, node] as const] : [],
    ),
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
        'error',
        'STORY_BUILD_UNREACHABLE_NODE',
        `Node ${nodeId} is unreachable from Build entry ${entryNodeId ?? '<missing>'}.`,
        'revision',
        nodeId,
      ),
    ),
  );
  detectStructuralCycles(entryNodeId, nodes, selection, diagnostics);

  const requiredGraphNodeIds = requiredVideoNodeIds(
    selection,
    nodes,
    clipNodeByKey,
    diagnostics,
  );
  const includedVideos = [...requiredGraphNodeIds]
    .flatMap((graphNodeId) => {
      const video = videos.get(graphNodeId);
      if (video) diagnostics.push(...video.eligibilityDiagnostics);
      if (video?.asset) return [video as FrozenStoryBuildVideoInput];
      const node = nodes.get(graphNodeId);
      diagnostics.push(
        diagnostic(
          'error',
          'STORY_BUILD_CURRENT_VIDEO_REQUIRED',
          `Clip ${node?.kind === 'clip' ? node.clipKey : graphNodeId} has no current video selection.`,
          'clip',
          graphNodeId,
        ),
      );
      return [];
    })
    .sort((left, right) => left.graphNodeId.localeCompare(right.graphNodeId));
  includedVideos.forEach((video) =>
    validateFrozenVideo(video, input.frameProfile, diagnostics),
  );

  [...selection].forEach((nodeId) => {
    const node = nodes.get(nodeId);
    if (node?.kind !== 'clip' || node.exit.kind !== 'choice') return;
    if (node.exit.trigger.kind !== 'timecode') return;
    const durationMs = videos.get(node.nodeId)?.asset?.durationMs;
    if (durationMs === undefined) return;
    if (node.exit.trigger.atMs >= durationMs) {
      diagnostics.push(
        diagnostic(
          'error',
          'STORY_BUILD_CHOICE_TIMECODE_OUT_OF_RANGE',
          `Decision ${node.exit.decisionId} triggers at ${node.exit.trigger.atMs}ms, but current video ${node.clipKey} is only ${durationMs}ms long.`,
          'choice',
          node.exit.decisionId,
        ),
      );
    }
  });

  const enumeration = enumeratePaths(
    entryNodeId,
    nodes,
    videos,
    clipNodeByKey,
    selection,
    initialRuntimeState(input.draft),
    input.draft.storyBible.stateVariables,
    diagnostics,
  );
  const durations = enumeration.paths.map((path) => path.durationMs);
  const pathReport: StoryBuildPathReportDto = {
    enumeratedPathCount: enumeration.paths.length,
    reachableEndingIds: [
      ...new Set(enumeration.paths.map((path) => path.endingId)),
    ].sort(),
    unreachableNodeIds,
    ambiguousPathCount: enumeration.ambiguousPathCount,
    durationMinMs: durations.length > 0 ? Math.min(...durations) : 0,
    durationMaxMs: durations.length > 0 ? Math.max(...durations) : 0,
  };
  if (pathReport.reachableEndingIds.length === 0) {
    diagnostics.push(
      diagnostic(
        'error',
        'STORY_BUILD_NO_REACHABLE_ENDING',
        'The selected graph has no reachable ending.',
        'ending',
        null,
      ),
    );
  }
  if (input.scope.kind === 'full') {
    const reachableEndingIds = new Set(pathReport.reachableEndingIds);
    input.draft.storyBible.endings.forEach((ending) => {
      if (reachableEndingIds.has(ending.id)) return;
      diagnostics.push(
        diagnostic(
          'error',
          'STORY_BUILD_ENDING_UNREACHABLE',
          `Authored ending ${ending.id} is not reachable from the story entry.`,
          'ending',
          ending.id,
        ),
      );
    });
  }

  let runtime: ExperienceRuntimeManifest | null = null;
  if (!diagnostics.some((item) => item.severity === 'error') && entryNodeId) {
    const releaseCandidate = compileIntermediateRelease(
      input,
      entryNodeId,
      selection,
      nodes,
      videos,
      clipNodeByKey,
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
      const mediaIdentities: StoryExperienceMediaIdentity[] =
        includedVideos.map((video) => ({
          runtimeAssetId: storyRuntimeAssetId(
            clipNodeById(nodes, video.graphNodeId).clipKey,
          ),
          variantId: video.asset.variantId,
          mediaType: video.asset.contentType,
        }));
      const compiled = compileStoryExperienceManifest({
        release: release.data,
        metadata: input.metadata,
        stateVariables: input.draft.storyBible.stateVariables,
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

function resolveEntryNodeId(
  input: StoryBuildCompilerInput,
  nodes: ReadonlyMap<
    string,
    InteractiveFilmDraftContent['graph']['nodes'][number]
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
        'The saved v3 story has no Build entry node.',
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
        `Build entry node ${entryNodeId} does not exist in the saved v3 story.`,
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
    InteractiveFilmDraftContent['graph']['nodes'][number]
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
    InteractiveFilmDraftContent['graph']['nodes'][number]
  >,
  clipNodeByKey: ReadonlyMap<
    string,
    Extract<
      InteractiveFilmDraftContent['graph']['nodes'][number],
      { kind: 'clip' }
    >
  >,
  diagnostics: StoryBuildDiagnosticDto[],
): Set<string> {
  const required = new Set<string>();
  [...selection].forEach((nodeId) => {
    const node = nodes.get(nodeId);
    if (node?.kind !== 'clip') return;
    required.add(node.nodeId);
    if (node.exit.kind !== 'choice') return;
    node.exit.choices.forEach((choice) => {
      if (choice.afterSelect.kind !== 'play') return;
      const reactionNode = clipNodeByKey.get(
        choice.afterSelect.reactionClipKey,
      );
      if (reactionNode) {
        required.add(reactionNode.nodeId);
        return;
      }
      diagnostics.push(
        diagnostic(
          'error',
          'STORY_BUILD_REACTION_CLIP_MISSING',
          `Reaction clip ${choice.afterSelect.reactionClipKey} is not defined in the saved v3 story.`,
          'choice',
          choice.choiceId,
        ),
      );
    });
  });
  return required;
}

function validateFrozenVideo(
  video: FrozenStoryBuildVideoInput,
  frameProfile: StoryFrameProfile,
  diagnostics: StoryBuildDiagnosticDto[],
): void {
  const asset = video.asset;
  const expected =
    frameProfile === 'landscape_16_9'
      ? { width: 1920, height: 1080 }
      : { width: 1080, height: 1920 };
  if (!/^[a-f0-9]{64}$/.test(asset.checksumSha256)) {
    diagnostics.push(
      diagnostic(
        'error',
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
  if (!Number.isInteger(asset.durationMs) || asset.durationMs <= 0) {
    diagnostics.push(
      diagnostic(
        'error',
        'STORY_BUILD_VIDEO_DURATION_INVALID',
        `Current video for ${video.graphNodeId} has invalid duration metadata.`,
        'asset',
        asset.assetId,
      ),
    );
  }
  if (asset.width !== expected.width || asset.height !== expected.height) {
    diagnostics.push(
      diagnostic(
        'error',
        'STORY_BUILD_VIDEO_FRAME_MISMATCH',
        `Current video for ${video.graphNodeId} is ${asset.width}×${asset.height}; project frame requires ${expected.width}×${expected.height}.`,
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
    InteractiveFilmDraftContent['graph']['nodes'][number]
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
    InteractiveFilmDraftContent['graph']['nodes'][number]
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
                'error',
                'STORY_BUILD_GRAPH_CYCLE',
                `The story graph contains a cycle (${edge}).`,
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

function enumeratePaths(
  entryNodeId: string | null,
  nodes: ReadonlyMap<
    string,
    InteractiveFilmDraftContent['graph']['nodes'][number]
  >,
  videos: ReadonlyMap<string, StoryBuildVideoInput>,
  clipNodeByKey: ReadonlyMap<
    string,
    Extract<
      InteractiveFilmDraftContent['graph']['nodes'][number],
      { kind: 'clip' }
    >
  >,
  selection: ReadonlySet<string>,
  initialState: RuntimeState,
  stateVariables: StoryStateVariable[],
  diagnostics: StoryBuildDiagnosticDto[],
): { paths: EnumeratedPath[]; ambiguousPathCount: number } {
  if (!entryNodeId || !selection.has(entryNodeId)) {
    return { paths: [], ambiguousPathCount: 0 };
  }
  const paths: EnumeratedPath[] = [];
  let ambiguousPathCount = 0;
  let explored = 0;
  let aborted = false;
  const reported = new Set<string>();
  const reportOnce = (item: StoryBuildDiagnosticDto) => {
    const key = `${item.code}\u0000${item.entityId ?? ''}\u0000${item.message}`;
    if (reported.has(key)) return;
    reported.add(key);
    diagnostics.push(item);
  };
  const walk = (
    nodeId: string,
    state: RuntimeState,
    durationMs: number,
    active: ReadonlySet<string>,
    steps: number,
  ): void => {
    if (aborted) return;
    explored += 1;
    if (
      explored > MAX_EXPLORED_PATH_STATES ||
      paths.length >= MAX_ENUMERATED_PATHS
    ) {
      aborted = true;
      reportOnce(
        diagnostic(
          'error',
          'STORY_BUILD_PATH_LIMIT_EXCEEDED',
          'Path exploration exceeded the compiler safety budget.',
          'revision',
          nodeId,
        ),
      );
      return;
    }
    if (steps > MAX_PATH_STEPS || active.has(nodeId)) return;
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
      return;
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
      return;
    }
    const nextActive = new Set(active).add(nodeId);
    const nextDuration =
      durationMs +
      (node.kind === 'clip'
        ? (videos.get(node.nodeId)?.asset?.durationMs ?? 0)
        : 0);
    if (node.exit.kind === 'ending') {
      paths.push({ endingId: node.exit.endingId, durationMs: nextDuration });
      return;
    }
    if (node.exit.kind === 'choice') {
      const visible = node.exit.choices.filter(
        (choice) =>
          !choice.visibleWhen ||
          evaluateStoryCondition(choice.visibleWhen, state),
      );
      if (visible.length === 0) {
        reportOnce(
          diagnostic(
            'error',
            'STORY_BUILD_CHOICE_DEAD_END',
            `Decision ${node.exit.decisionId} has no visible choice for a reachable state.`,
            'choice',
            node.exit.decisionId,
          ),
        );
        return;
      }
      visible.forEach((choice) => {
        const nextState = cloneState(state);
        choice.effects.forEach((effect) => applyStoryEffect(effect, nextState));
        const violation = validateRuntimeStateVariables(
          nextState,
          stateVariables,
          choice.choiceId,
        );
        if (violation) {
          reportOnce(violation);
          return;
        }
        const reactionDuration =
          choice.afterSelect.kind === 'play'
            ? (videos.get(
                clipNodeByKey.get(choice.afterSelect.reactionClipKey)?.nodeId ??
                  '',
              )?.asset?.durationMs ?? 0)
            : 0;
        walk(
          choice.nextNodeId,
          nextState,
          nextDuration + reactionDuration,
          nextActive,
          steps + 1,
        );
      });
      return;
    }
    if (node.exit.kind === 'checkpoint') {
      walk(
        node.exit.nextNodeId,
        cloneState(state),
        nextDuration,
        nextActive,
        steps + 1,
      );
      return;
    }
    if (node.kind === 'clip') {
      if (!node.exit.nextNodeId) {
        reportOnce(
          diagnostic(
            'error',
            'STORY_BUILD_CLIP_CONTINUATION_MISSING',
            `Clip ${node.nodeId} has no next step.`,
            'clip',
            node.nodeId,
          ),
        );
        return;
      }
      walk(
        node.exit.nextNodeId,
        cloneState(state),
        nextDuration,
        nextActive,
        steps + 1,
      );
      return;
    }
    const matching = node.exit.routes
      .map((route, index) => ({ route, index }))
      .filter(
        ({ route }) => !route.when || evaluateStoryCondition(route.when, state),
      )
      .sort(
        (left, right) =>
          left.route.priority - right.route.priority ||
          left.index - right.index,
      );
    if (matching.length === 0) {
      reportOnce(
        diagnostic(
          'error',
          'STORY_BUILD_AUTO_ROUTE_DEAD_END',
          `Router ${node.nodeId} has no matching route for a reachable state.`,
          'revision',
          node.nodeId,
        ),
      );
      return;
    }
    if (matching.length > 1) {
      ambiguousPathCount += 1;
      reportOnce(
        diagnostic(
          'error',
          'STORY_BUILD_AUTO_ROUTE_AMBIGUOUS_STATE',
          `Router ${node.nodeId} matches ${matching.length} routes for a reachable state.`,
          'revision',
          node.nodeId,
        ),
      );
    }
    matching.forEach(({ route }) =>
      walk(
        route.nextNodeId,
        cloneState(state),
        nextDuration,
        nextActive,
        steps + 1,
      ),
    );
  };
  walk(entryNodeId, initialState, 0, new Set(), 0);
  return { paths, ambiguousPathCount };
}

function compileIntermediateRelease(
  input: StoryBuildCompilerInput,
  entryNodeId: string,
  selection: ReadonlySet<string>,
  nodes: ReadonlyMap<
    string,
    InteractiveFilmDraftContent['graph']['nodes'][number]
  >,
  videos: ReadonlyMap<string, StoryBuildVideoInput>,
  clipNodeByKey: ReadonlyMap<
    string,
    Extract<
      InteractiveFilmDraftContent['graph']['nodes'][number],
      { kind: 'clip' }
    >
  >,
  includedVideos: FrozenStoryBuildVideoInput[],
): InteractiveFilmRelease {
  const landscape = input.frameProfile === 'landscape_16_9';
  const media = includedVideos.map((video) => {
    const node = clipNodeById(nodes, video.graphNodeId);
    const variant = {
      sourceAssetId: video.asset.assetId,
      sha256: video.asset.checksumSha256,
      src: video.asset.url,
      width: video.asset.width,
      height: video.asset.height,
      durationSeconds: video.asset.durationMs / 1_000,
    };
    return {
      assetId: storyRuntimeAssetId(node.clipKey),
      kind: 'video' as const,
      orientationPolicy: 'single-master' as const,
      variants: landscape ? { landscape: variant } : { portrait: variant },
      audio: video.asset.hasAudio ? ('embedded' as const) : ('none' as const),
    };
  });
  const runtimeNodes: InteractiveFilmRelease['nodes'] = [];
  [...selection].sort().forEach((nodeId) => {
    const node = nodes.get(nodeId);
    if (!node) return;
    if (node.kind === 'router') {
      runtimeNodes.push({
        kind: 'router',
        nodeId: node.nodeId,
        exit: {
          kind: 'auto',
          routes: node.exit.routes.map((route) => ({
            nextNodeId: route.nextNodeId,
            ...(route.when ? { when: route.when } : {}),
            priority: route.priority,
          })),
        },
      });
      return;
    }
    const video = videos.get(node.nodeId);
    if (!video) return;
    runtimeNodes.push({
      nodeId: node.nodeId,
      presentation: {
        kind: 'video',
        sequence: [
          {
            clipId: node.nodeId,
            assetId: storyRuntimeAssetId(node.clipKey),
            endBehavior: { behavior: 'advance' },
          },
        ],
        fit: 'cover',
      },
      overlays: [],
      exit: compileExit(node, clipNodeByKey),
    });
  });
  const locales = collectInteractiveFilmRuntimeLocales(
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
    initialState: {
      variables: Object.fromEntries(
        input.draft.storyBible.stateVariables.map((variable) => [
          variable.key,
          variable.initialValue,
        ]),
      ),
      flags: {},
      relationships: {},
    },
    endings: input.draft.storyBible.endings.map((ending) => ({
      endingId: ending.id,
      title: ending.title,
      summary: ending.summary,
      kind: ending.kind,
    })),
    media,
    nodes: runtimeNodes,
  };
}

function compileExit(
  node: InteractiveFilmDraftContent['graph']['nodes'][number],
  clipNodeByKey: ReadonlyMap<
    string,
    Extract<
      InteractiveFilmDraftContent['graph']['nodes'][number],
      { kind: 'clip' }
    >
  >,
): InteractiveFilmRelease['nodes'][number]['exit'] {
  const exit = node.exit;
  if (exit.kind === 'ending') return exit;
  if (exit.kind === 'auto') {
    if (node.kind === 'clip') {
      const clipExit = node.exit;
      if (clipExit.kind !== 'auto') {
        throw new Error(`Clip ${node.nodeId} exit changed while compiling.`);
      }
      return {
        kind: 'auto',
        routes: clipExit.nextNodeId
          ? [{ nextNodeId: clipExit.nextNodeId, priority: 0 }]
          : [],
      };
    }
    return {
      kind: 'auto',
      routes: node.exit.routes.map((route) => ({
        nextNodeId: route.nextNodeId,
        ...(route.when ? { when: route.when } : {}),
        priority: route.priority,
      })),
    };
  }
  if (exit.kind === 'checkpoint') {
    return {
      kind: 'external-overlay',
      rendererId: STORY_CHECKPOINT_RENDERER_ID,
      routes: [
        {
          actionId: STORY_CHECKPOINT_CONTINUE_ACTION_ID,
          effects: [],
          nextNodeId: exit.nextNodeId,
        },
      ],
    };
  }
  return {
    kind: 'choice',
    decisionId: exit.decisionId,
    prompt: exit.prompt,
    trigger:
      exit.trigger.kind === 'timecode'
        ? { kind: 'timecode', atSeconds: exit.trigger.atMs / 1_000 }
        : exit.trigger,
    choices: exit.choices.map((choice) => ({
      choiceId: choice.choiceId,
      label: choice.label,
      ...(choice.accessibilityLabel
        ? { accessibilityLabel: choice.accessibilityLabel }
        : {}),
      ...(choice.visibleWhen ? { visibleWhen: choice.visibleWhen } : {}),
      effects: choice.effects as RuntimeSessionEffect[],
      nextNodeId: choice.nextNodeId,
      afterSelect:
        choice.afterSelect.kind === 'play'
          ? {
              kind: 'play',
              reactionAssetId: storyRuntimeAssetId(
                requiredReactionNode(
                  clipNodeByKey,
                  choice.afterSelect.reactionClipKey,
                ).clipKey,
              ),
            }
          : choice.afterSelect,
    })),
  };
}

function requiredReactionNode(
  nodes: ReadonlyMap<
    string,
    Extract<
      InteractiveFilmDraftContent['graph']['nodes'][number],
      { kind: 'clip' }
    >
  >,
  clipKey: string,
) {
  const node = nodes.get(clipKey);
  if (!node) throw new Error(`Missing validated reaction clip ${clipKey}.`);
  return node;
}

function clipNodeById(
  nodes: ReadonlyMap<
    string,
    InteractiveFilmDraftContent['graph']['nodes'][number]
  >,
  graphNodeId: string,
): Extract<
  InteractiveFilmDraftContent['graph']['nodes'][number],
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

export function storyRuntimeAssetId(clipKey: string): string {
  return `video:${clipKey}`;
}

function nextNodeIds(
  node: InteractiveFilmDraftContent['graph']['nodes'][number],
): string[] {
  if (node.exit.kind === 'ending') return [];
  if (node.exit.kind === 'checkpoint') return [node.exit.nextNodeId];
  if (node.exit.kind === 'choice') {
    return node.exit.choices.map((choice) => choice.nextNodeId);
  }
  return node.kind === 'clip'
    ? node.exit.nextNodeId
      ? [node.exit.nextNodeId]
      : []
    : node.exit.routes.map((route) => route.nextNodeId);
}

function initialRuntimeState(draft: InteractiveFilmDraftContent): RuntimeState {
  return {
    variables: Object.fromEntries(
      draft.storyBible.stateVariables.map((variable) => [
        variable.key,
        variable.initialValue,
      ]),
    ),
    flags: {},
    relationships: {},
    unlockedEndings: new Set(),
  };
}

function cloneState(state: RuntimeState): RuntimeState {
  return {
    variables: { ...state.variables },
    flags: { ...state.flags },
    relationships: { ...state.relationships },
    unlockedEndings: new Set(state.unlockedEndings),
  };
}

export function evaluateStoryCondition(
  condition: FilmCondition,
  state: Pick<RuntimeState, 'variables' | 'flags' | 'relationships'>,
): boolean {
  switch (condition.kind) {
    case 'flag':
      return (state.flags[condition.flag] ?? false) === condition.equals;
    case 'relationship-at-least':
      return (
        (state.relationships[condition.characterId] ?? 0) >= condition.value
      );
    case 'all':
      return condition.conditions.every((child) =>
        evaluateStoryCondition(child, state),
      );
    case 'any':
      return condition.conditions.some((child) =>
        evaluateStoryCondition(child, state),
      );
    case 'not':
      return !evaluateStoryCondition(condition.condition, state);
    case 'variable': {
      const actual = state.variables[condition.key];
      if (condition.operator === 'equals') return actual === condition.value;
      if (condition.operator === 'not_equals')
        return actual !== condition.value;
      if (typeof actual !== 'number' || typeof condition.value !== 'number')
        return false;
      if (condition.operator === 'greater_than')
        return actual > condition.value;
      if (condition.operator === 'at_least') return actual >= condition.value;
      if (condition.operator === 'less_than') return actual < condition.value;
      return actual <= condition.value;
    }
  }
}

export function applyStoryEffect(
  effect: FilmEffect,
  state: RuntimeState,
): void {
  switch (effect.kind) {
    case 'set_variable':
      state.variables[effect.key] = effect.value;
      return;
    case 'increment_variable': {
      const current = state.variables[effect.key];
      if (typeof current === 'number')
        state.variables[effect.key] = current + effect.amount;
      return;
    }
    case 'set_flag':
      state.flags[effect.flag] = effect.value;
      return;
    case 'adjust_relationship':
      state.relationships[effect.characterId] =
        (state.relationships[effect.characterId] ?? 0) + effect.amount;
      return;
    case 'unlock_ending':
      state.unlockedEndings.add(effect.endingId);
  }
}

function validateRuntimeStateVariables(
  state: RuntimeState,
  contracts: StoryStateVariable[],
  choiceId: string,
): StoryBuildDiagnosticDto | null {
  for (const contract of contracts) {
    const value = state.variables[contract.key];
    if (contract.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return stateContractDiagnostic(
          choiceId,
          contract.key,
          'must remain a finite number',
        );
      }
      if (contract.minimum !== undefined && value < contract.minimum) {
        return stateContractDiagnostic(
          choiceId,
          contract.key,
          `became ${value}, below its minimum of ${contract.minimum}`,
        );
      }
      if (contract.maximum !== undefined && value > contract.maximum) {
        return stateContractDiagnostic(
          choiceId,
          contract.key,
          `became ${value}, above its maximum of ${contract.maximum}`,
        );
      }
      continue;
    }
    if (contract.type === 'string') {
      if (typeof value !== 'string') {
        return stateContractDiagnostic(
          choiceId,
          contract.key,
          'must remain a string',
        );
      }
      if (contract.allowedValues && !contract.allowedValues.includes(value)) {
        return stateContractDiagnostic(
          choiceId,
          contract.key,
          `became ${JSON.stringify(value)}, outside its allowed values`,
        );
      }
      continue;
    }
    if (typeof value !== 'boolean') {
      return stateContractDiagnostic(
        choiceId,
        contract.key,
        'must remain a boolean',
      );
    }
  }
  return null;
}

function stateContractDiagnostic(
  choiceId: string,
  variableKey: string,
  reason: string,
): StoryBuildDiagnosticDto {
  return diagnostic(
    'error',
    'STORY_BUILD_STATE_VARIABLE_CONTRACT_VIOLATION',
    `Choice ${choiceId} makes state variable ${variableKey} invalid: it ${reason}.`,
    'choice',
    choiceId,
  );
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
