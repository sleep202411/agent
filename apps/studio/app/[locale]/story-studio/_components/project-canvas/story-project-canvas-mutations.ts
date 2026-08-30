import type {
  InteractiveStoryDraftContent,
  StoryClipGraphNode,
  StoryGraphChoice,
  StoryGraphNode,
  StoryWorldGraphNode,
} from "@/lib/story-projects-api";

type ClipGraphNode = StoryClipGraphNode;
type FlowGraphNode = StoryGraphNode & {
  exit: { kind: "auto"; nextNodeId: string | null };
};
type ChoiceClipNode = ClipGraphNode & {
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
  | "INVALID_MEDIA_ASSET_ID"
  | "NODE_NOT_FOUND"
  | "CLIP_NOT_FOUND"
  | "CHOICE_NOT_FOUND"
  | "TARGET_NODE_NOT_FOUND"
  | "SOURCE_EXIT_KIND_MISMATCH"
  | "CHOICE_LIMIT_REACHED"
  | "BRANCH_NOT_FOUND";

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

export interface CreateWorldNodeOptions {
  nodeId?: string;
  worldId?: string | null;
  name?: string;
  maxExperienceSeconds?: 60 | 90 | 120;
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
    exit: { kind: "auto", nextNodeId: null },
  };
  return { content: appendGraphNode(content, created), created };
}

