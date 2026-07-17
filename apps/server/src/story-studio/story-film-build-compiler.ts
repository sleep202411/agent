import {
  INTERACTIVE_FILM_RELEASE_SCHEMA_VERSION,
  InteractiveFilmReleaseSchema,
  STORY_CHECKPOINT_CONTINUE_ACTION_ID,
  STORY_CHECKPOINT_RENDERER_ID,
  type InteractiveFilmRelease,
  type RuntimeSessionEffect,
} from '@repo/shared/interactive-film-runtime';
import type { FilmBuildDiagnosticDto, FilmBuildPathReportDto } from './dto';
import type {
  FilmBuildScope,
  FilmClipSpec,
  FilmCondition,
  FilmEffect,
  FilmSpec,
  InteractiveFilmDraftContent,
  StoryScalarValue,
  StoryStateVariable,
} from './interactive-film.schema';

/** Hard safety bounds are part of the compiler contract, not UI pagination.
 * They keep adversarial or accidentally cyclic graphs from consuming an API
 * process indefinitely while still covering product graphs by a wide margin. */
const MAX_ENUMERATED_PATHS = 10_000;
const MAX_EXPLORED_PATH_STATES = 10_000;
const MAX_PATH_STEPS = 2_000;

export interface FrozenFilmClipAsset {
  assetId: string;
  variantId: string;
  checksumSha256: string;
  contentType: string;
  sizeBytes: bigint | null;
  width: number;
  height: number;
  durationMs: number;
  url: string;
}

export interface StoryFilmBuildClipInput {
  id: string;
  key: string;
  graphNodeId: string;
  rank: number;
  specHash: string;
  productionInputHash: string | null;
  /** A persisted projection can be corrupt even though every write path is
   * schema-validated. Keep that state explicit so Build validation can report
   * it without letting an unsafe type assertion reach path enumeration. */
  spec: FilmClipSpec | null;
  /** Optional generation provenance. A current video selected from the asset
   * library has no generation attempt and remains fully buildable. */
  sourceGenerationId: string | null;
  asset: FrozenFilmClipAsset | null;
  eligibilityDiagnostics: FilmBuildDiagnosticDto[];
}

type EligibleStoryFilmBuildClipInput = StoryFilmBuildClipInput & {
  spec: FilmClipSpec;
  asset: FrozenFilmClipAsset;
};

export interface StoryFilmBuildCompilerInput {
  projectId: string;
  revisionId: string;
  revisionNumber: number;
  buildId: string;
  profile: 'preview' | 'production';
  scope: FilmBuildScope;
  draft: InteractiveFilmDraftContent;
  filmSpec: FilmSpec;
  clips: StoryFilmBuildClipInput[];
  /** Eligibility diagnostics are produced while loading the production
   * snapshot. Passing them in keeps the graph compiler deterministic and free
   * of database concerns. */
  diagnostics?: FilmBuildDiagnosticDto[];
}

