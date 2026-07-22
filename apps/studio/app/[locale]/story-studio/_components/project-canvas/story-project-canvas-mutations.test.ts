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
  setNodeMusic,
  updateTextNode,
  validateStoryDraftGraph,
} from "./story-project-canvas-mutations";

/** Real MediaAsset ids: the binding is validated as a UUID, exactly as on the server. */
const THEME_ASSET_ID = "0197f4a2-0800-7000-8000-0000000000a1";
const ECHO_ASSET_ID = "0197f4a2-0800-7000-8000-0000000000a2";

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

  it("writes explicit cross-chapter continuations without admitting arbitrary missing targets", () => {
    let content = createTextNode(draft(), {
      nodeId: "chapter-one-ending",
      body: "The first chapter closes.",
    }).content;

    expect(() =>
      connectSceneContinuation(content, "chapter-one-ending", "chapter-two-opening")
    ).toThrow(/Unknown target node/);

    content = connectSceneContinuation(content, "chapter-one-ending", "chapter-two-opening", {
      allowExternalTarget: true,
    });
    expect(content.graph.nodes[0]).toMatchObject({
      exit: { kind: "auto", nextNodeId: "chapter-two-opening" },
    });

    content = convertSceneExitToChoice(content, "chapter-one-ending", "en-US");
    content = addChoiceOption(content, "chapter-one-ending", "chapter-two-opening", "en-US", {
      label: "Enter Chapter 2",
      allowExternalTarget: true,
    }).content;
    expect(content.graph.nodes[0]).toMatchObject({
      exit: {
        kind: "choice",
        choices: [
          {
            label: { "en-US": "Enter Chapter 2" },
            nextNodeId: "chapter-two-opening",
          },
        ],
      },
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

  it("binds, re-binds and clears a scene's music without leaving the key behind", () => {
    let content = createClipNode(draft(), { nodeId: "opening", clipKey: "OPENING" }).content;
    content = createTextNode(content, { nodeId: "text:reprise", locale: "en-US" }).content;
    const pristine = content;

    content = setNodeMusic(content, "opening", { mediaAssetId: ` ${THEME_ASSET_ID} ` });
    expect(content.graph.nodes[0]).toMatchObject({ music: { mediaAssetId: THEME_ASSET_ID } });

    // The same theme returning on a later scene is legal and normal.
    content = setNodeMusic(content, "text:reprise", { mediaAssetId: THEME_ASSET_ID });
    expect(content.graph.nodes[1]).toMatchObject({ music: { mediaAssetId: THEME_ASSET_ID } });

    // Re-binding the attached track is a no-op; a real change replaces it.
    expect(setNodeMusic(content, "opening", { mediaAssetId: THEME_ASSET_ID })).toBe(content);
    content = setNodeMusic(content, "opening", { mediaAssetId: ECHO_ASSET_ID });
    expect(content.graph.nodes[0]).toMatchObject({ music: { mediaAssetId: ECHO_ASSET_ID } });

    // Clearing removes the key entirely — a story with no music serializes
    // exactly as it did before the field existed.
    content = setNodeMusic(content, "opening", null);
    content = setNodeMusic(content, "text:reprise", null);
    expect(content).toEqual(pristine);
    expect(Object.keys(content.graph.nodes[0]!)).not.toContain("music");
    expect(setNodeMusic(content, "opening", null)).toBe(content);
  });

  it("rejects music bound to an unknown node or an id the server would refuse", () => {
    const content = createClipNode(draft(), { nodeId: "opening", clipKey: "OPENING" }).content;

    expect(() => setNodeMusic(content, "missing", { mediaAssetId: THEME_ASSET_ID })).toThrow(
      /Unknown graph node/
    );
    expect(() => setNodeMusic(content, "opening", { mediaAssetId: "   " })).toThrow(
      /Invalid media asset id/
    );
    // Caught here rather than at save: the server takes a UUID and nothing else,
    // and its rejection names a graph path the creator cannot act on.
    expect(() => setNodeMusic(content, "opening", { mediaAssetId: "theme-a" })).toThrow(
      /Invalid media asset id/
    );
    expect(() =>
      setNodeMusic(content, "opening", { mediaAssetId: THEME_ASSET_ID.slice(0, -1) })
    ).toThrow(/Invalid media asset id/);
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
