import type {
  InteractiveStoryDraftContent,
  StoryBibleEnding,
  StoryBibleStateVariable,
  StoryBibleWriterPatch,
  StoryClipGraphNode,
  StoryDecisionGraphNode,
  StoryGraphChoice,
  StoryGraphNode,
} from "@/lib/story-projects-api";
import {
  MAX_STORY_EXIT_ROUTES,
  MAX_STORY_STATE_EFFECTS,
  MAX_STORY_STATE_NOTE_LENGTH,
  MAX_STORY_STATE_VARIABLES,
  StoryStateKeySchema,
  replaceAutoFallbackTarget,
  storyAutoExit,
  storyAutoFallbackNodeId,
  storyConditionTypeError,
  storyEffectTypeError,
  storyNodeTarget,
  storyRouteEndingId,
  storyRouteNodeId,
  type StoryCondition,
  type StoryExitRoute,
  type StoryRouteTarget,
  type StoryStateEffect,
} from "@repo/shared/story-stats";

type ClipGraphNode = StoryClipGraphNode;
type FlowGraphNode = StoryClipGraphNode & {
  exit: Extract<StoryClipGraphNode["exit"], { kind: "auto" }>;
};
type ChoiceClipNode = (ClipGraphNode | StoryDecisionGraphNode) & {
  exit: Extract<ClipGraphNode["exit"], { kind: "choice" }>;
};

const STABLE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]*$/;
const CLIP_KEY_PATTERN = /^[A-Z][A-Z0-9_-]*$/;
const MAX_STABLE_ID_LENGTH = 120;
const MAX_CLIP_KEY_LENGTH = 40;
const MAX_CHOICES = 6;

export type StoryDraftMutationErrorCode =
  | "DUPLICATE_NODE_ID"
  | "DUPLICATE_CLIP_KEY"
  | "DUPLICATE_CHOICE_ID"
  | "INVALID_STABLE_ID"
  | "INVALID_CLIP_KEY"
  | "INVALID_LOCALE"
  | "NODE_NOT_FOUND"
  | "CLIP_NOT_FOUND"
  | "CHOICE_NOT_FOUND"
  | "TARGET_NODE_NOT_FOUND"
  | "SOURCE_EXIT_KIND_MISMATCH"
  | "CHOICE_LIMIT_REACHED"
  | "BRANCH_NOT_FOUND"
  | "DUPLICATE_STATE_KEY"
  | "INVALID_STATE_KEY"
  | "STATE_VARIABLE_LIMIT"
  | "STATE_VARIABLE_NOT_FOUND"
  | "DUPLICATE_ENDING_ID"
  | "ENDING_NOT_FOUND"
  | "EFFECT_LIMIT"
  | "ROUTE_LIMIT"
  | "INVALID_EFFECT"
  | "INVALID_CONDITION"
  | "INVALID_ROUTES";

export class StoryDraftMutationError extends Error {
  constructor(
    readonly code: StoryDraftMutationErrorCode,
    message: string
  ) {
    super(message);
    this.name = "StoryDraftMutationError";
  }
}

export interface CreateClipNodeOptions {
  nodeId?: string;
  clipKey?: string;
  name?: string;
}

export interface StoryNodeCreationResult<T> {
  content: InteractiveStoryDraftContent;
  created: T;
}

export function createClipNode(
  content: InteractiveStoryDraftContent,
  options: CreateClipNodeOptions = {}
): StoryNodeCreationResult<ClipGraphNode> {
  const ordinal = content.graph.nodes.length + 1;
  const nodeId = options.nodeId
    ? assertAvailableNodeId(content, options.nodeId)
    : allocateStableId(
        content.graph.nodes.map((node) => node.nodeId),
        `clip:scene-${ordinal}`
      );
  const clipKey = options.clipKey
    ? assertAvailableClipKey(content, options.clipKey)
    : allocateClipKey(
        content.graph.nodes.flatMap((node) => (node.kind === "clip" ? [node.clipKey] : [])),
        `SCENE_${ordinal}`
      );
  const created: ClipGraphNode = {
    kind: "clip",
    nodeId,
    clipKey,
    ...(options.name?.trim() ? { name: options.name.trim() } : {}),
    interactions: [],
    exit: storyAutoExit(null),
  };
  return { content: appendGraphNode(content, created), created };
}

/** Decisions and unfinished options are saved independently of their connections. */
export function createDecisionNode(
  content: InteractiveStoryDraftContent,
  locale: string,
  options: { nodeId?: string; labels?: string[] } = {}
): StoryNodeCreationResult<StoryDecisionGraphNode> {
  const nodeId = options.nodeId
    ? assertAvailableNodeId(content, options.nodeId)
    : allocateStableId(
        content.graph.nodes.map((node) => node.nodeId),
        "decision:choice"
      );
  const created: StoryDecisionGraphNode = {
    kind: "decision",
    nodeId,
    exit: {
      kind: "choice",
      decisionId: allocateStableId(
        content.graph.nodes.flatMap((node) =>
          node.exit.kind === "choice" ? [node.exit.decisionId] : []
        ),
        nodeId
      ),
      prompt: { [assertLocale(locale)]: "" },
      choices: (options.labels ?? ["Option 1", "Option 2"]).map((label, index) => ({
        choiceId: `option:${index + 1}`,
        label: { [assertLocale(locale)]: label },
        target: null,
      })),
    },
  };
  return { content: appendGraphNode(content, created), created };
}

