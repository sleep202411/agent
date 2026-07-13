import type {
  FilmCondition,
  InteractiveFilmDraftContent,
  StoryClipPromptBeat,
  StoryClipPromptDraft,
  StoryTrailerPromptDraft,
  StoryGraphChoice,
  StoryGraphNode,
} from "@/lib/story-projects-api";

type ClipGraphNode = Extract<StoryGraphNode, { kind: "clip" }>;
type RouterGraphNode = Extract<StoryGraphNode, { kind: "router" }>;
type ChoiceExit = Extract<ClipGraphNode["exit"], { kind: "choice" }>;
type CheckpointExit = Extract<ClipGraphNode["exit"], { kind: "checkpoint" }>;
type StoryEnding = InteractiveFilmDraftContent["storyBible"]["endings"][number];
type StoryDirectorPromptDraft = StoryClipPromptDraft | StoryTrailerPromptDraft;

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
  | "INVALID_CHOICE_TIMECODE"
  | "INVALID_ROUTE_PRIORITY"
  | "INVALID_BRANCH_SELECTOR"
  | "NODE_NOT_FOUND"
  | "CLIP_NOT_FOUND"
  | "CLIP_PROMPT_NOT_FOUND"
  | "CLIP_PROMPT_IDENTITY_MISMATCH"
  | "CLIP_PROMPT_BEAT_TOO_SHORT"
  | "INVALID_CLIP_PROMPT_DURATION"
  | "ENDING_NOT_FOUND"
  | "CHOICE_NOT_FOUND"
  | "TARGET_NODE_NOT_FOUND"
  | "SOURCE_EXIT_KIND_MISMATCH"
  | "ENDING_SOURCE_MUST_BE_CLIP"
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

export interface CreateRouterNodeOptions {
  nodeId?: string;
}

export interface CreateEndingNodeOptions {
  endingId?: string;
  locale?: string;
  title?: string;
  summary?: string;
  kind?: StoryEnding["kind"];
}

export interface StoryNodeCreationResult<T> {
  content: InteractiveFilmDraftContent;
  created: T;
}

export function createClipNode(
  content: InteractiveFilmDraftContent,
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
    exit: { kind: "auto", routes: [] },
  };
  const next = appendGraphNode(content, created);
  return {
    content: {
      ...next,
      clipPrompts: [...next.clipPrompts, createDefaultClipPrompt(created)],
    },
    created,
  };
}

export function createRouterNode(
  content: InteractiveFilmDraftContent,
  options: CreateRouterNodeOptions = {}
): StoryNodeCreationResult<RouterGraphNode> {
  const ordinal = content.graph.nodes.filter((node) => node.kind === "router").length + 1;
  const nodeId = options.nodeId
    ? assertAvailableNodeId(content, options.nodeId)
    : allocateStableId(
        content.graph.nodes.map((node) => node.nodeId),
        `router:route-${ordinal}`
      );
  const created: RouterGraphNode = {
    kind: "router",
    nodeId,
    exit: { kind: "auto", routes: [] },
  };
  return {
    content: appendGraphNode(content, created),
    created,
  };
}

export function createEndingNode(
  content: InteractiveFilmDraftContent,
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
    kind: options.kind ?? "custom",
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
  content: InteractiveFilmDraftContent,
  nodeId: string | null
): InteractiveFilmDraftContent {
  if (nodeId !== null) requireTargetNode(content, nodeId);
  if (content.graph.entryNodeId === nodeId) return content;
  return { ...content, graph: { ...content.graph, entryNodeId: nodeId } };
}

export function duplicateClipNode(
  content: InteractiveFilmDraftContent,
  sourceNodeId: string,
  options: CreateClipNodeOptions = {}
): StoryNodeCreationResult<ClipGraphNode> {
  const source = requireClip(content, sourceNodeId);
  const sourcePrompt = requireClipPrompt(content, sourceNodeId);
  const result = createClipNode(content, options);
  const created: ClipGraphNode = {
    ...source,
    nodeId: result.created.nodeId,
    clipKey: result.created.clipKey,
    exit: { kind: "auto", routes: [] },
  };
  return {
    content: {
      ...replaceGraphNode(result.content, result.created.nodeId, created),
      clipPrompts: result.content.clipPrompts.map((prompt) =>
        prompt.graphNodeId === result.created.nodeId
          ? {
              ...sourcePrompt,
              graphNodeId: created.nodeId,
              clipKey: created.clipKey,
              referenceRoleNotes: sourcePrompt.referenceRoleNotes.map((note) => ({ ...note })),
              beats: sourcePrompt.beats.map((beat) => ({ ...beat })),
              negativeConstraints: [...sourcePrompt.negativeConstraints],
              continuityNotes: [...sourcePrompt.continuityNotes],
            }
          : prompt
      ),
    },
    created,
  };
}

export function duplicateRouterNode(
  content: InteractiveFilmDraftContent,
  sourceNodeId: string,
  options: CreateRouterNodeOptions = {}
): StoryNodeCreationResult<RouterGraphNode> {
  const source = requireGraphNode(content, sourceNodeId);
  if (source.kind !== "router") {
    throw mutationError("NODE_NOT_FOUND", `Unknown router node ${sourceNodeId}.`);
  }
  return createRouterNode(content, options);
}

