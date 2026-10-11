import { expect, it } from "vitest";
import { deleteRepairNode } from "./story-repair-delete-node";
import type { RepairContent } from "./story-repair-fields";
const target = { kind: "node", nodeId: "remove" };
const ending = (endingId: string) => ({ kind: "ending", endingId });
const clip = (nodeId: string, routes: unknown[] = [{ target: null }]) => ({
  kind: "clip",
  nodeId,
  interactions: [],
  exit: { kind: "auto", routes },
});
it("cleans incoming routes, choices and interaction outcomes without mutating the source", () => {
  const content: RepairContent = {
    storyBible: { logline: "Keep", endings: [{ endingId: "keep" }, { endingId: "unused" }] },
    graph: {
      entryNodeId: "remove",
      nodes: [
        clip("remove", [{ target: ending("unused") }]),
        {
          ...clip("other", [{ when: { kind: "test" }, target }, { target }]),
          interactions: [
            {
              interactionId: "i",
              outcomes: {
                success: { kind: "goto", target },
                failure: { kind: "goto", target },
                timeout: { kind: "goto", target: ending("keep") },
              },
            },
          ],
        },
        {
          kind: "decision",
          nodeId: "choice",
          exit: {
            kind: "choice",
            choices: [
              {
                choiceId: "c",
                label: { "en-US": "Go" },
                target,
                effects: [{ op: "add", key: "score", value: 1 }],
              },
            ],
          },
        },
      ],
    },
  };
  const before = JSON.stringify(content);
  const next = deleteRepairNode(content, "remove");
  expect(next.graph.entryNodeId).toBeNull();
  expect(next.graph.nodes).toHaveLength(2);
  expect(next.graph.nodes[0].exit).toEqual({ kind: "auto", routes: [{ target: null }] });
  expect(next.graph.nodes[0].interactions).toEqual([
    {
      interactionId: "i",
      outcomes: {
        success: { kind: "continue" },
        timeout: { kind: "goto", target: ending("keep") },
      },
    },
  ]);
  expect(next.graph.nodes[1].exit).toMatchObject({
    choices: [{ choiceId: "c", target: null, effects: [{ op: "add", key: "score", value: 1 }] }],
  });
  expect(next.storyBible).toEqual({ logline: "Keep", endings: [{ endingId: "keep" }] });
  expect(JSON.stringify(content)).toBe(before);
});
it("materializes attached choices with collision-safe IDs and preserves their copy", () => {
  const exit = {
    kind: "choice",
    decisionId: "d",
    prompt: { "en-US": "Choose" },
    choices: [{ target: null }],
  };
  const content: RepairContent = {
    storyBible: {},
    graph: {
      entryNodeId: "keep",
      nodes: [{ ...clip("remove"), exit }, clip("decision:remove"), clip("keep")],
    },
  };
  const next = deleteRepairNode(content, "remove");
  expect(next.graph.entryNodeId).toBe("keep");
  expect(next.graph.nodes.find((n) => n.nodeId === "decision:remove-2")).toEqual({
    kind: "decision",
    nodeId: "decision:remove-2",
    exit,
  });
});
it("rejects missing nodes and unreadable graph data before changing anything", () => {
  const content: RepairContent = {
    storyBible: {},
    graph: { entryNodeId: null, nodes: [clip("remove"), { nodeId: "bad" }] },
  };
  expect(() => deleteRepairNode(content, "missing")).toThrow("no longer available");
  expect(() => deleteRepairNode(content, "remove")).toThrow("unreadable");
  expect(content.graph.nodes).toHaveLength(2);
});
