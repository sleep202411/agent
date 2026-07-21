import {
  INTERACTIVE_FILM_RELEASE_SCHEMA_VERSION,
  InteractiveFilmReleaseSchema,
  STORY_CHECKPOINT_CONTINUE_ACTION_ID,
  STORY_CHECKPOINT_RENDERER_ID,
  type InteractiveFilmRelease,
} from '@repo/shared/interactive-film-runtime';
import type { ExperienceRuntimeManifest } from '@repo/shared/experience-runtime';
import type {
  CreatableStoryFormat,
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
  browserSafeMp4: boolean;
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
  format: CreatableStoryFormat;
  buildId: string;
  sourceDraftRevision: number;
  channel: 'preview' | 'production';
  scope: StoryBuildScope;
  // Null for a text-first (narrative) project: video is inline media at its
  // native size, not a full-frame clip bound to a fixed picture contract.
  frameProfile: StoryFrameProfile | null;
  defaultLocale: string;
  metadata: { title: string; summary: string | null };
  draft: InteractiveStoryDraftContent;
  videos: StoryBuildVideoInput[];
  diagnostics?: StoryBuildDiagnosticDto[];
}

export interface StoryBuildCompilerResult {
  diagnostics: StoryBuildDiagnosticDto[];
  pathReport: StoryBuildPathReportDto;
  runtime: ExperienceRuntimeManifest | null;
  includedGraphNodeIds: string[];
}

interface EnumeratedPath {
  endingId: string;
  durationMs: number;
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
  includedVideos.forEach((video) => validateFrozenVideo(video, diagnostics));