/**
 * Removes a canonical graph node and every reference to it. If the deleted
 * node was the entry, the next node in authoring order becomes the entry (or
 * the previous final node when the deleted node was last).
 */
export function deleteGraphNode(
  content: InteractiveFilmDraftContent,
  nodeId: string
): InteractiveFilmDraftContent {
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
    clipPrompts:
      deleted.kind === "clip"
        ? content.clipPrompts.filter((prompt) => prompt.graphNodeId !== deleted.nodeId)
        : content.clipPrompts,
  };
}

export function replaceClipPrompt(
  content: InteractiveFilmDraftContent,
  graphNodeId: string,
  next: StoryClipPromptDraft
): InteractiveFilmDraftContent {
  const node = requireClip(content, graphNodeId);
  const promptIndex = content.clipPrompts.findIndex((prompt) => prompt.graphNodeId === graphNodeId);
  if (promptIndex < 0) {
    throw mutationError("CLIP_PROMPT_NOT_FOUND", `Clip ${graphNodeId} has no director prompt.`);
  }
  if (next.graphNodeId !== node.nodeId || next.clipKey !== node.clipKey) {
    throw mutationError(
      "CLIP_PROMPT_IDENTITY_MISMATCH",
      `Director prompt identity must remain ${node.nodeId}/${node.clipKey}.`
    );
  }
  if (JSON.stringify(content.clipPrompts[promptIndex]) === JSON.stringify(next)) return content;
  return {
    ...content,
    clipPrompts: content.clipPrompts.map((prompt, index) =>
      index === promptIndex ? next : prompt
    ),
  };
}

export function createTrailerPrompt(
  content: InteractiveFilmDraftContent,
  title: string
): InteractiveFilmDraftContent {
  if (content.trailerPrompt) return content;
  return {
    ...content,
    trailerPrompt: {
      title: title.trim(),
      description: "",
      targetDurationMs: 15_000,
      generationControl: { mode: "omni_reference" },
      masterDirection: "",
      referenceRoleNotes: [],
      emotionalArc: "",
      beats: [emptyClipPromptBeat("trailer:beat:1", 0, 15_000)],
      negativeConstraints: [],
      continuityNotes: [],
    },
  };
}

export function replaceTrailerPrompt(
  content: InteractiveFilmDraftContent,
  prompt: StoryTrailerPromptDraft
): InteractiveFilmDraftContent {
  if (content.trailerPrompt === prompt) return content;
  return { ...content, trailerPrompt: prompt };
}

export function createDefaultClipPrompt(
  node: Pick<ClipGraphNode, "nodeId" | "clipKey">
): StoryClipPromptDraft {
  return {
    graphNodeId: node.nodeId,
    clipKey: node.clipKey,
    title: node.clipKey,
    description: "",
    targetDurationMs: 15_000,
    generationControl: { mode: "frame_lock", frameMode: "first_frame" },
    masterDirection: "",
    referenceRoleNotes: [],
    emotionalArc: "",
    beats: [
      {
        id: "beat:1",
        startMs: 0,
        endMs: 15_000,
        visual: "",
        camera: "",
        action: "",
        performance: "",
        emotion: "",
        dialogue: "",
        audio: "",
        endState: "",
        continuity: "",
      },
    ],
    negativeConstraints: [],
    continuityNotes: [],
  };
}

export function appendClipPromptBeat<T extends StoryDirectorPromptDraft>(prompt: T): T {
  const beats = prompt.beats.map((beat) => ({ ...beat }));
  const last = beats.at(-1);
  let startMs = 0;
  let endMs = prompt.targetDurationMs;
  if (last) {
    if (last.endMs - last.startMs < 2) {
      throw mutationError(
        "CLIP_PROMPT_BEAT_TOO_SHORT",
        "The final beat is too short to split into another positive-length beat."
      );
    }
    const originalEnd = last.endMs;
    const midpoint = Math.max(last.startMs + 1, Math.floor((last.startMs + originalEnd) / 2));
    last.endMs = midpoint;
    startMs = midpoint;
    endMs = originalEnd;
  }
  beats.push(
    emptyClipPromptBeat(
      nextScopedStableId(
        "beat",
        beats.map((beat) => beat.id)
      ),
      startMs,
      endMs
    )
  );
  return { ...prompt, beats } as T;
}

export function moveClipPromptBeat<T extends StoryDirectorPromptDraft>(
  prompt: T,
  index: number,
  direction: "up" | "down"
): T {
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (
    index < 0 ||
    index >= prompt.beats.length ||
    targetIndex < 0 ||
    targetIndex >= prompt.beats.length
  ) {
    return prompt;
  }
  const beats = [...prompt.beats];
  const source = beats[index]!;
  const target = beats[targetIndex]!;
  beats[targetIndex] = { ...source, startMs: target.startMs, endMs: target.endMs };
  beats[index] = { ...target, startMs: source.startMs, endMs: source.endMs };
  return { ...prompt, beats } as T;
}

