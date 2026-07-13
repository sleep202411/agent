import { describe, expect, it } from "vitest";
import type { InteractiveFilmDraftContent, StoryGraphNode } from "@/lib/story-projects-api";
import {
  addChoiceOption,
  appendClipPromptBeat,
  connectAutoRoute,
  connectChoiceTarget,
  connectEnding,
  convertClipExitToCheckpoint,
  convertClipExitToChoice,
  convertClipExitToEnding,
  convertExitToAuto,
  createClipNode,
  createDefaultClipPrompt,
  createEndingNode,
  createRouterNode,
  createTrailerPrompt,
  deleteEndingNode,
  deleteGraphNode,
  disconnectAutoRoute,
  disconnectChoiceTarget,
  disconnectEnding,
  disconnectStoryBranch,
  duplicateClipNode,
  duplicateRouterNode,
  moveChoiceOption,
  moveClipPromptBeat,
  removeChoiceOption,
  replaceClipPrompt,
  replaceTrailerPrompt,
  setEntryNode,
  setClipPromptTargetDuration,
  StoryDraftMutationError,
  updateAutoRoute,
  updateAutoRouteTarget,
  updateChoiceExit,
  updateChoiceExitPrompt,
  updateChoiceOption,
  updateCheckpointTarget,
  updateEndingNode,
  validateStoryDraftGraph,
} from "./story-project-canvas-mutations";

