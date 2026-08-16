import { describe, expect, it } from "vitest";
import type { InteractiveStoryDraftContent } from "@/lib/story-projects-api";
import { removeWorldExperienceNodes } from "./story-world-feature-policy";

describe("world experience feature policy", () => {
  it("removes world nodes and preserves clip continuations", () => {
    const content = draft();
    const normalized = removeWorldExperienceNodes(content);

    expect(normalized.graph.entryNodeId).toBe("clip:a");
    expect(normalized.graph.nodes.map((node) => node.nodeId)).toEqual(["clip:a", "clip:b"]);
    expect(normalized.graph.nodes[0]?.exit).toEqual({
      kind: "auto",
      nextNodeId: "clip:b",
    });
  });

  it("rewrites hotspot and choice targets through chained world nodes", () => {
    const content = draft();
    const source = content.graph.nodes[0];
    if (!source || source.kind !== "clip") throw new Error("Expected clip fixture.");
    source.interactions = [
      {
        kind: "hotspot",
        interactionId: "branch",
        label: { "en-US": "Branch" },
        trigger: { kind: "tap" },
        rect: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
        startMs: 0,
        endMs: 1_000,
        outcomes: { success: { kind: "goto", nodeId: "world:a" } },
      },
    ];
    source.exit = {
      kind: "choice",
      decisionId: "choice:a",
      prompt: { "en-US": "Continue?" },
      choices: [{ choiceId: "yes", label: { "en-US": "Yes" }, nextNodeId: "world:a" }],
    };

    const normalized = removeWorldExperienceNodes(content);
    const normalizedSource = normalized.graph.nodes[0];
    if (!normalizedSource || normalizedSource.kind !== "clip") {
      throw new Error("Expected normalized clip.");
    }

    expect(normalizedSource.interactions[0]?.outcomes.success).toEqual({
      kind: "goto",
      nodeId: "clip:b",
    });
    expect(normalizedSource.exit).toMatchObject({
      kind: "choice",
      choices: [{ nextNodeId: "clip:b" }],
    });
  });

  it("returns the original draft when it contains no world nodes", () => {
    const content = draft();
    content.graph.nodes = content.graph.nodes.filter((node) => node.kind === "clip");
    const source = content.graph.nodes[0];
    if (source?.kind === "clip") source.exit = { kind: "auto", nextNodeId: "clip:b" };

    expect(removeWorldExperienceNodes(content)).toBe(content);
  });
});

function draft(): InteractiveStoryDraftContent {
  return {
    storyBible: { logline: "", synopsis: "", characters: [] },
    graph: {
      entryNodeId: "clip:a",
      nodes: [
        {
          kind: "clip",
          nodeId: "clip:a",
          clipKey: "A",
          interactions: [],
          exit: { kind: "auto", nextNodeId: "world:a" },
        },
        {
          kind: "world",
          nodeId: "world:a",
          worldId: null,
          maxExperienceSeconds: 60,
          exit: { kind: "auto", nextNodeId: "world:b" },
        },
        {
          kind: "world",
          nodeId: "world:b",
          worldId: null,
          maxExperienceSeconds: 60,
          exit: { kind: "auto", nextNodeId: "clip:b" },
        },
        {
          kind: "clip",
          nodeId: "clip:b",
          clipKey: "B",
          interactions: [],
          exit: { kind: "auto", nextNodeId: null },
        },
      ],
    },
    productionNotes: [],
  };
}