export interface StoryFilmBuildCompilerResult {
  diagnostics: FilmBuildDiagnosticDto[];
  pathReport: FilmBuildPathReportDto;
  runtime: InteractiveFilmRelease | null;
  includedClipIds: string[];
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

/** Analyze the immutable graph and, only when every invariant is satisfied,
 * compile it to the shared player contract. No fallback media or metadata is
 * synthesized here: a missing production fact is a failed Build diagnostic. */
export function compileStoryFilmBuild(
  input: StoryFilmBuildCompilerInput,
): StoryFilmBuildCompilerResult {
  const diagnostics = [...(input.diagnostics ?? [])];
  const graphNodeById = new Map(
    input.draft.graph.nodes.map((node) => [node.nodeId, node]),
  );
  const clipById = new Map(input.clips.map((clip) => [clip.id, clip]));
  const clipByNodeId = new Map(
    input.clips.map((clip) => [clip.graphNodeId, clip]),
  );
  const clipByKey = new Map(input.clips.map((clip) => [clip.key, clip]));

  const entryNodeId = resolveEntryNodeId(input, clipById, diagnostics);
  const selection = selectGraphNodes(
    entryNodeId,
    graphNodeById,
    input.scope,
    diagnostics,
  );

  const structurallyReachable = structuralReachability(
    entryNodeId,
    graphNodeById,
    selection,
  );
  const unreachableNodeIds = [...selection]
    .filter((nodeId) => !structurallyReachable.has(nodeId))
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

  detectStructuralCycles(entryNodeId, graphNodeById, selection, diagnostics);
  diagnoseGraphContracts(input, selection, graphNodeById, diagnostics);

  const requiredClipIds = new Set<string>();
  [...selection].forEach((nodeId) => {
    const node = graphNodeById.get(nodeId);
    if (node?.kind !== 'clip') return;
    const clip = clipByNodeId.get(nodeId);
    if (!clip) {
      diagnostics.push(
        diagnostic(
          'error',
          'STORY_BUILD_CLIP_PROJECTION_MISSING',
          `Graph clip ${node.clipKey} has no immutable production Clip.`,
          'clip',
          nodeId,
        ),
      );
      return;
    }
    requiredClipIds.add(clip.id);
    if (node.exit.kind === 'choice') {
      node.exit.choices.forEach((choice) => {
        if (choice.afterSelect.kind !== 'play') return;
        const reaction = clipByKey.get(choice.afterSelect.reactionClipKey);
        if (!reaction) {
          diagnostics.push(
            diagnostic(
              'error',
              'STORY_BUILD_REACTION_CLIP_MISSING',
              `Reaction clip ${choice.afterSelect.reactionClipKey} has no immutable production Clip.`,
              'choice',
              choice.choiceId,
            ),
          );
          return;
        }
        requiredClipIds.add(reaction.id);
      });
    }
  });

  const includedClips = [...requiredClipIds]
    .flatMap((clipId) => {
      const clip = clipById.get(clipId);
      return clip ? [clip] : [];
    })
    .sort(
      (left, right) =>
        left.rank - right.rank || left.id.localeCompare(right.id),
    );
  includedClips.forEach((clip) =>
    diagnostics.push(...clip.eligibilityDiagnostics),
  );
  includedClips.forEach((clip) => {
    if (clip.spec?.outputContract.audio !== 'separate') return;
    diagnostics.push(
      diagnostic(
        'error',
        'STORY_BUILD_SEPARATE_AUDIO_UNSUPPORTED',
        `Clip ${clip.key} requests a separate audio track, but the interactive-film runtime currently accepts only silent or embedded-audio video assets.`,
        'clip',
        clip.id,
      ),
    );
  });
  includedClips.forEach((clip) => {
    if (!clip.asset) return;
    // Video-first: a manually bound video IS the content — its length is not
    // constrained by the generation contract. Only generated clips apply.
    if (clip.sourceGenerationId === null) return;
    if (clip.asset.durationMs > input.filmSpec.duration.maxGeneratedClipMs) {
      diagnostics.push(
        diagnostic(
          'error',
          'STORY_BUILD_GENERATED_CLIP_DURATION_EXCEEDED',
          `Clip ${clip.key} current video is ${clip.asset.durationMs}ms, exceeding the Film contract generated-clip limit of ${input.filmSpec.duration.maxGeneratedClipMs}ms.`,
          'clip',
          clip.id,
        ),
      );
    }
  });

  // If any included clip is a manual (video-first) bind, the film's total and
  // continuous durations are the creator's own footage — the generation
  // duration contract does not apply to the assembled film.
  const isVideoFirstFilm = includedClips.some(
    (clip) => clip.asset !== null && clip.sourceGenerationId === null,
  );
  const enumeration = enumeratePaths(
    entryNodeId,
    graphNodeById,
    clipByNodeId,
    selection,
    initialRuntimeState(input.draft),
    input.draft.storyBible.stateVariables,
    isVideoFirstFilm
      ? Number.POSITIVE_INFINITY
      : input.filmSpec.duration.maxContinuousMs,
    diagnostics,
  );
  const pathDurations = enumeration.paths.map((path) => path.durationMs);
  const hasCompleteFrozenDurations = includedClips.every(
    (clip) => clip.asset !== null,
  );
  const pathReport: FilmBuildPathReportDto = {
    enumeratedPathCount: enumeration.paths.length,
    reachableEndingIds: [
      ...new Set(enumeration.paths.map((path) => path.endingId)),
    ].sort(),
    unreachableNodeIds,
    ambiguousPathCount: enumeration.ambiguousPathCount,
    durationMinMs: pathDurations.length > 0 ? Math.min(...pathDurations) : 0,
    durationMaxMs: pathDurations.length > 0 ? Math.max(...pathDurations) : 0,
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
    const minimumDurationMs = Math.max(
      0,
      input.filmSpec.duration.targetMs - input.filmSpec.duration.toleranceMs,
    );
    const maximumDurationMs =
      input.filmSpec.duration.targetMs + input.filmSpec.duration.toleranceMs;
    if (
      !isVideoFirstFilm &&
      hasCompleteFrozenDurations &&
      pathDurations.some(
        (durationMs) =>
          durationMs < minimumDurationMs || durationMs > maximumDurationMs,
      )
    ) {
      diagnostics.push(
        diagnostic(
          'error',
          'STORY_BUILD_PATH_DURATION_OUT_OF_RANGE',
          `At least one reachable path falls outside the Film contract duration range of ${minimumDurationMs}–${maximumDurationMs}ms (actual ${pathReport.durationMinMs}–${pathReport.durationMaxMs}ms).`,
          'revision',
          input.revisionId,
        ),
      );
    }
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

  let runtime: InteractiveFilmRelease | null = null;
  if (!diagnostics.some((item) => item.severity === 'error')) {
    const eligibleClips = includedClips.filter(
      (clip): clip is EligibleStoryFilmBuildClipInput =>
        clip.spec !== null && clip.asset !== null,
    );
    if (eligibleClips.length !== includedClips.length) {
      diagnostics.push(
        diagnostic(
          'error',
          'STORY_BUILD_ELIGIBILITY_DIAGNOSTIC_MISSING',
          'An ineligible Clip was not accompanied by a production diagnostic.',
          'revision',
          input.revisionId,
        ),
      );
    } else {
      const candidate = compileRuntime(
        input,
        entryNodeId as string,
        selection,
        graphNodeById,
        clipByNodeId,
        clipByKey,
        eligibleClips,
      );
      const parsed = InteractiveFilmReleaseSchema.safeParse(candidate);
      if (parsed.success) {
        runtime = parsed.data;
      } else {
        parsed.error.issues.forEach((issue) => {
          diagnostics.push(
            diagnostic(
              'error',
              'STORY_BUILD_RUNTIME_SCHEMA_INVALID',
              `${issue.path.join('.') || 'runtime'}: ${issue.message}`,
              'revision',
              input.revisionId,
            ),
          );
        });
      }
    }
  }

  return {
    diagnostics: sortAndDedupeDiagnostics(diagnostics),
    pathReport,
    runtime,
    includedClipIds: includedClips.map((clip) => clip.id),
  };
}

function resolveEntryNodeId(
  input: StoryFilmBuildCompilerInput,
  clipById: Map<string, StoryFilmBuildClipInput>,
  diagnostics: FilmBuildDiagnosticDto[],
): string | null {
  if (input.scope.kind === 'subgraph') {
    const entry = clipById.get(input.scope.entryClipId);
    if (!entry) {
      diagnostics.push(
        diagnostic(
          'error',
          'STORY_BUILD_SCOPE_ENTRY_CLIP_NOT_FOUND',
          'The preview subgraph entry Clip does not belong to this revision.',
          'clip',
          input.scope.entryClipId,
        ),
      );
      return null;
    }
    return entry.graphNodeId;
  }
  if (!input.draft.graph.entryNodeId) {
    diagnostics.push(
      diagnostic(
        'error',
        'STORY_BUILD_ENTRY_NODE_MISSING',
        'The immutable story graph has no entry node.',
        'revision',
        input.revisionId,
      ),
    );
  }
  return input.draft.graph.entryNodeId;
}

function selectGraphNodes(
  entryNodeId: string | null,
  nodes: Map<string, InteractiveFilmDraftContent['graph']['nodes'][number]>,
  scope: FilmBuildScope,
  diagnostics: FilmBuildDiagnosticDto[],
): Set<string> {
  if (scope.kind === 'full') return new Set(nodes.keys());
  if (!entryNodeId || !nodes.has(entryNodeId)) return new Set();
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
        `The preview subgraph exceeds its maxDepth of ${maxDepth}; the compiler will not silently truncate routes.`,
        'revision',
        entryNodeId,
      ),
    );
  }
  return selected;
}