describe("story project canvas mutations", () => {
  it("authors and replaces an independent mutable trailer director design", () => {
    const original = draft();
    const authored = createTrailerPrompt(original, "  Project trailer  ");

    expect(original.trailerPrompt).toBeNull();
    expect(authored.trailerPrompt).toMatchObject({
      title: "Project trailer",
      targetDurationMs: 15_000,
      generationControl: { mode: "omni_reference" },
      beats: [{ id: "trailer:beat:1", startMs: 0, endMs: 15_000 }],
    });
    expect(createTrailerPrompt(authored, "Ignored")).toBe(authored);

    const replacement = {
      ...authored.trailerPrompt!,
      masterDirection: "Open on the villa, then reveal the dragon gate.",
    };
    const replaced = replaceTrailerPrompt(authored, replacement);

    expect(replaced.trailerPrompt).toBe(replacement);
    expect(replaced.clipPrompts).toBe(authored.clipPrompts);
  });

  it("creates clip, router, and synthetic ending records with stable deterministic IDs", () => {
    const original = draft();
    const firstClip = createClipNode(original);
    const secondClip = createClipNode(firstClip.content, {
      nodeId: "clip:scene-2",
      clipKey: "SCENE_2",
    });
    const router = createRouterNode(secondClip.content);
    const ending = createEndingNode(router.content, {
      locale: "zh-CN",
      title: "真相",
      kind: "truth",
    });

    expect(original).toEqual(draft());
    expect(firstClip.created).toEqual({
      kind: "clip",
      nodeId: "clip:scene-1",
      clipKey: "SCENE_1",
      exit: { kind: "auto", routes: [] },
    });
    expect(firstClip.content.clipPrompts).toEqual([
      expect.objectContaining({
        graphNodeId: "clip:scene-1",
        clipKey: "SCENE_1",
        targetDurationMs: 15_000,
        generationControl: { mode: "frame_lock", frameMode: "first_frame" },
      }),
    ]);
    expect(ending.content.graph.entryNodeId).toBe("clip:scene-1");
    expect(router.created).toEqual({
      kind: "router",
      nodeId: "router:route-1",
      exit: { kind: "auto", routes: [] },
    });
    expect(ending.created).toEqual({
      id: "ending:1",
      title: { "zh-CN": "真相" },
      summary: { "zh-CN": "" },
      kind: "truth",
    });
    expect(validateStoryDraftGraph(ending.content)).toEqual([]);
  });

  it("rejects duplicate or contract-invalid explicit stable identifiers", () => {
    const content = createClipNode(draft(), { nodeId: "opening", clipKey: "OPENING" }).content;

    expectMutationCode(() => createRouterNode(content, { nodeId: "opening" }), "DUPLICATE_NODE_ID");
    expectMutationCode(
      () => createClipNode(content, { nodeId: "another", clipKey: "OPENING" }),
      "DUPLICATE_CLIP_KEY"
    );
    expectMutationCode(
      () => createClipNode(content, { nodeId: "1-not-stable", clipKey: "SECOND" }),
      "INVALID_STABLE_ID"
    );
  });

  it("duplicates graph nodes with fresh identities and intentionally empty outgoing exits", () => {
    let content = createClipNode(draft(), { nodeId: "opening", clipKey: "OPENING" }).content;
    const sourcePrompt = content.clipPrompts[0]!;
    content = replaceClipPrompt(content, "opening", {
      ...sourcePrompt,
      title: "Opening direction",
      masterDirection: "Hold a single slow push-in.",
      beats: [{ ...sourcePrompt.beats[0]!, visual: "A lantern enters frame." }],
    });
    content = createRouterNode(content, { nodeId: "gate" }).content;
    content = connectAutoRoute(content, "opening", "gate", { priority: 4 });
    content = connectAutoRoute(content, "gate", "opening");

    const clipCopy = duplicateClipNode(content, "opening");
    const routerCopy = duplicateRouterNode(clipCopy.content, "gate");

    expect(clipCopy.created.nodeId).toBe("clip:scene-2");
    expect(clipCopy.created.clipKey).toBe("SCENE_2");
    expect(clipCopy.created.exit).toEqual({ kind: "auto", routes: [] });
    const copiedPrompt = clipCopy.content.clipPrompts.find(
      (prompt) => prompt.graphNodeId === clipCopy.created.nodeId
    );
    expect(copiedPrompt).toMatchObject({
      graphNodeId: "clip:scene-2",
      clipKey: "SCENE_2",
      title: "Opening direction",
      masterDirection: "Hold a single slow push-in.",
      beats: [{ visual: "A lantern enters frame." }],
    });
    expect(copiedPrompt?.beats).not.toBe(sourcePrompt.beats);
    expect(routerCopy.created).toMatchObject({
      kind: "router",
      nodeId: "router:route-2",
      exit: { kind: "auto", routes: [] },
    });
  });

  it("sets entry explicitly and selects a stable neighbor when deleting the current entry", () => {
    const content = draft({
      entryNodeId: "middle",
      nodes: [autoClip("first", "FIRST"), autoClip("middle", "MIDDLE"), autoClip("last", "LAST")],
    });

    expect(setEntryNode(content, "last").graph.entryNodeId).toBe("last");
    expect(deleteGraphNode(content, "middle").graph.entryNodeId).toBe("last");
    expect(
      deleteGraphNode({ ...content, graph: { ...content.graph, entryNodeId: "last" } }, "last")
        .graph.entryNodeId
    ).toBe("middle");
    expectMutationCode(() => setEntryNode(content, "missing"), "TARGET_NODE_NOT_FOUND");
  });

  it("deletes a graph node and atomically removes incoming routes, choices, and reaction references", () => {
    const content = draft({
      entryNodeId: "opening",
      nodes: [
        {
          kind: "clip",
          nodeId: "opening",
          clipKey: "OPENING",
          exit: {
            kind: "choice",
            decisionId: "path",
            prompt: { "en-US": "Where next?" },
            trigger: { kind: "media-ended" },
            choices: [
              choice("delete-target", "target", "TARGET"),
              choice("keep-target", "keeper", "TARGET"),
            ],
          },
        },
        autoClip("target", "TARGET"),
        {
          kind: "router",
          nodeId: "router",
          exit: {
            kind: "auto",
            routes: [
              { nextNodeId: "target", priority: 0 },
              { nextNodeId: "keeper", priority: 1 },
            ],
          },
        },
        autoClip("keeper", "KEEPER"),
      ],
    });

    const next = deleteGraphNode(content, "target");
    const opening = graphNode(next, "opening");
    const router = graphNode(next, "router");

    expect(opening.exit).toMatchObject({
      kind: "choice",
      choices: [
        {
          choiceId: "keep-target",
          nextNodeId: "keeper",
          afterSelect: { kind: "immediate" },
        },
      ],
    });
    expect(router.exit).toEqual({
      kind: "auto",
      routes: [{ nextNodeId: "keeper", priority: 1 }],
    });
    expect(next.clipPrompts.some((prompt) => prompt.graphNodeId === "target")).toBe(false);
    expect(validateStoryDraftGraph(next)).toEqual([]);
  });

  it("replaces clip prompts immutably and rejects identity changes", () => {
    const content = createClipNode(draft(), { nodeId: "opening", clipKey: "OPENING" }).content;
    const current = content.clipPrompts[0]!;
    const replacement = { ...current, emotionalArc: "Unease becomes resolve." };

    const next = replaceClipPrompt(content, "opening", replacement);

    expect(next.clipPrompts[0]).toBe(replacement);
    expect(content.clipPrompts[0]?.emotionalArc).toBe("");
    expect(replaceClipPrompt(next, "opening", replacement)).toBe(next);
    expectMutationCode(
      () => replaceClipPrompt(content, "opening", { ...replacement, clipKey: "OTHER" }),
      "CLIP_PROMPT_IDENTITY_MISMATCH"
    );
  });

  it("deletes only the director prompt owned by a deleted clip", () => {
    let content = createClipNode(draft(), { nodeId: "opening", clipKey: "OPENING" }).content;
    content = createClipNode(content, { nodeId: "second", clipKey: "SECOND" }).content;
    content = createRouterNode(content, { nodeId: "gate" }).content;

    const withoutOpening = deleteGraphNode(content, "opening");
    const withoutRouter = deleteGraphNode(content, "gate");

    expect(withoutOpening.clipPrompts.map((prompt) => prompt.graphNodeId)).toEqual(["second"]);
    expect(withoutRouter.clipPrompts).toEqual(content.clipPrompts);
    expect(content.clipPrompts.map((prompt) => prompt.graphNodeId)).toEqual(["opening", "second"]);
  });

  it("splits positive-length beats, preserves time slots when moving, and clamps duration safely", () => {
    const prompt = createDefaultClipPrompt({ nodeId: "opening", clipKey: "OPENING" });
    const split = appendClipPromptBeat(prompt);
    const directed = {
      ...split,
      beats: [
        { ...split.beats[0]!, visual: "First content" },
        { ...split.beats[1]!, visual: "Second content" },
      ],
    };

    expect(split.beats.map(({ startMs, endMs }) => [startMs, endMs])).toEqual([
      [0, 7_500],
      [7_500, 15_000],
    ]);
    expect(split.beats.every((beat) => beat.endMs > beat.startMs)).toBe(true);

    const moved = moveClipPromptBeat(directed, 1, "up");
    expect(moved.beats.map(({ startMs, endMs }) => [startMs, endMs])).toEqual([
      [0, 7_500],
      [7_500, 15_000],
    ]);
    expect(moved.beats.map((beat) => beat.visual)).toEqual(["Second content", "First content"]);

    const shortened = setClipPromptTargetDuration(directed, 12_000);
    expect(shortened.targetDurationMs).toBe(12_000);
    expect(shortened.beats[1]?.endMs).toBe(12_000);
    const clamped = setClipPromptTargetDuration({ ...directed, targetDurationMs: 20_000 }, 5_000);
    expect(clamped.targetDurationMs).toBe(15_000);

    expectMutationCode(
      () =>
        appendClipPromptBeat({
          ...prompt,
          beats: [{ ...prompt.beats[0]!, startMs: 0, endMs: 1 }],
        }),
      "CLIP_PROMPT_BEAT_TOO_SHORT"
    );
  });

  it("deletes an ending and cleans both terminal exits and unlock effects", () => {
    const content = draft({
      entryNodeId: "terminal",
      endings: [ending("truth"), ending("failure")],
      nodes: [
        {
          kind: "clip",
          nodeId: "terminal",
          clipKey: "TERMINAL",
          exit: { kind: "ending", endingId: "truth" },
        },
        {
          kind: "clip",
          nodeId: "decision",
          clipKey: "DECISION",
          exit: {
            kind: "choice",
            decisionId: "ending-path",
            prompt: { "en-US": "Choose" },
            trigger: { kind: "media-ended" },
            choices: [
              {
                ...choice("unlock", "terminal"),
                effects: [
                  { kind: "unlock_ending", endingId: "truth" },
                  { kind: "unlock_ending", endingId: "failure" },
                ],
              },
            ],
          },
        },
      ],
    });

    const next = deleteEndingNode(content, "truth");
    expect(next.storyBible.endings.map((candidate) => candidate.id)).toEqual(["failure"]);
    expect(graphNode(next, "terminal").exit).toEqual({ kind: "auto", routes: [] });
    expect(graphNode(next, "decision").exit).toMatchObject({
      choices: [{ effects: [{ kind: "unlock_ending", endingId: "failure" }] }],
    });
    expect(validateStoryDraftGraph(next)).toEqual([]);
  });

  it("converts a clip exit to a choice and edits the prompt, trigger, and options", () => {
    let content = draft({
      entryNodeId: "opening",
      nodes: [autoClip("opening", "OPENING"), autoClip("left", "LEFT"), autoClip("right", "RIGHT")],
    });
    content = connectAutoRoute(content, "opening", "left");
    content = convertClipExitToChoice(content, "opening", "zh-CN");
    content = updateChoiceExitPrompt(content, "opening", "zh-CN", "你要走哪条路？");
    expectMutationCode(
      () => updateChoiceExit(content, "opening", { trigger: { kind: "timecode", atMs: 1.5 } }),
      "INVALID_CHOICE_TIMECODE"
    );
    content = updateChoiceExit(content, "opening", { trigger: { kind: "timecode", atMs: 2_500 } });
    const left = addChoiceOption(content, "opening", "left", "zh-CN", {
      choiceId: "go-left",
      label: "向左",
    });
    content = left.content;
    content = addChoiceOption(content, "opening", "right", "zh-CN", {
      choiceId: "go-right",
      label: "向右",
    }).content;
    content = updateChoiceOption(content, "opening", "go-left", {
      label: { "zh-CN": "进入左廊" },
    });
    content = connectChoiceTarget(content, "opening", "go-left", "right");

    expect(graphNode(content, "opening").exit).toEqual({
      kind: "choice",
      decisionId: "decision:1",
      prompt: { "zh-CN": "你要走哪条路？" },
      trigger: { kind: "timecode", atMs: 2_500 },
      choices: [
        expect.objectContaining({
          choiceId: "go-left",
          label: { "zh-CN": "进入左廊" },
          nextNodeId: "right",
        }),
        expect.objectContaining({ choiceId: "go-right", nextNodeId: "right" }),
      ],
    });
    expect(
      validateStoryDraftGraph(content, { requireComplete: true }).filter(
        (issue) => issue.code === "incomplete-choice-exit"
      )
    ).toEqual([]);

    content = disconnectChoiceTarget(content, "opening", "go-left");
    expect(choiceIds(content, "opening")).toEqual(["go-right"]);
    content = removeChoiceOption(content, "opening", "go-right");
    expect(choiceIds(content, "opening")).toEqual([]);
  });

  it("moves choice options without mutating option objects and no-ops at list boundaries", () => {
    const content = draft({
      entryNodeId: "decision",
      nodes: [
        {
          kind: "clip",
          nodeId: "decision",
          clipKey: "DECISION",
          exit: {
            kind: "choice",
            decisionId: "path",
            prompt: { "en-US": "Choose" },
            trigger: { kind: "media-ended" },
            choices: [choice("first", "a"), choice("second", "b"), choice("third", "c")],
          },
        },
        autoClip("a", "A"),
        autoClip("b", "B"),
        autoClip("c", "C"),
      ],
    });
    const originalChoices = choiceOptions(content, "decision");

    const moved = moveChoiceOption(content, "decision", "second", "up");
    const movedChoices = choiceOptions(moved, "decision");

    expect(originalChoices.map((candidate) => candidate.choiceId)).toEqual([
      "first",
      "second",
      "third",
    ]);
    expect(movedChoices.map((candidate) => candidate.choiceId)).toEqual([
      "second",
      "first",
      "third",
    ]);
    expect(movedChoices[0]).toBe(originalChoices[1]);
    expect(movedChoices[1]).toBe(originalChoices[0]);
    expect(movedChoices[2]).toBe(originalChoices[2]);
    expect(moveChoiceOption(moved, "decision", "second", "up")).toBe(moved);
    expect(moveChoiceOption(content, "decision", "third", "down")).toBe(content);
    expect(choiceIds(moveChoiceOption(moved, "decision", "second", "down"), "decision")).toEqual([
      "first",
      "second",
      "third",
    ]);
    expectMutationCode(
      () => moveChoiceOption(content, "decision", "missing", "up"),
      "CHOICE_NOT_FOUND"
    );
  });

  it("connects and disconnects exact automatic branches without disturbing siblings", () => {
    let content = draft({
      entryNodeId: "router",
      nodes: [
        { kind: "router", nodeId: "router", exit: { kind: "auto", routes: [] } },
        autoClip("a", "A"),
        autoClip("b", "B"),
      ],
    });
    content = connectAutoRoute(content, "router", "a", { priority: 10 });
    content = connectAutoRoute(content, "router", "b", { priority: 20 });
    content = disconnectStoryBranch(content, {
      kind: "auto",
      sourceNodeId: "router",
      routeIndex: 0,
      targetNodeId: "a",
    });

    expect(graphNode(content, "router").exit).toEqual({
      kind: "auto",
      routes: [{ nextNodeId: "b", priority: 20 }],
    });
    expectMutationCode(
      () => disconnectAutoRoute(content, "router", { targetNodeId: "missing" }),
      "BRANCH_NOT_FOUND"
    );
  });

  it("updates one automatic route atomically while preserving its position and siblings", () => {
    const guard = { kind: "flag", flag: "gate-open", equals: true } as const;
    let content = draft({
      entryNodeId: "router",
      nodes: [
        { kind: "router", nodeId: "router", exit: { kind: "auto", routes: [] } },
        autoClip("a", "A"),
        autoClip("b", "B"),
        autoClip("c", "C"),
      ],
    });
    content = connectAutoRoute(content, "router", "a", { priority: 10, when: guard });
    content = connectAutoRoute(content, "router", "b", { priority: 20 });
    const before = content;

    const originalRoutes = autoRoutes(content, "router");
    const next = updateAutoRoute(content, "router", 0, {
      targetNodeId: "c",
      priority: 30,
      when: null,
    });

    expect(graphNode(before, "router").exit).toEqual({
      kind: "auto",
      routes: [
        { nextNodeId: "a", priority: 10, when: guard },
        { nextNodeId: "b", priority: 20 },
      ],
    });
    expect(graphNode(next, "router").exit).toEqual({
      kind: "auto",
      routes: [
        { nextNodeId: "c", priority: 30 },
        { nextNodeId: "b", priority: 20 },
      ],
    });
    expect(autoRoutes(next, "router")[1]).toBe(originalRoutes[1]);
    expect(validateStoryDraftGraph(next)).toEqual([]);
    const withCondition = updateAutoRoute(next, "router", 1, { when: guard });
    expect(autoRoutes(withCondition, "router")[1]).toEqual({
      nextNodeId: "b",
      priority: 20,
      when: guard,
    });
    expect(updateAutoRouteTarget(next, "router", 0, "c")).toBe(next);
    expectMutationCode(
      () => updateAutoRoute(next, "router", 0.5, { targetNodeId: "a" }),
      "INVALID_BRANCH_SELECTOR"
    );
    expectMutationCode(
      () => updateAutoRoute(next, "router", 8, { targetNodeId: "a" }),
      "BRANCH_NOT_FOUND"
    );
    expectMutationCode(
      () => updateAutoRoute(next, "router", 0, { targetNodeId: "missing" }),
      "TARGET_NODE_NOT_FOUND"
    );
    expectMutationCode(
      () => updateAutoRoute(next, "router", 0, { priority: -1 }),
      "INVALID_ROUTE_PRIORITY"
    );
    expectMutationCode(
      () =>
        updateAutoRoute(withCondition, "router", 1, {
          targetNodeId: "c",
          priority: 30,
          when: null,
        }),
      "BRANCH_ALREADY_EXISTS"
    );
  });

  it("connects an empty clip to an ending, refuses to erase branches, and disconnects cleanly", () => {
    let content = draft({
      entryNodeId: "terminal",
      endings: [ending("truth")],
      nodes: [autoClip("terminal", "TERMINAL"), autoClip("next", "NEXT")],
    });
    content = connectEnding(content, "terminal", "truth");
    expect(graphNode(content, "terminal").exit).toEqual({ kind: "ending", endingId: "truth" });
    content = disconnectEnding(content, "terminal", "truth");
    expect(graphNode(content, "terminal").exit).toEqual({ kind: "auto", routes: [] });

    content = connectAutoRoute(content, "terminal", "next");
    expectMutationCode(() => connectEnding(content, "terminal", "truth"), "BRANCH_ALREADY_EXISTS");
  });

  it("authors a deterministic checkpoint as one non-decision target", () => {
    let content = draft({
      entryNodeId: "opening",
      nodes: [autoClip("opening", "OPENING"), autoClip("epilogue", "EPILOGUE")],
    });

    content = convertClipExitToCheckpoint(content, "opening", "epilogue");
    expect(graphNode(content, "opening").exit).toEqual({
      kind: "checkpoint",
      nextNodeId: "epilogue",
    });
    expect(validateStoryDraftGraph(content)).toEqual([]);
    expect(updateCheckpointTarget(content, "opening", "epilogue")).toBe(content);

    content = createClipNode(content, { nodeId: "finale", clipKey: "FINALE" }).content;
    content = updateCheckpointTarget(content, "opening", "finale");
    expect(graphNode(content, "opening").exit).toEqual({
      kind: "checkpoint",
      nextNodeId: "finale",
    });

    content = disconnectStoryBranch(content, {
      kind: "checkpoint",
      sourceNodeId: "opening",
      targetNodeId: "finale",
    });
    expect(graphNode(content, "opening").exit).toEqual({ kind: "auto", routes: [] });
  });

  it("cleans checkpoint targets when their graph node is deleted", () => {
    const content = draft({
      entryNodeId: "opening",
      nodes: [
        {
          kind: "clip",
          nodeId: "opening",
          clipKey: "OPENING",
          exit: { kind: "checkpoint", nextNodeId: "epilogue" },
        },
        autoClip("epilogue", "EPILOGUE"),
      ],
    });

    const next = deleteGraphNode(content, "epilogue");
    expect(graphNode(next, "opening").exit).toEqual({ kind: "auto", routes: [] });
    expect(
      validateStoryDraftGraph(next, { requireComplete: true }).map((issue) => issue.code)
    ).toEqual(["empty-auto-exit"]);
  });

  it("supports explicit destructive exit conversion and localized ending edits", () => {
    let content = draft({
      entryNodeId: "terminal",
      endings: [ending("truth")],
      nodes: [
        {
          kind: "clip",
          nodeId: "terminal",
          clipKey: "TERMINAL",
          exit: { kind: "ending", endingId: "truth" },
        },
      ],
    });
    content = convertExitToAuto(content, "terminal");
    content = updateEndingNode(content, "truth", {
      title: { locale: "zh-CN", value: "真相结局" },
      summary: { locale: "en-US", value: "The truth is revealed." },
      kind: "hidden",
    });

    expect(graphNode(content, "terminal").exit).toEqual({ kind: "auto", routes: [] });
    expect(content.storyBible.endings[0]).toMatchObject({
      id: "truth",
      title: { "en-US": "truth", "zh-CN": "真相结局" },
      summary: { "en-US": "The truth is revealed." },
      kind: "hidden",
    });
  });

  it("converts an existing branched exit to a selected ending atomically", () => {
    let content = draft({
      entryNodeId: "terminal",
      endings: [ending("truth")],
      nodes: [autoClip("terminal", "TERMINAL"), autoClip("next", "NEXT")],
    });
    content = connectAutoRoute(content, "terminal", "next");
    content = convertClipExitToEnding(content, "terminal", "truth");

    expect(graphNode(content, "terminal").exit).toEqual({
      kind: "ending",
      endingId: "truth",
    });
  });

  it("reports relational corruption and lock-only exit completeness separately", () => {
    const content = draft({
      entryNodeId: "missing-entry",
      endings: [],
      nodes: [
        {
          kind: "clip",
          nodeId: "opening",
          clipKey: "OPENING",
          exit: { kind: "ending", endingId: "missing-ending" },
        },
        { kind: "router", nodeId: "route", exit: { kind: "auto", routes: [] } },
      ],
    });

    expect(validateStoryDraftGraph(content).map((issue) => issue.code)).toEqual([
      "unknown-entry-node",
      "unknown-ending",
    ]);
    expect(
      validateStoryDraftGraph(content, { requireComplete: true }).map((issue) => issue.code)
    ).toEqual(["unknown-entry-node", "unknown-ending", "empty-auto-exit"]);
  });
});

