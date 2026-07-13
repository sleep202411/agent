import {
  STORY_CHECKPOINT_CONTINUE_ACTION_ID,
  STORY_CHECKPOINT_RENDERER_ID,
  type FilmCondition,
  type InteractiveFilmRelease,
  type InteractiveFilmRuntimeNode,
  type RuntimeAutoExit,
  type RuntimeChoiceExit,
  type RuntimeExternalExit,
  type RuntimeInitialState,
  type RuntimeSessionEffect,
  type RuntimeSessionValue,
  type RuntimeVideoSequenceClip,
} from "@repo/shared/interactive-film-runtime";

// Keep the player and its focused tests on the compiler's shared identifiers.
export {
  STORY_CHECKPOINT_CONTINUE_ACTION_ID,
  STORY_CHECKPOINT_RENDERER_ID,
} from "@repo/shared/interactive-film-runtime";

export interface StoryFilmPreviewSession {
  variables: Record<string, RuntimeSessionValue>;
  flags: Record<string, boolean>;
  relationships: Record<string, number>;
  watchedAssetIds: string[];
  unlockedEndingIds: string[];
}

export type RuntimeNodeResolution =
  | { ok: true; node: InteractiveFilmRuntimeNode; traversedNodeIds: string[] }
  | {
      ok: false;
      code: "UNKNOWN_NODE" | "NO_MATCHING_ROUTE" | "ROUTER_CYCLE";
      nodeId: string;
      traversedNodeIds: string[];
    };

export interface FilmChoiceTransition {
  nextNodeId: string;
  reactionAssetId: string | null;
  session: StoryFilmPreviewSession;
}

export interface FilmCheckpointTransition {
  nextNodeId: string;
  session: StoryFilmPreviewSession;
}

export type FilmSequenceEndAction =
  | { kind: "advance"; sequenceIndex: number }
  | { kind: "hold"; durationMs: number; sequenceIndex: number | null }
  | { kind: "complete" }
  | { kind: "loop-tail"; tailSeconds: number }
  | { kind: "loop"; assetId: string };

export function createStoryFilmPreviewSession(
  initialState: RuntimeInitialState
): StoryFilmPreviewSession {
  return {
    variables: { ...initialState.variables },
    flags: { ...initialState.flags },
    relationships: { ...initialState.relationships },
    watchedAssetIds: [],
    unlockedEndingIds: [],
  };
}

export function evaluateFilmCondition(
  condition: FilmCondition | undefined,
  session: StoryFilmPreviewSession
): boolean {
  if (!condition) return true;

  switch (condition.kind) {
    case "flag":
      return (session.flags[condition.flag] ?? false) === condition.equals;
    case "variable":
      return compareVariable(session.variables[condition.key], condition.operator, condition.value);
    case "relationship-at-least":
      return (session.relationships[condition.characterId] ?? 0) >= condition.value;
    case "all":
      return condition.conditions.every((nested) => evaluateFilmCondition(nested, session));
    case "any":
      return condition.conditions.some((nested) => evaluateFilmCondition(nested, session));
    case "not":
      return !evaluateFilmCondition(condition.condition, session);
  }
}

export function applyFilmEffects(
  session: StoryFilmPreviewSession,
  effects: readonly RuntimeSessionEffect[]
): StoryFilmPreviewSession {
  if (effects.length === 0) return session;

  const next: StoryFilmPreviewSession = {
    variables: { ...session.variables },
    flags: { ...session.flags },
    relationships: { ...session.relationships },
    watchedAssetIds: [...session.watchedAssetIds],
    unlockedEndingIds: [...session.unlockedEndingIds],
  };

  for (const effect of effects) {
    switch (effect.kind) {
      case "set_variable":
        next.variables[effect.key] = effect.value;
        break;
      case "increment_variable": {
        const current = next.variables[effect.key];
        if (typeof current === "number") next.variables[effect.key] = current + effect.amount;
        break;
      }
      case "set_flag":
        next.flags[effect.flag] = effect.value;
        break;
      case "adjust_relationship":
        next.relationships[effect.characterId] =
          (next.relationships[effect.characterId] ?? 0) + effect.amount;
        break;
      case "mark_asset_watched":
        pushUnique(next.watchedAssetIds, effect.assetId);
        break;
      case "unlock_ending":
        pushUnique(next.unlockedEndingIds, effect.endingId);
        break;
    }
  }

  return next;
}

/** Lower numeric values have higher routing priority; equal priorities retain author order. */
export function selectFilmAutoRoute(
  exit: RuntimeAutoExit,
  session: StoryFilmPreviewSession
): RuntimeAutoExit["routes"][number] | null {
  let selected: RuntimeAutoExit["routes"][number] | null = null;
  for (const route of exit.routes) {
    if (!evaluateFilmCondition(route.when, session)) continue;
    if (!selected || route.priority < selected.priority) selected = route;
  }
  return selected;
}

export function visibleFilmChoices(
  exit: RuntimeChoiceExit,
  session: StoryFilmPreviewSession
): RuntimeChoiceExit["choices"] {
  return exit.choices.filter((choice) => evaluateFilmCondition(choice.visibleWhen, session));
}

export function createFilmChoiceTransition(
  session: StoryFilmPreviewSession,
  choice: RuntimeChoiceExit["choices"][number]
): FilmChoiceTransition {
  return {
    nextNodeId: choice.nextNodeId,
    reactionAssetId: choice.afterSelect.kind === "play" ? choice.afterSelect.reactionAssetId : null,
    session: applyFilmEffects(session, choice.effects),
  };
}

/**
 * Resolves the one built-in deterministic checkpoint action. Other external
 * renderers remain unsupported by the internal playtest and fail loudly.
 */
