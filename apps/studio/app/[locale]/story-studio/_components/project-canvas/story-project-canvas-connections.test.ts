import { describe, expect, it } from "vitest";
import type { Connection } from "@xyflow/react";
import type { InteractiveStoryDraftContent } from "@/lib/story-projects-api";
import {
  canConnectStoryCompletion,
  isValidStoryFlowConnection,
  storyExistingTargetAvailability,
} from "./story-project-canvas-connections";
import { buildStoryCanvasModel, storyDecisionCanvasNodeId } from "./story-project-canvas-model";
import {
  connectSceneContinuation,
  createClipNode,
  createDecisionNode,
  connectChoiceTarget,
  disconnectSceneContinuation,
  replaceIncomingStoryLinks,
} from "./story-project-canvas-mutations";

describe("story port connections", () => {
  it("keeps multiple outputs connected to the same input after saving and loading", () => {
    let content = connect(createNodes(), "A", "C");
    content = connect(content, "B", "C");
    const restored = buildStoryCanvasModel(JSON.parse(JSON.stringify(content)), "en-US");
    expect(restored.edges.map((edge) => [edge.source, edge.target, edge.targetHandle])).toEqual([
      ["A", "C", "in"],
      ["B", "C", "in"],
    ]);
    const disconnected = disconnectSceneContinuation(content, "A", "C");
    expect(buildStoryCanvasModel(disconnected, "en-US").edges.map((edge) => edge.source)).toEqual([
      "B",
    ]);
    expect(connect(disconnected, "A", "C")).toEqual(content);
  });

  it("requires disconnecting an occupied output before connecting another target", () => {
    let content = connect(createNodes(), "A", "B");
    const { nodes } = buildStoryCanvasModel(content, "en-US");
    expect(canConnectStoryCompletion(nodes.find((node) => node.id === "A")!.data)).toBe(false);
    expect(isValidStoryFlowConnection(flow("A", "C"), nodes)).toBe(false);
    expect(isValidStoryFlowConnection(flow("A", "B"), nodes)).toBe(false);
    content = disconnectSceneContinuation(content, "A", "B");
    content = connect(content, "A", "C");
    expect(buildStoryCanvasModel(content, "en-US").edges.map((edge) => edge.target)).toEqual(["C"]);
  });

  it("allows separate choice outputs to share an input and locks each connected output", () => {
    let content = createDecisionNode(createNodes(), "en-US", {
      nodeId: "D",
      labels: ["First", "Second"],
    }).content;
    for (const choiceId of ["option:1", "option:2"]) {
      const connection = flow("D", "C", `choice:${choiceId}`);
      expect(
        isValidStoryFlowConnection(connection, buildStoryCanvasModel(content, "en-US").nodes)
      ).toBe(true);
      content = connectChoiceTarget(content, "D", choiceId, "C");
      expect(
        isValidStoryFlowConnection(
          flow("D", "B", `choice:${choiceId}`),
          buildStoryCanvasModel(content, "en-US").nodes
        )
      ).toBe(false);
    }
    const edges = buildStoryCanvasModel(content, "en-US").edges.filter(
      (edge) => edge.target === "C"
    );
    expect(edges.map((edge) => edge.sourceHandle)).toEqual(["choice:option:1", "choice:option:2"]);
    expect(new Set(edges.map((edge) => edge.id)).size).toBe(2);
  });

  it("does not edit the legacy proposal projection before it is adopted", () => {
    const content = createNodes();
    content.graph.nodes[0]!.exit = {
      kind: "choice",
      decisionId: "legacy-choice",
      prompt: {},
      choices: [],
    };
    const { nodes } = buildStoryCanvasModel(content, "en-US");
    expect(canConnectStoryCompletion(nodes.find((node) => node.id === "A")!.data)).toBe(false);
    expect(isValidStoryFlowConnection(flow("A", "B"), nodes)).toBe(false);
    expect(isValidStoryFlowConnection(flow("B", storyDecisionCanvasNodeId("A")), nodes)).toBe(
      false
    );
  });

  it("offers a free input before an occupied one and blocks an occupied output", () => {
    let content = connect(createNodes(), "A", "C");
    const { nodes, edges } = buildStoryCanvasModel(content, "en-US");
    const incoming = (targetId: string) =>
      edges.filter(
        (edge) =>
          edge.target === targetId &&
          (edge.data.kind === "continuation" || edge.data.kind === "choice")
      ).length;
    expect(storyExistingTargetAvailability("B", "C", nodes, incoming("C"))).toBe("replace");
    expect(storyExistingTargetAvailability("B", "A", nodes, incoming("A"))).toBe("open");
    expect(storyExistingTargetAvailability("A", "B", nodes, incoming("B"))).toBe("blocked");
  });

  it("rejects missing nodes, invalid handles, and connections to the same node", () => {
    const { nodes } = buildStoryCanvasModel(createNodes(), "en-US");
    for (const connection of [
      flow("A", "missing"),
      flow("missing", "A"),
      flow("A", "A"),
      flow("A", "B", "wrong"),
      { ...flow("A", "B"), targetHandle: "completion" },
    ]) {
      expect(isValidStoryFlowConnection(connection, nodes)).toBe(false);
    }
  });

  it("replaces every story link that already arrives at the chosen node", () => {
    let content = connect(createNodes(), "A", "C");
    content = connect(content, "B", "C");
    content = replaceIncomingStoryLinks(content, "C");
    const cleared = buildStoryCanvasModel(content, "en-US");
    expect(cleared.edges).toEqual([]);
    content = connect(content, "B", "C");
    expect(buildStoryCanvasModel(content, "en-US").edges.map((edge) => edge.source)).toEqual(["B"]);
  });
});

function flow(source: string, target: string, sourceHandle = "completion"): Connection {
  return { source, target, sourceHandle, targetHandle: "in" };
}

function connect(content: InteractiveStoryDraftContent, source: string, target: string) {
  expect(
    isValidStoryFlowConnection(flow(source, target), buildStoryCanvasModel(content, "en-US").nodes)
  ).toBe(true);
  return connectSceneContinuation(content, source, target);
}

function createNodes(): InteractiveStoryDraftContent {
  let content: InteractiveStoryDraftContent = {
    storyBible: { logline: "", synopsis: "", characters: [] },
    graph: { entryNodeId: null, nodes: [] },
    productionNotes: [],
  };
  for (const nodeId of ["A", "B", "C"]) {
    content = createClipNode(content, { nodeId, clipKey: nodeId }).content;
  }
  return content;
}