export function setClipPromptTargetDuration<T extends StoryDirectorPromptDraft>(
  prompt: T,
  requestedDurationMs: number
): T {
  if (
    !Number.isInteger(requestedDurationMs) ||
    requestedDurationMs <= 0 ||
    requestedDurationMs > 600_000
  ) {
    throw mutationError(
      "INVALID_CLIP_PROMPT_DURATION",
      "Clip prompt duration must be an integer between 1 and 600000 milliseconds."
    );
  }
  const lastIndex = prompt.beats.length - 1;
  const alignedLast = prompt.beats[lastIndex]?.endMs === prompt.targetDurationMs;
  const fixedBeatEndMs = Math.max(
    1,
    ...prompt.beats.flatMap((beat, index) =>
      index === lastIndex && alignedLast ? [beat.startMs + 1] : [beat.endMs]
    )
  );
  const targetDurationMs = Math.max(requestedDurationMs, fixedBeatEndMs);
  if (targetDurationMs === prompt.targetDurationMs) return prompt;
  const beats = prompt.beats.map((beat, index) =>
    index === lastIndex && alignedLast ? { ...beat, endMs: targetDurationMs } : beat
  );
  return { ...prompt, targetDurationMs, beats } as T;
}

function emptyClipPromptBeat(id: string, startMs: number, endMs: number): StoryClipPromptBeat {
  return {
    id,
    startMs,
    endMs,
    visual: "",
    camera: "",
    action: "",
    performance: "",
    emotion: "",
    dialogue: "",
    audio: "",
    endState: "",
    continuity: "",
  };
}

function nextScopedStableId(prefix: string, existing: string[]): string {
  const used = new Set(existing);
  let ordinal = existing.length + 1;
  while (used.has(`${prefix}:${ordinal}`)) ordinal += 1;
  return `${prefix}:${ordinal}`;
}

/** Removes a story-bible ending plus ending exits/effects that reference it. */
export function deleteEndingNode(
  content: InteractiveFilmDraftContent,
  endingId: string
): InteractiveFilmDraftContent {
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
 * Makes a clip own a canonical choice exit. This is the explicit destructive
 * conversion point: any previous auto/ending exit is replaced atomically.
 * Choice options are added separately because the persisted contract does not
 * permit an option without a valid target node.
 */
export function convertClipExitToChoice(
  content: InteractiveFilmDraftContent,
  sourceNodeId: string,
  locale: string,
  options: { decisionId?: string } = {}
): InteractiveFilmDraftContent {
  const normalizedLocale = assertLocale(locale);
  const source = requireClip(content, sourceNodeId);
  if (source.exit.kind === "choice" && !options.decisionId) return content;
  const decisionId = options.decisionId
    ? assertStableId(options.decisionId)
    : allocateStableId(
        content.graph.nodes.flatMap((node) =>
          node.kind === "clip" && node.exit.kind === "choice" ? [node.exit.decisionId] : []
        ),
        `decision:${content.graph.nodes.indexOf(source) + 1}`
      );
  return replaceGraphNode(content, sourceNodeId, {
    ...source,
    exit: {
      kind: "choice",
      decisionId,
      prompt: { [normalizedLocale]: "" },
      trigger: { kind: "media-ended" },
      choices: [],
    },
  });
}

/** Explicit destructive conversion used before adding automatic branches. */
export function convertExitToAuto(
  content: InteractiveFilmDraftContent,
  sourceNodeId: string
): InteractiveFilmDraftContent {
  const source = requireGraphNode(content, sourceNodeId);
  if (source.exit.kind === "auto") return content;
  return replaceGraphNode(content, sourceNodeId, {
    ...source,
    exit: { kind: "auto", routes: [] },
  });
}

export function updateChoiceExit(
  content: InteractiveFilmDraftContent,
  sourceNodeId: string,
  patch: Partial<Pick<ChoiceExit, "prompt" | "trigger">>
): InteractiveFilmDraftContent {
  const source = requireChoiceClip(content, sourceNodeId);
  if (
    patch.trigger?.kind === "timecode" &&
    (!Number.isInteger(patch.trigger.atMs) || patch.trigger.atMs < 0)
  ) {
    throw mutationError(
      "INVALID_CHOICE_TIMECODE",
      "Choice timecode must be a non-negative integer number of milliseconds."
    );
  }
  return replaceChoiceExit(content, source, { ...source.exit, ...patch });
}

export function updateChoiceExitPrompt(
  content: InteractiveFilmDraftContent,
  sourceNodeId: string,
  locale: string,
  prompt: string
): InteractiveFilmDraftContent {
  const source = requireChoiceClip(content, sourceNodeId);
  const normalizedLocale = assertLocale(locale);
  return replaceChoiceExit(content, source, {
    ...source.exit,
    prompt: { ...source.exit.prompt, [normalizedLocale]: prompt },
  });
}

/**
 * Replaces a clip's next step with a deterministic player checkpoint. A
 * checkpoint is an interaction boundary, not a narrative decision: it keeps
 * the current story session intact and owns exactly one target.
 */
export function convertClipExitToCheckpoint(
  content: InteractiveFilmDraftContent,
  sourceNodeId: string,
  targetNodeId: string
): InteractiveFilmDraftContent {
  const source = requireClip(content, sourceNodeId);
  requireTargetNode(content, targetNodeId);
  if (source.exit.kind === "checkpoint" && source.exit.nextNodeId === targetNodeId) return content;
  return replaceGraphNode(content, sourceNodeId, {
    ...source,
    exit: { kind: "checkpoint", nextNodeId: targetNodeId },
  });
}

export function updateCheckpointTarget(
  content: InteractiveFilmDraftContent,
  sourceNodeId: string,
  targetNodeId: string
): InteractiveFilmDraftContent {
  const source = requireCheckpointClip(content, sourceNodeId);
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
  accessibilityLabel?: string;
  visibleWhen?: FilmCondition;
  effects?: StoryGraphChoice["effects"];
  afterSelect?: StoryGraphChoice["afterSelect"];
}

export function addChoiceOption(
  content: InteractiveFilmDraftContent,
  sourceNodeId: string,
  targetNodeId: string,
  locale: string,
  options: AddChoiceOptionOptions = {}
): StoryNodeCreationResult<StoryGraphChoice> {
  const source = requireChoiceClip(content, sourceNodeId);
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
    ...(options.accessibilityLabel !== undefined
      ? { accessibilityLabel: { [normalizedLocale]: options.accessibilityLabel } }
      : {}),
    ...(options.visibleWhen ? { visibleWhen: options.visibleWhen } : {}),
    effects: options.effects ?? [],
    nextNodeId: targetNodeId,
    afterSelect: options.afterSelect ?? { kind: "immediate" },
  };
  return {
    content: replaceChoiceExit(content, source, {
      ...source.exit,
      choices: [...source.exit.choices, created],
    }),
    created,
  };
}

