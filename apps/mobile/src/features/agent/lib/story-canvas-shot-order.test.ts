import { expect, it } from "vitest";
import * as Y from "yjs";
import { compareByOrder } from "@repo/shared";
import { moveCanvasShot } from "../../../../canvas-editor/shot-order";
import { encodeCanvasBytes, materializeCanvas } from "../../../../canvas-editor/state";

function fixture() {
  const doc = new Y.Doc();
  for (const [id, order] of [
    ["a", "F"],
    ["b", "V"],
    ["c", "k"],
    ["d", "s"],
  ]) {
    const node = new Y.Map<unknown>();
    node.set("id", id);
    node.set("type", "shot");
    node.set(
      "data",
      new Y.Map<unknown>(
        Object.entries({
          order,
          dialogue: id,
          references: { frame: [{ edgeId: `frame-${id}`, url: "keep" }] },
        })
      )
    );
    doc.getMap("nodes").set(id, node);
  }
  return { doc, state: () => encodeCanvasBytes(Y.encodeStateAsUpdate(doc)) };
}
function ids(snapshot: ReturnType<typeof materializeCanvas>["snapshot"]) {
  return Object.entries(snapshot.nodes)
    .map(([id, node]) => ({ id, order: (node as { data: { order: string } }).data.order }))
    .sort(compareByOrder)
    .map((n) => n.id);
}
it.each([
  ["d", 0, ["d", "a", "b", "c"]],
  ["a", 3, ["b", "c", "d", "a"]],
  ["a", 2, ["b", "c", "a", "d"]],
  ["d", 1, ["a", "d", "b", "c"]],
  ["b", 99, ["a", "c", "d", "b"]],
] as const)("moves %s to index %s without renumbering neighbors", (nodeId, index, expected) => {
  const { doc, state } = fixture();
  try {
    const base = state(),
      original = materializeCanvas(base, []).snapshot;
    const result = moveCanvasShot(base, { nodeId, index });
    expect(ids(result.snapshot)).toEqual(expected);
    expect(materializeCanvas(base, [result.yjsUpdateBase64!]).snapshot).toEqual(result.snapshot);
    for (const id of ["a", "b", "c", "d"]) {
      if (id !== nodeId) expect(result.snapshot.nodes[id]).toEqual(original.nodes[id]);
      else
        expect(result.snapshot.nodes[id]).toMatchObject({
          data: { dialogue: id, references: { frame: [{ edgeId: `frame-${id}`, url: "keep" }] } },
        });
    }
    expect(moveCanvasShot(result.state, { nodeId, index }).yjsUpdateBase64).toBeNull();
  } finally {
    doc.destroy();
  }
});
it("converges with concurrent dialogue and another shot move", () => {
  const { doc, state } = fixture();
  try {
    const base = state();
    const first = moveCanvasShot(base, { nodeId: "d", index: 0 });
    const second = moveCanvasShot(base, { nodeId: "a", index: 3 });
    const node = doc.getMap("nodes").get("d") as Y.Map<unknown>;
    (node.get("data") as Y.Map<unknown>).set("dialogue", "Web dialogue");
    const merged = materializeCanvas(state(), [first.yjsUpdateBase64!, second.yjsUpdateBase64!]);
    expect(merged.snapshot).toEqual(
      materializeCanvas(second.state, [state(), first.yjsUpdateBase64!]).snapshot
    );
    expect(ids(merged.snapshot)).toEqual(["d", "b", "c", "a"]);
    expect(merged.snapshot.nodes.d).toMatchObject({ data: { dialogue: "Web dialogue" } });
    expect(materializeCanvas(merged.state, [first.yjsUpdateBase64!]).snapshot).toEqual(
      merged.snapshot
    );
  } finally {
    doc.destroy();
  }
});
it("rejects missing shots and invalid destinations", () => {
  const { doc, state } = fixture();
  try {
    expect(() => moveCanvasShot(state(), { nodeId: "missing", index: 0 })).toThrow("unavailable");
    for (const index of [-1, 0.5, Infinity, NaN])
      expect(() => moveCanvasShot(state(), { nodeId: "a", index })).toThrow();
  } finally {
    doc.destroy();
  }
});
it("uses Web's stable ID tie-break and degenerate-key fallback", () => {
  const { doc, state } = fixture();
  try {
    for (const id of ["a", "b"]) {
      const node = doc.getMap("nodes").get(id) as Y.Map<unknown>;
      (node.get("data") as Y.Map<unknown>).set("order", "V");
    }
    // Equal neighbors use the shared mint's append-after-lower fallback.
    const result = moveCanvasShot(state(), { nodeId: "d", index: 1 });
    expect(ids(result.snapshot)).toEqual(["a", "b", "c", "d"]);
    expect(result.snapshot.nodes.d).toMatchObject({ data: { order: "l" } });
    const selected = doc.getMap("nodes").get("c") as Y.Map<unknown>;
    (selected.get("data") as Y.Map<unknown>).delete("order");
    expect(ids(moveCanvasShot(state(), { nodeId: "c", index: 0 }).snapshot)).toEqual([
      "c",
      "a",
      "b",
      "d",
    ]);
  } finally {
    doc.destroy();
  }
});
it("rejects malformed shot data without producing an update", () => {
  const { doc, state } = fixture();
  try {
    const selected = doc.getMap("nodes").get("c") as Y.Map<unknown>;
    (selected.get("data") as Y.Map<unknown>).set("order", 3);
    expect(() => moveCanvasShot(state(), { nodeId: "a", index: 2 })).toThrow("order is invalid");
    selected.set("data", {});
    expect(() => moveCanvasShot(state(), { nodeId: "a", index: 2 })).toThrow("data is invalid");
  } finally {
    doc.destroy();
  }
});