function structuralReachability(
  entryNodeId: string | null,
  nodes: Map<string, InteractiveFilmDraftContent['graph']['nodes'][number]>,
  selection: Set<string>,
): Set<string> {
  const reachable = new Set<string>();
  const pending = entryNodeId ? [entryNodeId] : [];
  while (pending.length > 0) {
    const nodeId = pending.pop();
    if (!nodeId || reachable.has(nodeId) || !selection.has(nodeId)) continue;
    reachable.add(nodeId);
    const node = nodes.get(nodeId);
    if (!node) continue;
    nextNodeIds(node).forEach((next) => pending.push(next));
  }
  return reachable;
}

function detectStructuralCycles(
  entryNodeId: string | null,
  nodes: Map<string, InteractiveFilmDraftContent['graph']['nodes'][number]>,
  selection: Set<string>,
  diagnostics: FilmBuildDiagnosticDto[],
): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const reported = new Set<string>();
  const visit = (nodeId: string): void => {
    if (!selection.has(nodeId) || visited.has(nodeId)) return;
    if (visiting.has(nodeId)) return;
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

function diagnoseGraphContracts(
  input: StoryFilmBuildCompilerInput,
  selection: Set<string>,
  nodes: Map<string, InteractiveFilmDraftContent['graph']['nodes'][number]>,
  diagnostics: FilmBuildDiagnosticDto[],
): void {
  const selectedNodes = [...selection].flatMap((nodeId) => {
    const node = nodes.get(nodeId);
    return node ? [node] : [];
  });
  selectedNodes.forEach((node) => {
    if (node.exit.kind !== 'auto') return;
    if (node.kind === 'clip') {
      if (node.exit.nextNodeId === null) {
        diagnostics.push(
          diagnostic(
            'error',
            'STORY_BUILD_CLIP_CONTINUATION_MISSING',
            `Clip ${node.nodeId} has no next step.`,
            'clip',
            node.nodeId,
          ),
        );
      }
      return;
    }
    if (node.exit.routes.length === 0) {
      diagnostics.push(
        diagnostic(
          'error',
          'STORY_BUILD_AUTO_ROUTE_MISSING',
          `Automatic node ${node.nodeId} has no route.`,
          'revision',
          node.nodeId,
        ),
      );
    }
    const unconditionalCount = node.exit.routes.filter(
      (route) => !route.when,
    ).length;
    if (unconditionalCount > 1) {
      diagnostics.push(
        diagnostic(
          'error',
          'STORY_BUILD_AUTO_ROUTE_AMBIGUOUS',
          `Automatic node ${node.nodeId} has ${unconditionalCount} competing unconditional routes.`,
          'revision',
          node.nodeId,
        ),
      );
    }
  });

  if (input.scope.kind !== 'full') return;
  const clipCount = selectedNodes.filter((node) => node.kind === 'clip').length;
  const choiceCount = new Set(
    selectedNodes.flatMap((node) =>
      node.exit.kind === 'choice' ? [node.exit.decisionId] : [],
    ),
  ).size;
  const endingCount = input.draft.storyBible.endings.length;
  const targets = input.filmSpec.targets;
  (
    [
      ['clip', clipCount, targets.clipCount],
      ['choice', choiceCount, targets.choiceCount],
      ['ending', endingCount, targets.endingCount],
    ] as const
  ).forEach(([kind, actual, expected]) => {
    if (actual === expected) return;
    diagnostics.push(
      diagnostic(
        'error',
        `STORY_BUILD_${kind.toUpperCase()}_COUNT_MISMATCH`,
        `Film contract expects ${expected} ${kind}${expected === 1 ? '' : 's'}, but the immutable revision contains ${actual}.`,
        kind === 'ending' ? 'ending' : 'revision',
        input.revisionId,
      ),
    );
  });
}

function enumeratePaths(
  entryNodeId: string | null,
  nodes: Map<string, InteractiveFilmDraftContent['graph']['nodes'][number]>,
  clips: Map<string, StoryFilmBuildClipInput>,
  selection: Set<string>,
  initialState: RuntimeState,
  stateVariables: StoryStateVariable[],
  maxContinuousMs: number,
  diagnostics: FilmBuildDiagnosticDto[],
): { paths: EnumeratedPath[]; ambiguousPathCount: number } {
  if (!entryNodeId || !selection.has(entryNodeId)) {
    return { paths: [], ambiguousPathCount: 0 };
  }
  const paths: EnumeratedPath[] = [];
  let ambiguousPathCount = 0;
  let pathLimitReported = false;
  let exploredPathStateCount = 0;
  let aborted = false;
  let continuousLimitReported = false;
  const enumerationDiagnosticKeys = new Set<string>();
  const reportOnce = (item: FilmBuildDiagnosticDto): void => {
    const key = `${item.code}\u0000${item.entityType ?? ''}\u0000${item.entityId ?? ''}\u0000${item.message}`;
    if (enumerationDiagnosticKeys.has(key)) return;
    enumerationDiagnosticKeys.add(key);
    diagnostics.push(item);
  };
  const abortForPathLimit = (nodeId: string, message: string): void => {
    aborted = true;
    if (pathLimitReported) return;
    pathLimitReported = true;
    reportOnce(
      diagnostic(
        'error',
        'STORY_BUILD_PATH_LIMIT_EXCEEDED',
        message,
        'revision',
        nodeId,
      ),
    );
  };
  const walk = (
    nodeId: string,
    state: RuntimeState,
    durationMs: number,
    continuousDurationMs: number,
    active: Set<string>,
    steps: number,
  ): void => {
    if (aborted) return;
    exploredPathStateCount += 1;
    if (exploredPathStateCount > MAX_EXPLORED_PATH_STATES) {
      abortForPathLimit(
        nodeId,
        `Path exploration exceeded the safety budget of ${MAX_EXPLORED_PATH_STATES} states.`,
      );
      return;
    }
    if (paths.length >= MAX_ENUMERATED_PATHS) {
      abortForPathLimit(
        nodeId,
        `Path enumeration exceeded the safety limit of ${MAX_ENUMERATED_PATHS} completed paths.`,
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
        ? (clips.get(node.nodeId)?.asset?.durationMs ?? 0)
        : 0);
    const nextContinuousDuration =
      continuousDurationMs +
      (node.kind === 'clip'
        ? (clips.get(node.nodeId)?.asset?.durationMs ?? 0)
        : 0);
    if (nextContinuousDuration > maxContinuousMs && !continuousLimitReported) {
      continuousLimitReported = true;
      reportOnce(
        diagnostic(
          'error',
          'STORY_BUILD_CONTINUOUS_DURATION_EXCEEDED',
          `A reachable uninterrupted playback segment is ${nextContinuousDuration}ms, exceeding the Film contract limit of ${maxContinuousMs}ms.`,
          node.kind === 'clip' ? 'clip' : 'revision',
          node.nodeId,
        ),
      );
    }

    if (node.exit.kind === 'ending') {
      paths.push({ endingId: node.exit.endingId, durationMs: nextDuration });
      return;
    }
    if (node.exit.kind === 'choice') {
      const visible = node.exit.choices.filter(
        (choice) =>
          !choice.visibleWhen ||
          evaluateFilmCondition(choice.visibleWhen, state),
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
        choice.effects.forEach((effect) => applyFilmEffect(effect, nextState));
        const stateViolation = validateRuntimeStateVariables(
          nextState,
          stateVariables,
          choice.choiceId,
        );
        if (stateViolation) {
          reportOnce(stateViolation);
          return;
        }
        const afterSelect = choice.afterSelect;
        const reactionDurationMs =
          afterSelect.kind === 'play'
            ? ([...clips.values()].find(
                (clip) => clip.key === afterSelect.reactionClipKey,
              )?.asset?.durationMs ?? 0)
            : 0;
        if (reactionDurationMs > maxContinuousMs && !continuousLimitReported) {
          continuousLimitReported = true;
          reportOnce(
            diagnostic(
              'error',
              'STORY_BUILD_CONTINUOUS_DURATION_EXCEEDED',
              `A reachable reaction starts an uninterrupted playback segment of ${reactionDurationMs}ms, exceeding the Film contract limit of ${maxContinuousMs}ms.`,
              'choice',
              choice.choiceId,
            ),
          );
        }
        walk(
          choice.nextNodeId,
          nextState,
          nextDuration + reactionDurationMs,
          reactionDurationMs,
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
        0,
        nextActive,
        steps + 1,
      );
      return;
    }

    if (node.kind === 'clip') {
      if (node.exit.nextNodeId === null) {
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
        nextContinuousDuration,
        nextActive,
        steps + 1,
      );
      return;
    }

    const matching = node.exit.routes
      .map((route, index) => ({ route, index }))
      .filter(
        ({ route }) => !route.when || evaluateFilmCondition(route.when, state),
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
          `Automatic node ${node.nodeId} has no matching route for a reachable state.`,
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
          `Automatic node ${node.nodeId} matches ${matching.length} routes for a reachable state; automatic routes must be mutually exclusive.`,
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
        nextContinuousDuration,
        nextActive,
        steps + 1,
      ),
    );
  };
  walk(entryNodeId, initialState, 0, 0, new Set(), 0);
  return { paths, ambiguousPathCount };
}

function validateRuntimeStateVariables(
  state: RuntimeState,
  contracts: StoryStateVariable[],
  choiceId: string,
): FilmBuildDiagnosticDto | null {
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
): FilmBuildDiagnosticDto {
  return diagnostic(
    'error',
    'STORY_BUILD_STATE_VARIABLE_CONTRACT_VIOLATION',
    `Choice ${choiceId} makes state variable ${variableKey} invalid: it ${reason}.`,
    'choice',
    choiceId,
  );
}

function compileRuntime(
  input: StoryFilmBuildCompilerInput,
  entryNodeId: string,
  selection: Set<string>,
  nodes: Map<string, InteractiveFilmDraftContent['graph']['nodes'][number]>,
  clipsByNodeId: Map<string, StoryFilmBuildClipInput>,
  clipsByKey: Map<string, StoryFilmBuildClipInput>,
  includedClips: EligibleStoryFilmBuildClipInput[],
): unknown {
  const landscape = input.filmSpec.frame.aspectRatio === '16:9';
  const media = includedClips.map((clip) => {
    const variant = {
      sourceAssetId: clip.asset.assetId,
      sha256: clip.asset.checksumSha256,
      src: clip.asset.url,
      width: clip.asset.width,
      height: clip.asset.height,
      durationSeconds: clip.asset.durationMs / 1_000,
    };
    return {
      assetId: storyFilmRuntimeAssetId(clip),
      kind: 'video' as const,
      orientationPolicy: 'single-master' as const,
      variants: landscape ? { landscape: variant } : { portrait: variant },
      audio:
        clip.spec.outputContract.audio === 'none'
          ? ('none' as const)
          : ('embedded' as const),
    };
  });

  const runtimeNodes: unknown[] = [];
  [...selection].sort().forEach((nodeId) => {
    const node = nodes.get(nodeId);
    if (!node) return;
    if (node.kind === 'router') {
      runtimeNodes.push({
        kind: 'router' as const,
        nodeId: node.nodeId,
        exit: compileExit(node, clipsByKey),
      });
      return;
    }
    const clip = clipsByNodeId.get(node.nodeId);
    if (!clip) return;
    runtimeNodes.push({
      nodeId: node.nodeId,
      presentation: {
        kind: 'video' as const,
        sequence: [
          {
            clipId: clip.id,
            assetId: storyFilmRuntimeAssetId(clip),
            endBehavior: { behavior: 'advance' as const },
          },
        ],
        fit: 'cover' as const,
      },
      overlays: [],
      exit: compileExit(node, clipsByKey),
    });
  });

  const variables = Object.fromEntries(
    input.draft.storyBible.stateVariables.map((variable) => [
      variable.key,
      variable.initialValue,
    ]),
  );
  return {
    schemaVersion: INTERACTIVE_FILM_RELEASE_SCHEMA_VERSION,
    channel: input.profile,
    // Java persists gameId/contentVersion in length-bounded columns (a
    // 36-char dashed UUID + a "build:"-prefixed version overflowed them). Emit
    // dashless UUIDs (32 chars) — stable, unique, and comfortably within Java's
    // limit — for the release identity. The manifest is otherwise unchanged.
    gameId: input.projectId.replace(/-/g, ''),
    releaseId: input.buildId,
    contentVersion: `revision:${input.revisionNumber}`,
    entryNodeId,
    defaultLocale: input.filmSpec.locales.defaultLocale,
    locales: input.filmSpec.locales.enabledLocales,
    initialState: { variables, flags: {}, relationships: {} },
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
  clipsByKey: Map<string, StoryFilmBuildClipInput>,
): unknown {
  const { exit } = node;
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
              reactionAssetId: storyFilmRuntimeAssetId(
                clipsByKey.get(
                  choice.afterSelect.reactionClipKey,
                ) as StoryFilmBuildClipInput,
              ),
            }
          : choice.afterSelect,
    })),
  };
}

