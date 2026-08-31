import { describe, expect, it } from "vitest";
import type { InteractiveStoryDraftContent } from "@/lib/story-projects-api";
import { buildStoryCanvasModel } from "./story-project-canvas-model";
import {
  addChoiceOption,
  convertSceneExitToChoice,
  createClipNode,
} from "./story-project-canvas-mutations";
import {
  createConnectedSceneForBlankDrop,
  resolveBlankDropConnectionPlan,
} from "./story-project-canvas-drop";

describe("story canvas blank-drop connections", () => {
  it("creates a clip from a film completion handle", () => {
    const content = createClipNode(draft(), { nodeId: "opening", clipKey: "OPENING" }).content;
    const opening = canvasNode(content, "opening");
    const result = createConnectedSceneForBlankDrop(content, opening.data, "completion", "en-US")!;

    expect(graphNode(result.content, "opening").exit).toEqual({
      kind: "auto",
      nextNodeId: result.createdNodeId,
    });
  });

  it("supports both inline interaction option handle forms", () => {
    let content = createClipNode(draft(), { nodeId: "opening", clipKey: "OPENING" }).content;
    content = createClipNode(content, { nodeId: "old-target", clipKey: "OLD_TARGET" }).content;
    content = convertSceneExitToChoice(content, "opening", "en-US");
    content = addChoiceOption(content, "opening", "old-target", "en-US", {
      choiceId: "stay",
    }).content;

    const retargeted = createConnectedSceneForBlankDrop(
      content,
      decisionNode(content, "opening").data,
      "choice:stay",
      "en-US"
    )!;
    expect(graphNode(retargeted.content, "opening").exit).toMatchObject({
      kind: "choice",
      choices: [{ choiceId: "stay", nextNodeId: retargeted.createdNodeId }],
    });

    const appended = createConnectedSceneForBlankDrop(
      retargeted.content,
      decisionNode(retargeted.content, "opening").data,
      "choice-new:draft-1",
      "en-US",
      { newChoiceLabel: "Take the new path" }
    )!;
    const appendedOpening = graphNode(appended.content, "opening");
    expect(appendedOpening.exit.kind === "choice" ? appendedOpening.exit.choices : []).toEqual([
      expect.objectContaining({ choiceId: "stay", nextNodeId: retargeted.createdNodeId }),
      expect.objectContaining({
        choiceId: "choice:2",
        label: { "en-US": "Take the new path" },
        nextNodeId: appended.createdNodeId,
      }),
    ]);
  });

  it("rejects target handles, mismatched handle kinds, and ambiguous terminal exits", () => {
    let content = createClipNode(draft(), { nodeId: "opening", clipKey: "OPENING" }).content;
    expect(
      resolveBlankDropConnectionPlan(canvasNode(content, "opening").data, "route-new")
    ).toBeNull();

    content = convertSceneExitToChoice(content, "opening", "en-US");
    expect(
      resolveBlankDropConnectionPlan(decisionNode(content, "opening").data, "completion")
    ).toBeNull();
  });
});

function canvasNode(content: InteractiveStoryDraftContent, nodeId: string) {
  const node = buildStoryCanvasModel(content, "en-US").nodes.find(
    (candidate) => candidate.id === nodeId
  );
  if (!node) throw new Error(`Missing canvas node ${nodeId}`);
  return node;
}

function decisionNode(content: InteractiveStoryDraftContent, sourceNodeId: string) {
  const node = buildStoryCanvasModel(content, "en-US").nodes.find(
    (candidate) =>
      candidate.data.kind === "decision" && candidate.data.sourceNodeId === sourceNodeId
  );
  if (!node) throw new Error(`Missing decision for ${sourceNodeId}`);
  return {
    ...node,
    data: {
      ...node.data,
      // The blank-drop domain accepts the canonical source scene shape. The
      // canvas controller performs this projection-boundary translation too.
      kind: "clip" as const,
      nodeId: sourceNodeId,
    },
  };
}

function graphNode(content: InteractiveStoryDraftContent, nodeId: string) {
  const node = content.graph.nodes.find((candidate) => candidate.nodeId === nodeId);
  if (!node) throw new Error(`Missing graph node ${nodeId}`);
  return node;
}

function draft(): InteractiveStoryDraftContent {
  return {
    storyBible: {
      logline: "",
      synopsis: "",
      characters: [],
    },
    graph: { entryNodeId: null, nodes: [] },
    productionNotes: [],
  };
}