function draft(
  overrides: {
    entryNodeId?: string | null;
    nodes?: StoryGraphNode[];
    endings?: InteractiveFilmDraftContent["storyBible"]["endings"];
  } = {}
): InteractiveFilmDraftContent {
  return {
    storyBible: {
      logline: "",
      synopsis: "",
      worldview: "",
      storyRules: [],
      characters: [],
      locations: [],
      props: [],
      stateVariables: [],
      endings: overrides.endings ?? [],
    },
    graph: {
      entryNodeId: overrides.entryNodeId ?? null,
      nodes: overrides.nodes ?? [],
    },
    clipPrompts: [],
    trailerPrompt: null,
    productionNotes: [],
  };
}

function autoClip(nodeId: string, clipKey: string): StoryGraphNode {
  return { kind: "clip", nodeId, clipKey, exit: { kind: "auto", routes: [] } };
}

function choice(choiceId: string, nextNodeId: string, reactionClipKey?: string) {
  return {
    choiceId,
    label: { "en-US": choiceId },
    effects: [],
    nextNodeId,
    afterSelect: reactionClipKey
      ? ({ kind: "play", reactionClipKey } as const)
      : ({ kind: "immediate" } as const),
  };
}

function ending(id: string): InteractiveFilmDraftContent["storyBible"]["endings"][number] {
  return { id, title: { "en-US": id }, summary: { "en-US": "" }, kind: "custom" };
}

function graphNode(content: InteractiveFilmDraftContent, nodeId: string): StoryGraphNode {
  const node = content.graph.nodes.find((candidate) => candidate.nodeId === nodeId);
  if (!node) throw new Error(`Missing fixture graph node ${nodeId}.`);
  return node;
}

function choiceIds(content: InteractiveFilmDraftContent, nodeId: string): string[] {
  return choiceOptions(content, nodeId).map((candidate) => candidate.choiceId);
}

function choiceOptions(content: InteractiveFilmDraftContent, nodeId: string) {
  const node = graphNode(content, nodeId);
  if (node.kind !== "clip" || node.exit.kind !== "choice") throw new Error("Expected choice clip.");
  return node.exit.choices;
}

function autoRoutes(content: InteractiveFilmDraftContent, nodeId: string) {
  const node = graphNode(content, nodeId);
  if (node.exit.kind !== "auto") throw new Error("Expected automatic exit.");
  return node.exit.routes;
}

function expectMutationCode(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error(`Expected StoryDraftMutationError ${code}.`);
  } catch (error) {
    expect(error).toBeInstanceOf(StoryDraftMutationError);
    expect(error).toMatchObject({ code });
  }
}
