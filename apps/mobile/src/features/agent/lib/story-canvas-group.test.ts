import { expect, it } from "vitest";
import * as Y from "yjs";
import { editCanvasGroup } from "../../../../canvas-editor/group-edit";
import { canvasGroups, CANVAS_GROUP_COLORS } from "../../../../canvas-editor/group-schema";
import { encodeCanvasBytes, materializeCanvas } from "../../../../canvas-editor/state";
const groupId = "group-00000000-0000-4000-8000-000000000001";
function fixture() {
  const doc = new Y.Doc();
  for (const [index, id] of ["a", "b", "c", "d", "e"].entries()) {
    const node = new Y.Map<unknown>();
    node.set("id", id);
    node.set("type", "note");
    node.set("data", new Y.Map([["text", id]]));
    node.set(
      "position",
      new Y.Map([
        ["x", index * 100],
        ["y", 20],
      ])
    );
    doc.getMap("nodes").set(id, node);
  }
  const groups = doc.getMap("groups");
  groups.set("first", { id: "first", nodeIds: ["a", "b"], color: "red" });
  groups.set("second", { id: "second", nodeIds: ["c", "d"], color: "blue" });
  doc
    .getMap("edges")
    .set("wire", new Y.Map(Object.entries({ id: "wire", source: "a", target: "b" })));
  doc.getMap("assets").set("asset", { url: "keep" });
  return { doc, groups, state: () => encodeCanvasBytes(Y.encodeStateAsUpdate(doc)) };
}
it("groups an exact selection and dissolves both undersized source groups", () => {
  const { doc, state } = fixture();
  try {
    const before = materializeCanvas(state(), []).snapshot;
    const result = editCanvasGroup(state(), { operation: "create", groupId, nodeIds: ["b", "c"] });
    expect(result.snapshot.groups).toEqual({
      [groupId]: { id: groupId, nodeIds: ["b", "c"], color: "slate" },
    });
    expect(result.snapshot.nodes).toEqual(before.nodes);
    expect(result.snapshot.edges).toEqual(before.edges);
    expect(result.snapshot.assets).toEqual(before.assets);
    expect(
      materializeCanvas(state(), [result.yjsUpdateBase64!, result.yjsUpdateBase64!]).snapshot
    ).toEqual(result.snapshot);
  } finally {
    doc.destroy();
  }
});
it("moves selected members into an existing group without changing its color or order", () => {
  const { doc, state } = fixture();
  try {
    const result = editCanvasGroup(state(), {
      operation: "add",
      groupId: "second",
      nodeIds: ["b", "e", "c"],
    });
    expect(result.snapshot.groups).toEqual({
      second: { id: "second", nodeIds: ["c", "d", "b", "e"], color: "blue" },
    });
    expect(
      editCanvasGroup(result.state, { operation: "add", groupId: "second", nodeIds: ["b", "e"] })
        .yjsUpdateBase64
    ).toBeNull();
  } finally {
    doc.destroy();
  }
});
it("ungroups without deleting nodes, wires or assets", () => {
  const { doc, state } = fixture();
  try {
    const before = materializeCanvas(state(), []).snapshot;
    const result = editCanvasGroup(state(), { operation: "ungroup", groupId: "first" });
    expect(result.snapshot.groups).toEqual({ second: before.groups.second });
    expect(result.snapshot.nodes).toEqual(before.nodes);
    expect(result.snapshot.edges).toEqual(before.edges);
    expect(result.snapshot.assets).toEqual(before.assets);
  } finally {
    doc.destroy();
  }
});
it("removes selected memberships and dissolves single-member remnants", () => {
  const { doc, state } = fixture();
  try {
    const result = editCanvasGroup(state(), { operation: "remove", nodeIds: ["a", "d"] });
    expect(result.snapshot.groups).toEqual({});
    expect(Object.keys(result.snapshot.nodes)).toHaveLength(5);
    expect(
      editCanvasGroup(result.state, { operation: "remove", nodeIds: ["a"] }).yjsUpdateBase64
    ).toBeNull();
  } finally {
    doc.destroy();
  }
});
it.each(CANVAS_GROUP_COLORS)("supports Web group color %s and only changes that group", (color) => {
  const { doc, state } = fixture();
  try {
    const result = editCanvasGroup(state(), { operation: "color", groupId: "first", color });
    expect(result.snapshot.groups.first).toEqual({ id: "first", nodeIds: ["a", "b"], color });
    expect(result.snapshot.groups.second).toEqual({
      id: "second",
      nodeIds: ["c", "d"],
      color: "blue",
    });
    expect(
      editCanvasGroup(result.state, { operation: "color", groupId: "first", color }).yjsUpdateBase64
    ).toBeNull();
  } finally {
    doc.destroy();
  }
});
it("moves every member's position while preserving concurrent content edits", () => {
  const { doc, state } = fixture();
  try {
    const result = editCanvasGroup(state(), {
      operation: "move",
      groupId: "first",
      delta: { x: 48, y: -24 },
    });
    expect(result.snapshot.nodes.a).toHaveProperty("position", { x: 48, y: -4 });
    expect(result.snapshot.nodes.b).toHaveProperty("position", { x: 148, y: -4 });
    expect(result.snapshot.nodes.c).toHaveProperty("position", { x: 200, y: 20 });
    const node = doc.getMap("nodes").get("a") as Y.Map<unknown>;
    (node.get("data") as Y.Map<unknown>).set("text", "Concurrent");
    const merged = materializeCanvas(state(), [result.yjsUpdateBase64!, result.yjsUpdateBase64!]);
    expect(merged.snapshot.nodes.a).toHaveProperty("data.text", "Concurrent");
    expect(merged.snapshot.nodes.a).toHaveProperty("position.x", 48);
    expect(
      editCanvasGroup(merged.state, { operation: "move", groupId: "first", delta: { x: 0, y: 0 } })
        .yjsUpdateBase64
    ).toBeNull();
  } finally {
    doc.destroy();
  }
});
it("merges independent group recoloring and group movement", () => {
  const { doc, state } = fixture();
  try {
    const base = state();
    const color = editCanvasGroup(base, { operation: "color", groupId: "first", color: "pink" });
    const move = editCanvasGroup(base, {
      operation: "move",
      groupId: "first",
      delta: { x: 8, y: 0 },
    });
    expect(materializeCanvas(color.state, [move.yjsUpdateBase64!]).snapshot).toEqual(
      materializeCanvas(move.state, [color.yjsUpdateBase64!]).snapshot
    );
    expect(
      materializeCanvas(color.state, [move.yjsUpdateBase64!]).snapshot.groups.first
    ).toHaveProperty("color", "pink");
  } finally {
    doc.destroy();
  }
});
it("normalizes stale and duplicate membership in Web's sorted group order", () => {
  expect(
    canvasGroups(
      {
        z: { nodeIds: ["a", "b"], color: "blue" },
        a: { nodeIds: ["a", "a", "missing"], color: "red" },
      },
      ["a", "b"]
    )
  ).toEqual([]);
  expect(
    canvasGroups({ legacy: { nodeIds: ["a", 1, "b"], color: "invalid" } }, ["a", "b"])
  ).toEqual([{ id: "legacy", nodeIds: ["a", "b"], color: "slate" }]);
});
it("rejects missing members, ID collisions, duplicate selections and stale groups", () => {
  const { doc, groups, state } = fixture();
  try {
    expect(() =>
      editCanvasGroup(state(), { operation: "create", groupId, nodeIds: ["a", "missing"] })
    ).toThrow("unavailable");
    expect(() =>
      editCanvasGroup(state(), { operation: "create", groupId, nodeIds: ["a", "a"] })
    ).toThrow("once");
    expect(() =>
      editCanvasGroup(state(), { operation: "create", groupId, nodeIds: ["a"] })
    ).toThrow("two");
    groups.set(groupId, { nodeIds: [] });
    expect(() =>
      editCanvasGroup(state(), { operation: "create", groupId, nodeIds: ["a", "b"] })
    ).toThrow("already exists");
    expect(() => editCanvasGroup(state(), { operation: "ungroup", groupId: "gone" })).toThrow(
      "changed"
    );
  } finally {
    doc.destroy();
  }
});
it("validates all move positions before emitting a delta", () => {
  const { doc, state } = fixture();
  try {
    const node = doc.getMap("nodes").get("b") as Y.Map<unknown>;
    node.set("position", { x: 100, y: 20 });
    const before = state();
    expect(() =>
      editCanvasGroup(before, { operation: "move", groupId: "first", delta: { x: 5, y: 0 } })
    ).toThrow("position is invalid");
    expect(state()).toBe(before);
    expect(() =>
      editCanvasGroup(before, { operation: "move", groupId: "first", delta: { x: Infinity, y: 0 } })
    ).toThrow();
  } finally {
    doc.destroy();
  }
});