  const enumeration = enumeratePaths(
    entryNodeId,
    nodes,
    videos,
    clipNodeByKey,
    selection,
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
        experienceProfile:
          input.format === 'interactive_film' ? 'cinematic' : 'narrative',
        metadata: input.metadata,
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
  clipNodeByKey: ReadonlyMap<
    string,
    Extract<
      InteractiveStoryDraftContent['graph']['nodes'][number],
      { kind: 'clip' }
    >
  >,
  diagnostics: StoryBuildDiagnosticDto[],
): Set<string> {
  const required = new Set<string>();
  [...selection].forEach((nodeId) => {
    const node = nodes.get(nodeId);
    if (node?.kind === 'clip') required.add(node.nodeId);
  });
  return required;
}

/**
 * Technical integrity of a frozen clip: checksum, content type, duration.
 *
 * Picture dimensions are deliberately NOT checked. The project frame profile
 * is authoring intent (it drives generation and canvas framing), not a delivery
 * contract — a 1280×720 clip carries the same 16:9 picture as 1920×1080 and
 * plays correctly, so it must not block publication.
 */
function validateFrozenVideo(
  video: FrozenStoryBuildVideoInput,
  diagnostics: StoryBuildDiagnosticDto[],
): void {
  const asset = video.asset;
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
  // Frame profile is authoring intent, not a delivery contract — see
  // validateFrozenVideo's counterpart in story-build.service.ts. A clip whose
  // pixel dimensions differ from the profile still shares the picture and
  // plays correctly, so it no longer blocks Build.
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
    InteractiveStoryDraftContent['graph']['nodes'][number]
  >,
  videos: ReadonlyMap<string, StoryBuildVideoInput>,
  clipNodeByKey: ReadonlyMap<
    string,
    Extract<
      InteractiveStoryDraftContent['graph']['nodes'][number],
      { kind: 'clip' }
    >
  >,
  selection: ReadonlySet<string>,
  diagnostics: StoryBuildDiagnosticDto[],
): { paths: EnumeratedPath[]; ambiguousPathCount: number } {
  if (!entryNodeId || !selection.has(entryNodeId)) {
    return { paths: [], ambiguousPathCount: 0 };
  }
  const paths: EnumeratedPath[] = [];
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
      node.exit.choices.forEach((choice) => {
        walk(choice.nextNodeId, nextDuration, nextActive, steps + 1);
      });
      return;
    }
    if (node.exit.kind === 'checkpoint') {
      walk(node.exit.nextNodeId, nextDuration, nextActive, steps + 1);
      return;
    }
    if (!node.exit.nextNodeId) {
      reportOnce(
        diagnostic(
          'error',
          'STORY_BUILD_SCENE_CONTINUATION_MISSING',
          `Scene ${node.nodeId} has no next step.`,
          'revision',
          node.nodeId,
        ),
      );
      return;
    }
    walk(node.exit.nextNodeId, nextDuration, nextActive, steps + 1);
  };
  walk(entryNodeId, 0, new Set(), 0);
  return { paths, ambiguousPathCount: 0 };
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
  clipNodeByKey: ReadonlyMap<
    string,
    Extract<
      InteractiveStoryDraftContent['graph']['nodes'][number],
      { kind: 'clip' }
    >
  >,
  includedVideos: FrozenStoryBuildVideoInput[],
): InteractiveFilmRelease {
  // A film project pins every clip to its project-wide orientation. A narrative
  // (null-profile) project derives each clip's orientation from its own native
  // dimensions, so inline video keeps its intrinsic frame.
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
    const landscape =
      input.frameProfile === null
        ? video.asset.width >= video.asset.height
        : input.frameProfile === 'landscape_16_9';
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
    if (node.kind === 'text') {
      runtimeNodes.push({
        nodeId: node.nodeId,
        presentation: {
          kind: 'text',
          ...(hasNonEmptyLocalizedText(node.title)
            ? { title: node.title }
            : {}),
          body: node.body,
          completion:
            node.exit.kind === 'auto' || node.exit.kind === 'ending'
              ? 'continue'
              : 'passive',
        },
        overlays: [],
        exit: compileExit(node, clipNodeByKey),
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
        // Narrative (null-profile) stories present inline video at native size;
        // film stories cover their fixed frame.
        fit: input.frameProfile === null ? 'native' : 'cover',
      },
      overlays: [],
      exit: compileExit(node, clipNodeByKey),
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
    endings: input.draft.storyBible.endings.map((ending) => ({
      endingId: ending.id,
      title: ending.title,
      ...(hasNonEmptyLocalizedText(ending.summary)
        ? { summary: ending.summary }
        : {}),
    })),
    media,
    nodes: runtimeNodes,
  };
}

function hasNonEmptyLocalizedText(
  value: Record<string, string> | undefined,
): value is Record<string, string> {
  return Boolean(value && Object.values(value).some((text) => text.trim()));
}

function compileExit(
  node: InteractiveStoryDraftContent['graph']['nodes'][number],
  clipNodeByKey: ReadonlyMap<
    string,
    Extract<
      InteractiveStoryDraftContent['graph']['nodes'][number],
      { kind: 'clip' }
    >
  >,
): InteractiveFilmRelease['nodes'][number]['exit'] {
  const exit = node.exit;
  if (exit.kind === 'ending') return exit;
  if (exit.kind === 'auto') {
    if (exit.nextNodeId === null) {
      // A dead-end scene fails Build before compilation; every auto exit that
      // reaches here has a validated target.
      throw new Error(`Scene ${node.nodeId} auto exit has no target.`);
    }
    return { kind: 'auto', nextNodeId: exit.nextNodeId };
  }
  if (exit.kind === 'checkpoint') {
    return {
      kind: 'external-overlay',
      rendererId: STORY_CHECKPOINT_RENDERER_ID,
      routes: [
        {
          actionId: STORY_CHECKPOINT_CONTINUE_ACTION_ID,
          nextNodeId: exit.nextNodeId,
        },
      ],
    };
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

export function storyRuntimeAssetId(clipKey: string): string {
  return `video:${clipKey}`;
}

function nextNodeIds(
  node: InteractiveStoryDraftContent['graph']['nodes'][number],
): string[] {
  if (node.exit.kind === 'ending') return [];
  if (node.exit.kind === 'checkpoint') return [node.exit.nextNodeId];
  if (node.exit.kind === 'choice') {
    return node.exit.choices.map((choice) => choice.nextNodeId);
  }
  return node.exit.nextNodeId ? [node.exit.nextNodeId] : [];
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
