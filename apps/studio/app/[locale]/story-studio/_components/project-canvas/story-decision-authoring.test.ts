import { describe, expect, it } from "vitest";
import type { InteractiveStoryDraftContent } from "@/lib/story-projects-api";
import {
  createDecisionNode,
  createClipNode,
  connectSceneContinuation,
  connectChoiceTarget,
  materializeStoryDecisionNodes,
} from "./story-project-canvas-mutations";
import { deleteStoryCanvasElements } from "./story-project-canvas-deletion";
import { buildStoryCanvasModel } from "./story-project-canvas-model";
import { isValidStoryFlowConnection } from "./story-project-canvas-connections";

function draft() {
  let content: InteractiveStoryDraftContent = {
    storyBible: { logline: "", synopsis: "", characters: [] },
    graph: { entryNodeId: null, nodes: [] },
    productionNotes: [],
  };
  for (const nodeId of ["A", "B", "C"])
    content = createClipNode(content, { nodeId, clipKey: nodeId }).content;
  content = createDecisionNode(content, "zh-CN", {
    nodeId: "D",
    labels: ["相信记忆", "继续寻找"],
  }).content;
  content = connectSceneContinuation(content, "A", "D");
  content = connectChoiceTarget(content, "D", "option:1", "B");
  return connectChoiceTarget(content, "D", "option:2", "C");
}

describe("independent decisions", () => {
  it("does not reuse a legacy decision id when creating an independent choice", () => {
    const content = draft();
    const existing = content.graph.nodes.find((node) => node.nodeId === "D")!;
    if (existing.exit.kind !== "choice") throw new Error("Expected choice");
    existing.exit.decisionId = "decision:choice";
    const created = createDecisionNode(content, "en-US").created;
    expect(created.exit.decisionId).not.toBe(existing.exit.decisionId);
    expect(created.nodeId).toBe("decision:choice");
  });
  it("preserves empty translations and whitespace in editable choice fields", () => {
    const content = draft();
    const decision = content.graph.nodes.find((n) => n.nodeId === "D")!;
    if (decision.exit.kind !== "choice") throw new Error("Expected decision");
    decision.exit.prompt = { "zh-CN": " 中文问题 ", "en-US": "Question" };
    decision.exit.choices[0]!.label = { "zh-CN": "", "en-US": "Option" };
    decision.exit.choices[1]!.label = { "zh-CN": " 保留空格 " };
    const projected = buildStoryCanvasModel(content, "zh-CN").nodes.find((n) => n.id === "D")!;
    expect(projected.data.summary).toBe(" 中文问题 ");
    expect(projected.data.choices?.map((c) => c.label)).toEqual(["", " 保留空格 "]);
  });

  it("deleting a predecessor preserves the entire decision and its outgoing connections", () => {
    const content = draft();
    const { nodes, edges } = buildStoryCanvasModel(content, "zh-CN");
    const result = deleteStoryCanvasElements(content, {
      nodes: [nodes.find((n) => n.id === "A")!],
      edges: edges.filter((e) => e.source === "A"),
    });
    expect(result.graph.nodes).toEqual(content.graph.nodes.filter((n) => n.nodeId !== "A"));
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it("deleting a destination retains option ids, order, translations and all other targets", () => {
    const content = draft();
    const { nodes, edges } = buildStoryCanvasModel(content, "zh-CN");
    const result = deleteStoryCanvasElements(content, {
      nodes: [nodes.find((n) => n.id === "B")!],
      edges: edges.filter((e) => e.target === "B"),
    });
    const decision = result.graph.nodes.find((n) => n.nodeId === "D")!;
    expect(decision.exit).toMatchObject({
      choices: [
        { choiceId: "option:1", label: { "zh-CN": "相信记忆" }, nextNodeId: null },
        { choiceId: "option:2", label: { "zh-CN": "继续寻找" }, nextNodeId: "C" },
      ],
    });
    expect(
      isValidStoryFlowConnection(
        { source: "D", sourceHandle: "choice:option:1", target: "C", targetHandle: "in" },
        buildStoryCanvasModel(result, "zh-CN").nodes
      )
    ).toBe(true);
    const reconnected = connectChoiceTarget(result, "D", "option:1", "C");
    expect(
      buildStoryCanvasModel(reconnected, "zh-CN").edges.filter((e) => e.target === "C")
    ).toHaveLength(2);
  });

  it("deleting a decision preserves both its predecessor and destinations", () => {
    const content = draft();
    const model = buildStoryCanvasModel(content, "zh-CN");
    const result = deleteStoryCanvasElements(content, {
      nodes: [model.nodes.find((n) => n.id === "D")!],
      edges: model.edges.filter((e) => e.source === "D" || e.target === "D"),
    });
    expect(result.graph.nodes.map((n) => n.nodeId)).toEqual(["A", "B", "C"]);
    expect(result.graph.nodes[0]?.exit).toEqual({ kind: "auto", nextNodeId: null });
    expect(result.graph.nodes.slice(1)).toEqual(content.graph.nodes.slice(1, 3));
  });

  it("upgrades attached decisions once without dropping text or disconnected options", () => {
    const content = draft();
    const decision = content.graph.nodes.find((n) => n.nodeId === "D")!;
    content.graph.nodes[0]!.exit = decision.exit;
    content.graph.nodes = content.graph.nodes.filter((n) => n.nodeId !== "D");
    const result = materializeStoryDecisionNodes(content);
    expect(result.graph.nodes.find((n) => n.kind === "decision")?.exit).toEqual(decision.exit);
    expect(materializeStoryDecisionNodes(result)).toBe(result);
    const model = buildStoryCanvasModel(result, "zh-CN");
    const withoutSource = deleteStoryCanvasElements(result, {
      nodes: [model.nodes.find((n) => n.id === "A")!],
      edges: [],
    });
    expect(withoutSource.graph.nodes.find((n) => n.kind === "decision")?.exit).toEqual(
      decision.exit
    );
  });
});
