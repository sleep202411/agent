import type {
  InteractiveStoryDraftContent,
  StoryGraphChoice,
  StoryGraphNode,
} from "@/lib/story-projects-api";

type ClipGraphNode = Extract<StoryGraphNode, { kind: "clip" }>;
type TextGraphNode = Extract<StoryGraphNode, { kind: "text" }>;
type SceneGraphNode = ClipGraphNode | TextGraphNode;
type ClipChoiceExit = Extract<ClipGraphNode["exit"], { kind: "choice" }>;
type TextChoiceExit = Extract<TextGraphNode["exit"], { kind: "choice" }>;
type ChoiceExit = ClipChoiceExit | TextChoiceExit;
type ChoiceScene =
  | (ClipGraphNode & { exit: ClipChoiceExit })
  | (TextGraphNode & { exit: TextChoiceExit });
type CheckpointExit = Extract<SceneGraphNode["exit"], { kind: "checkpoint" }>;
type StoryEnding = InteractiveStoryDraftContent["storyBible"]["endings"][number];

const STABLE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]*$/;
const CLIP_KEY_PATTERN = /^[A-Z][A-Z0-9_-]*$/;
const MAX_STABLE_ID_LENGTH = 120;
const MAX_CLIP_KEY_LENGTH = 40;
const MAX_CHOICES = 6;

export type StoryDraftMutationErrorCode =
  | "DUPLICATE_NODE_ID"
  | "DUPLICATE_CLIP_KEY"
  | "DUPLICATE_ENDING_ID"
  | "DUPLICATE_CHOICE_ID"
  | "INVALID_STABLE_ID"
  | "INVALID_CLIP_KEY"
  | "INVALID_LOCALE"
  | "NODE_NOT_FOUND"
  | "CLIP_NOT_FOUND"
  | "ENDING_NOT_FOUND"
  | "CHOICE_NOT_FOUND"
  | "TARGET_NODE_NOT_FOUND"
  | "SOURCE_EXIT_KIND_MISMATCH"
  | "CHOICE_LIMIT_REACHED"
  | "BRANCH_ALREADY_EXISTS"
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
}

export interface CreateTextNodeOptions {
  nodeId?: string;
  locale?: string;
  title?: string;
  body?: string;
}

export interface CreateEndingNodeOptions {
  endingId?: string;
  locale?: string;
  title?: string;
  summary?: string;
}

export interface StoryNodeCreationResult<T> {
  content: InteractiveStoryDraftContent;
  created: T;
}

export function createClipNode(
  content: InteractiveStoryDraftContent,
  options: CreateClipNodeOptions = {}
): StoryNodeCreationResult<ClipGraphNode> {
  const ordinal = content.graph.nodes.filter((node) => node.kind === "clip").length + 1;
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
    exit: { kind: "auto", nextNodeId: null },
  };
  return {
    content: appendGraphNode(content, created),
    created,
  };
}

export function createTextNode(
  content: InteractiveStoryDraftContent,
  options: CreateTextNodeOptions = {}
): StoryNodeCreationResult<TextGraphNode> {
  const ordinal = content.graph.nodes.filter((node) => node.kind === "text").length + 1;
  const nodeId = options.nodeId
    ? assertAvailableNodeId(content, options.nodeId)
    : allocateStableId(
        content.graph.nodes.map((node) => node.nodeId),
        `text:scene-${ordinal}`
      );
  const locale = assertLocale(options.locale ?? "en-US");
  const created: TextGraphNode = {
    kind: "text",
    nodeId,
    title: { [locale]: options.title ?? "" },
    body: { [locale]: options.body ?? "" },
    exit: { kind: "auto", nextNodeId: null },
  };
  return { content: appendGraphNode(content, created), created };
}

export function createEndingNode(
  content: InteractiveStoryDraftContent,
  options: CreateEndingNodeOptions = {}
): StoryNodeCreationResult<StoryEnding> {
  const ordinal = content.storyBible.endings.length + 1;
  const endingId = options.endingId
    ? assertAvailableEndingId(content, options.endingId)
    : allocateStableId(
        content.storyBible.endings.map((ending) => ending.id),
        `ending:${ordinal}`
      );
  const locale = assertLocale(options.locale ?? "en-US");
  const created: StoryEnding = {
    id: endingId,
    title: { [locale]: options.title ?? "" },
    summary: { [locale]: options.summary ?? "" },
  };
  return {
    content: {
      ...content,
      storyBible: {
        ...content.storyBible,
        endings: [...content.storyBible.endings, created],
      },
    },
    created,
  };
}

