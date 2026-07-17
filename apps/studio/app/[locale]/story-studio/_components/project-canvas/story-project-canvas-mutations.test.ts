import { describe, expect, it } from "vitest";
import type { InteractiveFilmDraftContent } from "@/lib/story-projects-api";
import {
  connectClipContinuation,
  createClipNode,
  deleteGraphNode,
  duplicateClipNode,
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
    content = connectClipContinuation(content, "opening", "second");

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
});

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
    productionNotes: [],
  };
}
