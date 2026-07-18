import { describe, expect, it } from "vitest";
import type { InteractiveFilmDraftContent, StoryGraphNode } from "@/lib/story-projects-api";
import { deleteStoryCanvasElements } from "./story-project-canvas-deletion";
import { buildStoryCanvasModel, STORY_ROOT_NODE_ID } from "./story-project-canvas-model";

describe("deleteStoryCanvasElements", () => {
  it("deduplicates a selected clip and its synthetic decision", () => {
    const content = draft({
      entryNodeId: "source",
      nodes: [
        clip("source", {
          kind: "choice",
          decisionId: "decision:source",
          prompt: { "en-US": "Choose" },
          trigger: { kind: "media-ended" },
          choices: [
            {
              choiceId: "continue",
              label: { "en-US": "Continue" },
              effects: [],
              nextNodeId: "target",
              afterSelect: { kind: "immediate" },
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
        {
          kind: "router",
          nodeId: "router",
          exit: {
            kind: "auto",
            routes: [
              { nextNodeId: "first", priority: 10 },
              { nextNodeId: "second", priority: 20 },
            ],
          },
        },
        clip("first", { kind: "auto", nextNodeId: null }),
        clip("second", { kind: "auto", nextNodeId: null }),
      ],
    });
    const model = buildStoryCanvasModel(content, "en-US");
    const deleted = requiredNode(model.nodes, "deleted");
    const selectedRoute = model.edges.find(
      (edge) => edge.source === "router" && edge.target === "second"
    );
    if (!selectedRoute) throw new Error("Expected the second router edge.");

    const next = deleteStoryCanvasElements(content, {
      nodes: [deleted],
      edges: [
        ...model.edges.filter((edge) => edge.source === deleted.id || edge.target === deleted.id),
        selectedRoute,
      ],
    });

    expect(next.graph.entryNodeId).toBe("router");
    expect(next.graph.nodes.map((node) => node.nodeId)).toEqual(["router", "first", "second"]);
    expect(next.graph.nodes.find((node) => node.nodeId === "router")).toMatchObject({
      exit: { routes: [{ nextNodeId: "first", priority: 10 }] },
    });
  });

  it("treats root deletion as layout-only and consumes its incident entry edge", () => {
    const content = draft({
      entryNodeId: "source",
      nodes: [clip("source", { kind: "auto", nextNodeId: null })],
    });
    const model = buildStoryCanvasModel(content, "en-US");
    const root = requiredNode(model.nodes, STORY_ROOT_NODE_ID);

    const next = deleteStoryCanvasElements(content, {
      nodes: [root],
      edges: model.edges.filter((edge) => edge.source === root.id || edge.target === root.id),
    });

    expect(next).toBe(content);
    expect(next.graph.entryNodeId).toBe("source");
  });

  it("still clears the executable entry when only the root edge is deleted", () => {
    const content = draft({
      entryNodeId: "source",
      nodes: [clip("source", { kind: "auto", nextNodeId: null })],
    });
    const model = buildStoryCanvasModel(content, "en-US");
    const rootEdge = model.edges.find((edge) => edge.data.kind === "root");
    if (!rootEdge) throw new Error("Expected the root entry edge.");

    const next = deleteStoryCanvasElements(content, { nodes: [], edges: [rootEdge] });

    expect(next.graph.entryNodeId).toBeNull();
    expect(next.graph.nodes.map((node) => node.nodeId)).toEqual(["source"]);
  });

  it("deletes canonical nodes alongside the layout-only root in one request", () => {
    const content = draft({
      entryNodeId: "source",
      nodes: [clip("source", { kind: "ending", endingId: "truth" })],
      endings: [
        {
          id: "truth",
          title: { "en-US": "Truth" },
          summary: { "en-US": "" },
          kind: "truth",
        },
      ],
    });
    const model = buildStoryCanvasModel(content, "en-US");
    const root = requiredNode(model.nodes, STORY_ROOT_NODE_ID);
    const ending = requiredNode(model.nodes, "__ending__:truth");

    const next = deleteStoryCanvasElements(content, {
      nodes: [root, ending],
      edges: model.edges.filter(
        (edge) =>
          edge.source === root.id ||
          edge.target === root.id ||
          edge.source === ending.id ||
          edge.target === ending.id
      ),
    });

    expect(next.storyBible.endings).toEqual([]);
    expect(next.graph.entryNodeId).toBe("source");
    expect(next.graph.nodes[0]).toMatchObject({
      nodeId: "source",
      exit: { kind: "auto", nextNodeId: null },
    });
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
}: {
  entryNodeId: string | null;
  nodes: StoryGraphNode[];
  endings?: InteractiveFilmDraftContent["storyBible"]["endings"];
}): InteractiveFilmDraftContent {
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