export function setEntryNode(
  content: InteractiveStoryDraftContent,
  nodeId: string | null
): InteractiveStoryDraftContent {
  if (nodeId !== null) requireTargetNode(content, nodeId);
  if (content.graph.entryNodeId === nodeId) return content;
  return { ...content, graph: { ...content.graph, entryNodeId: nodeId } };
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
    content: replaceGraphNode(result.content, result.created.nodeId, created),
    created,
  };
}

export function duplicateTextNode(
  content: InteractiveStoryDraftContent,
  sourceNodeId: string,
  options: CreateTextNodeOptions = {}
): StoryNodeCreationResult<TextGraphNode> {
  const source = requireText(content, sourceNodeId);
  const result = createTextNode(content, options);
  const created: TextGraphNode = {
    ...source,
    nodeId: result.created.nodeId,
    exit: { kind: "auto", nextNodeId: null },
  };
  return {
    content: replaceGraphNode(result.content, result.created.nodeId, created),
    created,
  };
}

export function updateTextNode(
  content: InteractiveStoryDraftContent,
  sourceNodeId: string,
  locale: string,
  patch: { title?: string; body?: string }
): InteractiveStoryDraftContent {
  const source = requireText(content, sourceNodeId);
  const normalizedLocale = assertLocale(locale);
  return replaceGraphNode(content, sourceNodeId, {
    ...source,
    ...(patch.title !== undefined
      ? { title: { ...(source.title ?? {}), [normalizedLocale]: patch.title } }
      : {}),
    ...(patch.body !== undefined
      ? { body: { ...source.body, [normalizedLocale]: patch.body } }
      : {}),
  });
}

/**
 * Removes a canonical graph node and every reference to it. If the deleted
 * node was the entry, the next node in authoring order becomes the entry (or
 * the previous final node when the deleted node was last).
 */
export function deleteGraphNode(
  content: InteractiveStoryDraftContent,
  nodeId: string
): InteractiveStoryDraftContent {
  const deletedIndex = content.graph.nodes.findIndex((node) => node.nodeId === nodeId);
  if (deletedIndex < 0) {
    throw mutationError("NODE_NOT_FOUND", `Unknown graph node ${nodeId}.`);
  }
  const deleted = content.graph.nodes[deletedIndex]!;
  const remainingNodes = content.graph.nodes
    .filter((node) => node.nodeId !== nodeId)
    .map((node) => removeGraphNodeReferences(node, deleted));
  const entryNodeId =
    content.graph.entryNodeId === nodeId
      ? (remainingNodes[Math.min(deletedIndex, remainingNodes.length - 1)]?.nodeId ?? null)
      : content.graph.entryNodeId;

  return {
    ...content,
    graph: { entryNodeId, nodes: remainingNodes },
  };
}

/** Removes a story-bible ending plus ending exits/effects that reference it. */
export function deleteEndingNode(
  content: InteractiveStoryDraftContent,
  endingId: string
): InteractiveStoryDraftContent {
  if (!content.storyBible.endings.some((ending) => ending.id === endingId)) {
    throw mutationError("ENDING_NOT_FOUND", `Unknown ending ${endingId}.`);
  }
  return {
    ...content,
    storyBible: {
      ...content.storyBible,
      endings: content.storyBible.endings.filter((ending) => ending.id !== endingId),
    },
    graph: {
      ...content.graph,
      nodes: content.graph.nodes.map((node) => removeEndingReferences(node, endingId)),
    },
  };
}

/**
 * Makes a scene own a canonical choice exit. This is the explicit destructive
 * conversion point: any previous auto/ending exit is replaced atomically.
 * Choice options are added separately because the persisted contract does not
 * permit an option without a valid target node.
 */
export function convertSceneExitToChoice(
  content: InteractiveStoryDraftContent,
  sourceNodeId: string,
  locale: string,
  options: { decisionId?: string } = {}
): InteractiveStoryDraftContent {
  const normalizedLocale = assertLocale(locale);
  const source = requireScene(content, sourceNodeId);
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
      prompt: { [normalizedLocale]: "" },
      choices: [],
    },
  });
}