/** Upgrade attached decisions without discarding any authored copy or target. */
export function materializeStoryDecisionNodes(
  content: InteractiveStoryDraftContent
): InteractiveStoryDraftContent {
  const ids = content.graph.nodes.map((node) => node.nodeId);
  let changed = false;
  const nodes = content.graph.nodes.flatMap((node): StoryGraphNode[] => {
    if (node.kind !== "clip" || node.exit.kind !== "choice") return [node];
    changed = true;
    const nodeId = allocateStableId(ids, `decision:${node.nodeId}`.slice(0, MAX_STABLE_ID_LENGTH));
    ids.push(nodeId);
    return [
      { ...node, exit: storyAutoExit(nodeId) },
      { kind: "decision", nodeId, exit: node.exit },
    ];
  });
  return changed ? { ...content, graph: { ...content.graph, nodes } } : content;
}

/** Updates human-facing clip metadata without changing its stable machine key. */
export function updateStoryClipMeta(
  content: InteractiveStoryDraftContent,
  nodeId: string,
  patch: { name?: string; description?: string }
): InteractiveStoryDraftContent {
  let found = false;
  const nodes = content.graph.nodes.map((node) => {
    if (node.nodeId !== nodeId || node.kind !== "clip") return node;
    found = true;
    return { ...node, ...patch };
  });
  if (!found) throw error("CLIP_NOT_FOUND", `Unknown clip node ${nodeId}.`);
  return { ...content, graph: { ...content.graph, nodes } };
}

export function replaceStoryNodeInteractions(
  content: InteractiveStoryDraftContent,
  sourceNodeId: string,
  interactions: StoryClipGraphNode["interactions"]
): InteractiveStoryDraftContent {
  const source = requireClip(content, sourceNodeId);
  return replaceGraphNode(content, sourceNodeId, { ...source, interactions });
}

export function setEntryNode(
  content: InteractiveStoryDraftContent,
  nodeId: string | null
): InteractiveStoryDraftContent {
  if (nodeId !== null) requireTargetNode(content, nodeId);
  return content.graph.entryNodeId === nodeId
    ? content
    : { ...content, graph: { ...content.graph, entryNodeId: nodeId } };
}

export function deleteGraphNode(
  content: InteractiveStoryDraftContent,
  nodeId: string
): InteractiveStoryDraftContent {
  content = materializeStoryDecisionNodes(content);
  const deletedIndex = content.graph.nodes.findIndex((node) => node.nodeId === nodeId);
  if (deletedIndex < 0) throw error("NODE_NOT_FOUND", `Unknown graph node ${nodeId}.`);
  const nodes = content.graph.nodes
    .filter((node) => node.nodeId !== nodeId)
    .map((node) => removeNodeReferences(node, nodeId));
  const entryNodeId = content.graph.entryNodeId === nodeId ? null : content.graph.entryNodeId;
  return { ...content, graph: { entryNodeId, nodes } };
}

export function convertExitToAuto(
  content: InteractiveStoryDraftContent,
  sourceNodeId: string
): InteractiveStoryDraftContent {
  const source = requireClip(content, sourceNodeId);
  return source.exit.kind === "auto"
    ? content
    : replaceGraphNode(content, sourceNodeId, {
        ...source,
        exit: storyAutoExit(null),
      });
}

export function updateChoiceExitPrompt(
  content: InteractiveStoryDraftContent,
  sourceNodeId: string,
  locale: string,
  prompt: string
): InteractiveStoryDraftContent {
  const source = requireChoiceClip(content, sourceNodeId);
  return replaceChoiceExit(content, source, {
    ...source.exit,
    prompt: { ...source.exit.prompt, [assertLocale(locale)]: prompt },
  });
}

export interface AddChoiceOptionOptions {
  choiceId?: string;
  label?: string;
  allowExternalTarget?: boolean;
}

export function addChoiceOption(
  content: InteractiveStoryDraftContent,
  sourceNodeId: string,
  targetNodeId: string | null,
  locale: string,
  options: AddChoiceOptionOptions = {}
): StoryNodeCreationResult<StoryGraphChoice> {
  const source = requireChoiceClip(content, sourceNodeId);
  if (targetNodeId !== null) {
    if (options.allowExternalTarget) assertStableId(targetNodeId);
    else requireTargetNode(content, targetNodeId);
  }
  if (source.exit.choices.length >= MAX_CHOICES) {
    throw error("CHOICE_LIMIT_REACHED", `Choice ${source.exit.decisionId} is full.`);
  }
  const choiceId = options.choiceId
    ? assertAvailableChoiceId(source, options.choiceId)
    : allocateStableId(
        source.exit.choices.map((choice) => choice.choiceId),
        `choice:${source.exit.choices.length + 1}`
      );
  const created: StoryGraphChoice = {
    choiceId,
    label: { [assertLocale(locale)]: options.label ?? "" },
    target: storyNodeTarget(targetNodeId),
  };
  return {
    content: replaceChoiceExit(content, source, {
      ...source.exit,
      choices: [...source.exit.choices, created],
    }),
    created,
  };
}

export type ChoiceMoveDirection = "up" | "down";

