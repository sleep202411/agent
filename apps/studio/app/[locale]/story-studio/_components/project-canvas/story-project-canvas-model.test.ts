import { describe, expect, it } from "vitest";
import type { InteractiveStoryDraftContent, StoryClipGraphNode } from "@/lib/story-projects-api";
import { buildStoryCanvasModel, storyDecisionCanvasNodeId } from "./story-project-canvas-model";

describe("film-only story canvas projection", () => {
  it("projects one decision card whose option rows retain independent anchors", () => {
    const model = buildStoryCanvasModel(draft(), "en-US", { clip: "Clip" });
    const decisionNodeId = storyDecisionCanvasNodeId("clip:a", "decision:a");
    expect(model.nodes.map((node) => node.id)).toEqual(["clip:a", decisionNodeId, "clip:b"]);
    expect(model.nodes.map((node) => node.data.kind)).toEqual(["clip", "decision", "clip"]);
    expect(model.nodes[0]?.data).toMatchObject({
      exitKind: "auto",
      continuationTargetNodeId: decisionNodeId,
    });
    expect(model.nodes[1]?.data).toMatchObject({
      kind: "decision",
      sourceNodeId: "clip:a",
      decisionId: "decision:a",
      summary: "Where next?",
      choices: [
        {
          choiceId: "go",
          label: "Go",
          targetNodeId: "clip:b",
          targetTitle: "Clip 2",
        },
      ],
    });
    expect(model.nodes.every((node) => node.dragHandle === undefined)).toBe(true);
  });

  it("projects scene completion into the decision and branches from option handles", () => {
    const model = buildStoryCanvasModel(draft(), "en-US");
    const decisionNodeId = storyDecisionCanvasNodeId("clip:a", "decision:a");
    expect(model.edges.map((edge) => edge.data.kind)).toEqual(["decision", "choice"]);
    expect(model.edges[0]).toMatchObject({ source: "clip:a", target: decisionNodeId });
    expect(model.edges[1]).toMatchObject({
      source: decisionNodeId,
      sourceHandle: "choice:go",
      target: "clip:b",
    });
  });

  it("keeps local hotspot actions inline and projects only cross-clip actions as edges", () => {
    const content = draft();
    const source = content.graph.nodes[0]!;
    if (source.kind !== "clip") throw new Error("Expected clip fixture.");
    source.interactions = [
      hotspot("continue", { kind: "continue" }),
      hotspot("rewind", { kind: "seek", timeMs: 500 }),
      hotspot("branch", { kind: "goto", nodeId: "clip:b" }),
    ];

    const model = buildStoryCanvasModel(content, "en-US");
    expect(model.nodes[0]?.data.interactions).toHaveLength(3);
    expect(model.edges.filter((edge) => edge.data.kind === "interaction")).toEqual([
      expect.objectContaining({
        source: "clip:a",
        target: "clip:b",
        sourceHandle: "interaction:branch:success",
      }),
    ]);
  });

  it("omits story-bible characters from the canvas entirely", () => {
    const model = buildStoryCanvasModel(draft(), "en-US");
    expect(model.nodes.some((node) => node.id.startsWith("character:"))).toBe(false);
  });
});

function draft(): InteractiveStoryDraftContent {
  return {
    storyBible: {
      logline: "A choice",
      synopsis: "",
      characters: [{ id: "hero", name: { "en-US": "Hero" }, summary: "", images: [], voice: null }],
    },
    graph: {
      entryNodeId: "clip:a",
      nodes: [
        {
          kind: "clip",
          nodeId: "clip:a",
          clipKey: "A",
          interactions: [],
          exit: {
            kind: "choice",
            decisionId: "decision:a",
            prompt: { "en-US": "Where next?" },
            choices: [{ choiceId: "go", label: { "en-US": "Go" }, nextNodeId: "clip:b" }],
          },
        },
        {
          kind: "clip",
          nodeId: "clip:b",
          clipKey: "B",
          interactions: [],
          exit: { kind: "auto", nextNodeId: null },
        },
      ],
    },
    productionNotes: [],
  };
}

function hotspot(
  interactionId: string,
  action: StoryClipGraphNode["interactions"][number]["outcomes"]["success"]
): StoryClipGraphNode["interactions"][number] {
  return {
    kind: "hotspot",
    interactionId,
    label: { "en-US": interactionId },
    trigger: { kind: "tap" },
    rect: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
    startMs: 0,
    endMs: 1_000,
    outcomes: { success: action },
  };
}