export type ChoiceOptionPatch = Partial<
  Pick<StoryGraphChoice, "label" | "accessibilityLabel" | "visibleWhen" | "effects" | "afterSelect">
>;

export type ChoiceMoveDirection = "up" | "down";

export function updateChoiceOption(
  content: InteractiveFilmDraftContent,
  sourceNodeId: string,
  choiceId: string,
  patch: ChoiceOptionPatch
): InteractiveFilmDraftContent {
  const source = requireChoiceClip(content, sourceNodeId);
  const choice = requireChoice(source.exit, choiceId);
  const updated: StoryGraphChoice = { ...choice, ...patch };
  if (patch.accessibilityLabel === undefined && "accessibilityLabel" in patch) {
    delete updated.accessibilityLabel;
  }
  if (patch.visibleWhen === undefined && "visibleWhen" in patch) {
    delete updated.visibleWhen;
  }
  return replaceChoiceExit(content, source, {
    ...source.exit,
    choices: source.exit.choices.map((candidate) =>
      candidate.choiceId === choiceId ? updated : candidate
    ),
  });
}

export function removeChoiceOption(
  content: InteractiveFilmDraftContent,
  sourceNodeId: string,
  choiceId: string
): InteractiveFilmDraftContent {
  const source = requireChoiceClip(content, sourceNodeId);
  requireChoice(source.exit, choiceId);
  return replaceChoiceExit(content, source, {
    ...source.exit,
    choices: source.exit.choices.filter((choice) => choice.choiceId !== choiceId),
  });
}

export function moveChoiceOption(
  content: InteractiveFilmDraftContent,
  sourceNodeId: string,
  choiceId: string,
  direction: ChoiceMoveDirection
): InteractiveFilmDraftContent {
  const source = requireChoiceClip(content, sourceNodeId);
  requireChoice(source.exit, choiceId);
  const currentIndex = source.exit.choices.findIndex((choice) => choice.choiceId === choiceId);
  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (targetIndex < 0 || targetIndex >= source.exit.choices.length) return content;

  const choices = [...source.exit.choices];
  [choices[currentIndex], choices[targetIndex]] = [choices[targetIndex]!, choices[currentIndex]!];
  return replaceChoiceExit(content, source, { ...source.exit, choices });
}

export function connectChoiceTarget(
  content: InteractiveFilmDraftContent,
  sourceNodeId: string,
  choiceId: string,
  targetNodeId: string
): InteractiveFilmDraftContent {
  requireTargetNode(content, targetNodeId);
  const source = requireChoiceClip(content, sourceNodeId);
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
  content: InteractiveFilmDraftContent,
  sourceNodeId: string,
  choiceId: string
): InteractiveFilmDraftContent {
  return removeChoiceOption(content, sourceNodeId, choiceId);
}