export function updateChoiceOptionLabel(
  content: InteractiveStoryDraftContent,
  sourceNodeId: string,
  choiceId: string,
  locale: string,
  label: string
): InteractiveStoryDraftContent {
  const source = requireChoiceClip(content, sourceNodeId);
  const choice = requireChoice(source, choiceId);
  return replaceChoiceExit(content, source, {
    ...source.exit,
    choices: source.exit.choices.map((candidate) =>
      candidate.choiceId === choiceId
        ? { ...choice, label: { ...choice.label, [assertLocale(locale)]: label } }
        : candidate
    ),
  });
}

export function removeChoiceOption(
  content: InteractiveStoryDraftContent,
  sourceNodeId: string,
  choiceId: string
): InteractiveStoryDraftContent {
  const source = requireChoiceClip(content, sourceNodeId);
  requireChoice(source, choiceId);
  return replaceChoiceExit(content, source, {
    ...source.exit,
    choices: source.exit.choices.filter((choice) => choice.choiceId !== choiceId),
  });
}

export function moveChoiceOption(
  content: InteractiveStoryDraftContent,
  sourceNodeId: string,
  choiceId: string,
  direction: ChoiceMoveDirection
): InteractiveStoryDraftContent {
  const source = requireChoiceClip(content, sourceNodeId);
  requireChoice(source, choiceId);
  const currentIndex = source.exit.choices.findIndex((choice) => choice.choiceId === choiceId);
  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (targetIndex < 0 || targetIndex >= source.exit.choices.length) return content;
  const choices = [...source.exit.choices];
  [choices[currentIndex], choices[targetIndex]] = [choices[targetIndex]!, choices[currentIndex]!];
  return replaceChoiceExit(content, source, { ...source.exit, choices });
}

export function connectChoiceTarget(
  content: InteractiveStoryDraftContent,
  sourceNodeId: string,
  choiceId: string,
  targetNodeId: string
): InteractiveStoryDraftContent {
  requireTargetNode(content, targetNodeId);
  const source = requireChoiceClip(content, sourceNodeId);
  const choice = requireChoice(source, choiceId);
  return storyRouteNodeId(choice.target) === targetNodeId
    ? content
    : replaceChoiceExit(content, source, {
        ...source.exit,
        choices: source.exit.choices.map((candidate) =>
          candidate.choiceId === choiceId
            ? { ...candidate, target: storyNodeTarget(targetNodeId) }
            : candidate
        ),
      });
}

export function disconnectChoiceTarget(
  content: InteractiveStoryDraftContent,
  sourceNodeId: string,
  choiceId: string
): InteractiveStoryDraftContent {
  const source = requireChoiceClip(content, sourceNodeId);
  requireChoice(source, choiceId);
  return replaceChoiceExit(content, source, {
    ...source.exit,
    choices: source.exit.choices.map((choice) =>
      choice.choiceId === choiceId ? { ...choice, target: null } : choice
    ),
  });
}

export function connectSceneContinuation(
  content: InteractiveStoryDraftContent,
  sourceNodeId: string,
  targetNodeId: string,
  options: { allowExternalTarget?: boolean } = {}
): InteractiveStoryDraftContent {
  const source = requireFlowNode(content, sourceNodeId);
  if (options.allowExternalTarget) assertStableId(targetNodeId);
  else requireTargetNode(content, targetNodeId);
  if (source.exit.kind !== "auto") {
    throw error("SOURCE_EXIT_KIND_MISMATCH", `Node ${sourceNodeId} is not automatic.`);
  }
  return storyAutoFallbackNodeId(source.exit) === targetNodeId
    ? content
    : replaceGraphNode(content, sourceNodeId, {
        ...source,
        exit: {
          kind: "auto",
          routes: replaceAutoFallbackTarget(source.exit.routes, storyNodeTarget(targetNodeId)),
        },
      });
}

export function disconnectSceneContinuation(
  content: InteractiveStoryDraftContent,
  sourceNodeId: string,
  targetNodeId?: string
): InteractiveStoryDraftContent {
  const source = requireFlowNode(content, sourceNodeId);
  if (source.exit.kind !== "auto") {
    throw error("BRANCH_NOT_FOUND", `Node ${sourceNodeId} has no matching continuation.`);
  }
  if (targetNodeId === undefined) {
    if (storyAutoFallbackNodeId(source.exit) === null) {
      throw error("BRANCH_NOT_FOUND", `Node ${sourceNodeId} has no matching continuation.`);
    }
    return replaceGraphNode(content, sourceNodeId, {
      ...source,
      exit: { kind: "auto", routes: replaceAutoFallbackTarget(source.exit.routes, null) },
    });
  }
  if (storyAutoFallbackNodeId(source.exit) === targetNodeId) {
    return replaceGraphNode(content, sourceNodeId, {
      ...source,
      exit: { kind: "auto", routes: replaceAutoFallbackTarget(source.exit.routes, null) },
    });
  }
  return disconnectConditionalContinuation(content, sourceNodeId, targetNodeId);
}

export function disconnectConditionalContinuation(
  content: InteractiveStoryDraftContent,
  sourceNodeId: string,
  targetNodeId: string
): InteractiveStoryDraftContent {
  const source = requireFlowNode(content, sourceNodeId);
  const routes = source.exit.routes.filter(
    (route) => !(route.when && storyRouteNodeId(route.target) === targetNodeId)
  );
  if (routes.length === source.exit.routes.length) {
    throw error("BRANCH_NOT_FOUND", `Node ${sourceNodeId} has no matching continuation.`);
  }
  return replaceGraphNode(content, sourceNodeId, {
    ...source,
    exit: { kind: "auto", routes: assertAutoRoutes(routes) },
  });
}

