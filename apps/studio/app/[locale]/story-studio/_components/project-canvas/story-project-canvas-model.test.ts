import { describe, expect, it } from "vitest";
import type {
  FilmTrailerSummary,
  InteractiveFilmDraftContent,
  StoryGraphNode,
} from "@/lib/story-projects-api";
import {
  buildStoryCanvasModel,
  normalizeStoryClipPromptDrafts,
} from "./story-project-canvas-model";

describe("buildStoryCanvasModel", () => {
  it("projects the story bible root even when the executable graph is empty", () => {
    const content = draft();

    const model = buildStoryCanvasModel(content, "en-US");
    expect(model.edges).toEqual([]);
    expect(model.nodes).toMatchObject([
      {
        id: "__story_root__",
        type: "storyCanvas",
        dragHandle: ".canvas-node-drag-handle",
        position: { x: 0, y: 0 },
        data: { kind: "root", title: "Story World" },
      },
    ]);
  });

  it("projects the independent trailer and immutable project aspect ratio onto the root", () => {
    const trailer = { id: "trailer-1" } as FilmTrailerSummary;

    const model = buildStoryCanvasModel(draft(), "en-US", [], undefined, "portrait_9_16", trailer);

    expect(model.nodes[0]?.data).toMatchObject({
      kind: "root",
      frameAspectRatio: "9:16",
      filmTrailer: trailer,
    });
  });

  it("normalizes a legacy payload with no trailerPrompt to an explicit null", () => {
    const legacy = draft();
    delete (legacy as Partial<InteractiveFilmDraftContent>).trailerPrompt;

    expect(normalizeStoryClipPromptDrafts(legacy)).toHaveProperty("trailerPrompt", null);
  });

  it("projects a linear auto route into deterministic BFS layers", () => {
    const content = draft({
      entryNodeId: "opening",
      nodes: [
        clip("opening", "clip-opening", {
          kind: "auto",
          routes: [{ nextNodeId: "arrival", priority: 0 }],
        }),
        clip("arrival", "clip-arrival", { kind: "ending", endingId: "truth" }),
      ],
      endings: [ending("truth", "The Truth", "真相")],
    });
    const canonicalBeforeProjection = JSON.parse(JSON.stringify(content));

    const first = buildStoryCanvasModel(content, "en-US");
    const second = buildStoryCanvasModel(content, "en-US");

    expect(first).toEqual(second);
    expect(content).toEqual(canonicalBeforeProjection);
    expect(
      first.nodes.map(({ id, type, position, data }) => ({
        id,
        type,
        position,
        kind: data.kind,
      }))
    ).toEqual([
      {
        id: "__story_root__",
        type: "storyCanvas",
        position: { x: 0, y: 0 },
        kind: "root",
      },
      {
        id: "opening",
        type: "storyCanvas",
        position: { x: 420, y: 0 },
        kind: "clip",
      },
      {
        id: "arrival",
        type: "storyCanvas",
        position: { x: 840, y: 0 },
        kind: "clip",
      },
      {
        id: "__ending__:truth",
        type: "storyCanvas",
        position: { x: 1260, y: 0 },
        kind: "ending",
      },
    ]);
    expect(first.edges).toMatchObject([
      {
        source: "__story_root__",
        target: "opening",
        sourceHandle: "entry",
        targetHandle: "in",
        data: { kind: "root" },
      },
      {
        source: "opening",
        target: "arrival",
        sourceHandle: "auto:0",
        targetHandle: "in",
        data: { kind: "auto", priority: 0 },
      },
      {
        source: "arrival",
        target: "__ending__:truth",
        sourceHandle: "ending",
        targetHandle: "ending-in",
        data: { kind: "ending", endingId: "truth" },
      },
    ]);
    expect(first.nodes.find((node) => node.id === "opening")?.data.autoRoutes).toEqual([
      { routeIndex: 0, targetNodeId: "arrival", priority: 0, hasCondition: false },
    ]);
  });

  it("projects mutable director authoring onto its clip card without mutation", () => {
    const prompt = clipPrompt("opening", "OPENING");
    const content = draft({
      nodes: [clip("opening", "OPENING", { kind: "auto", routes: [] })],
      clipPrompts: [prompt],
    });

    const model = buildStoryCanvasModel(content, "en-US");

    expect(model.nodes.find((node) => node.id === "opening")?.data.directorPrompt).toBe(prompt);
    expect(content.clipPrompts).toEqual([prompt]);
  });

  it("normalizes a legacy payload with no clipPrompts before projection", () => {
    const legacy = draft({
      nodes: [clip("opening", "OPENING", { kind: "auto", routes: [] })],
    });
    delete (legacy as Partial<InteractiveFilmDraftContent>).clipPrompts;

    const model = buildStoryCanvasModel(legacy, "en-US");

    expect(model.nodes.find((node) => node.id === "opening")?.data.directorPrompt).toMatchObject({
      graphNodeId: "opening",
      clipKey: "OPENING",
      targetDurationMs: 15_000,
      beats: [{ startMs: 0, endMs: 15_000 }],
    });
  });

  it("keeps choices as localized labeled edges and projects routers and endings", () => {
    const content = draft({
      entryNodeId: "decision",
      nodes: [
        clip("decision", "clip-decision", {
          kind: "choice",
          decisionId: "gate",
          prompt: { "en-US": "Choose a path", "zh-CN": "选择道路" },
          trigger: { kind: "media-ended" },
          choices: [
            choice("follow", "Follow the light", "追随灯光", "conditional-route"),
            choice("stay", "Stay behind", "留在原地", "failure-scene"),
          ],
        }),
        {
          kind: "router",
          nodeId: "conditional-route",
          exit: {
            kind: "auto",
            routes: [
              {
                nextNodeId: "truth-scene",
                priority: 10,
                when: { kind: "flag", flag: "truth-open", equals: true },
              },
            ],
          },
        },
        clip("truth-scene", "clip-truth", { kind: "ending", endingId: "truth" }),
        clip("failure-scene", "clip-failure", {
          kind: "ending",
          endingId: "failure",
        }),
      ],
      endings: [ending("truth", "The Truth", "真相"), ending("failure", "Lost", "迷失")],
    });

    const model = buildStoryCanvasModel(content, "zh-CN");
    const decision = model.nodes.find((node) => node.id === "decision");
    const decisionProjection = model.nodes.find((node) => node.id === "__decision__:decision");
    const router = model.nodes.find((node) => node.id === "conditional-route");
    const choiceEdges = model.edges.filter((edge) => edge.data.kind === "choice");

    expect(decision?.data).toMatchObject({
      kind: "clip",
      exitKind: "choice",
    });
    expect(decision?.data.choices).toBeUndefined();
    expect(decisionProjection?.data).toMatchObject({
      kind: "decision",
      title: "选择道路",
      decisionId: "gate",
      sourceNodeId: "decision",
      choices: [
        { choiceId: "follow", label: "追随灯光", targetNodeId: "conditional-route" },
        { choiceId: "stay", label: "留在原地", targetNodeId: "failure-scene" },
      ],
    });
    expect(router?.data).toMatchObject({
      kind: "router",
      exitKind: "auto",
      autoRoutes: [
        { routeIndex: 0, targetNodeId: "truth-scene", priority: 10, hasCondition: true },
      ],
    });
    expect(choiceEdges.map((edge) => edge.label)).toEqual(["追随灯光", "留在原地"]);
    expect(choiceEdges.map((edge) => edge.source)).toEqual([
      "__decision__:decision",
      "__decision__:decision",
    ]);
    expect(choiceEdges.map((edge) => [edge.sourceHandle, edge.targetHandle])).toEqual([
      ["choice:follow", "in"],
      ["choice:stay", "in"],
    ]);
    expect(model.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "decision",
          target: "__decision__:decision",
          sourceHandle: "choice-trigger",
          targetHandle: "decision-in",
          data: { kind: "decision", decisionId: "gate", sourceNodeId: "decision" },
        }),
        expect.objectContaining({
          source: "conditional-route",
          target: "truth-scene",
          sourceHandle: "route:0",
          targetHandle: "in",
          data: { kind: "auto", priority: 10, routeIndex: 0 },
        }),
      ])
    );
    expect(
      model.nodes
        .filter((node) => node.data.kind === "ending")
        .map((node) => ({
          endingId: node.data.endingId,
          title: node.data.title,
        }))
    ).toEqual([
      { endingId: "truth", title: "真相" },
      { endingId: "failure", title: "迷失" },
    ]);
  });

  it("projects a checkpoint as one direct interaction edge without a synthetic decision", () => {
    const content = draft({
      entryNodeId: "scene",
      nodes: [
        clip("scene", "SCENE", { kind: "checkpoint", nextNodeId: "epilogue" }),
        clip("epilogue", "EPILOGUE", { kind: "ending", endingId: "truth" }),
      ],
      endings: [ending("truth", "The Truth", "真相")],
    });

    const model = buildStoryCanvasModel(content, "en-US");

    expect(model.nodes.find((node) => node.id === "scene")?.data).toMatchObject({
      kind: "clip",
      exitKind: "checkpoint",
      checkpointTargetNodeId: "epilogue",
    });
    expect(model.nodes.some((node) => node.data.kind === "decision")).toBe(false);
    expect(model.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "scene",
          target: "epilogue",
          sourceHandle: "checkpoint",
          targetHandle: "in",
          data: { kind: "checkpoint" },
        }),
      ])
    );
  });
});

