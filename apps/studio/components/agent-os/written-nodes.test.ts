import { describe, expect, it } from "vitest";

import { writtenNodesFromResult } from "./written-nodes";

/**
 * The links come from the tool RESULT, never from the assistant's prose: the
 * model may summarise a write any way it likes, but where the write landed is
 * a fact the server reported.
 */
describe("writtenNodesFromResult", () => {
  it("links each shot a storyboard write touched, by its canvas node", () => {
    const nodes = writtenNodesFromResult("storyboard.upsertShots", {
      revision: 12,
      written: [
        { id: "s1", title: "开场", nodeId: "agent-os:shot:s1" },
        { id: "7f3a", title: "人类建的", nodeId: "7f3a" },
      ],
    });
    expect(nodes).toEqual([
      { nodeId: "agent-os:shot:s1", label: "开场" },
      { nodeId: "7f3a", label: "人类建的" },
    ]);
  });

  it("skips rows the server could not place on the canvas", () => {
    const nodes = writtenNodesFromResult("storyboard.upsertShots", {
      written: [{ id: "s1", title: "无节点" }],
    });
    expect(nodes).toEqual([]);
  });

  it("links the nodes a canvas patch created or changed", () => {
    const nodes = writtenNodesFromResult("canvas.applyPatch", {
      appliedOperationIds: ["op-1"],
      nodeIds: ["agent-os:shot:test-shot-fireworks-001"],
    });
    // The namespace prefix is ours, not something the user typed.
    expect(nodes).toEqual([
      {
        nodeId: "agent-os:shot:test-shot-fireworks-001",
        label: "test-shot-fireworks-001",
      },
    ]);
  });

  it("offers nothing for reads and for tools with no canvas result", () => {
    expect(writtenNodesFromResult("storyboard.listShots", { shots: [] })).toEqual([]);
    expect(writtenNodesFromResult("characters.upsert", { written: [] })).toEqual([]);
    expect(writtenNodesFromResult("canvas.applyPatch", null)).toEqual([]);
    expect(writtenNodesFromResult("canvas.applyPatch", undefined)).toEqual([]);
  });
});