export type StoryBranchSelector =
  | { kind: "continuation"; sourceNodeId: string; targetNodeId: string }
  | { kind: "choice"; sourceNodeId: string; choiceId: string }
  | {
      kind: "interaction";
      sourceNodeId: string;
      interactionId: string;
      outcome: "success" | "failure" | "timeout";
    };

export function disconnectStoryBranch(
  content: InteractiveStoryDraftContent,
  selector: StoryBranchSelector
): InteractiveStoryDraftContent {
  if (selector.kind === "continuation") {
    return disconnectSceneContinuation(content, selector.sourceNodeId, selector.targetNodeId);
  }
  if (selector.kind === "interaction") {
    const source = requireClip(content, selector.sourceNodeId);
    const interaction = source.interactions.find(
      (candidate) => candidate.interactionId === selector.interactionId
    );
    const action = interaction?.outcomes[selector.outcome];
    if (!interaction || !action || action.kind !== "goto") {
      throw error(
        "BRANCH_NOT_FOUND",
        `Clip ${selector.sourceNodeId} has no matching interaction branch.`
      );
    }
    return replaceGraphNode(content, selector.sourceNodeId, {
      ...source,
      interactions: source.interactions.map((candidate) =>
        candidate.interactionId === selector.interactionId
          ? {
              ...candidate,
              outcomes:
                selector.outcome === "success"
                  ? { ...candidate.outcomes, success: { kind: "continue" } }
                  : omitInteractionOutcome(candidate.outcomes, selector.outcome),
            }
          : candidate
      ),
    });
  }
  return disconnectChoiceTarget(content, selector.sourceNodeId, selector.choiceId);
}

export function applyStoryBiblePatch(
  content: InteractiveStoryDraftContent,
  patch: StoryBibleWriterPatch
): InteractiveStoryDraftContent {
  let next = content;
  if (patch.logline !== undefined || patch.synopsis !== undefined) {
    next = {
      ...next,
      storyBible: {
        ...next.storyBible,
        ...(patch.logline !== undefined ? { logline: patch.logline } : {}),
        ...(patch.synopsis !== undefined ? { synopsis: patch.synopsis } : {}),
      },
    };
  }
  if (patch.stateVariables) {
    const nextKeys = new Set(patch.stateVariables.map((variable) => variable.key));
    for (const previous of bibleVariables(next)) {
      if (!nextKeys.has(previous.key)) next = removeStoryStateVariable(next, previous.key);
    }
    for (const variable of patch.stateVariables) {
      next = putStoryStateVariable(next, variable);
    }
  }
  if (patch.endings) {
    const nextIds = new Set(patch.endings.map((ending) => ending.endingId));
    for (const previous of bibleEndings(next)) {
      if (!nextIds.has(previous.endingId)) next = removeStoryEnding(next, previous.endingId);
    }
    for (const ending of patch.endings) {
      next = putStoryEnding(next, ending);
    }
  }
  return next;
}

export function putStoryStateVariable(
  content: InteractiveStoryDraftContent,
  variable: StoryBibleStateVariable
): InteractiveStoryDraftContent {
  const key = assertStateKey(variable.key);
  const current = bibleVariables(content);
  const existingIndex = current.findIndex((candidate) => candidate.key === key);
  if (existingIndex < 0 && current.length >= MAX_STORY_STATE_VARIABLES) {
    throw error("STATE_VARIABLE_LIMIT", `At most ${MAX_STORY_STATE_VARIABLES} state variables.`);
  }
  const nextVariable = normalizeStateVariable({ ...variable, key });
  const stateVariables =
    existingIndex < 0
      ? [...current, nextVariable]
      : current.map((candidate, index) => (index === existingIndex ? nextVariable : candidate));
  return replaceBible(content, { stateVariables });
}

export function removeStoryStateVariable(
  content: InteractiveStoryDraftContent,
  key: string
): InteractiveStoryDraftContent {
  const current = bibleVariables(content);
  if (!current.some((variable) => variable.key === key)) {
    throw error("STATE_VARIABLE_NOT_FOUND", `Unknown state variable ${key}.`);
  }
  const stateVariables = current.filter((variable) => variable.key !== key);
  return stripStateKeyFromContent(replaceBible(content, { stateVariables }), key);
}

export function putStoryEnding(
  content: InteractiveStoryDraftContent,
  ending: StoryBibleEnding
): InteractiveStoryDraftContent {
  const endingId = assertStableId(ending.endingId);
  const current = bibleEndings(content);
  const existingIndex = current.findIndex((candidate) => candidate.endingId === endingId);
  const nextEnding: StoryBibleEnding = {
    endingId,
    title: ending.title,
    kind: ending.kind,
  };
  const endings =
    existingIndex < 0
      ? [...current, nextEnding]
      : current.map((candidate, index) => (index === existingIndex ? nextEnding : candidate));
  return replaceBible(content, { endings });
}

