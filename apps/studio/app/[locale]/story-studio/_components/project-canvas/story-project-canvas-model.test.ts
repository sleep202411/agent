import { describe, expect, it } from "vitest";
import type { InteractiveStoryDraftContent, StoryGraphNode } from "@/lib/story-projects-api";
import {
  buildStoryCanvasModel,
  characterCanvasNodeId,
  characterIdForCanvasNode,
  rejectsStoryCastWiring,
  syntheticDecisionNodeId,
  syntheticEndingNodeId,
} from "./story-project-canvas-model";

describe("buildStoryCanvasModel", () => {
  it("marks every projected element deletable", () => {
    const content = draft({
      entryNodeId: "decision",
      nodes: [
        clip("decision", "DECISION", {
          kind: "choice",
          decisionId: "gate",
          prompt: { "en-US": "Choose" },
          choices: [
            choice("continue", "Continue", "继续", "outcome"),
            choice("stay", "Stay", "留下", "decision"),
          ],
        }),
        clip("outcome", "OUTCOME", { kind: "ending", endingId: "truth" }),
      ],
      endings: [ending("truth", "Truth", "真相")],
    });

    const model = buildStoryCanvasModel(content, "en-US");

    expect(Object.fromEntries(model.nodes.map((node) => [node.data.kind, node.deletable]))).toEqual(
      { clip: true, decision: true, ending: true }
    );
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
      // Each column is centred on y = 0, so its y is minus half the card's own
      // height: a clip is 236 tall, an ending 132.
      {
        id: "opening",
        type: "storyCanvas",
        position: { x: 0, y: -118 },
        kind: "clip",
      },
      {
        id: "arrival",
        type: "storyCanvas",
        position: { x: 420, y: -118 },
        kind: "clip",
      },
      {
        id: "__ending__:truth",
        type: "storyCanvas",
        position: { x: 840, y: -66 },
        kind: "ending",
      },
    ]);
    expect(first.edges).toMatchObject([
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

  it("keeps choices as localized labeled edges and projects endings", () => {
    const content = draft({
      entryNodeId: "decision",
      nodes: [
        clip("decision", "clip-decision", {
          kind: "choice",
          decisionId: "gate",
          prompt: { "en-US": "Choose a path", "zh-CN": "选择道路" },
          choices: [
            choice("follow", "Follow the light", "追随灯光", "truth-scene"),
            choice("stay", "Stay behind", "留在原地", "failure-scene"),
          ],
        }),
        clip("truth-scene", "clip-truth", { kind: "ending", endingId: "truth" }),
        clip("failure-scene", "clip-failure", {
          kind: "ending",
          endingId: "failure",
        }),
      ],
      endings: [ending("truth", "The Truth", "真相"), ending("failure", "Lost", "迷失")],
    });

    const model = buildStoryCanvasModel(content, "zh-CN", [], {
      clip: "镜头",
      text: "关键剧情",
      decision: "玩家选择",
      ending: "结局",
    });
    const decision = model.nodes.find((node) => node.id === "decision");
    const decisionProjection = model.nodes.find((node) => node.id === "__decision__:decision");
    const choiceEdges = model.edges.filter((edge) => edge.data.kind === "choice");

    expect(decision?.data).toMatchObject({
      kind: "clip",
      title: "镜头 1",
      exitKind: "choice",
    });
    expect(decision?.data.choices).toBeUndefined();
    expect(decisionProjection?.data).toMatchObject({
      kind: "decision",
      title: "选择道路",
      decisionId: "gate",
      sourceNodeId: "decision",
      choices: [
        {
          choiceId: "follow",
          label: "追随灯光",
          targetNodeId: "truth-scene",
          targetTitle: "镜头 2",
        },
        {
          choiceId: "stay",
          label: "留在原地",
          targetNodeId: "failure-scene",
          targetTitle: "镜头 3",
        },
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

  it("projects mixed text and video scenes through one graph", () => {
    const content = draft({
      entryNodeId: "prologue",
      nodes: [
        textScene("prologue", "Prologue", "Read the letter.", {
          kind: "auto",
          nextNodeId: "memory",
        }),
        clip("memory", "MEMORY", { kind: "ending", endingId: "truth" }),
      ],
      endings: [ending("truth", "Truth", "真相")],
    });

    const model = buildStoryCanvasModel(content, "en-US");
    expect(model.nodes.find((node) => node.id === "prologue")?.data).toMatchObject({
      kind: "text",
      title: "Prologue",
      summary: "Read the letter.",
      continuationTargetNodeId: "memory",
    });
    expect(model.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "prologue",
          target: "memory",
          data: { kind: "continuation" },
        }),
      ])
    );
  });

  it("projects text scenes without optional titles and endings without optional summaries", () => {
    const content = draft({
      entryNodeId: "untitled",
      nodes: [
        {
          kind: "text",
          nodeId: "untitled",
          body: { "en-US": "The story begins." },
          exit: { kind: "ending", endingId: "finish" },
        },
      ],
      endings: [
        {
          id: "finish",
          title: { "en-US": "Finish" },
        },
      ],
    });

    const model = buildStoryCanvasModel(content, "en-US");

    expect(model.nodes.find((node) => node.id === "untitled")?.data).toMatchObject({
      kind: "text",
      title: "Text scene 1",
      summary: "The story begins.",
    });
    expect(
      model.nodes.find((node) => node.id === syntheticEndingNodeId("finish"))?.data
    ).toMatchObject({
      kind: "ending",
      title: "Finish",
    });
  });

  it("projects text choices, checkpoints, and endings with the canonical edge semantics", () => {
    const content = draft({
      entryNodeId: "question",
      nodes: [
        textScene("question", "Question", "Choose a path.", {
          kind: "choice",
          decisionId: "decision:path",
          prompt: { "en-US": "Where next?" },
          choices: [
            choice("wait", "Wait", "等待", "pause"),
            choice("leave", "Leave", "離開", "farewell"),
          ],
        }),
        textScene("pause", "Pause", "Take a breath.", {
          kind: "checkpoint",
          nextNodeId: "farewell",
        }),
        textScene("farewell", "Farewell", "The door closes.", {
          kind: "ending",
          endingId: "truth",
        }),
      ],
      endings: [ending("truth", "Truth", "真相")],
    });

    const model = buildStoryCanvasModel(content, "en-US");
    expect(
      model.nodes.find((node) => node.id === syntheticDecisionNodeId("question"))?.data
    ).toMatchObject({
      kind: "decision",
      sourceNodeId: "question",
      decisionId: "decision:path",
    });
    expect(model.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "question",
          target: syntheticDecisionNodeId("question"),
          data: expect.objectContaining({ kind: "decision", sourceNodeId: "question" }),
        }),
        expect.objectContaining({
          source: syntheticDecisionNodeId("question"),
          target: "pause",
          data: expect.objectContaining({ kind: "choice", sourceNodeId: "question" }),
        }),
        expect.objectContaining({
          source: "pause",
          target: "farewell",
          data: { kind: "checkpoint" },
        }),
        expect.objectContaining({
          source: "farewell",
          target: syntheticEndingNodeId("truth"),
          data: { kind: "ending", endingId: "truth" },
        }),
      ])
    );
  });
});

