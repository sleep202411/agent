import { describe, expect, it } from "vitest";
import type { InteractiveStoryDraftContent } from "@/lib/story-projects-api";
import { buildStoryCanvasModel } from "./story-project-canvas-model";
import { deleteStoryCanvasElements } from "./story-project-canvas-deletion";

describe("deleteStoryCanvasElements", () => {
  it("deleting a clip removes graph references", () => {
    const content = draft();
    const model = buildStoryCanvasModel(content, "en-US");
    const target = model.nodes.find((node) => node.id === "clip:b")!;
    const result = deleteStoryCanvasElements(content, { nodes: [target], edges: [] });
    expect(result.graph.nodes).toHaveLength(1);
    expect(result.graph.nodes[0]?.exit).toEqual({ kind: "auto", routes: [{ target: null }] });
  });

  it("deleting a world node removes the node and every incoming reference", () => {
    const content = worldDraft();
    const model = buildStoryCanvasModel(content, "en-US");
    const target = model.nodes.find((node) => node.id === "world:rain")!;

    const result = deleteStoryCanvasElements(content, { nodes: [target], edges: [] });

    expect(result.graph.nodes.map((node) => node.nodeId)).toEqual(["clip:a", "clip:b"]);
    expect(result.graph.nodes[0]?.exit).toEqual({ kind: "auto", routes: [{ target: null }] });
  });

  it("deleting a choice edge preserves the option text and clears only its target", () => {
    const content = choiceDraft();
    const model = buildStoryCanvasModel(content, "en-US");
    const choiceEdge = model.edges.find((edge) => edge.data.kind === "choice")!;
    const result = deleteStoryCanvasElements(content, { nodes: [], edges: [choiceEdge] });
    expect(result.graph.nodes[0]?.exit).toMatchObject({
      kind: "choice",
      choices: [{ choiceId: "go", label: { "en-US": "Go" }, target: null }],
    });
  });

  it("deleting a projected decision removes the scene choice without deleting the scene", () => {
    const content = choiceDraft();
    const model = buildStoryCanvasModel(content, "en-US");
    const decision = model.nodes.find((node) => node.data.kind === "decision")!;

    const result = deleteStoryCanvasElements(content, { nodes: [decision], edges: [] });

    expect(result.graph.nodes.map((node) => node.nodeId)).toEqual(["clip:a", "clip:b"]);
    expect(result.graph.nodes[0]?.exit).toEqual({ kind: "auto", routes: [{ target: null }] });
  });

  it("deleting the scene-to-decision edge detaches and retains the choice", () => {
    const content = choiceDraft();
    const model = buildStoryCanvasModel(content, "en-US");
    const decisionEdge = model.edges.find((edge) => edge.data.kind === "decision")!;

    const result = deleteStoryCanvasElements(content, { nodes: [], edges: [decisionEdge] });

    expect(result.graph.nodes[0]?.exit).toEqual({ kind: "auto", routes: [{ target: null }] });
    expect(result.graph.nodes.find((node) => node.kind === "decision")?.exit).toEqual(
      content.graph.nodes[0]!.exit
    );
  });

  it("deleting a hotspot branch keeps the hotspot and changes it to continue locally", () => {
    const content = draft();
    const source = content.graph.nodes[0]!;
    if (source.kind !== "clip") throw new Error("Expected clip fixture.");
    source.interactions = [
      {
        kind: "hotspot",
        interactionId: "open-door",
        label: { "en-US": "Open door" },
        trigger: { kind: "tap" },
        rect: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
        startMs: 0,
        endMs: 1_000,
        outcomes: { success: { kind: "goto", target: { kind: "node", nodeId: "clip:b" } } },
      },
    ];
    const model = buildStoryCanvasModel(content, "en-US");
    const edge = model.edges.find((candidate) => candidate.data.kind === "interaction")!;

    const result = deleteStoryCanvasElements(content, { nodes: [], edges: [edge] });

    const remaining = result.graph.nodes[0];
    expect(remaining?.kind).toBe("clip");
    expect(remaining?.kind === "clip" ? remaining.interactions : []).toEqual([
      expect.objectContaining({ outcomes: { success: { kind: "continue" } } }),
    ]);
  });
});

function draft(): InteractiveStoryDraftContent {
  return {
    storyBible: { logline: "", synopsis: "", characters: [] },
    graph: {
      entryNodeId: "clip:a",
      nodes: [
        {
          kind: "clip",
          nodeId: "clip:a",
          clipKey: "A",
          interactions: [],
          exit: { kind: "auto", routes: [{ target: { kind: "node", nodeId: "clip:b" } }] },
        },
        {
          kind: "clip",
          nodeId: "clip:b",
          clipKey: "B",
          interactions: [],
          exit: { kind: "auto", routes: [{ target: null }] },
        },
      ],
    },
    productionNotes: [],
  };
}

function choiceDraft(): InteractiveStoryDraftContent {
  const value = draft();
  value.graph.nodes[0]!.exit = {
    kind: "choice",
    decisionId: "decision:a",
    prompt: { "en-US": "Choose" },
    choices: [
      { choiceId: "go", label: { "en-US": "Go" }, target: { kind: "node", nodeId: "clip:b" } },
    ],
  };
  return value;
}

function worldDraft(): InteractiveStoryDraftContent {
  return {
    storyBible: { logline: "", synopsis: "", characters: [] },
    graph: {
      entryNodeId: "clip:a",
      nodes: [
        {
          kind: "clip",
          nodeId: "clip:a",
          clipKey: "A",
          interactions: [],
          exit: { kind: "auto", routes: [{ target: { kind: "node", nodeId: "world:rain" } }] },
        },
        {
          kind: "world",
          nodeId: "world:rain",
          worldId: null,
          name: "Rain world",
          entryInstruction: "Reach the gate.",
          maxExperienceSeconds: 60,
          exit: { kind: "auto", routes: [{ target: { kind: "node", nodeId: "clip:b" } }] },
        },
        {
          kind: "clip",
          nodeId: "clip:b",
          clipKey: "B",
          interactions: [],
          exit: { kind: "auto", routes: [{ target: null }] },
        },
      ],
    },
    productionNotes: [],
  };
}