export function removeStoryEnding(
  content: InteractiveStoryDraftContent,
  endingId: string
): InteractiveStoryDraftContent {
  const current = bibleEndings(content);
  if (!current.some((ending) => ending.endingId === endingId)) {
    throw error("ENDING_NOT_FOUND", `Unknown ending ${endingId}.`);
  }
  const endings = current.filter((ending) => ending.endingId !== endingId);
  return stripEndingFromContent(replaceBible(content, { endings }), endingId);
}

function nextStoryEndingId(content: InteractiveStoryDraftContent): string {
  const ids = new Set(bibleEndings(content).map((ending) => ending.endingId));
  for (let index = 1; ; index += 1) {
    const id = `ending:${index}`;
    if (!ids.has(id)) return id;
  }
}

/** Add the ending and its route in one draft mutation, so neither can be saved alone. */
export function createStoryEndingForAutoRoute(
  content: InteractiveStoryDraftContent,
  sourceNodeId: string,
  routeIndex: number,
  locale: string,
  title: string
): InteractiveStoryDraftContent {
  const source = requireFlowNode(content, sourceNodeId);
  if (!source.exit.routes[routeIndex]) throw error("INVALID_ROUTES", "Route not found.");
  const endingId = nextStoryEndingId(content);
  const withEnding = putStoryEnding(content, {
    endingId,
    title: { [locale]: title },
    kind: "neutral",
  });
  return setAutoRoutes(
    withEnding,
    sourceNodeId,
    source.exit.routes.map((route, index) =>
      index === routeIndex ? { ...route, target: { kind: "ending", endingId } } : route
    )
  );
}

export function createStoryEndingForChoice(
  content: InteractiveStoryDraftContent,
  sourceNodeId: string,
  choiceId: string,
  locale: string,
  title: string
): InteractiveStoryDraftContent {
  const endingId = nextStoryEndingId(content);
  const withEnding = putStoryEnding(content, {
    endingId,
    title: { [locale]: title },
    kind: "neutral",
  });
  return updateChoiceStats(withEnding, sourceNodeId, choiceId, {
    target: { kind: "ending", endingId },
  });
}

export function setNodeOnEnterEffects(
  content: InteractiveStoryDraftContent,
  nodeId: string,
  effects: StoryStateEffect[] | null
): InteractiveStoryDraftContent {
  const node = requireGraphNode(content, nodeId);
  return replaceGraphNode(
    content,
    nodeId,
    withOptionalField(node, "onEnterEffects", assertEffects(content, effects))
  );
}

export function setAutoRoutes(
  content: InteractiveStoryDraftContent,
  sourceNodeId: string,
  routes: StoryExitRoute[]
): InteractiveStoryDraftContent {
  const source = requireFlowNode(content, sourceNodeId);
  return replaceGraphNode(content, sourceNodeId, {
    ...source,
    exit: { kind: "auto", routes: assertAutoRoutes(routes, variableLookup(content)) },
  });
}

export function updateChoiceStats(
  content: InteractiveStoryDraftContent,
  sourceNodeId: string,
  choiceId: string,
  patch: {
    effects?: StoryStateEffect[] | null;
    visibleWhen?: StoryCondition | null;
    target?: StoryRouteTarget | null;
  }
): InteractiveStoryDraftContent {
  const source = requireChoiceClip(content, sourceNodeId);
  const choice = requireChoice(source, choiceId);
  if (patch.target?.kind === "node") requireTargetNode(content, patch.target.nodeId);
  if (patch.target?.kind === "ending") requireEnding(content, patch.target.endingId);
  let next: StoryGraphChoice = { ...choice };
  if (patch.target !== undefined) next = { ...next, target: patch.target };
  if (patch.effects !== undefined) {
    next = withOptionalField(next, "effects", assertEffects(content, patch.effects));
  }
  if (patch.visibleWhen !== undefined) {
    next = withOptionalField(next, "visibleWhen", assertCondition(content, patch.visibleWhen));
  }
  return replaceChoiceExit(content, source, {
    ...source.exit,
    choices: source.exit.choices.map((candidate) =>
      candidate.choiceId === choiceId ? next : candidate
    ),
  });
}

function appendGraphNode(
  content: InteractiveStoryDraftContent,
  node: StoryGraphNode
): InteractiveStoryDraftContent {
  return {
    ...content,
    graph: {
      entryNodeId: content.graph.entryNodeId ?? node.nodeId,
      nodes: [...content.graph.nodes, node],
    },
  };
}

function routesWithoutDeletedNode(
  routes: FlowGraphNode["exit"]["routes"],
  deletedNodeId: string
): FlowGraphNode["exit"]["routes"] {
  const next = routes.flatMap((route) => {
    if (storyRouteNodeId(route.target) !== deletedNodeId) return [route];
    return route.when ? [] : [{ target: null }];
  });
  const conditionals = next.filter((route) => route.when);
  const fallback = next.find((route) => !route.when) ?? { target: null };
  return [...conditionals, fallback];
}

function removeNodeReferences(node: StoryGraphNode, deletedNodeId: string): StoryGraphNode {
  const interactions = (node.kind === "clip" ? node.interactions : []).map((interaction) => ({
    ...interaction,
    outcomes: removeDeletedInteractionTargets(interaction.outcomes, deletedNodeId),
  }));
  if (node.exit.kind === "auto") {
    if (node.kind !== "clip") return node;
    return {
      ...node,
      interactions,
      exit: {
        kind: "auto",
        routes: routesWithoutDeletedNode(node.exit.routes, deletedNodeId),
      },
    };
  }
  return {
    ...node,
    ...(node.kind === "clip" ? { interactions } : {}),
    exit: {
      ...node.exit,
      choices: node.exit.choices.map((choice) =>
        storyRouteNodeId(choice.target) === deletedNodeId ? { ...choice, target: null } : choice
      ),
    },
  };
}