export function connectAutoRoute(
  content: InteractiveFilmDraftContent,
  sourceNodeId: string,
  targetNodeId: string,
  options: { priority?: number; when?: FilmCondition } = {}
): InteractiveFilmDraftContent {
  const source = requireGraphNode(content, sourceNodeId);
  requireTargetNode(content, targetNodeId);
  if (source.exit.kind !== "auto") {
    throw mutationError(
      "SOURCE_EXIT_KIND_MISMATCH",
      `Node ${sourceNodeId} has a ${source.exit.kind} exit, not an auto exit.`
    );
  }
  const priority = assertRoutePriority(options.priority ?? 0);
  if (
    source.exit.routes.some(
      (route) =>
        route.nextNodeId === targetNodeId &&
        route.priority === priority &&
        sameCondition(route.when, options.when)
    )
  ) {
    throw mutationError(
      "BRANCH_ALREADY_EXISTS",
      `Auto route ${sourceNodeId} -> ${targetNodeId} already exists.`
    );
  }
  return replaceGraphNode(content, sourceNodeId, {
    ...source,
    exit: {
      ...source.exit,
      routes: [
        ...source.exit.routes,
        {
          nextNodeId: targetNodeId,
          priority,
          ...(options.when ? { when: options.when } : {}),
        },
      ],
    },
  });
}

export interface AutoRoutePatch {
  targetNodeId?: string;
  priority?: number;
  /** `null` explicitly removes the route condition. */
  when?: FilmCondition | null;
}

/** Updates exactly one canonical auto route without changing its array position. */
export function updateAutoRoute(
  content: InteractiveFilmDraftContent,
  sourceNodeId: string,
  routeIndex: number,
  patch: AutoRoutePatch
): InteractiveFilmDraftContent {
  const source = requireGraphNode(content, sourceNodeId);
  if (source.exit.kind !== "auto") {
    throw mutationError(
      "SOURCE_EXIT_KIND_MISMATCH",
      `Node ${sourceNodeId} has a ${source.exit.kind} exit, not an auto exit.`
    );
  }
  if (!Number.isInteger(routeIndex) || routeIndex < 0) {
    throw mutationError(
      "INVALID_BRANCH_SELECTOR",
      `Route index ${routeIndex} must be a non-negative integer.`
    );
  }
  const route = source.exit.routes[routeIndex];
  if (!route) {
    throw mutationError(
      "BRANCH_NOT_FOUND",
      `Auto route ${routeIndex} does not exist on ${sourceNodeId}.`
    );
  }
  const targetNodeId = patch.targetNodeId ?? route.nextNodeId;
  requireTargetNode(content, targetNodeId);
  const priority = assertRoutePriority(patch.priority ?? route.priority);
  const when = "when" in patch ? (patch.when ?? undefined) : route.when;
  if (
    source.exit.routes.some(
      (candidate, candidateIndex) =>
        candidateIndex !== routeIndex &&
        candidate.nextNodeId === targetNodeId &&
        candidate.priority === priority &&
        sameCondition(candidate.when, when)
    )
  ) {
    throw mutationError(
      "BRANCH_ALREADY_EXISTS",
      `Auto route ${sourceNodeId} -> ${targetNodeId} already exists.`
    );
  }
  if (
    route.nextNodeId === targetNodeId &&
    route.priority === priority &&
    sameCondition(route.when, when)
  ) {
    return content;
  }
  const updatedRoute = {
    nextNodeId: targetNodeId,
    priority,
    ...(when ? { when } : {}),
  };
  return replaceGraphNode(content, sourceNodeId, {
    ...source,
    exit: {
      ...source.exit,
      routes: source.exit.routes.map((candidate, candidateIndex) =>
        candidateIndex === routeIndex ? updatedRoute : candidate
      ),
    },
  });
}

/** Retargets one route while preserving its priority and condition. */
export function updateAutoRouteTarget(
  content: InteractiveFilmDraftContent,
  sourceNodeId: string,
  routeIndex: number,
  targetNodeId: string
): InteractiveFilmDraftContent {
  return updateAutoRoute(content, sourceNodeId, routeIndex, { targetNodeId });
}

export function disconnectAutoRoute(
  content: InteractiveFilmDraftContent,
  sourceNodeId: string,
  selector: { routeIndex?: number; targetNodeId?: string; priority?: number }
): InteractiveFilmDraftContent {
  if (selector.routeIndex === undefined && selector.targetNodeId === undefined) {
    throw mutationError(
      "INVALID_BRANCH_SELECTOR",
      "Select an automatic route by routeIndex or targetNodeId."
    );
  }
  const source = requireGraphNode(content, sourceNodeId);
  if (source.exit.kind !== "auto") {
    throw mutationError(
      "SOURCE_EXIT_KIND_MISMATCH",
      `Node ${sourceNodeId} has a ${source.exit.kind} exit, not an auto exit.`
    );
  }
  const routeIndex = findAutoRouteIndex(source.exit.routes, selector);
  if (routeIndex < 0) {
    throw mutationError("BRANCH_NOT_FOUND", `No matching auto route leaves ${sourceNodeId}.`);
  }
  return replaceGraphNode(content, sourceNodeId, {
    ...source,
    exit: {
      ...source.exit,
      routes: source.exit.routes.filter((_route, index) => index !== routeIndex),
    },
  });
}

