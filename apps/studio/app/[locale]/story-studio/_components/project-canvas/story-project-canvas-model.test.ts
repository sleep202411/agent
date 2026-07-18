import { describe, expect, it } from "vitest";
import type {
  StoryTrailerVideoSummary,
  InteractiveFilmDraftContent,
  StoryGraphNode,
} from "@/lib/story-projects-api";
import { buildStoryCanvasModel, STORY_ROOT_NODE_ID } from "./story-project-canvas-model";

describe("buildStoryCanvasModel", () => {
  it("allows every projected story element to be deleted", () => {
    const content = draft({
      entryNodeId: "decision",
      nodes: [
        clip("decision", "DECISION", {
          kind: "choice",
          decisionId: "gate",
          prompt: { "en-US": "Choose" },
          trigger: { kind: "media-ended" },
          choices: [choice("continue", "Continue", "继续", "router")],
        }),
        { kind: "router", nodeId: "router", exit: { kind: "auto", routes: [] } },
      ],
      endings: [ending("truth", "Truth", "真相")],
    });

    const model = buildStoryCanvasModel(content, "en-US");

    expect(Object.fromEntries(model.nodes.map((node) => [node.data.kind, node.deletable]))).toEqual(
      { root: true, clip: true, decision: true, router: true, ending: true }
    );
  });

  it("omits the Story World projection and its entry edge when the layout hides it", () => {
    const content = draft({
      entryNodeId: "opening",
      nodes: [
        clip("opening", "OPENING", { kind: "auto", nextNodeId: "arrival" }),
        clip("arrival", "ARRIVAL", { kind: "auto", nextNodeId: null }),
      ],
    });

    const model = buildStoryCanvasModel(
      content,
      "en-US",
      [],
      undefined,
      "landscape_16_9",
      null,
      false
    );

    expect(model.nodes.some((node) => node.id === STORY_ROOT_NODE_ID)).toBe(false);
    expect(model.edges.some((edge) => edge.data.kind === "root")).toBe(false);
    expect(model.nodes.map(({ id, position }) => ({ id, position }))).toEqual([
      { id: "opening", position: { x: 0, y: 0 } },
      { id: "arrival", position: { x: 420, y: 0 } },
    ]);
    expect(content.graph.entryNodeId).toBe("opening");
  });

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
    const trailer: StoryTrailerVideoSummary = {
      selectionVersion: 1,
      currentVideo: null,
      generation: null,
    };

    const model = buildStoryCanvasModel(draft(), "en-US", [], undefined, "portrait_9_16", trailer);

    expect(model.nodes[0]?.data).toMatchObject({
      kind: "root",
      frameAspectRatio: "9:16",
      trailerVideo: trailer,
    });
  });

  it("projects a linear auto route into deterministic BFS layers", () => {
    const content = draft({
      entryNodeId: "opening",
      nodes: [
        clip("opening", "clip-opening", {
          kind: "auto",
          nextNodeId: "arrival",
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
        sourceHandle: "completion",
        targetHandle: "in",
        data: { kind: "continuation" },
      },
      {
        source: "arrival",
        target: "__ending__:truth",
        sourceHandle: "completion",
        targetHandle: "ending-in",
        data: { kind: "ending", endingId: "truth" },
      },
    ]);
    expect(first.nodes.find((node) => node.id === "opening")?.data).toMatchObject({
      continuationTargetNodeId: "arrival",
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
          sourceHandle: "completion",
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
          sourceHandle: "completion",
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
    productionNotes: [],
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