export function storyFilmRuntimeAssetId(
  clip: Pick<StoryFilmBuildClipInput, 'key'>,
): string {
  return `video:${clip.key}`;
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

export function evaluateFilmCondition(
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
        evaluateFilmCondition(child, state),
      );
    case 'any':
      return condition.conditions.some((child) =>
        evaluateFilmCondition(child, state),
      );
    case 'not':
      return !evaluateFilmCondition(condition.condition, state);
    case 'variable': {
      const actual = state.variables[condition.key];
      switch (condition.operator) {
        case 'equals':
          return actual === condition.value;
        case 'not_equals':
          return actual !== condition.value;
        case 'greater_than':
        case 'at_least':
        case 'less_than':
        case 'at_most':
          if (typeof actual !== 'number' || typeof condition.value !== 'number')
            return false;
          if (condition.operator === 'greater_than')
            return actual > condition.value;
          if (condition.operator === 'at_least')
            return actual >= condition.value;
          if (condition.operator === 'less_than')
            return actual < condition.value;
          return actual <= condition.value;
      }
    }
  }
}

export function applyFilmEffect(effect: FilmEffect, state: RuntimeState): void {
  switch (effect.kind) {
    case 'set_variable':
      state.variables[effect.key] = effect.value;
      return;
    case 'increment_variable': {
      const current = state.variables[effect.key];
      if (typeof current === 'number') {
        state.variables[effect.key] = current + effect.amount;
      }
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

function diagnostic(
  severity: 'error' | 'warning',
  code: string,
  message: string,
  entityType: FilmBuildDiagnosticDto['entityType'],
  entityId: string | null,
): FilmBuildDiagnosticDto {
  return { severity, code, message, entityType, entityId };
}

function sortAndDedupeDiagnostics(
  diagnostics: FilmBuildDiagnosticDto[],
): FilmBuildDiagnosticDto[] {
  const byIdentity = new Map<string, FilmBuildDiagnosticDto>();
  diagnostics.forEach((item) => {
    const key = [
      item.severity,
      item.code,
      item.entityType ?? '',
      item.entityId ?? '',
      item.message,
    ].join('\u0000');
    byIdentity.set(key, item);
  });
  return [...byIdentity.values()].sort(
    (left, right) =>
      Number(left.severity === 'warning') -
        Number(right.severity === 'warning') ||
      left.code.localeCompare(right.code) ||
      (left.entityId ?? '').localeCompare(right.entityId ?? '') ||
      left.message.localeCompare(right.message),
  );
}