export function connectEnding(
  content: InteractiveFilmDraftContent,
  sourceNodeId: string,
  endingId: string
): InteractiveFilmDraftContent {
  const source = requireClip(content, sourceNodeId);
  requireEnding(content, endingId);
  if (source.exit.kind === "ending" && source.exit.endingId === endingId) return content;
  if (hasBranches(source.exit)) {
    throw mutationError(
      "BRANCH_ALREADY_EXISTS",
      `Clip ${sourceNodeId} already has an outgoing branch; disconnect it before connecting an ending.`
    );
  }
  return replaceGraphNode(content, sourceNodeId, {
    ...source,
    exit: { kind: "ending", endingId },
  });
}

/** Explicit destructive conversion used by the inspector exit-type control. */
export function convertClipExitToEnding(
  content: InteractiveFilmDraftContent,
  sourceNodeId: string,
  endingId: string
): InteractiveFilmDraftContent {
  const source = requireClip(content, sourceNodeId);
  requireEnding(content, endingId);
  if (source.exit.kind === "ending" && source.exit.endingId === endingId) return content;
  return replaceGraphNode(content, sourceNodeId, {
    ...source,
    exit: { kind: "ending", endingId },
  });
}

export function disconnectEnding(
  content: InteractiveFilmDraftContent,
  sourceNodeId: string,
  endingId?: string
): InteractiveFilmDraftContent {
  const source = requireClip(content, sourceNodeId);
  if (
    source.exit.kind !== "ending" ||
    (endingId !== undefined && source.exit.endingId !== endingId)
  ) {
    throw mutationError(
      "BRANCH_NOT_FOUND",
      `Clip ${sourceNodeId} is not connected to that ending.`
    );
  }
  return replaceGraphNode(content, sourceNodeId, {
    ...source,
    exit: { kind: "auto", routes: [] },
  });
}

export type StoryBranchSelector =
  | {
      kind: "auto";
      sourceNodeId: string;
      routeIndex: number;
      targetNodeId?: string;
      priority?: number;
    }
  | { kind: "decision"; sourceNodeId: string }
  | { kind: "choice"; sourceNodeId: string; choiceId: string }
  | { kind: "checkpoint"; sourceNodeId: string; targetNodeId: string }
  | { kind: "ending"; sourceNodeId: string; endingId: string };

