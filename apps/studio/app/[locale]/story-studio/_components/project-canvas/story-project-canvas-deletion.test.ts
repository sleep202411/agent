import { describe, expect, it } from "vitest";
import type { InteractiveStoryDraftContent, StoryGraphNode } from "@/lib/story-projects-api";
import { deleteStoryCanvasElements } from "./story-project-canvas-deletion";
import { buildStoryCanvasModel, characterCanvasNodeId } from "./story-project-canvas-model";

describe("deleteStoryCanvasElements", () => {
  it("deduplicates a selected clip and its synthetic decision", () => {
    const content = draft({
      entryNodeId: "source",
      nodes: [
        clip("source", {
          kind: "choice",
          decisionId: "decision:source",
          prompt: { "en-US": "Choose" },
          choices: [
            {
              choiceId: "continue",
              label: { "en-US": "Continue" },
              nextNodeId: "target",
            },
          ],
        }),
        clip("target", { kind: "auto", nextNodeId: null }),
      ],
    });
    const model = buildStoryCanvasModel(content, "en-US");
    const source = requiredNode(model.nodes, "source");
    const decision = requiredNode(model.nodes, "__decision__:source");

    const next = deleteStoryCanvasElements(content, {
      nodes: [source, decision],
      edges: model.edges.filter(
        (edge) =>
          edge.source === source.id ||
          edge.target === source.id ||
          edge.source === decision.id ||
          edge.target === decision.id
      ),
    });

    expect(next.graph.entryNodeId).toBe("target");
    expect(next.graph.nodes.map((node) => node.nodeId)).toEqual(["target"]);
  });

  it("deletes an unrelated selected edge before deleting a node", () => {
    const content = draft({
      entryNodeId: "deleted",
      nodes: [
        clip("deleted", { kind: "auto", nextNodeId: null }),
        clip("first", { kind: "auto", nextNodeId: "second" }),
        clip("second", { kind: "auto", nextNodeId: null }),
      ],
    });
    const model = buildStoryCanvasModel(content, "en-US");
    const deleted = requiredNode(model.nodes, "deleted");
    const selectedContinuation = model.edges.find(
      (edge) => edge.source === "first" && edge.target === "second"
    );
    if (!selectedContinuation) throw new Error("Expected the first→second continuation edge.");

    const next = deleteStoryCanvasElements(content, {
      nodes: [deleted],
      edges: [
        ...model.edges.filter((edge) => edge.source === deleted.id || edge.target === deleted.id),
        selectedContinuation,
      ],
    });

    expect(next.graph.entryNodeId).toBe("first");
    expect(next.graph.nodes.map((node) => node.nodeId)).toEqual(["first", "second"]);
    expect(next.graph.nodes.find((node) => node.nodeId === "first")).toMatchObject({
      exit: { kind: "auto", nextNodeId: null },
    });
  });

  it("deletes a text scene and its synthetic decision as one canonical node", () => {
    const content = draft({
      entryNodeId: "text:choice",
      nodes: [
        {
          kind: "text",
          nodeId: "text:choice",
          title: { "en-US": "Choose" },
          body: { "en-US": "Two doors wait." },
          exit: {
            kind: "choice",
            decisionId: "decision:text",
            prompt: { "en-US": "Which door?" },
            choices: [],
          },
        },
        clip("after", { kind: "auto", nextNodeId: null }),
      ],
    });
    const model = buildStoryCanvasModel(content, "en-US");
    const scene = requiredNode(model.nodes, "text:choice");
    const decision = requiredNode(model.nodes, "__decision__:text:choice");

    const next = deleteStoryCanvasElements(content, {
      nodes: [scene, decision],
      edges: model.edges.filter(
        (edge) =>
          edge.source === scene.id ||
          edge.target === scene.id ||
          edge.source === decision.id ||
          edge.target === decision.id
      ),
    });

    expect(next.graph.entryNodeId).toBe("after");
    expect(next.graph.nodes.map((node) => node.nodeId)).toEqual(["after"]);
  });
});

function requiredNode(nodes: ReturnType<typeof buildStoryCanvasModel>["nodes"], nodeId: string) {
  const node = nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new Error(`Expected canvas node ${nodeId}.`);
  return node;
}

function draft({
  entryNodeId,
  nodes,
  endings = [],
  characters = [],
}: {
  entryNodeId: string | null;
  nodes: StoryGraphNode[];
  endings?: InteractiveStoryDraftContent["storyBible"]["endings"];
  characters?: InteractiveStoryDraftContent["storyBible"]["characters"];
}): InteractiveStoryDraftContent {
  return {
    storyBible: {
      logline: "",
      synopsis: "",
      worldview: "",
      characters,
      endings,
    },
    graph: { entryNodeId, nodes },
    productionNotes: [],
  };
}

function clip(
  nodeId: string,
  exit: Extract<StoryGraphNode, { kind: "clip" }>["exit"]
): StoryGraphNode {
  return { kind: "clip", nodeId, clipKey: nodeId.toUpperCase(), exit };
}

describe("character card deletion", () => {
  it("deletes an unreferenced character through the standard pipeline", () => {
    const content = draft({
      entryNodeId: null,
      nodes: [],
      characters: [character("hero"), character("guide")],
    });
    const model = buildStoryCanvasModel(content, "en-US");
    const heroNode = model.nodes.find((node) => node.id === characterCanvasNodeId("hero"))!;

    const next = deleteStoryCanvasElements(content, {
      nodes: [heroNode],
      edges: model.edges.filter(
        (edge) => edge.source === heroNode.id || edge.target === heroNode.id
      ),
    });

    expect(next.storyBible.characters.map(({ id }) => id)).toEqual(["guide"]);
  });
});

function character(id: string): InteractiveStoryDraftContent["storyBible"]["characters"][number] {
  return { id, name: { "en-US": id }, summary: "", images: [], voice: null };
}