describe("Story cast projection", () => {
  it("projects one character node per bible character with a character: id in the left cast lane", () => {
    const content = draft({
      entryNodeId: "opening",
      nodes: [clip("opening", "OPENING", { kind: "auto", nextNodeId: null })],
      characters: [
        character("hero", "Hero", "The lead."),
        character("rival", "Rival", "The foil."),
      ],
    });

    const model = buildStoryCanvasModel(content, "en-US");
    const cast = model.nodes.filter((node) => node.data.kind === "character");
    expect(cast.map((node) => node.id)).toEqual(["character:hero", "character:rival"]);
    expect(cast[0]?.data).toMatchObject({
      kind: "character",
      title: "Hero",
      characterId: "hero",
      summary: "The lead.",
    });
    // Character cards join the standard delete pipeline and are always deletable
    // in a pure branching tree.
    expect(cast.every((node) => node.deletable === true)).toBe(true);
    // The cast lane sits LEFT of the entry scene; story flow runs to its right.
    const openingX = model.nodes.find((node) => node.id === "opening")!.position.x;
    expect(cast.every((node) => node.position.x < openingX)).toBe(true);
    // A single vertical column: one shared x, distinct rows.
    expect(new Set(cast.map((node) => node.position.x)).size).toBe(1);
    expect(cast[0]!.position.y).not.toBe(cast[1]!.position.y);
  });

  it("keeps character cards on the canvas with no world tether", () => {
    const content = draft({
      entryNodeId: "opening",
      nodes: [clip("opening", "OPENING", { kind: "auto", nextNodeId: null })],
      characters: [character("hero", "Hero", "The lead.")],
    });
    const model = buildStoryCanvasModel(content, "en-US", [], undefined, "landscape_16_9");
    expect(model.edges.some((edge) => edge.data.kind === "membership")).toBe(false);
    expect(model.nodes.some((node) => node.id === "character:hero")).toBe(true);
  });

  it("maps character canvas ids outside the executable graph", () => {
    expect(characterCanvasNodeId("hero")).toBe("character:hero");
    expect(characterIdForCanvasNode("character:hero")).toBe("hero");
    expect(characterIdForCanvasNode("opening")).toBeNull();
  });
});

