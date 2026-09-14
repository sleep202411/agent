import { describe, expect, it } from "vitest";
import type { InteractiveStoryDraftContent } from "@/lib/story-projects-api";
import {
  addChoiceOption,
  connectSceneContinuation,
  createDecisionNode,
  createClipNode,
  createWorldNode,
  deleteGraphNode,
  moveChoiceOption,
  updateStoryClipMeta,
  updateChoiceExitPrompt,
} from "./story-project-canvas-mutations";

describe("story canvas mutations", () => {
  it("creates clip nodes with unique identities", () => {
    const first = createClipNode(draft(), { nodeId: "clip:a", clipKey: "A" });
    const second = createClipNode(first.content);
    expect(second.content.graph.nodes).toHaveLength(2);
    expect(second.created.kind).toBe("clip");
    expect(second.created.nodeId).not.toBe("clip:a");
    expect(second.created.clipKey).not.toBe("A");
  });

  it("creates a disconnected named Plot node from the Storyboard view", () => {
    const result = createClipNode(draft(), {
      nodeId: "clip:storyboard",
      clipKey: "STORYBOARD",
      name: "Untitled scene",
    });
    expect(result.created).toMatchObject({
      kind: "clip",
      nodeId: "clip:storyboard",
      clipKey: "STORYBOARD",
      name: "Untitled scene",
      exit: { kind: "auto", nextNodeId: null },
    });
  });

  it("updates clip display metadata without changing its stable identity", () => {
    const created = createClipNode(draft(), { nodeId: "clip:a", clipKey: "A" });
    const next = updateStoryClipMeta(created.content, "clip:a", {
      name: "Opening",
      description: "Rain over Jinling.",
    });

    expect(next.graph.nodes[0]).toMatchObject({
      nodeId: "clip:a",
      clipKey: "A",
      name: "Opening",
      description: "Rain over Jinling.",
    });
  });

  it("connects clips and removes inbound references when a clip is deleted", () => {
    let content = createClipNode(draft(), { nodeId: "clip:a", clipKey: "A" }).content;
    content = createClipNode(content, { nodeId: "clip:b", clipKey: "B" }).content;
    content = connectSceneContinuation(content, "clip:a", "clip:b");
    content = deleteGraphNode(content, "clip:b");
    expect(content.graph.nodes[0]?.exit).toEqual({ kind: "auto", nextNodeId: null });
  });

  it("connects world experiences into the same story-flow graph in both directions", () => {
    let content = createClipNode(draft(), { nodeId: "clip:a", clipKey: "A" }).content;
    content = createWorldNode(content, { nodeId: "world:a" }).content;
    content = createClipNode(content, { nodeId: "clip:b", clipKey: "B" }).content;

    content = connectSceneContinuation(content, "clip:a", "world:a");
    content = connectSceneContinuation(content, "world:a", "clip:b");

    expect(content.graph.nodes.find((node) => node.nodeId === "clip:a")?.exit).toEqual({
      kind: "auto",
      nextNodeId: "world:a",
    });
    expect(content.graph.nodes.find((node) => node.nodeId === "world:a")?.exit).toEqual({
      kind: "auto",
      nextNodeId: "clip:b",
    });
  });

  it("authors ordered choices", () => {
    let content = createClipNode(draft(), { nodeId: "clip:a", clipKey: "A" }).content;
    content = createClipNode(content, { nodeId: "clip:b", clipKey: "B" }).content;
    content = createClipNode(content, { nodeId: "clip:c", clipKey: "C" }).content;
    content = createDecisionNode(content, "en-US", { nodeId: "decision:a", labels: [] }).content;
    content = updateChoiceExitPrompt(content, "decision:a", "en-US", "Choose a path.");
    content = addChoiceOption(content, "decision:a", "clip:b", "en-US", {
      choiceId: "left",
      label: "Left",
    }).content;
    content = addChoiceOption(content, "decision:a", "clip:c", "en-US", {
      choiceId: "right",
      label: "Right",
    }).content;
    content = moveChoiceOption(content, "decision:a", "right", "up");
    const exit = content.graph.nodes.find((node) => node.nodeId === "decision:a")?.exit;
    expect(exit?.kind === "choice" ? exit.choices.map((choice) => choice.choiceId) : []).toEqual([
      "right",
      "left",
    ]);
  });
});

function draft(): InteractiveStoryDraftContent {
  return {
    storyBible: { logline: "", synopsis: "", characters: [] },
    graph: { entryNodeId: null, nodes: [] },
    productionNotes: [],
  };
}
