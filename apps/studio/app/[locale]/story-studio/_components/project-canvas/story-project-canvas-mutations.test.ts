import { describe, expect, it } from "vitest";
import type { InteractiveStoryDraftContent } from "@/lib/story-projects-api";
import {
  addChoiceOption,
  connectSceneContinuation,
  convertSceneExitToChoice,
  createClipNode,
  deleteGraphNode,
  duplicateClipNode,
  moveChoiceOption,
  updateStoryClipMeta,
  updateChoiceExitPrompt,
  validateStoryDraftGraph,
} from "./story-project-canvas-mutations";

describe("film-only canvas mutations", () => {
  it("creates and duplicates only clip nodes with unique identities", () => {
    const first = createClipNode(draft(), { nodeId: "clip:a", clipKey: "A" });
    const second = duplicateClipNode(first.content, "clip:a");
    expect(second.content.graph.nodes).toHaveLength(2);
    expect(second.created.kind).toBe("clip");
    expect(second.created.nodeId).not.toBe("clip:a");
    expect(second.created.clipKey).not.toBe("A");
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

  it("authors ordered choices and validates their targets", () => {
    let content = createClipNode(draft(), { nodeId: "clip:a", clipKey: "A" }).content;
    content = createClipNode(content, { nodeId: "clip:b", clipKey: "B" }).content;
    content = createClipNode(content, { nodeId: "clip:c", clipKey: "C" }).content;
    content = convertSceneExitToChoice(content, "clip:a", "en-US");
    content = updateChoiceExitPrompt(content, "clip:a", "en-US", "Choose a path.");
    content = addChoiceOption(content, "clip:a", "clip:b", "en-US", {
      choiceId: "left",
      label: "Left",
    }).content;
    content = addChoiceOption(content, "clip:a", "clip:c", "en-US", {
      choiceId: "right",
      label: "Right",
    }).content;
    content = moveChoiceOption(content, "clip:a", "right", "up");
    const exit = content.graph.nodes[0]?.exit;
    expect(exit?.kind === "choice" ? exit.choices.map((choice) => choice.choiceId) : []).toEqual([
      "right",
      "left",
    ]);
    expect(validateStoryDraftGraph(content, { requireComplete: true })).toEqual([]);
  });
});

function draft(): InteractiveStoryDraftContent {
  return {
    storyBible: { logline: "", synopsis: "", characters: [] },
    graph: { entryNodeId: null, nodes: [] },
    productionNotes: [],
  };
}
