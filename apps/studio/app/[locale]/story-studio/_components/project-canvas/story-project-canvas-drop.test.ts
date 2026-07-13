import { describe, expect, it } from "vitest";
import type { InteractiveFilmDraftContent } from "@/lib/story-projects-api";
import { buildStoryCanvasModel, syntheticDecisionNodeId } from "./story-project-canvas-model";
import {
  addChoiceOption,
  connectAutoRoute,
  convertClipExitToChoice,
  convertClipExitToCheckpoint,
  createClipNode,
  createRouterNode,
} from "./story-project-canvas-mutations";
import {
  createConnectedClipForBlankDrop,
  resolveBlankDropConnectionPlan,
} from "./story-project-canvas-drop";

describe("story canvas blank-drop connections", () => {
  it("creates and installs a root entry clip atomically", () => {
    const original = draft();
    const root = canvasNode(original, "__story_root__");

    const result = createConnectedClipForBlankDrop(original, root.data, "entry", "en-US");

    expect(result).not.toBeNull();
    expect(original.graph).toEqual({ entryNodeId: null, nodes: [] });
    expect(result!.content.graph.entryNodeId).toBe(result!.createdNodeId);
    expect(result!.content.graph.nodes).toHaveLength(1);
  });

  it("creates a clip from new and existing automatic route handles", () => {
    let content = createClipNode(draft(), { nodeId: "opening", clipKey: "OPENING" }).content;
    content = createClipNode(content, { nodeId: "old-target", clipKey: "OLD_TARGET" }).content;
    content = connectAutoRoute(content, "opening", "old-target", { priority: 7 });

    const opening = canvasNode(content, "opening");
    const retargeted = createConnectedClipForBlankDrop(content, opening.data, "auto:0", "en-US")!;
    const retargetedOpening = graphNode(retargeted.content, "opening");
    expect(retargetedOpening.exit).toEqual({
      kind: "auto",
      routes: [{ nextNodeId: retargeted.createdNodeId, priority: 7 }],
    });

    const appended = createConnectedClipForBlankDrop(
      retargeted.content,
      canvasNode(retargeted.content, "opening").data,
      "auto-new",
      "en-US"
    )!;
    const appendedOpening = graphNode(appended.content, "opening");
    expect(appendedOpening.exit.kind).toBe("auto");
    expect(appendedOpening.exit.kind === "auto" ? appendedOpening.exit.routes : []).toEqual([
      { nextNodeId: retargeted.createdNodeId, priority: 7 },
      { nextNodeId: appended.createdNodeId, priority: 0 },
    ]);
  });

  it("supports router routes and both decision option handle forms", () => {
    let content = createClipNode(draft(), { nodeId: "opening", clipKey: "OPENING" }).content;
    content = createClipNode(content, { nodeId: "old-target", clipKey: "OLD_TARGET" }).content;
    content = createRouterNode(content, { nodeId: "router" }).content;
    content = connectAutoRoute(content, "router", "old-target");
    content = convertClipExitToChoice(content, "opening", "en-US");
    content = addChoiceOption(content, "opening", "old-target", "en-US", {
      choiceId: "stay",
    }).content;

    const routed = createConnectedClipForBlankDrop(
      content,
      canvasNode(content, "router").data,
      "route-new",
      "en-US"
    )!;
    expect(graphNode(routed.content, "router").exit).toMatchObject({
      kind: "auto",
      routes: [{ nextNodeId: "old-target" }, { nextNodeId: routed.createdNodeId }],
    });

    const decisionId = syntheticDecisionNodeId("opening");
    const retargeted = createConnectedClipForBlankDrop(
      routed.content,
      canvasNode(routed.content, decisionId).data,
      "choice:stay",
      "en-US"
    )!;
    expect(graphNode(retargeted.content, "opening").exit).toMatchObject({
      kind: "choice",
      choices: [{ choiceId: "stay", nextNodeId: retargeted.createdNodeId }],
    });

    const appended = createConnectedClipForBlankDrop(
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

    content = convertClipExitToChoice(content, "opening", "en-US");
    expect(
      resolveBlankDropConnectionPlan(canvasNode(content, "opening").data, "choice-trigger")
    ).toBeNull();
  });

  it("creates and retargets a clip from a checkpoint handle", () => {
    let content = createClipNode(draft(), { nodeId: "scene", clipKey: "SCENE" }).content;
    content = createClipNode(content, { nodeId: "old-target", clipKey: "OLD_TARGET" }).content;
    content = convertClipExitToCheckpoint(content, "scene", "old-target");

    const result = createConnectedClipForBlankDrop(
      content,
      canvasNode(content, "scene").data,
      "checkpoint",
      "en-US"
    )!;

    expect(graphNode(result.content, "scene").exit).toEqual({
      kind: "checkpoint",
      nextNodeId: result.createdNodeId,
    });
  });
});

function canvasNode(content: InteractiveFilmDraftContent, nodeId: string) {
  const node = buildStoryCanvasModel(content, "en-US").nodes.find(
    (candidate) => candidate.id === nodeId
  );
  if (!node) throw new Error(`Missing canvas node ${nodeId}`);
  return node;
}

function graphNode(content: InteractiveFilmDraftContent, nodeId: string) {
  const node = content.graph.nodes.find((candidate) => candidate.nodeId === nodeId);
  if (!node) throw new Error(`Missing graph node ${nodeId}`);
  return node;
}

function draft(): InteractiveFilmDraftContent {
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
      endings: [],
    },
    graph: { entryNodeId: null, nodes: [] },
    clipPrompts: [],
    trailerPrompt: null,
    productionNotes: [],
  };
}