function omitInteractionOutcome(
  outcomes: StoryClipGraphNode["interactions"][number]["outcomes"],
  outcome: "failure" | "timeout"
): StoryClipGraphNode["interactions"][number]["outcomes"] {
  const remaining = { ...outcomes };
  delete remaining[outcome];
  return remaining;
}

function removeDeletedInteractionTargets(
  outcomes: StoryClipGraphNode["interactions"][number]["outcomes"],
  deletedNodeId: string
): StoryClipGraphNode["interactions"][number]["outcomes"] {
  const targetsDeleted = (
    action: StoryClipGraphNode["interactions"][number]["outcomes"]["success"]
  ) => action.kind === "goto" && storyRouteNodeId(action.target) === deletedNodeId;
  const success = targetsDeleted(outcomes.success)
    ? ({ kind: "continue" } as const)
    : outcomes.success;
  return {
    success,
    ...(outcomes.failure && !targetsDeleted(outcomes.failure) ? { failure: outcomes.failure } : {}),
    ...(outcomes.timeout && !targetsDeleted(outcomes.timeout) ? { timeout: outcomes.timeout } : {}),
  };
}

function replaceGraphNode(
  content: InteractiveStoryDraftContent,
  nodeId: string,
  replacement: StoryGraphNode
): InteractiveStoryDraftContent {
  return {
    ...content,
    graph: {
      ...content.graph,
      nodes: content.graph.nodes.map((node) => (node.nodeId === nodeId ? replacement : node)),
    },
  };
}

function replaceChoiceExit(
  content: InteractiveStoryDraftContent,
  source: ChoiceClipNode,
  exit: ChoiceClipNode["exit"]
): InteractiveStoryDraftContent {
  return replaceGraphNode(content, source.nodeId, { ...source, exit });
}

function requireClip(content: InteractiveStoryDraftContent, nodeId: string): ClipGraphNode {
  const node = content.graph.nodes.find((candidate) => candidate.nodeId === nodeId);
  if (!node || node.kind !== "clip") throw error("CLIP_NOT_FOUND", `Unknown clip ${nodeId}.`);
  return node;
}

function requireFlowNode(content: InteractiveStoryDraftContent, nodeId: string): FlowGraphNode {
  const node = content.graph.nodes.find((candidate) => candidate.nodeId === nodeId);
  if (!node || !isAutoFlowNode(node)) {
    throw error("SOURCE_EXIT_KIND_MISMATCH", `Node ${nodeId} is not an automatic flow node.`);
  }
  return node;
}

function requireChoiceClip(content: InteractiveStoryDraftContent, nodeId: string): ChoiceClipNode {
  const node = content.graph.nodes.find((candidate) => candidate.nodeId === nodeId);
  if (!node || node.exit.kind !== "choice") {
    throw error("SOURCE_EXIT_KIND_MISMATCH", `Clip ${nodeId} is not a choice.`);
  }
  return node as ChoiceClipNode;
}

function requireTargetNode(content: InteractiveStoryDraftContent, nodeId: string): void {
  if (!content.graph.nodes.some((node) => node.nodeId === nodeId)) {
    throw error("TARGET_NODE_NOT_FOUND", `Unknown target clip ${nodeId}.`);
  }
}

function requireChoice(source: ChoiceClipNode, choiceId: string): StoryGraphChoice {
  const choice = source.exit.choices.find((candidate) => candidate.choiceId === choiceId);
  if (!choice) throw error("CHOICE_NOT_FOUND", `Unknown choice ${choiceId}.`);
  return choice;
}

function assertAvailableNodeId(content: InteractiveStoryDraftContent, value: string): string {
  const nodeId = assertStableId(value);
  if (content.graph.nodes.some((node) => node.nodeId === nodeId)) {
    throw error("DUPLICATE_NODE_ID", `Graph node ${nodeId} already exists.`);
  }
  return nodeId;
}

function assertAvailableClipKey(content: InteractiveStoryDraftContent, value: string): string {
  const clipKey = assertClipKey(value);
  if (content.graph.nodes.some((node) => node.kind === "clip" && node.clipKey === clipKey)) {
    throw error("DUPLICATE_CLIP_KEY", `Clip key ${clipKey} already exists.`);
  }
  return clipKey;
}

function assertAvailableChoiceId(source: ChoiceClipNode, value: string): string {
  const choiceId = assertStableId(value);
  if (source.exit.choices.some((choice) => choice.choiceId === choiceId)) {
    throw error("DUPLICATE_CHOICE_ID", `Choice ${choiceId} already exists.`);
  }
  return choiceId;
}

function assertStableId(value: string): string {
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > MAX_STABLE_ID_LENGTH ||
    !STABLE_ID_PATTERN.test(normalized)
  ) {
    throw error("INVALID_STABLE_ID", `Invalid stable identifier ${value}.`);
  }
  return normalized;
}

function assertClipKey(value: string): string {
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > MAX_CLIP_KEY_LENGTH ||
    !CLIP_KEY_PATTERN.test(normalized)
  ) {
    throw error("INVALID_CLIP_KEY", `Invalid clip key ${value}.`);
  }
  return normalized;
}