/** Explicit destructive conversion used before adding automatic branches. */
export function convertExitToAuto(
  content: InteractiveStoryDraftContent,
  sourceNodeId: string
): InteractiveStoryDraftContent {
  const source = requireScene(content, sourceNodeId);
  if (source.exit.kind === "auto") return content;
  return replaceGraphNode(content, sourceNodeId, {
    ...source,
    exit: { kind: "auto", nextNodeId: null },
  });
}

export function updateChoiceExit(
  content: InteractiveStoryDraftContent,
  sourceNodeId: string,
  patch: Partial<Pick<ChoiceExit, "prompt">>
): InteractiveStoryDraftContent {
  const source = requireChoiceScene(content, sourceNodeId);
  return replaceChoiceExit(content, source, patch);
}

export function updateChoiceExitPrompt(
  content: InteractiveStoryDraftContent,
  sourceNodeId: string,
  locale: string,
  prompt: string
): InteractiveStoryDraftContent {
  const source = requireChoiceScene(content, sourceNodeId);
  const normalizedLocale = assertLocale(locale);
  return replaceChoiceExit(content, source, {
    ...source.exit,
    prompt: { ...source.exit.prompt, [normalizedLocale]: prompt },
  });
}

/**
 * Replaces a scene's next step with a deterministic player checkpoint. A
 * checkpoint is an interaction boundary, not a narrative decision: it keeps
 * the current story session intact and owns exactly one target.
 */
export function convertSceneExitToCheckpoint(
  content: InteractiveStoryDraftContent,
  sourceNodeId: string,
  targetNodeId: string
): InteractiveStoryDraftContent {
  const source = requireScene(content, sourceNodeId);
  requireTargetNode(content, targetNodeId);
  if (source.exit.kind === "checkpoint" && source.exit.nextNodeId === targetNodeId) return content;
  return replaceGraphNode(content, sourceNodeId, {
    ...source,
    exit: { kind: "checkpoint", nextNodeId: targetNodeId },
  });
}

export function updateCheckpointTarget(
  content: InteractiveStoryDraftContent,
  sourceNodeId: string,
  targetNodeId: string
): InteractiveStoryDraftContent {
  const source = requireCheckpointScene(content, sourceNodeId);
  requireTargetNode(content, targetNodeId);
  if (source.exit.nextNodeId === targetNodeId) return content;
  return replaceGraphNode(content, sourceNodeId, {
    ...source,
    exit: { ...source.exit, nextNodeId: targetNodeId },
  });
}

export interface AddChoiceOptionOptions {
  choiceId?: string;
  label?: string;
}

