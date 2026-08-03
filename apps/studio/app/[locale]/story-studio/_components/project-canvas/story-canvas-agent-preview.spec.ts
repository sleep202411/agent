import { describe, expect, it } from "vitest";

import type { StudioAgentCanvasPreviewPart } from "@/lib/studio-agent";

import type { StoryCanvasNode } from "./story-project-canvas-model";
import { projectStoryCanvasAgentPreview } from "./story-canvas-agent-preview";

const authority = {
  chapterId: "chapter-1",
  draftRevision: 7,
  contentHash: "a".repeat(64),
  layoutRevision: 3,
};

const canonicalNode: StoryCanvasNode = {
  id: "intro",
  type: "storyCanvas",
  position: { x: 0, y: 0 },
  data: {
    kind: "clip",
    title: "Intro",
    eyebrow: "",
    nodeId: "intro",
  },
};

function preview(
  operations: StudioAgentCanvasPreviewPart["operations"]
): StudioAgentCanvasPreviewPart {
  return {
    schemaVersion: "story-canvas-preview/v1",
    previewId: "preview-1",
    runId: "run-1",
    toolCallId: "tool-1",
    ...authority,
    baseDraftRevision: authority.draftRevision,
    baseContentHash: authority.contentHash,
    baseLayoutRevision: authority.layoutRevision,
    title: "Proposal",
    summary: "One change",
    operations,
  };
}

describe("projectStoryCanvasAgentPreview", () => {
  it("adds a view-only ghost without mutating canonical nodes", () => {
    const original = structuredClone(canonicalNode);
    const result = projectStoryCanvasAgentPreview({
      preview: preview([
        {
          kind: "story_graph.put_node",
          payload: {
            intent: "create",
            node: {
              kind: "clip",
              nodeId: "new-scene",
              clipKey: "NEW_SCENE",
              name: "新场景",
              exit: { kind: "auto", nextNodeId: null },
            },
          },
        },
      ]),
      authority,
      nodes: [canonicalNode],
      locale: "zh-CN",
    });

    expect(result.applied).toBe(true);
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[1]).toMatchObject({
      id: "new-scene",
      draggable: false,
      selectable: false,
      connectable: false,
      deletable: false,
      data: {
        title: "新场景",
        agentPreview: { previewId: "preview-1", kind: "create" },
      },
    });
    expect(canonicalNode).toEqual(original);
  });

  it("marks replacement and removal proposals without replacing canonical content", () => {
    const result = projectStoryCanvasAgentPreview({
      preview: preview([
        {
          kind: "story_graph.put_node",
          payload: {
            intent: "replace",
            node: {
              kind: "clip",
              nodeId: "intro",
              clipKey: "INTRO",
              name: "Changed",
              exit: { kind: "auto", nextNodeId: null },
            },
          },
        },
        { kind: "story_graph.remove_node", payload: { nodeId: "intro" } },
      ]),
      authority,
      nodes: [canonicalNode],
      locale: "en-US",
    });

    expect(result.nodes[0]?.data.title).toBe("Intro");
    expect(result.nodes[0]?.data.agentPreview).toEqual({
      previewId: "preview-1",
      kind: "remove",
    });
  });

  it("suppresses a stale preview whose authority tuple no longer matches", () => {
    const result = projectStoryCanvasAgentPreview({
      preview: preview([{ kind: "story_graph.remove_node", payload: { nodeId: "intro" } }]),
      authority: { ...authority, draftRevision: authority.draftRevision + 1 },
      nodes: [canonicalNode],
      locale: "en-US",
    });

    expect(result.applied).toBe(false);
    expect(result.nodes).toEqual([canonicalNode]);
    expect(result.nodes[0]?.data.agentPreview).toBeUndefined();
  });

  it("projects character creates into the cast lane", () => {
    const result = projectStoryCanvasAgentPreview({
      preview: preview([
        {
          kind: "story_bible.put_character",
          payload: {
            intent: "create",
            character: {
              id: "hero",
              name: { "en-US": "Hero" },
              summary: "Lead",
            },
          },
        },
      ]),
      authority,
      nodes: [canonicalNode],
      locale: "en-US",
    });

    expect(result.nodes.map((node) => node.id)).toEqual(["intro", "character:hero"]);
    expect(result.nodes.slice(1).every((node) => node.data.agentPreview?.kind === "create")).toBe(
      true
    );
  });
});
