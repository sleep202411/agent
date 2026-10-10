import { expect, it } from "vitest";
import * as Y from "yjs";
import { editCanvasNode } from "../../../../canvas-editor/node-edit";
import { removeCanvasNode } from "../../../../canvas-editor/node-remove";
import { encodeCanvasBytes, materializeCanvas } from "../../../../canvas-editor/state";

function seed() {
  const doc = new Y.Doc();
  const data = new Map<string, Y.Map<unknown>>();
  for (const id of ["a", "b", "c", "d"]) {
    const fields = new Y.Map<unknown>();
    fields.set("prompt", id);
    data.set(id, fields);
    const node = new Y.Map<unknown>();
    node.set("id", id);
    node.set("type", "prompt");
    node.set("data", fields);
    doc.getMap("nodes").set(id, node);
  }
  for (const [id, source, target] of [
    ["ab", "a", "b"],
    ["ab2", "a", "b"],
    ["ca", "c", "a"],
    ["cd", "c", "d"],
  ]) {
    doc.getMap("edges").set(id, new Y.Map(Object.entries({ id, source, target })));
  }
  data.get("b")!.set("references", {
    images: [{ edgeId: "ab", url: "old" }, { edgeId: "ab2", url: "old2" }, { url: "manual" }],
    video: [{ edgeId: "cd", url: "other" }],
  });
  doc.getMap("groups").set("g1", { id: "g1", nodeIds: ["a", "b", "c"], color: "cyan" });
  doc.getMap("assets").set("asset", { id: "asset", kind: "image", url: "kept" });
  return { doc, data, state: () => encodeCanvasBytes(Y.encodeStateAsUpdate(doc)) };
}
it("removes incoming/outgoing wires and only their references, retaining reusable media", () => {
  const { doc, state } = seed();
  try {
    const base = state(),
      result = editCanvasNode(base, { nodeId: "a", kind: "remove", value: "" });
    expect(Object.keys(result.snapshot.nodes)).toEqual(["b", "c", "d"]);
    expect(Object.keys(result.snapshot.edges)).toEqual(["cd"]);
    expect(result.snapshot.nodes.b).toMatchObject({
      data: {
        prompt: "b",
        references: {
          images: [{ url: "manual" }],
          video: [{ edgeId: "cd", url: "other" }],
        },
      },
    });
    expect(result.snapshot.assets.asset).toEqual({ id: "asset", kind: "image", url: "kept" });
    expect(result.snapshot.groups.g1).toEqual({ id: "g1", nodeIds: ["b", "c"], color: "cyan" });
    expect(materializeCanvas(base, [result.yjsUpdateBase64!]).snapshot).toEqual(result.snapshot);
    expect(
      materializeCanvas(base, [result.yjsUpdateBase64!, result.yjsUpdateBase64!]).snapshot
    ).toEqual(result.snapshot);
  } finally {
    doc.destroy();
  }
});
it("dissolves small groups and reconciles stale/duplicate memberships in Web id order", () => {
  const { doc, state } = seed();
  try {
    doc.getMap("groups").set("g1", { id: "g1", nodeIds: ["a", "b", "b", "missing"], color: "red" });
    doc.getMap("groups").set("g2", { id: "g2", nodeIds: ["b", "c", "d"], color: "invalid" });
    const result = removeCanvasNode(state(), "a");
    expect(result.snapshot.groups).toEqual({
      g2: { id: "g2", nodeIds: ["c", "d"], color: "slate" },
    });
  } finally {
    doc.destroy();
  }
});
it("preserves concurrent edits to unrelated fields and converges on replay", () => {
  const { doc, data, state } = seed();
  try {
    const removed = removeCanvasNode(state(), "a");
    data.get("b")!.set("prompt", "Web edit");
    data.get("d")!.set("settings", { ratio: "16:9" });
    const merged = materializeCanvas(state(), [removed.yjsUpdateBase64!]);
    expect(merged.snapshot).toEqual(materializeCanvas(removed.state, [state()]).snapshot);
    expect(merged.snapshot.nodes.b).toMatchObject({ data: { prompt: "Web edit" } });
    expect(merged.snapshot.nodes.d).toMatchObject({ data: { settings: { ratio: "16:9" } } });
  } finally {
    doc.destroy();
  }
});
it("does not accept a missing node as proof of a successful previous deletion", () => {
  const { doc, state } = seed();
  try {
    expect(() => removeCanvasNode(state(), "missing")).toThrow("unavailable");
  } finally {
    doc.destroy();
  }
});
it.each(["bad-reference", "bad-edge", "bad-target"])(
  "rejects %s without changing the source document",
  (kind) => {
    const { doc, data, state } = seed();
    try {
      if (kind === "bad-reference") data.get("b")!.set("references", { images: "invalid" });
      if (kind === "bad-edge")
        doc.getMap("edges").set("ab", { id: "ab", source: "a", target: "b" });
      if (kind === "bad-target") doc.getMap("nodes").set("b", { id: "b" });
      const original = state();
      expect(() => removeCanvasNode(original, "a")).toThrow();
      expect(state()).toBe(original);
    } finally {
      doc.destroy();
    }
  }
);
it("removes a wire to a previously deleted target without inventing the target", () => {
  const { doc, state } = seed();
  try {
    doc.getMap("nodes").delete("b");
    const result = removeCanvasNode(state(), "a");
    expect(result.snapshot.nodes).not.toHaveProperty("b");
    expect(Object.keys(result.snapshot.edges)).toEqual(["cd"]);
  } finally {
    doc.destroy();
  }
});