export function createFilmCheckpointTransition(
  session: StoryFilmPreviewSession,
  exit: RuntimeExternalExit
): FilmCheckpointTransition | null {
  if (exit.rendererId !== STORY_CHECKPOINT_RENDERER_ID || exit.routes.length !== 1) return null;
  const action = exit.routes[0];
  if (
    !action ||
    action.actionId !== STORY_CHECKPOINT_CONTINUE_ACTION_ID ||
    !("nextNodeId" in action) ||
    action.effects.length !== 0
  ) {
    return null;
  }
  return {
    nextNodeId: action.nextNodeId,
    session,
  };
}

export function resolveFilmSequenceEndAction(
  clip: RuntimeVideoSequenceClip,
  sequenceIndex: number,
  sequenceLength: number
): FilmSequenceEndAction {
  const isLast = sequenceIndex >= sequenceLength - 1;
  const behavior = clip.endBehavior;

  switch (behavior.behavior) {
    case "advance":
      return isLast ? { kind: "complete" } : { kind: "advance", sequenceIndex: sequenceIndex + 1 };
    case "hold-last-frame":
      return behavior.durationMs
        ? {
            kind: "hold",
            durationMs: behavior.durationMs,
            sequenceIndex: isLast ? null : sequenceIndex + 1,
          }
        : { kind: "complete" };
    case "loop-tail":
      return { kind: "loop-tail", tailSeconds: behavior.tailSeconds };
    case "loop":
      return { kind: "loop", assetId: behavior.assetId };
  }
}

export function filmSequenceTimeSeconds(
  clipDurationsSeconds: readonly number[],
  sequenceIndex: number,
  currentClipSeconds: number
): number {
  const completedSeconds = clipDurationsSeconds
    .slice(0, Math.max(0, sequenceIndex))
    .reduce(
      (total, duration) => total + (Number.isFinite(duration) ? Math.max(0, duration) : 0),
      0
    );
  return (
    completedSeconds + (Number.isFinite(currentClipSeconds) ? Math.max(0, currentClipSeconds) : 0)
  );
}

export function filmTimecodeDelayWithinHoldMs(
  triggerSeconds: number,
  elapsedSeconds: number,
  holdDurationMs: number
): number | null {
  if (
    !Number.isFinite(triggerSeconds) ||
    !Number.isFinite(elapsedSeconds) ||
    !Number.isFinite(holdDurationMs) ||
    holdDurationMs <= 0
  ) {
    return null;
  }
  const delayMs = Math.max(0, (triggerSeconds - elapsedSeconds) * 1_000);
  return delayMs <= holdDurationMs ? delayMs : null;
}

export function resolveFilmRuntimeNode(
  release: Pick<InteractiveFilmRelease, "nodes">,
  startNodeId: string,
  session: StoryFilmPreviewSession
): RuntimeNodeResolution {
  const nodes = new Map(release.nodes.map((node) => [node.nodeId, node]));
  const traversedNodeIds: string[] = [];
  const visitedRouters = new Set<string>();
  let nodeId = startNodeId;

  while (true) {
    const node = nodes.get(nodeId);
    if (!node) return { ok: false, code: "UNKNOWN_NODE", nodeId, traversedNodeIds };
    traversedNodeIds.push(nodeId);
    if (!isFilmRouterNode(node)) return { ok: true, node, traversedNodeIds };
    if (visitedRouters.has(nodeId)) {
      return { ok: false, code: "ROUTER_CYCLE", nodeId, traversedNodeIds };
    }
    visitedRouters.add(nodeId);
    const route = selectFilmAutoRoute(node.exit, session);
    if (!route) return { ok: false, code: "NO_MATCHING_ROUTE", nodeId, traversedNodeIds };
    nodeId = route.nextNodeId;
  }
}

export function isFilmRouterNode(
  node: InteractiveFilmRuntimeNode
): node is Extract<InteractiveFilmRuntimeNode, { kind: "router" }> {
  return "kind" in node && node.kind === "router";
}

export function localizedFilmText(
  values: Record<string, string>,
  locale: string,
  defaultLocale: string
): string {
  const exact = values[locale];
  if (exact) return exact;

  const language = locale.split("-")[0]?.toLowerCase();
  const languageMatch = Object.entries(values).find(
    ([candidate]) => candidate.split("-")[0]?.toLowerCase() === language
  )?.[1];
  if (languageMatch) return languageMatch;

  // A fallback must always be authored copy. Never select an arbitrary locale
  // and present it as though it matched the current UI language.
  return values[defaultLocale] ?? "";
}

export function resolveFilmPlaybackLocale(
  locales: readonly string[],
  requestedLocale: string,
  defaultLocale: string
): string {
  if (locales.includes(requestedLocale)) return requestedLocale;
  const requestedLanguage = requestedLocale.split("-")[0]?.toLowerCase();
  const languageMatch = locales.find(
    (candidate) => candidate.split("-")[0]?.toLowerCase() === requestedLanguage
  );
  return languageMatch ?? defaultLocale;
}

function compareVariable(
  left: RuntimeSessionValue | undefined,
  operator: Extract<FilmCondition, { kind: "variable" }>["operator"],
  right: RuntimeSessionValue
): boolean {
  if (operator === "equals") return left === right;
  if (operator === "not_equals") return left !== right;
  if (typeof left !== "number" || typeof right !== "number") return false;

  switch (operator) {
    case "greater_than":
      return left > right;
    case "at_least":
      return left >= right;
    case "less_than":
      return left < right;
    case "at_most":
      return left <= right;
    default:
      return false;
  }
}

function pushUnique(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value);
}
