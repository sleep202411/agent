import { describe, expect, it } from "vitest";
import type { InteractiveStoryDraftContent } from "@/lib/story-projects-api";
import {
  connectSceneContinuation,
  convertSceneExitToChoice,
  addChoiceOption,
  createClipNode,
  createTextNode,
  deleteGraphNode,
  duplicateClipNode,
  duplicateTextNode,
  updateTextNode,
  validateStoryDraftGraph,
} from "./story-project-canvas-mutations";

describe("story project canvas mutations", () => {
  it("creates and duplicates graph-only clips", () => {
    const first = createClipNode(draft(), { nodeId: "opening", clipKey: "OPENING" });
    const duplicate = duplicateClipNode(first.content, "opening");

    expect(first.content.graph.entryNodeId).toBe("opening");
    expect(first.content).toEqual({
      ...draft(),
      graph: { entryNodeId: "opening", nodes: [first.created] },
    });
    expect(duplicate.created).toMatchObject({
      kind: "clip",
      clipKey: "SCENE_2",
      exit: { kind: "auto", nextNodeId: null },
    });
  });

  it("removes incoming routes when a clip is deleted", () => {
    let content = createClipNode(draft(), { nodeId: "opening", clipKey: "OPENING" }).content;
    content = createClipNode(content, { nodeId: "second", clipKey: "SECOND" }).content;
    content = connectSceneContinuation(content, "opening", "second");

    const next = deleteGraphNode(content, "second");
    expect(next.graph.nodes).toEqual([
      {
        kind: "clip",
        nodeId: "opening",
        clipKey: "OPENING",
        exit: { kind: "auto", nextNodeId: null },
      },
    ]);
  });

  it("creates, edits, branches, and duplicates a first-class text scene", () => {
    let content = createTextNode(draft(), {
      nodeId: "text:opening",
      locale: "en-US",
      title: "The letter",
      body: "You unfold the paper.",
    }).content;
    content = createClipNode(content, { nodeId: "clip:reply", clipKey: "REPLY" }).content;
    content = connectSceneContinuation(content, "text:opening", "clip:reply");
    content = updateTextNode(content, "text:opening", "zh-CN", {
      title: "来信",
      body: "你展开了信纸。",
    });

    expect(content.graph.nodes[0]).toMatchObject({
      kind: "text",
      title: { "en-US": "The letter", "zh-CN": "来信" },
      body: { "en-US": "You unfold the paper.", "zh-CN": "你展开了信纸。" },
      exit: { kind: "auto", nextNodeId: "clip:reply" },
    });

    const choice = convertSceneExitToChoice(content, "text:opening", "en-US");
    expect(choice.graph.nodes[0]).toMatchObject({
      kind: "text",
      exit: { kind: "choice", choices: [] },
    });

    const duplicate = duplicateTextNode(choice, "text:opening", { locale: "en-US" });
    expect(duplicate.created).toMatchObject({
      kind: "text",
      title: { "en-US": "The letter", "zh-CN": "来信" },
      exit: { kind: "auto", nextNodeId: null },
    });
  });

  it("requires text body copy only when validating a playable graph", () => {
    let content = createTextNode(draft(), {
      nodeId: "text:opening",
      locale: "en-US",
      title: "",
      body: "",
    }).content;
    content = createTextNode(content, {
      nodeId: "text:ending",
      locale: "en-US",
      title: "",
      body: "The end.",
    }).content;
    content = connectSceneContinuation(content, "text:opening", "text:ending");

    expect(validateStoryDraftGraph(content)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "empty-text-body" })])
    );
    expect(validateStoryDraftGraph(content, { requireComplete: true })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "empty-text-body",
          path: ["graph", "nodes", 0, "body"],
        }),
      ])
    );
    expect(validateStoryDraftGraph(content, { requireComplete: true })).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "empty-text-title" })])
    );
  });

  it("removes a text-scene choice option whose target node is deleted", () => {
    let content = createTextNode(draft(), {
      nodeId: "text:choice",
      body: "Choose.",
    }).content;
    content = createClipNode(content, {
      nodeId: "clip:target",
      clipKey: "TARGET",
    }).content;
    content = createClipNode(content, {
      nodeId: "clip:other",
      clipKey: "OTHER",
    }).content;
    content = convertSceneExitToChoice(content, "text:choice", "en-US");
    content = addChoiceOption(content, "text:choice", "clip:target", "en-US", {
      choiceId: "go",
    }).content;

    // Deleting an unrelated node leaves the choice and its target untouched.
    const withoutOther = deleteGraphNode(content, "clip:other");
    expect(withoutOther.graph.nodes[0]).toMatchObject({
      kind: "text",
      exit: {
        kind: "choice",
        choices: [{ choiceId: "go", nextNodeId: "clip:target" }],
      },
    });

    // Deleting the option's target removes the now-targetless option entirely.
    const withoutTarget = deleteGraphNode(withoutOther, "clip:target");
    expect(withoutTarget.graph.nodes[0]).toMatchObject({
      kind: "text",
      exit: { kind: "choice", choices: [] },
    });
  });
});

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