function assertLocale(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 2 || normalized.length > 16) {
    throw error("INVALID_LOCALE", `Invalid locale ${value}.`);
  }
  return normalized;
}

function allocateStableId(existing: string[], preferred: string): string {
  const values = new Set(existing);
  const base = assertStableId(preferred);
  if (!values.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const tail = `-${suffix}`;
    const candidate = `${base.slice(0, MAX_STABLE_ID_LENGTH - tail.length)}${tail}`;
    if (!values.has(candidate)) return candidate;
  }
}

function allocateClipKey(existing: string[], preferred: string): string {
  const values = new Set(existing);
  const base = assertClipKey(preferred);
  if (!values.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const tail = `_${suffix}`;
    const candidate = `${base.slice(0, MAX_CLIP_KEY_LENGTH - tail.length)}${tail}`;
    if (!values.has(candidate)) return candidate;
  }
}

function bibleVariables(content: InteractiveStoryDraftContent): StoryBibleStateVariable[] {
  return content.storyBible.stateVariables ?? [];
}

function bibleEndings(content: InteractiveStoryDraftContent): StoryBibleEnding[] {
  return content.storyBible.endings ?? [];
}

function replaceBible(
  content: InteractiveStoryDraftContent,
  patch: Partial<Pick<InteractiveStoryDraftContent["storyBible"], "stateVariables" | "endings">>
): InteractiveStoryDraftContent {
  return { ...content, storyBible: { ...content.storyBible, ...patch } };
}

function variableLookup(content: InteractiveStoryDraftContent) {
  return new Map(bibleVariables(content).map((variable) => [variable.key, variable]));
}

function normalizeStateVariable(variable: StoryBibleStateVariable): StoryBibleStateVariable {
  const valueType = variable.valueType;
  const initialValue =
    typeof variable.initialValue === valueType
      ? variable.initialValue
      : valueType === "boolean"
        ? false
        : 0;
  if (valueType === "number" && !Number.isFinite(initialValue)) {
    throw error("INVALID_STATE_KEY", "Initial value must be a finite number.");
  }
  if (valueType === "boolean") {
    return {
      key: variable.key,
      name: variable.name,
      valueType,
      initialValue,
      ...(variable.note?.trim()
        ? { note: variable.note.trim().slice(0, MAX_STORY_STATE_NOTE_LENGTH) }
        : {}),
    };
  }
  return {
    key: variable.key,
    name: variable.name,
    valueType,
    initialValue,
    ...(variable.note?.trim()
      ? { note: variable.note.trim().slice(0, MAX_STORY_STATE_NOTE_LENGTH) }
      : {}),
  };
}

function assertStateKey(value: string): string {
  const parsed = StoryStateKeySchema.safeParse(value);
  if (!parsed.success) throw error("INVALID_STATE_KEY", `Invalid state key ${value}.`);
  return parsed.data;
}

function assertEffects(
  content: InteractiveStoryDraftContent,
  effects: StoryStateEffect[] | null | undefined
): StoryStateEffect[] | undefined {
  if (!effects || effects.length === 0) return undefined;
  if (effects.length > MAX_STORY_STATE_EFFECTS) {
    throw error("EFFECT_LIMIT", `At most ${MAX_STORY_STATE_EFFECTS} effects.`);
  }
  const variables = variableLookup(content);
  for (const effect of effects) {
    const issue = storyEffectTypeError(effect, variables);
    if (issue) throw error("INVALID_EFFECT", issue);
  }
  return effects;
}

function assertCondition(
  content: InteractiveStoryDraftContent,
  condition: StoryCondition | null | undefined
): StoryCondition | undefined {
  if (!condition) return undefined;
  const issue = storyConditionTypeError(condition, variableLookup(content));
  if (issue) throw error("INVALID_CONDITION", issue);
  return condition;
}

function assertAutoRoutes(
  routes: StoryExitRoute[],
  variables?: ReturnType<typeof variableLookup>
): StoryExitRoute[] {
  if (routes.length < 1 || routes.length > MAX_STORY_EXIT_ROUTES) {
    throw error("ROUTE_LIMIT", `Auto routes must contain 1–${MAX_STORY_EXIT_ROUTES} entries.`);
  }
  const fallbackIndex = routes.findIndex((route) => route.when === undefined);
  if (
    fallbackIndex !== routes.length - 1 ||
    routes.some((route, index) => index !== fallbackIndex && !route.when)
  ) {
    throw error(
      "INVALID_ROUTES",
      "Conditional auto routes must precede a single unconditional fallback."
    );
  }
  if (variables) {
    for (const route of routes) {
      if (!route.when) continue;
      const issue = storyConditionTypeError(route.when, variables);
      if (issue) throw error("INVALID_CONDITION", issue);
    }
  }
  return routes;
}

function requireGraphNode(content: InteractiveStoryDraftContent, nodeId: string): StoryGraphNode {
  const node = content.graph.nodes.find((candidate) => candidate.nodeId === nodeId);
  if (!node) throw error("NODE_NOT_FOUND", `Unknown graph node ${nodeId}.`);
  return node;
}

function requireEnding(content: InteractiveStoryDraftContent, endingId: string): void {
  if (!bibleEndings(content).some((ending) => ending.endingId === endingId)) {
    throw error("ENDING_NOT_FOUND", `Unknown ending ${endingId}.`);
  }
}

