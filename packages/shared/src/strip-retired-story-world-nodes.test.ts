import { describe, expect, it } from "vitest";
import { stripRetiredStoryWorldNodes } from "./strip-retired-story-world-nodes";

describe("stripRetiredStoryWorldNodes", () => {
  it("removes world nodes and preserves clip continuations", () => {
    const normalized = stripRetiredStoryWorldNodes(draft());

    expect(normalized.graph.entryNodeId).toBe("clip:a");
    expect(normalized.graph.nodes.map((node) => node.nodeId)).toEqual(["clip:a", "clip:b"]);
    expect(normalized.graph.nodes[0]?.exit).toEqual({
      kind: "auto",
      routes: [{ target: { kind: "node", nodeId: "clip:b" } }],
    });
  });

  it("rewrites hotspot and choice targets through chained world nodes", () => {
    const content = draft();
    const source = content.graph.nodes[0];
    if (!source || source.kind !== "clip") throw new Error("Expected clip fixture.");
    source.interactions = [
      {
        outcomes: { success: { kind: "goto", target: { kind: "node", nodeId: "world:a" } } },
      },
    ];
    source.exit = {
      kind: "choice",
      choices: [{ target: { kind: "node", nodeId: "world:a" } }],
    };

    const normalized = stripRetiredStoryWorldNodes(content);
    const normalizedSource = normalized.graph.nodes[0];
    if (!normalizedSource || normalizedSource.kind !== "clip") {
      throw new Error("Expected normalized clip.");
    }

    expect(normalizedSource.interactions?.[0]?.outcomes.success).toEqual({
      kind: "goto",
      target: { kind: "node", nodeId: "clip:b" },
    });
    expect(normalizedSource.exit).toMatchObject({
      kind: "choice",
      choices: [{ target: { kind: "node", nodeId: "clip:b" } }],
    });
  });

  it("returns the original draft when it contains no world nodes", () => {
    const content = draft();
    content.graph.nodes = content.graph.nodes.filter((node) => node.kind === "clip");
    const source = content.graph.nodes[0];
    if (source?.kind === "clip") {
      source.exit = {
        kind: "auto",
        routes: [{ target: { kind: "node", nodeId: "clip:b" } }],
      };
    }

    expect(stripRetiredStoryWorldNodes(content)).toBe(content);
  });
});

function draft() {
  return {
    graph: {
      entryNodeId: "clip:a" as string | null,
      nodes: [
        {
          kind: "clip",
          nodeId: "clip:a",
          interactions: [] as Array<{
            outcomes: {
              success: { kind: string; target?: { kind: string; nodeId: string } | null };
            };
          }>,
          exit: {
            kind: "auto",
            routes: [
              {
                target: { kind: "node", nodeId: "world:a" } as {
                  kind: string;
                  nodeId: string;
                } | null,
              },
            ],
            choices: undefined as
              | Array<{ target: { kind: string; nodeId: string } | null }>
              | undefined,
          },
        },
        {
          kind: "world",
          nodeId: "world:a",
          exit: {
            kind: "auto",
            routes: [{ target: { kind: "node", nodeId: "world:b" } }],
          },
        },
        {
          kind: "world",
          nodeId: "world:b",
          exit: {
            kind: "auto",
            routes: [{ target: { kind: "node", nodeId: "clip:b" } }],
          },
        },
        {
          kind: "clip",
          nodeId: "clip:b",
          interactions: [],
          exit: { kind: "auto", routes: [{ target: null }] },
        },
      ],
    },
  };
}