describe("rejectsStoryCastWiring", () => {
  it("rejects any connection touching a character node or a cast handle", () => {
    expect(rejectsStoryCastWiring({ sourceKind: "character", targetKind: "clip" })).toBe(true);
    expect(rejectsStoryCastWiring({ sourceKind: "clip", targetKind: "character" })).toBe(true);
    expect(
      rejectsStoryCastWiring({
        sourceKind: "clip",
        targetKind: "character",
        targetHandle: "cast-in",
      })
    ).toBe(true);
  });

  it("allows ordinary story-flow connections", () => {
    expect(
      rejectsStoryCastWiring({
        sourceKind: "clip",
        targetKind: "clip",
        sourceHandle: "completion",
        targetHandle: "in",
      })
    ).toBe(false);
  });
});

function draft(
  overrides: {
    entryNodeId?: string | null;
    nodes?: StoryGraphNode[];
    endings?: InteractiveStoryDraftContent["storyBible"]["endings"];
    characters?: InteractiveStoryDraftContent["storyBible"]["characters"];
  } = {}
): InteractiveStoryDraftContent {
  return {
    storyBible: {
      logline: "",
      synopsis: "",
      worldview: "",
      characters: overrides.characters ?? [],
      endings: overrides.endings ?? [],
    },
    graph: {
      entryNodeId: overrides.entryNodeId ?? null,
      nodes: overrides.nodes ?? [],
    },
    productionNotes: [],
  };
}

function character(
  id: string,
  name: string,
  summary: string
): InteractiveStoryDraftContent["storyBible"]["characters"][number] {
  return { id, name: { "en-US": name }, summary, images: [], voice: null };
}

function clip(
  nodeId: string,
  clipKey: string,
  exit: Extract<StoryGraphNode, { kind: "clip" }>["exit"]
): StoryGraphNode {
  return { kind: "clip", nodeId, clipKey, exit };
}

function textScene(
  nodeId: string,
  title: string,
  body: string,
  exit: Extract<StoryGraphNode, { kind: "text" }>["exit"]
): StoryGraphNode {
  return {
    kind: "text",
    nodeId,
    title: { "en-US": title },
    body: { "en-US": body },
    exit,
  };
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
    nextNodeId,
  };
}

function ending(
  id: string,
  englishTitle: string,
  chineseTitle: string
): InteractiveStoryDraftContent["storyBible"]["endings"][number] {
  return {
    id,
    title: { "en-US": englishTitle, "zh-CN": chineseTitle },
    summary: { "en-US": "", "zh-CN": "" },
  };
}
