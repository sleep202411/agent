import { describe, expect, it } from "vitest";
import type { InteractiveStoryDraftContent } from "@/lib/story-projects-api";
import { buildStoryCanvasModel, syntheticDecisionNodeId } from "./story-project-canvas-model";
import { deleteStoryCanvasElements } from "./story-project-canvas-deletion";

describe("deleteStoryCanvasElements", () => {
  it("deleting a clip removes graph references", () => {
    const content = draft();
    const model = buildStoryCanvasModel(content, "en-US");
    const target = model.nodes.find((node) => node.id === "clip:b")!;
    const result = deleteStoryCanvasElements(content, { nodes: [target], edges: [] });
    expect(result.graph.nodes).toHaveLength(1);
    expect(result.graph.nodes[0]?.exit).toEqual({ kind: "auto", nextNodeId: null });
  });

  it("deleting a decision converts its source to a natural terminal", () => {
    const content = choiceDraft();
    const model = buildStoryCanvasModel(content, "en-US");
    const decision = model.nodes.find((node) => node.id === syntheticDecisionNodeId("clip:a"))!;
    const result = deleteStoryCanvasElements(content, { nodes: [decision], edges: [] });
    expect(result.graph.nodes[0]?.exit).toEqual({ kind: "auto", nextNodeId: null });
  });

  it("ignores a defensive delete request for a read-only character card", () => {
    const content = draft();
    content.storyBible.characters = [
      { id: "hero", name: { "en-US": "Hero" }, summary: "", images: [], voice: null },
    ];
    const model = buildStoryCanvasModel(content, "en-US");
    const characterNode = model.nodes.find((node) => node.data.kind === "character")!;

    expect(deleteStoryCanvasElements(content, { nodes: [characterNode], edges: [] })).toBe(content);
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
          exit: { kind: "auto", nextNodeId: "clip:b" },
        },
        { kind: "clip", nodeId: "clip:b", clipKey: "B", exit: { kind: "auto", nextNodeId: null } },
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
    choices: [{ choiceId: "go", label: { "en-US": "Go" }, nextNodeId: "clip:b" }],
  };
  return value;
}
