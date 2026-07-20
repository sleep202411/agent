import { describe, expect, it } from "vitest";
import type { InteractiveStoryDraftContent } from "@/lib/story-projects-api";
import { buildStoryCanvasModel, syntheticDecisionNodeId } from "./story-project-canvas-model";
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
  it("creates and installs a root entry clip atomically", () => {
    const original = draft();
    const root = canvasNode(original, "__story_root__");

    const result = createConnectedSceneForBlankDrop(original, root.data, "entry", "en-US");

    expect(result).not.toBeNull();
    expect(original.graph).toEqual({ entryNodeId: null, nodes: [] });
    expect(result!.content.graph.entryNodeId).toBe(result!.createdNodeId);
    expect(result!.content.graph.nodes).toHaveLength(1);
  });

  it("creates a clip from a film completion handle", () => {
    const content = createClipNode(draft(), { nodeId: "opening", clipKey: "OPENING" }).content;
    const opening = canvasNode(content, "opening");
    const result = createConnectedSceneForBlankDrop(content, opening.data, "completion", "en-US")!;

    expect(graphNode(result.content, "opening").exit).toEqual({
      kind: "auto",
      nextNodeId: result.createdNodeId,
    });
  });

  it("creates and connects a text scene from a scene completion handle", () => {
    const content = createClipNode(draft(), { nodeId: "opening", clipKey: "OPENING" }).content;
    const opening = canvasNode(content, "opening");
    const result = createConnectedSceneForBlankDrop(
      content,
      opening.data,
      "completion",
      "en-US",
      "text"
    )!;

    expect(graphNode(result.content, result.createdNodeId)).toMatchObject({
      kind: "text",
      title: { "en-US": "" },
      body: { "en-US": "" },
    });
    expect(graphNode(result.content, "opening").exit).toEqual({
      kind: "auto",
      nextNodeId: result.createdNodeId,
    });
  });

  it("supports both decision option handle forms", () => {
    let content = createClipNode(draft(), { nodeId: "opening", clipKey: "OPENING" }).content;
    content = createClipNode(content, { nodeId: "old-target", clipKey: "OLD_TARGET" }).content;
    content = convertSceneExitToChoice(content, "opening", "en-US");
    content = addChoiceOption(content, "opening", "old-target", "en-US", {
      choiceId: "stay",
    }).content;

    const decisionId = syntheticDecisionNodeId("opening");
    const retargeted = createConnectedSceneForBlankDrop(
      content,
      canvasNode(content, decisionId).data,
      "choice:stay",
      "en-US"
    )!;
    expect(graphNode(retargeted.content, "opening").exit).toMatchObject({
      kind: "choice",
      choices: [{ choiceId: "stay", nextNodeId: retargeted.createdNodeId }],
    });

    const appended = createConnectedSceneForBlankDrop(
      retargeted.content,
      canvasNode(retargeted.content, decisionId).data,
      "choice-new",
      "en-US"
    )!;
    const appendedOpening = graphNode(appended.content, "opening");
    expect(appendedOpening.exit.kind === "choice" ? appendedOpening.exit.choices : []).toEqual([
      expect.objectContaining({ choiceId: "stay", nextNodeId: retargeted.createdNodeId }),
      expect.objectContaining({ choiceId: "choice:2", nextNodeId: appended.createdNodeId }),
    ]);
  });

  it("rejects target handles, mismatched handle kinds, and ambiguous terminal exits", () => {
    const rootPlan = resolveBlankDropConnectionPlan(
      canvasNode(draft(), "__story_root__").data,
      "in"
    );
    expect(rootPlan).toBeNull();

    let content = createClipNode(draft(), { nodeId: "opening", clipKey: "OPENING" }).content;
    expect(
      resolveBlankDropConnectionPlan(canvasNode(content, "opening").data, "route-new")
    ).toBeNull();

    content = convertSceneExitToChoice(content, "opening", "en-US");
    expect(
      resolveBlankDropConnectionPlan(canvasNode(content, "opening").data, "completion")
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
      worldview: "",
      characters: [],
      endings: [],
    },
    graph: { entryNodeId: null, nodes: [] },
    productionNotes: [],
  };
}
