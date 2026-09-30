import { describe, expect, it } from "vitest";
import type { InteractiveStoryDraftContent } from "@/lib/story-projects-api";
import { storyAutoFallbackNodeId } from "@repo/shared/story-stats";
import {
  connectChoiceTarget,
  connectSceneContinuation,
  createClipNode,
  createDecisionNode,
  duplicateStoryNodes,
} from "./story-project-canvas-mutations";

describe("duplicateStoryNodes", () => {
  it("keeps a link only when both ends were copied", () => {
    const { content, left, right } = linkedPair();
    const copied = duplicateStoryNodes(content, [
      { canvasId: left, nodeId: left, role: "node" },
      { canvasId: right, nodeId: right, role: "node" },
    ]);

    const clones = copied.content.graph.nodes.slice(2);
    expect(clones).toHaveLength(2);
    expect(storyAutoFallbackNodeId(clones[0]!.exit)).toBe(clones[1]!.nodeId);
    expect(storyAutoFallbackNodeId(copied.content.graph.nodes[0]!.exit)).toBe(right);
    expect(copied.content.graph.entryNodeId).toBe(left);
  });

  it("drops the link when only one end is copied", () => {
    const { content, left, right } = linkedPair();
    const copied = duplicateStoryNodes(content, [{ canvasId: left, nodeId: left, role: "node" }]);

    const clone = copied.content.graph.nodes.at(-1)!;
    expect(clone.nodeId).not.toBe(left);
    expect(storyAutoFallbackNodeId(clone.exit)).toBeNull();
    expect(storyAutoFallbackNodeId(copied.content.graph.nodes[0]!.exit)).toBe(right);
  });

  it("does not invent a link across a gap in the selection", () => {
    let content = linkedPair().content;
    content = createClipNode(content, { nodeId: "clip:c", clipKey: "C" }).content;
    content = connectSceneContinuation(content, "clip:b", "clip:c");
    const copied = duplicateStoryNodes(content, [
      { canvasId: "clip:a", nodeId: "clip:a", role: "node" },
      { canvasId: "clip:c", nodeId: "clip:c", role: "node" },
    ]);

    const clones = copied.content.graph.nodes.slice(3);
    expect(clones.map((node) => storyAutoFallbackNodeId(node.exit))).toEqual([null, null]);
    expect(storyAutoFallbackNodeId(copied.content.graph.nodes[0]!.exit)).toBe("clip:b");
    expect(storyAutoFallbackNodeId(copied.content.graph.nodes[1]!.exit)).toBe("clip:c");
  });

  it("retargets only the choice options whose destinations were copied", () => {
    let content = linkedPair().content;
    content = createClipNode(content, { nodeId: "clip:c", clipKey: "C" }).content;
    const decision = createDecisionNode(content, "zh-CN", {
      nodeId: "decision:choice",
      labels: ["留在选区", "留在外面"],
    });
    content = connectChoiceTarget(decision.content, "decision:choice", "option:1", "clip:b");
    content = connectChoiceTarget(content, "decision:choice", "option:2", "clip:c");

    const copied = duplicateStoryNodes(content, [
      { canvasId: "decision:choice", nodeId: "decision:choice", role: "node" },
      { canvasId: "clip:b", nodeId: "clip:b", role: "node" },
    ]);
    const clone = copied.content.graph.nodes.find(
      (node) => node.kind === "decision" && node.nodeId !== "decision:choice"
    );
    expect(clone?.exit.kind).toBe("choice");
    if (clone?.exit.kind !== "choice") return;
    const copyOfB = copied.created.find((item) => item.canvasId === "clip:b")?.nodeId;
    expect(clone.exit.choices.map((choice) => choice.target)).toEqual([
      { kind: "node", nodeId: copyOfB },
      null,
    ]);
    const original = copied.content.graph.nodes.find((node) => node.nodeId === "decision:choice");
    if (original?.exit.kind !== "choice") throw new Error("original choice missing");
    expect(original.exit.choices.map((choice) => choice.target)).toEqual([
      { kind: "node", nodeId: "clip:b" },
      { kind: "node", nodeId: "clip:c" },
    ]);
  });
});

function linkedPair() {
  let content = createClipNode(emptyDraft(), { nodeId: "clip:a", clipKey: "A" }).content;
  content = createClipNode(content, { nodeId: "clip:b", clipKey: "B" }).content;
  content = connectSceneContinuation(content, "clip:a", "clip:b");
  return { content, left: "clip:a", right: "clip:b" };
}

function emptyDraft(): InteractiveStoryDraftContent {
  return {
    storyBible: { logline: "", synopsis: "", characters: [] },
    graph: { entryNodeId: null, nodes: [] },
    productionNotes: [],
  };
}