function withOptionalField<T extends object, K extends string, V>(
  object: T,
  key: K,
  value: V | undefined
): T {
  if (value === undefined) {
    const next = { ...object } as T & Record<string, unknown>;
    delete next[key];
    return next;
  }
  return { ...object, [key]: value } as T;
}

function stripStateKeyFromContent(
  content: InteractiveStoryDraftContent,
  key: string
): InteractiveStoryDraftContent {
  return {
    ...content,
    graph: {
      ...content.graph,
      nodes: content.graph.nodes.map((node) => stripStateKeyFromNode(node, key)),
    },
  };
}

function isAutoFlowNode(node: StoryGraphNode): node is FlowGraphNode {
  return node.kind === "clip" && node.exit.kind === "auto";
}

function isChoiceNode(node: StoryGraphNode): node is ChoiceClipNode {
  return node.exit.kind === "choice";
}

function stripStateKeyFromNode(node: StoryGraphNode, key: string): StoryGraphNode {
  const withoutEffects = withOptionalField(
    node,
    "onEnterEffects",
    stripEffects(node.onEnterEffects, key)
  );
  if (withoutEffects.kind === "clip") {
    const withInteractions: StoryClipGraphNode = {
      ...withoutEffects,
      interactions: withoutEffects.interactions.map((interaction) => ({
        ...interaction,
        outcomes: {
          success: stripActionEffects(interaction.outcomes.success, key),
          ...(interaction.outcomes.failure
            ? { failure: stripActionEffects(interaction.outcomes.failure, key) }
            : {}),
          ...(interaction.outcomes.timeout
            ? { timeout: stripActionEffects(interaction.outcomes.timeout, key) }
            : {}),
        },
      })),
    };
    if (isAutoFlowNode(withInteractions)) return withStrippedAutoRoutes(withInteractions, key);
    if (isChoiceNode(withInteractions)) return withStrippedChoiceStats(withInteractions, key);
    return withInteractions;
  }
  if (isAutoFlowNode(withoutEffects)) return withStrippedAutoRoutes(withoutEffects, key);
  if (isChoiceNode(withoutEffects)) return withStrippedChoiceStats(withoutEffects, key);
  return withoutEffects;
}

function stripEndingFromContent(
  content: InteractiveStoryDraftContent,
  endingId: string
): InteractiveStoryDraftContent {
  return {
    ...content,
    graph: {
      ...content.graph,
      nodes: content.graph.nodes.map((node) => stripEndingFromNode(node, endingId)),
    },
  };
}

function stripEndingFromNode(node: StoryGraphNode, endingId: string): StoryGraphNode {
  if (isAutoFlowNode(node)) {
    return {
      ...node,
      exit: {
        kind: "auto",
        routes: node.exit.routes.map((route) =>
          storyRouteEndingId(route.target) === endingId ? { ...route, target: null } : route
        ),
      },
    };
  }
  if (isChoiceNode(node)) {
    return {
      ...node,
      exit: {
        ...node.exit,
        choices: node.exit.choices.map((choice) =>
          storyRouteEndingId(choice.target) === endingId ? { ...choice, target: null } : choice
        ),
      },
    };
  }
  return node;
}

function withStrippedAutoRoutes<T extends FlowGraphNode>(node: T, key: string): T {
  const routes = node.exit.routes.flatMap((route) => {
    if (!route.when) return [route];
    const when = stripConditionKey(route.when, key);
    return when ? [{ ...route, when }] : [];
  });
  return {
    ...node,
    exit: { kind: "auto", routes: assertAutoRoutes(routes.length ? routes : [{ target: null }]) },
  };
}

function withStrippedChoiceStats<T extends ChoiceClipNode>(node: T, key: string): T {
  return {
    ...node,
    exit: {
      ...node.exit,
      choices: node.exit.choices.map((choice) =>
        withOptionalField(
          withOptionalField(choice, "effects", stripEffects(choice.effects, key)),
          "visibleWhen",
          choice.visibleWhen ? stripConditionKey(choice.visibleWhen, key) : undefined
        )
      ),
    },
  };
}

function stripEffects(
  effects: StoryStateEffect[] | undefined,
  key: string
): StoryStateEffect[] | undefined {
  if (!effects?.length) return undefined;
  const next = effects.filter((effect) => effect.key !== key);
  return next.length ? next : undefined;
}

function stripActionEffects<T extends { effects?: StoryStateEffect[] }>(action: T, key: string): T {
  return withOptionalField(action, "effects", stripEffects(action.effects, key));
}

function stripConditionKey(condition: StoryCondition, key: string): StoryCondition | undefined {
  if (condition.kind === "compare") {
    return condition.variableKey === key ? undefined : condition;
  }
  if (condition.kind === "not") {
    const inner = stripConditionKey(condition.condition, key);
    return inner ? { kind: "not", condition: inner } : undefined;
  }
  const next = condition.conditions.flatMap((child) => {
    const stripped = stripConditionKey(child, key);
    return stripped ? [stripped] : [];
  });
  if (next.length === 0) return undefined;
  if (next.length === 1) return next[0];
  return { kind: condition.kind, conditions: next };
}

function error(code: StoryDraftMutationErrorCode, message: string): StoryDraftMutationError {
  return new StoryDraftMutationError(code, message);
}
