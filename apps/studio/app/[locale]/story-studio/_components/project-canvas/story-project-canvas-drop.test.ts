import { describe, expect, it } from "vitest";
import type { InteractiveStoryDraftContent } from "@/lib/story-projects-api";
import { buildStoryCanvasModel } from "./story-project-canvas-model";
import {
  createClipNode,
  createDecisionNode,
  connectChoiceTarget,
  connectSceneContinuation,
} from "./story-project-canvas-mutations";
import {
  createConnectedSceneForBlankDrop,
  resolveBlankDropConnectionPlan,
} from "./story-project-canvas-drop";

const draft = (): InteractiveStoryDraftContent => ({
  storyBible: { logline: "", synopsis: "", characters: [] },
  graph: { entryNodeId: null, nodes: [] },
  productionNotes: [],
});
function node(content: InteractiveStoryDraftContent, nodeId: string) {
  return buildStoryCanvasModel(content, "en-US").nodes.find((candidate) => candidate.id === nodeId)!
    .data;
}

describe("story canvas blank-drop connections", () => {
  it("creates a scene from a free film completion output", () => {
    const content = createClipNode(draft(), { nodeId: "A" }).content;
    const result = createConnectedSceneForBlankDrop(content, node(content, "A"), "completion")!;
    expect(result.content.graph.nodes[0]?.exit).toEqual({
      kind: "auto",
      routes: [{ target: { kind: "node", nodeId: result.createdNodeId } }],
    });
  });

  it("connects the existing saved option without changing its text, id or other options", () => {
    const content = createDecisionNode(draft(), "zh-CN", {
      nodeId: "D",
      labels: ["左边", "右边"],
    }).content;
    const result = createConnectedSceneForBlankDrop(
      content,
      node(content, "D"),
      "choice:option:1"
    )!;
    expect(result.content.graph.nodes[0]?.exit).toMatchObject({
      choices: [
        {
          choiceId: "option:1",
          label: { "zh-CN": "左边" },
          target: { kind: "node", nodeId: result.createdNodeId },
        },
        { choiceId: "option:2", label: { "zh-CN": "右边" }, target: null },
      ],
    });
    expect(result.content.graph.nodes).toHaveLength(2);
  });

  it("cannot redirect occupied outputs or create orphan scenes", () => {
    let content = createClipNode(draft(), { nodeId: "A" }).content;
    content = createClipNode(content, { nodeId: "B" }).content;
    content = createDecisionNode(content, "en-US", { nodeId: "D" }).content;
    content = connectSceneContinuation(content, "A", "B");
    content = connectChoiceTarget(content, "D", "option:1", "B");
    expect(createConnectedSceneForBlankDrop(content, node(content, "A"), "completion")).toBeNull();
    expect(
      createConnectedSceneForBlankDrop(content, node(content, "D"), "choice:option:1")
    ).toBeNull();
    expect(content.graph.nodes).toHaveLength(3);
  });

  it("rejects target handles and removed temporary-option handles", () => {
    const content = createDecisionNode(draft(), "en-US", { nodeId: "D" }).content;
    for (const handle of ["in", "completion", "choice-new:draft-1", "choice:missing", null]) {
      expect(resolveBlankDropConnectionPlan(node(content, "D"), handle)).toBeNull();
    }
  });
});