export function addChoiceOption(
  content: InteractiveStoryDraftContent,
  sourceNodeId: string,
  targetNodeId: string,
  locale: string,
  options: AddChoiceOptionOptions = {}
): StoryNodeCreationResult<StoryGraphChoice> {
  const source = requireChoiceScene(content, sourceNodeId);
  requireTargetNode(content, targetNodeId);
  const normalizedLocale = assertLocale(locale);
  if (source.exit.choices.length >= MAX_CHOICES) {
    throw mutationError(
      "CHOICE_LIMIT_REACHED",
      `Choice exit ${source.exit.decisionId} already has ${MAX_CHOICES} options.`
    );
  }
  const choiceId = options.choiceId
    ? assertAvailableChoiceId(source.exit, options.choiceId)
    : allocateStableId(
        source.exit.choices.map((choice) => choice.choiceId),
        `choice:${source.exit.choices.length + 1}`
      );
  const created: StoryGraphChoice = {
    choiceId,
    label: { [normalizedLocale]: options.label ?? "" },
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

export type ChoiceOptionPatch = Partial<Pick<StoryGraphChoice, "label">>;

export type ChoiceMoveDirection = "up" | "down";

export function updateChoiceOption(
  content: InteractiveStoryDraftContent,
  sourceNodeId: string,
  choiceId: string,
  patch: ChoiceOptionPatch
): InteractiveStoryDraftContent {
  const source = requireChoiceScene(content, sourceNodeId);
  const choice = requireChoice(source.exit, choiceId);
  const updated: StoryGraphChoice = { ...choice, ...patch };
  return replaceChoiceExit(content, source, {
    ...source.exit,
    choices: source.exit.choices.map((candidate) =>
      candidate.choiceId === choiceId ? updated : candidate
    ),
  });
}

export function removeChoiceOption(
  content: InteractiveStoryDraftContent,
  sourceNodeId: string,
  choiceId: string
): InteractiveStoryDraftContent {
  const source = requireChoiceScene(content, sourceNodeId);
  requireChoice(source.exit, choiceId);
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
  const source = requireChoiceScene(content, sourceNodeId);
  requireChoice(source.exit, choiceId);
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
  const source = requireChoiceScene(content, sourceNodeId);
  const choice = requireChoice(source.exit, choiceId);
  if (choice.nextNodeId === targetNodeId) return content;
  return replaceChoiceExit(content, source, {
    ...source.exit,
    choices: source.exit.choices.map((candidate) =>
      candidate.choiceId === choiceId ? { ...candidate, nextNodeId: targetNodeId } : candidate
    ),
  });
}

/**
 * A persisted choice cannot be targetless. Disconnecting its target therefore
 * removes the option atomically instead of writing an invalid placeholder ID.
 */
export function disconnectChoiceTarget(
  content: InteractiveStoryDraftContent,
  sourceNodeId: string,
  choiceId: string
): InteractiveStoryDraftContent {
  return removeChoiceOption(content, sourceNodeId, choiceId);
}

/** Sets the one completion target owned by a scene. */
export function connectSceneContinuation(
  content: InteractiveStoryDraftContent,
  sourceNodeId: string,
  targetNodeId: string
): InteractiveStoryDraftContent {
  const source = requireScene(content, sourceNodeId);
  requireTargetNode(content, targetNodeId);
  if (source.exit.kind !== "auto") {
    throw mutationError(
      "SOURCE_EXIT_KIND_MISMATCH",
      `Scene ${sourceNodeId} has a ${source.exit.kind} exit, not an automatic exit.`
    );
  }
  if (source.exit.nextNodeId === targetNodeId) return content;
  return replaceGraphNode(content, sourceNodeId, {
    ...source,
    exit: { kind: "auto", nextNodeId: targetNodeId },
  });
}

export function disconnectSceneContinuation(
  content: InteractiveStoryDraftContent,
  sourceNodeId: string,
  targetNodeId?: string
): InteractiveStoryDraftContent {
  const source = requireScene(content, sourceNodeId);
  if (
    source.exit.kind !== "auto" ||
    source.exit.nextNodeId === null ||
    (targetNodeId !== undefined && source.exit.nextNodeId !== targetNodeId)
  ) {
    throw mutationError(
      "BRANCH_NOT_FOUND",
      `Scene ${sourceNodeId} is not connected to that continuation target.`
    );
  }
  return replaceGraphNode(content, sourceNodeId, {
    ...source,
    exit: { kind: "auto", nextNodeId: null },
  });
}

export function connectEnding(
  content: InteractiveStoryDraftContent,
  sourceNodeId: string,
  endingId: string
): InteractiveStoryDraftContent {
  const source = requireScene(content, sourceNodeId);
  requireEnding(content, endingId);
  if (source.exit.kind === "ending" && source.exit.endingId === endingId) return content;
  if (hasBranches(source.exit)) {
    throw mutationError(
      "BRANCH_ALREADY_EXISTS",
      `Scene ${sourceNodeId} already has an outgoing branch; disconnect it before connecting an ending.`
    );
  }
  return replaceGraphNode(content, sourceNodeId, {
    ...source,
    exit: { kind: "ending", endingId },
  });
}

/** Explicit destructive conversion used by the inspector exit-type control. */
export function convertSceneExitToEnding(
  content: InteractiveStoryDraftContent,
  sourceNodeId: string,
  endingId: string
): InteractiveStoryDraftContent {
  const source = requireScene(content, sourceNodeId);
  requireEnding(content, endingId);
  if (source.exit.kind === "ending" && source.exit.endingId === endingId) return content;
  return replaceGraphNode(content, sourceNodeId, {
    ...source,
    exit: { kind: "ending", endingId },
  });
}

export function disconnectEnding(
  content: InteractiveStoryDraftContent,
  sourceNodeId: string,
  endingId?: string
): InteractiveStoryDraftContent {
  const source = requireScene(content, sourceNodeId);
  if (
    source.exit.kind !== "ending" ||
    (endingId !== undefined && source.exit.endingId !== endingId)
  ) {
    throw mutationError(
      "BRANCH_NOT_FOUND",
      `Scene ${sourceNodeId} is not connected to that ending.`
    );
  }
  return replaceGraphNode(content, sourceNodeId, {
    ...source,
    exit: { kind: "auto", nextNodeId: null },
  });
}

export type StoryBranchSelector =
  | {
      kind: "continuation";
      sourceNodeId: string;
      targetNodeId: string;
    }
  | { kind: "decision"; sourceNodeId: string }
  | { kind: "choice"; sourceNodeId: string; choiceId: string }
  | { kind: "checkpoint"; sourceNodeId: string; targetNodeId: string }
  | { kind: "ending"; sourceNodeId: string; endingId: string };

/** Dispatches a projected canvas edge deletion back into canonical content. */
export function disconnectStoryBranch(
  content: InteractiveStoryDraftContent,
  selector: StoryBranchSelector
): InteractiveStoryDraftContent {
  if (selector.kind === "continuation") {
    return disconnectSceneContinuation(content, selector.sourceNodeId, selector.targetNodeId);
  }
  if (selector.kind === "decision") {
    return convertExitToAuto(content, selector.sourceNodeId);
  }
  if (selector.kind === "choice") {
    return disconnectChoiceTarget(content, selector.sourceNodeId, selector.choiceId);
  }
  if (selector.kind === "checkpoint") {
    const source = requireCheckpointScene(content, selector.sourceNodeId);
    if (source.exit.nextNodeId !== selector.targetNodeId) {
      throw mutationError(
        "BRANCH_NOT_FOUND",
        `Checkpoint ${selector.sourceNodeId} does not target ${selector.targetNodeId}.`
      );
    }
    return convertExitToAuto(content, selector.sourceNodeId);
  }
  return disconnectEnding(content, selector.sourceNodeId, selector.endingId);
}

export type EndingNodePatch = {
  title?: { locale: string; value: string };
  summary?: { locale: string; value: string };
};

export function updateEndingNode(
  content: InteractiveStoryDraftContent,
  endingId: string,
  patch: EndingNodePatch
): InteractiveStoryDraftContent {
  const ending = requireEnding(content, endingId);
  const updated: StoryEnding = {
    ...ending,
    ...(patch.summary
      ? {
          summary: {
            ...(ending.summary ?? {}),
            [assertLocale(patch.summary.locale)]: patch.summary.value,
          },
        }
      : {}),
    ...(patch.title
      ? {
          title: {
            ...ending.title,
            [assertLocale(patch.title.locale)]: patch.title.value,
          },
        }
      : {}),
  };
  return {
    ...content,
    storyBible: {
      ...content.storyBible,
      endings: content.storyBible.endings.map((candidate) =>
        candidate.id === endingId ? updated : candidate
      ),
    },
  };
}

export type StoryDraftGraphIssueCode =
  | "duplicate-node-id"
  | "duplicate-clip-key"
  | "duplicate-ending-id"
  | "duplicate-choice-id"
  | "missing-entry-node"
  | "unknown-entry-node"
  | "unknown-target-node"
  | "unknown-ending"
  | "empty-auto-exit"
  | "empty-text-body"
  | "empty-choice-prompt"
  | "empty-choice-label"
  | "incomplete-choice-exit";

export interface StoryDraftGraphIssue {
  code: StoryDraftGraphIssueCode;
  path: Array<string | number>;
  message: string;
}

/**
 * Fast client-side relational validation for authoring mutations. The server
 * remains authoritative and applies the full Zod schema. `requireComplete`
 * mirrors the graph completeness portion of revision locking; ordinary draft
 * autosaves deliberately allow empty auto/choice exits.
 */
export function validateStoryDraftGraph(
  content: InteractiveStoryDraftContent,
  options: { requireComplete?: boolean } = {}
): StoryDraftGraphIssue[] {
  const issues: StoryDraftGraphIssue[] = [];
  const nodeIds = duplicateAwareSet(
    content.graph.nodes.map((node) => node.nodeId),
    "duplicate-node-id",
    ["graph", "nodes"],
    issues
  );
  duplicateAwareSet(
    content.graph.nodes.flatMap((node) => (node.kind === "clip" ? [node.clipKey] : [])),
    "duplicate-clip-key",
    ["graph", "nodes"],
    issues
  );
  const endingIds = duplicateAwareSet(
    content.storyBible.endings.map((ending) => ending.id),
    "duplicate-ending-id",
    ["storyBible", "endings"],
    issues
  );

  if (options.requireComplete && !content.graph.entryNodeId) {
    issues.push({
      code: "missing-entry-node",
      path: ["graph", "entryNodeId"],
      message: "A complete story needs an entry node.",
    });
  } else if (content.graph.entryNodeId && !nodeIds.has(content.graph.entryNodeId)) {
    issues.push({
      code: "unknown-entry-node",
      path: ["graph", "entryNodeId"],
      message: `Unknown entry node ${content.graph.entryNodeId}.`,
    });
  }

  content.graph.nodes.forEach((node, nodeIndex) => {
    const exitPath: Array<string | number> = ["graph", "nodes", nodeIndex, "exit"];
    if (
      options.requireComplete &&
      node.kind === "text" &&
      (Object.keys(node.body).length === 0 ||
        Object.values(node.body).every((value) => !value.trim()))
    ) {
      issues.push({
        code: "empty-text-body",
        path: ["graph", "nodes", nodeIndex, "body"],
        message: "A playable text scene needs non-empty localized body copy.",
      });
    }
    if (node.exit.kind === "auto") {
      if (options.requireComplete && node.exit.nextNodeId === null) {
        issues.push({
          code: "empty-auto-exit",
          path: [...exitPath, "nextNodeId"],
          message: "An automatic scene exit needs a continuation target to be playable.",
        });
      }
      if (node.exit.nextNodeId !== null && !nodeIds.has(node.exit.nextNodeId)) {
        issues.push({
          code: "unknown-target-node",
          path: [...exitPath, "nextNodeId"],
          message: `Unknown target node ${node.exit.nextNodeId}.`,
        });
      }
      return;
    }
    if (node.exit.kind === "choice") {
      if (
        options.requireComplete &&
        (Object.keys(node.exit.prompt).length === 0 ||
          Object.values(node.exit.prompt).every((prompt) => !prompt.trim()))
      ) {
        issues.push({
          code: "empty-choice-prompt",
          path: [...exitPath, "prompt"],
          message: "A playable choice needs a non-empty localized prompt.",
        });
      }
      if (options.requireComplete && node.exit.choices.length < 2) {
        issues.push({
          code: "incomplete-choice-exit",
          path: [...exitPath, "choices"],
          message: "A playable choice needs at least two options.",
        });
      }
      const choiceIds = new Set<string>();
      node.exit.choices.forEach((choice, choiceIndex) => {
        const choicePath = [...exitPath, "choices", choiceIndex];
        if (choiceIds.has(choice.choiceId)) {
          issues.push({
            code: "duplicate-choice-id",
            path: [...choicePath, "choiceId"],
            message: `Duplicate choice identifier ${choice.choiceId}.`,
          });
        }
        choiceIds.add(choice.choiceId);
        if (
          options.requireComplete &&
          (Object.keys(choice.label).length === 0 ||
            Object.values(choice.label).every((label) => !label.trim()))
        ) {
          issues.push({
            code: "empty-choice-label",
            path: [...choicePath, "label"],
            message: "A playable choice needs a non-empty localized label.",
          });
        }
        if (!nodeIds.has(choice.nextNodeId)) {
          issues.push({
            code: "unknown-target-node",
            path: [...choicePath, "nextNodeId"],
            message: `Unknown target node ${choice.nextNodeId}.`,
          });
        }
      });
      return;
    }
    if (node.exit.kind === "checkpoint") {
      if (!nodeIds.has(node.exit.nextNodeId)) {
        issues.push({
          code: "unknown-target-node",
          path: [...exitPath, "nextNodeId"],
          message: `Unknown target node ${node.exit.nextNodeId}.`,
        });
      }
      return;
    }
    if (node.exit.kind === "ending" && !endingIds.has(node.exit.endingId)) {
      issues.push({
        code: "unknown-ending",
        path: [...exitPath, "endingId"],
        message: `Unknown ending ${node.exit.endingId}.`,
      });
    }
  });
  return issues;
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

function removeGraphNodeReferences(node: StoryGraphNode, deleted: StoryGraphNode): StoryGraphNode {
  if (node.exit.kind === "auto") {
    return node.exit.nextNodeId === deleted.nodeId
      ? { ...node, exit: { kind: "auto", nextNodeId: null } }
      : node;
  }
  if (node.exit.kind === "choice") {
    const choices = node.exit.choices.filter((choice) => choice.nextNodeId !== deleted.nodeId);
    return replaceSceneChoices(node as ChoiceScene, choices);
  }
  if (node.exit.kind === "checkpoint") {
    return node.exit.nextNodeId === deleted.nodeId
      ? { ...node, exit: { kind: "auto", nextNodeId: null } }
      : node;
  }
  return node;
}

function removeEndingReferences(node: StoryGraphNode, endingId: string): StoryGraphNode {
  if (node.exit.kind === "ending" && node.exit.endingId === endingId) {
    return { ...node, exit: { kind: "auto", nextNodeId: null } };
  }
  return node;
}

function replaceSceneChoices(source: ChoiceScene, choices: StoryGraphChoice[]): StoryGraphNode {
  return source.kind === "clip"
    ? { ...source, exit: { ...source.exit, choices } }
    : { ...source, exit: { ...source.exit, choices } };
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
  source: ChoiceScene,
  patch: Partial<{
    decisionId: string;
    prompt: Record<string, string>;
    choices: StoryGraphChoice[];
  }>
): InteractiveStoryDraftContent {
  return replaceGraphNode(content, source.nodeId, {
    ...source,
    exit: {
      ...source.exit,
      ...patch,
    },
  });
}

function requireGraphNode(content: InteractiveStoryDraftContent, nodeId: string): StoryGraphNode {
  const node = content.graph.nodes.find((candidate) => candidate.nodeId === nodeId);
  if (!node) throw mutationError("NODE_NOT_FOUND", `Unknown graph node ${nodeId}.`);
  return node;
}

function requireClip(content: InteractiveStoryDraftContent, nodeId: string): ClipGraphNode {
  const node = content.graph.nodes.find((candidate) => candidate.nodeId === nodeId);
  if (!node || node.kind !== "clip") {
    throw mutationError("CLIP_NOT_FOUND", `Unknown clip node ${nodeId}.`);
  }
  return node;
}

function requireText(content: InteractiveStoryDraftContent, nodeId: string): TextGraphNode {
  const node = content.graph.nodes.find((candidate) => candidate.nodeId === nodeId);
  if (!node || node.kind !== "text") {
    throw mutationError("NODE_NOT_FOUND", `Unknown text scene ${nodeId}.`);
  }
  return node;
}

function requireScene(content: InteractiveStoryDraftContent, nodeId: string): SceneGraphNode {
  // Every graph node is a playable scene in a pure branching tree.
  return requireGraphNode(content, nodeId);
}

function requireChoiceScene(content: InteractiveStoryDraftContent, nodeId: string): ChoiceScene {
  const node = requireScene(content, nodeId);
  if (node.exit.kind !== "choice") {
    throw mutationError(
      "SOURCE_EXIT_KIND_MISMATCH",
      `Scene ${nodeId} has a ${node.exit.kind} exit, not a choice exit.`
    );
  }
  return node as ChoiceScene;
}

function requireCheckpointScene(
  content: InteractiveStoryDraftContent,
  nodeId: string
): SceneGraphNode & { exit: CheckpointExit } {
  const node = requireScene(content, nodeId);
  if (node.exit.kind !== "checkpoint") {
    throw mutationError(
      "SOURCE_EXIT_KIND_MISMATCH",
      `Scene ${nodeId} has a ${node.exit.kind} exit, not a checkpoint exit.`
    );
  }
  return node as SceneGraphNode & { exit: CheckpointExit };
}

function requireTargetNode(content: InteractiveStoryDraftContent, nodeId: string): void {
  if (!content.graph.nodes.some((node) => node.nodeId === nodeId)) {
    throw mutationError("TARGET_NODE_NOT_FOUND", `Unknown target node ${nodeId}.`);
  }
}

function requireEnding(content: InteractiveStoryDraftContent, endingId: string): StoryEnding {
  const ending = content.storyBible.endings.find((candidate) => candidate.id === endingId);
  if (!ending) throw mutationError("ENDING_NOT_FOUND", `Unknown ending ${endingId}.`);
  return ending;
}

function requireChoice(exit: ChoiceExit, choiceId: string): StoryGraphChoice {
  const choice = exit.choices.find((candidate) => candidate.choiceId === choiceId);
  if (!choice) {
    throw mutationError(
      "CHOICE_NOT_FOUND",
      `Unknown choice ${choiceId} on decision ${exit.decisionId}.`
    );
  }
  return choice;
}

function assertAvailableNodeId(content: InteractiveStoryDraftContent, nodeId: string): string {
  const valid = assertStableId(nodeId);
  if (content.graph.nodes.some((node) => node.nodeId === valid)) {
    throw mutationError("DUPLICATE_NODE_ID", `Graph node ${valid} already exists.`);
  }
  return valid;
}

function assertAvailableEndingId(content: InteractiveStoryDraftContent, endingId: string): string {
  const valid = assertStableId(endingId);
  if (content.storyBible.endings.some((ending) => ending.id === valid)) {
    throw mutationError("DUPLICATE_ENDING_ID", `Ending ${valid} already exists.`);
  }
  return valid;
}

function assertAvailableChoiceId(exit: ChoiceExit, choiceId: string): string {
  const valid = assertStableId(choiceId);
  if (exit.choices.some((choice) => choice.choiceId === valid)) {
    throw mutationError("DUPLICATE_CHOICE_ID", `Choice ${valid} already exists.`);
  }
  return valid;
}

function assertAvailableClipKey(content: InteractiveStoryDraftContent, clipKey: string): string {
  const valid = assertClipKey(clipKey);
  if (content.graph.nodes.some((node) => node.kind === "clip" && node.clipKey === valid)) {
    throw mutationError("DUPLICATE_CLIP_KEY", `Clip key ${valid} already exists.`);
  }
  return valid;
}

function assertStableId(value: string): string {
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > MAX_STABLE_ID_LENGTH ||
    !STABLE_ID_PATTERN.test(normalized)
  ) {
    throw mutationError("INVALID_STABLE_ID", `Invalid stable identifier ${value}.`);
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
    throw mutationError("INVALID_CLIP_KEY", `Invalid clip key ${value}.`);
  }
  return normalized;
}

function assertLocale(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 2 || normalized.length > 16) {
    throw mutationError("INVALID_LOCALE", `Invalid story locale ${value}.`);
  }
  return normalized;
}

function allocateStableId(existing: string[], preferred: string): string {
  const existingIds = new Set(existing);
  const validPreferred = assertStableId(preferred);
  if (!existingIds.has(validPreferred)) return validPreferred;
  let suffix = 2;
  while (true) {
    const suffixText = `-${suffix}`;
    const candidate = `${validPreferred.slice(0, MAX_STABLE_ID_LENGTH - suffixText.length)}${suffixText}`;
    if (!existingIds.has(candidate)) return candidate;
    suffix += 1;
  }
}

function allocateClipKey(existing: string[], preferred: string): string {
  const existingKeys = new Set(existing);
  const validPreferred = assertClipKey(preferred);
  if (!existingKeys.has(validPreferred)) return validPreferred;
  let suffix = 2;
  while (true) {
    const suffixText = `_${suffix}`;
    const candidate = `${validPreferred.slice(0, MAX_CLIP_KEY_LENGTH - suffixText.length)}${suffixText}`;
    if (!existingKeys.has(candidate)) return candidate;
    suffix += 1;
  }
}

function hasBranches(exit: SceneGraphNode["exit"]): boolean {
  if (exit.kind === "ending" || exit.kind === "checkpoint") return true;
  if (exit.kind === "choice") return exit.choices.length > 0;
  return exit.nextNodeId !== null;
}

function duplicateAwareSet(
  values: string[],
  code: Extract<
    StoryDraftGraphIssueCode,
    "duplicate-node-id" | "duplicate-clip-key" | "duplicate-ending-id"
  >,
  path: Array<string | number>,
  issues: StoryDraftGraphIssue[]
): Set<string> {
  const result = new Set<string>();
  values.forEach((value, index) => {
    if (result.has(value)) {
      issues.push({ code, path: [...path, index], message: `Duplicate identifier ${value}.` });
    }
    result.add(value);
  });
  return result;
}

function mutationError(
  code: StoryDraftMutationErrorCode,
  message: string
): StoryDraftMutationError {
  return new StoryDraftMutationError(code, message);
}