export function createWorldNode(
  content: InteractiveStoryDraftContent,
  options: CreateWorldNodeOptions = {}
): StoryNodeCreationResult<StoryWorldGraphNode> {
  const ordinal = content.graph.nodes.filter((node) => node.kind === "world").length + 1;
  const nodeId = options.nodeId
    ? assertAvailableNodeId(content, options.nodeId)
    : allocateStableId(
        content.graph.nodes.map((node) => node.nodeId),
        `world:experience-${ordinal}`
      );
  const created: StoryWorldGraphNode = {
    kind: "world",
    nodeId,
    worldId: options.worldId ?? null,
    ...(options.name ? { name: options.name } : {}),
    maxExperienceSeconds: options.maxExperienceSeconds ?? 60,
    exit: { kind: "auto", nextNodeId: null },
  };
  return { content: appendGraphNode(content, created), created };
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

export function updateStoryWorldNode(
  content: InteractiveStoryDraftContent,
  nodeId: string,
  patch: Partial<
    Pick<StoryWorldGraphNode, "worldId" | "name" | "entryInstruction" | "maxExperienceSeconds">
  >
): InteractiveStoryDraftContent {
  const source = requireWorld(content, nodeId);
  return replaceGraphNode(content, nodeId, { ...source, ...patch });
}

export function replaceStoryNodeInteractions(
  content: InteractiveStoryDraftContent,
  sourceNodeId: string,
  interactions: StoryClipGraphNode["interactions"]
): InteractiveStoryDraftContent {
  const source = requireClip(content, sourceNodeId);
  return replaceGraphNode(content, sourceNodeId, { ...source, interactions });
}

export function duplicateClipNode(
  content: InteractiveStoryDraftContent,
  sourceNodeId: string,
  options: CreateClipNodeOptions = {}
): StoryNodeCreationResult<ClipGraphNode> {
  const source = requireClip(content, sourceNodeId);
  const result = createClipNode(content, options);
  const created: ClipGraphNode = {
    ...source,
    nodeId: result.created.nodeId,
    clipKey: result.created.clipKey,
    exit: { kind: "auto", nextNodeId: null },
  };
  return {
    content: replaceGraphNode(result.content, created.nodeId, created),
    created,
  };
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
  const deletedIndex = content.graph.nodes.findIndex((node) => node.nodeId === nodeId);
  if (deletedIndex < 0) throw error("NODE_NOT_FOUND", `Unknown graph node ${nodeId}.`);
  const nodes = content.graph.nodes
    .filter((node) => node.nodeId !== nodeId)
    .map((node) => removeNodeReferences(node, nodeId));
  const entryNodeId =
    content.graph.entryNodeId === nodeId
      ? (nodes[Math.min(deletedIndex, nodes.length - 1)]?.nodeId ?? null)
      : content.graph.entryNodeId;
  return { ...content, graph: { entryNodeId, nodes } };
}

export function convertSceneExitToChoice(
  content: InteractiveStoryDraftContent,
  sourceNodeId: string,
  locale: string,
  options: { decisionId?: string } = {}
): InteractiveStoryDraftContent {
  const source = requireClip(content, sourceNodeId);
  if (source.exit.kind === "choice" && !options.decisionId) return content;
  const decisionId = options.decisionId
    ? assertStableId(options.decisionId)
    : allocateStableId(
        content.graph.nodes.flatMap((node) =>
          node.exit.kind === "choice" ? [node.exit.decisionId] : []
        ),
        `decision:${content.graph.nodes.indexOf(source) + 1}`
      );
  return replaceGraphNode(content, sourceNodeId, {
    ...source,
    exit: {
      kind: "choice",
      decisionId,
      prompt: { [assertLocale(locale)]: "" },
      choices: [],
    },
  });
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
        exit: { kind: "auto", nextNodeId: null },
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
  targetNodeId: string,
  locale: string,
  options: AddChoiceOptionOptions = {}
): StoryNodeCreationResult<StoryGraphChoice> {
  const source = requireChoiceClip(content, sourceNodeId);
  if (options.allowExternalTarget) assertStableId(targetNodeId);
  else requireTargetNode(content, targetNodeId);
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
    nextNodeId: targetNodeId,
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
  return choice.nextNodeId === targetNodeId
    ? content
    : replaceChoiceExit(content, source, {
        ...source.exit,
        choices: source.exit.choices.map((candidate) =>
          candidate.choiceId === choiceId ? { ...candidate, nextNodeId: targetNodeId } : candidate
        ),
      });
}

export function disconnectChoiceTarget(
  content: InteractiveStoryDraftContent,
  sourceNodeId: string,
  choiceId: string
): InteractiveStoryDraftContent {
  return removeChoiceOption(content, sourceNodeId, choiceId);
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
  return source.exit.nextNodeId === targetNodeId
    ? content
    : replaceGraphNode(content, sourceNodeId, {
        ...source,
        exit: { kind: "auto", nextNodeId: targetNodeId },
      });
}

export function disconnectSceneContinuation(
  content: InteractiveStoryDraftContent,
  sourceNodeId: string,
  targetNodeId?: string
): InteractiveStoryDraftContent {
  const source = requireFlowNode(content, sourceNodeId);
  if (
    source.exit.kind !== "auto" ||
    source.exit.nextNodeId === null ||
    (targetNodeId !== undefined && source.exit.nextNodeId !== targetNodeId)
  ) {
    throw error("BRANCH_NOT_FOUND", `Node ${sourceNodeId} has no matching continuation.`);
  }
  return replaceGraphNode(content, sourceNodeId, {
    ...source,
    exit: { kind: "auto", nextNodeId: null },
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

function removeNodeReferences(node: StoryGraphNode, deletedNodeId: string): StoryGraphNode {
  if (node.kind === "world") {
    return {
      ...node,
      exit: node.exit.nextNodeId === deletedNodeId ? { kind: "auto", nextNodeId: null } : node.exit,
    };
  }
  const interactions = node.interactions.map((interaction) => ({
    ...interaction,
    outcomes: removeDeletedInteractionTargets(interaction.outcomes, deletedNodeId),
  }));
  if (node.exit.kind === "auto") {
    return {
      ...node,
      interactions,
      exit: node.exit.nextNodeId === deletedNodeId ? { kind: "auto", nextNodeId: null } : node.exit,
    };
  }
  return {
    ...node,
    interactions,
    exit: {
      ...node.exit,
      choices: node.exit.choices.filter((choice) => choice.nextNodeId !== deletedNodeId),
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
  const success =
    outcomes.success.kind === "goto" && outcomes.success.nodeId === deletedNodeId
      ? ({ kind: "continue" } as const)
      : outcomes.success;
  return {
    success,
    ...(outcomes.failure &&
    !(outcomes.failure.kind === "goto" && outcomes.failure.nodeId === deletedNodeId)
      ? { failure: outcomes.failure }
      : {}),
    ...(outcomes.timeout &&
    !(outcomes.timeout.kind === "goto" && outcomes.timeout.nodeId === deletedNodeId)
      ? { timeout: outcomes.timeout }
      : {}),
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

function requireWorld(content: InteractiveStoryDraftContent, nodeId: string): StoryWorldGraphNode {
  const node = content.graph.nodes.find((candidate) => candidate.nodeId === nodeId);
  if (!node || node.kind !== "world")
    throw error("NODE_NOT_FOUND", `Unknown world node ${nodeId}.`);
  return node;
}

function requireFlowNode(content: InteractiveStoryDraftContent, nodeId: string): FlowGraphNode {
  const node = content.graph.nodes.find((candidate) => candidate.nodeId === nodeId);
  if (!node || node.exit.kind !== "auto") {
    throw error("SOURCE_EXIT_KIND_MISMATCH", `Node ${nodeId} is not an automatic flow node.`);
  }
  return node as FlowGraphNode;
}

function requireChoiceClip(content: InteractiveStoryDraftContent, nodeId: string): ChoiceClipNode {
  const node = requireClip(content, nodeId);
  if (node.exit.kind !== "choice") {
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

function error(code: StoryDraftMutationErrorCode, message: string): StoryDraftMutationError {
  return new StoryDraftMutationError(code, message);
}