/** Dispatches a projected canvas edge deletion back into canonical content. */
export function disconnectStoryBranch(
  content: InteractiveFilmDraftContent,
  selector: StoryBranchSelector
): InteractiveFilmDraftContent {
  if (selector.kind === "auto") {
    return disconnectAutoRoute(content, selector.sourceNodeId, {
      routeIndex: selector.routeIndex,
      targetNodeId: selector.targetNodeId,
      priority: selector.priority,
    });
  }
  if (selector.kind === "decision") {
    return convertExitToAuto(content, selector.sourceNodeId);
  }
  if (selector.kind === "choice") {
    return disconnectChoiceTarget(content, selector.sourceNodeId, selector.choiceId);
  }
  if (selector.kind === "checkpoint") {
    const source = requireCheckpointClip(content, selector.sourceNodeId);
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

export type EndingNodePatch = Partial<Pick<StoryEnding, "kind">> & {
  title?: { locale: string; value: string };
  summary?: { locale: string; value: string };
};

export function updateEndingNode(
  content: InteractiveFilmDraftContent,
  endingId: string,
  patch: EndingNodePatch
): InteractiveFilmDraftContent {
  const ending = requireEnding(content, endingId);
  const updated: StoryEnding = {
    ...ending,
    ...(patch.summary
      ? {
          summary: {
            ...ending.summary,
            [assertLocale(patch.summary.locale)]: patch.summary.value,
          },
        }
      : {}),
    ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
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
  | "unknown-reaction-clip"
  | "unknown-state-variable"
  | "invalid-state-variable-type"
  | "unknown-character"
  | "empty-auto-exit"
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
  content: InteractiveFilmDraftContent,
  options: { requireComplete?: boolean } = {}
): StoryDraftGraphIssue[] {
  const issues: StoryDraftGraphIssue[] = [];
  const nodeIds = duplicateAwareSet(
    content.graph.nodes.map((node) => node.nodeId),
    "duplicate-node-id",
    ["graph", "nodes"],
    issues
  );
  const clipKeys = duplicateAwareSet(
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
  const stateVariables = new Map(
    content.storyBible.stateVariables.map((variable) => [variable.key, variable])
  );
  const characterIds = new Set(content.storyBible.characters.map((character) => character.id));

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
    if (node.exit.kind === "auto") {
      if (options.requireComplete && node.exit.routes.length === 0) {
        issues.push({
          code: "empty-auto-exit",
          path: [...exitPath, "routes"],
          message: "An automatic exit needs at least one route to be playable.",
        });
      }
      node.exit.routes.forEach((route, routeIndex) => {
        const routePath = [...exitPath, "routes", routeIndex];
        if (!nodeIds.has(route.nextNodeId)) {
          issues.push({
            code: "unknown-target-node",
            path: [...routePath, "nextNodeId"],
            message: `Unknown target node ${route.nextNodeId}.`,
          });
        }
        if (route.when) {
          validateConditionReferences(
            route.when,
            [...routePath, "when"],
            stateVariables,
            characterIds,
            issues
          );
        }
      });
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
        if (
          choice.afterSelect.kind === "play" &&
          !clipKeys.has(choice.afterSelect.reactionClipKey)
        ) {
          issues.push({
            code: "unknown-reaction-clip",
            path: [...choicePath, "afterSelect", "reactionClipKey"],
            message: `Unknown reaction clip ${choice.afterSelect.reactionClipKey}.`,
          });
        }
        if (choice.visibleWhen) {
          validateConditionReferences(
            choice.visibleWhen,
            [...choicePath, "visibleWhen"],
            stateVariables,
            characterIds,
            issues
          );
        }
        choice.effects.forEach((effect, effectIndex) =>
          validateEffectReferences(
            effect,
            [...choicePath, "effects", effectIndex],
            stateVariables,
            characterIds,
            endingIds,
            issues
          )
        );
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
    if (!endingIds.has(node.exit.endingId)) {
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
  content: InteractiveFilmDraftContent,
  node: StoryGraphNode
): InteractiveFilmDraftContent {
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
    return {
      ...node,
      exit: {
        ...node.exit,
        routes: node.exit.routes.filter((route) => route.nextNodeId !== deleted.nodeId),
      },
    };
  }
  if (node.kind === "clip" && node.exit.kind === "choice") {
    return {
      ...node,
      exit: {
        ...node.exit,
        choices: node.exit.choices
          .filter((choice) => choice.nextNodeId !== deleted.nodeId)
          .map((choice) =>
            deleted.kind === "clip" &&
            choice.afterSelect.kind === "play" &&
            choice.afterSelect.reactionClipKey === deleted.clipKey
              ? { ...choice, afterSelect: { kind: "immediate" as const } }
              : choice
          ),
      },
    };
  }
  if (node.kind === "clip" && node.exit.kind === "checkpoint") {
    return node.exit.nextNodeId === deleted.nodeId
      ? { ...node, exit: { kind: "auto", routes: [] } }
      : node;
  }
  return node;
}

function removeEndingReferences(node: StoryGraphNode, endingId: string): StoryGraphNode {
  if (node.kind === "clip" && node.exit.kind === "ending" && node.exit.endingId === endingId) {
    return { ...node, exit: { kind: "auto", routes: [] } };
  }
  if (node.kind !== "clip" || node.exit.kind !== "choice") return node;
  return {
    ...node,
    exit: {
      ...node.exit,
      choices: node.exit.choices.map((choice) => ({
        ...choice,
        effects: choice.effects.filter(
          (effect) => effect.kind !== "unlock_ending" || effect.endingId !== endingId
        ),
      })),
    },
  };
}

function replaceGraphNode(
  content: InteractiveFilmDraftContent,
  nodeId: string,
  replacement: StoryGraphNode
): InteractiveFilmDraftContent {
  return {
    ...content,
    graph: {
      ...content.graph,
      nodes: content.graph.nodes.map((node) => (node.nodeId === nodeId ? replacement : node)),
    },
  };
}

function replaceChoiceExit(
  content: InteractiveFilmDraftContent,
  source: ClipGraphNode & { exit: ChoiceExit },
  exit: ChoiceExit
): InteractiveFilmDraftContent {
  return replaceGraphNode(content, source.nodeId, { ...source, exit });
}

function requireGraphNode(content: InteractiveFilmDraftContent, nodeId: string): StoryGraphNode {
  const node = content.graph.nodes.find((candidate) => candidate.nodeId === nodeId);
  if (!node) throw mutationError("NODE_NOT_FOUND", `Unknown graph node ${nodeId}.`);
  return node;
}

function requireClip(content: InteractiveFilmDraftContent, nodeId: string): ClipGraphNode {
  const node = content.graph.nodes.find((candidate) => candidate.nodeId === nodeId);
  if (!node || node.kind !== "clip") {
    throw mutationError("CLIP_NOT_FOUND", `Unknown clip node ${nodeId}.`);
  }
  return node;
}

function requireClipPrompt(
  content: InteractiveFilmDraftContent,
  nodeId: string
): StoryClipPromptDraft {
  const prompt = content.clipPrompts.find((candidate) => candidate.graphNodeId === nodeId);
  if (!prompt) {
    throw mutationError("CLIP_PROMPT_NOT_FOUND", `Clip ${nodeId} has no director prompt.`);
  }
  return prompt;
}

function requireChoiceClip(
  content: InteractiveFilmDraftContent,
  nodeId: string
): ClipGraphNode & { exit: ChoiceExit } {
  const node = requireClip(content, nodeId);
  if (node.exit.kind !== "choice") {
    throw mutationError(
      "SOURCE_EXIT_KIND_MISMATCH",
      `Clip ${nodeId} has a ${node.exit.kind} exit, not a choice exit.`
    );
  }
  return node as ClipGraphNode & { exit: ChoiceExit };
}

function requireCheckpointClip(
  content: InteractiveFilmDraftContent,
  nodeId: string
): ClipGraphNode & { exit: CheckpointExit } {
  const node = requireClip(content, nodeId);
  if (node.exit.kind !== "checkpoint") {
    throw mutationError(
      "SOURCE_EXIT_KIND_MISMATCH",
      `Clip ${nodeId} has a ${node.exit.kind} exit, not a checkpoint exit.`
    );
  }
  return node as ClipGraphNode & { exit: CheckpointExit };
}

function requireTargetNode(content: InteractiveFilmDraftContent, nodeId: string): void {
  if (!content.graph.nodes.some((node) => node.nodeId === nodeId)) {
    throw mutationError("TARGET_NODE_NOT_FOUND", `Unknown target node ${nodeId}.`);
  }
}

function requireEnding(content: InteractiveFilmDraftContent, endingId: string): StoryEnding {
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

function assertAvailableNodeId(content: InteractiveFilmDraftContent, nodeId: string): string {
  const valid = assertStableId(nodeId);
  if (content.graph.nodes.some((node) => node.nodeId === valid)) {
    throw mutationError("DUPLICATE_NODE_ID", `Graph node ${valid} already exists.`);
  }
  return valid;
}

function assertAvailableEndingId(content: InteractiveFilmDraftContent, endingId: string): string {
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

function assertAvailableClipKey(content: InteractiveFilmDraftContent, clipKey: string): string {
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

function assertRoutePriority(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 10_000) {
    throw mutationError(
      "INVALID_ROUTE_PRIORITY",
      `Route priority ${value} must be an integer between 0 and 10000.`
    );
  }
  return value;
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

function findAutoRouteIndex(
  routes: Array<{ nextNodeId: string; priority: number }>,
  selector: { routeIndex?: number; targetNodeId?: string; priority?: number }
): number {
  if (selector.routeIndex !== undefined) {
    const route = routes[selector.routeIndex];
    if (!route) return -1;
    if (selector.targetNodeId !== undefined && route.nextNodeId !== selector.targetNodeId)
      return -1;
    if (selector.priority !== undefined && route.priority !== selector.priority) return -1;
    return selector.routeIndex;
  }
  return routes.findIndex(
    (route) =>
      (selector.targetNodeId === undefined || route.nextNodeId === selector.targetNodeId) &&
      (selector.priority === undefined || route.priority === selector.priority)
  );
}

function hasBranches(exit: ClipGraphNode["exit"]): boolean {
  if (exit.kind === "ending" || exit.kind === "checkpoint") return true;
  if (exit.kind === "choice") return exit.choices.length > 0;
  return exit.routes.length > 0;
}

function sameCondition(left: FilmCondition | undefined, right: FilmCondition | undefined): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateConditionReferences(
  condition: FilmCondition,
  path: Array<string | number>,
  stateVariables: ReadonlyMap<
    string,
    InteractiveFilmDraftContent["storyBible"]["stateVariables"][number]
  >,
  characterIds: ReadonlySet<string>,
  issues: StoryDraftGraphIssue[]
): void {
  if (condition.kind === "variable" && !stateVariables.has(condition.key)) {
    issues.push({
      code: "unknown-state-variable",
      path: [...path, "key"],
      message: `Unknown state variable ${condition.key}.`,
    });
  }
  if (condition.kind === "relationship-at-least" && !characterIds.has(condition.characterId)) {
    issues.push({
      code: "unknown-character",
      path: [...path, "characterId"],
      message: `Unknown character ${condition.characterId}.`,
    });
  }
  if (condition.kind === "all" || condition.kind === "any") {
    condition.conditions.forEach((child, index) =>
      validateConditionReferences(
        child,
        [...path, "conditions", index],
        stateVariables,
        characterIds,
        issues
      )
    );
  }
  if (condition.kind === "not") {
    validateConditionReferences(
      condition.condition,
      [...path, "condition"],
      stateVariables,
      characterIds,
      issues
    );
  }
}

function validateEffectReferences(
  effect: StoryGraphChoice["effects"][number],
  path: Array<string | number>,
  stateVariables: ReadonlyMap<
    string,
    InteractiveFilmDraftContent["storyBible"]["stateVariables"][number]
  >,
  characterIds: ReadonlySet<string>,
  endingIds: ReadonlySet<string>,
  issues: StoryDraftGraphIssue[]
): void {
  if (
    (effect.kind === "set_variable" || effect.kind === "increment_variable") &&
    !stateVariables.has(effect.key)
  ) {
    issues.push({
      code: "unknown-state-variable",
      path: [...path, "key"],
      message: `Unknown state variable ${effect.key}.`,
    });
  }
  if (
    effect.kind === "increment_variable" &&
    stateVariables.has(effect.key) &&
    stateVariables.get(effect.key)?.type !== "number"
  ) {
    issues.push({
      code: "invalid-state-variable-type",
      path: [...path, "key"],
      message: "increment_variable requires a numeric state variable.",
    });
  }
  if (effect.kind === "adjust_relationship" && !characterIds.has(effect.characterId)) {
    issues.push({
      code: "unknown-character",
      path: [...path, "characterId"],
      message: `Unknown character ${effect.characterId}.`,
    });
  }
  if (effect.kind === "unlock_ending" && !endingIds.has(effect.endingId)) {
    issues.push({
      code: "unknown-ending",
      path: [...path, "endingId"],
      message: `Unknown ending ${effect.endingId}.`,
    });
  }
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