function draft(
  overrides: {
    entryNodeId?: string | null;
    nodes?: StoryGraphNode[];
    endings?: InteractiveFilmDraftContent["storyBible"]["endings"];
    clipPrompts?: InteractiveFilmDraftContent["clipPrompts"];
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
    clipPrompts: overrides.clipPrompts ?? [],
    trailerPrompt: null,
    productionNotes: [],
  };
}

function clipPrompt(
  graphNodeId: string,
  clipKey: string
): InteractiveFilmDraftContent["clipPrompts"][number] {
  return {
    graphNodeId,
    clipKey,
    title: clipKey,
    description: "",
    targetDurationMs: 15_000,
    generationControl: { mode: "frame_lock", frameMode: "first_frame" },
    masterDirection: "A single controlled move.",
    referenceRoleNotes: [],
    emotionalArc: "Unease into resolve.",
    beats: [],
    negativeConstraints: [],
    continuityNotes: [],
  };
}

function clip(
  nodeId: string,
  clipKey: string,
  exit: Extract<StoryGraphNode, { kind: "clip" }>["exit"]
): StoryGraphNode {
  return { kind: "clip", nodeId, clipKey, exit };
}

function choice(
  choiceId: string,
  englishLabel: string,
  chineseLabel: string,
  nextNodeId: string
): Extract<
  Extract<StoryGraphNode, { kind: "clip" }>["exit"],
  { kind: "choice" }
>["choices"][number] {
  return {
    choiceId,
    label: { "en-US": englishLabel, "zh-CN": chineseLabel },
    effects: [],
    nextNodeId,
    afterSelect: { kind: "immediate" },
  };
}

function ending(
  id: string,
  englishTitle: string,
  chineseTitle: string
): InteractiveFilmDraftContent["storyBible"]["endings"][number] {
  return {
    id,
    title: { "en-US": englishTitle, "zh-CN": chineseTitle },
    summary: { "en-US": "", "zh-CN": "" },
    kind: "custom",
  };
}
