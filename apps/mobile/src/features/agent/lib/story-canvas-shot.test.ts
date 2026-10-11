import { expect, it } from "vitest";
import * as Y from "yjs";
import { editCanvasNode } from "../../../../canvas-editor/node-edit";
import { canvasShotValue, type CanvasShotField } from "../../../../canvas-editor/shot-fields";
import { encodeCanvasBytes, materializeCanvas } from "../../../../canvas-editor/state";
const fields: [CanvasShotField, string, string | number][] = [
  ["label", " Name ", "Name"],
  ["shotSize", "medium", "medium"],
  ["perspective", "high", "high"],
  ["movement", "tracking", "tracking"],
  ["durationSeconds", "2,5", 2.5],
  ["dialogue", " First\nSecond ", " First\nSecond "],
  ["notes", "Note", "Note"],
  ["description", "Rain", "Rain"],
  ["imagePrompt", "Still", "Still"],
  ["videoPrompt", "Motion", "Motion"],
];
function seed() {
  const doc = new Y.Doc(),
    node = new Y.Map<unknown>(),
    data = new Y.Map<unknown>();
  node.set("id", "shot");
  node.set("type", "shot");
  node.set("data", data);
  data.set("order", "V");
  data.set("references", { frame: [{ edgeId: "frame", url: "keep" }] });
  data.set("preferredFrameEdgeId", "frame");
  doc.getMap("nodes").set("shot", node);
  return { doc, data, state: () => encodeCanvasBytes(Y.encodeStateAsUpdate(doc)) };
}
it.each(fields)(
  "updates %s without replacing order or picture references",
  (kind, value, expected) => {
    const { doc, state } = seed();
    try {
      const base = state(),
        result = editCanvasNode(base, { nodeId: "shot", kind, value });
      expect(result.snapshot.nodes.shot).toMatchObject({
        data: {
          [kind]: expected,
          order: "V",
          preferredFrameEdgeId: "frame",
          references: { frame: [{ edgeId: "frame", url: "keep" }] },
        },
      });
      expect(materializeCanvas(base, [result.yjsUpdateBase64!]).snapshot).toEqual(result.snapshot);
      expect(
        editCanvasNode(result.state, { nodeId: "shot", kind, value }).yjsUpdateBase64
      ).toBeNull();
      const cleared = editCanvasNode(result.state, { nodeId: "shot", kind, value: "" });
      expect((cleared.snapshot.nodes.shot as { data: unknown }).data).not.toHaveProperty(kind);
    } finally {
      doc.destroy();
    }
  }
);
it("merges concurrent edits to different columns", () => {
  const { doc, data, state } = seed();
  try {
    const mobile = editCanvasNode(state(), { nodeId: "shot", kind: "dialogue", value: "Mobile" });
    data.set("durationSeconds", 10);
    const merged = materializeCanvas(state(), [mobile.yjsUpdateBase64!]);
    expect(merged.snapshot).toEqual(materializeCanvas(mobile.state, [state()]).snapshot);
    expect(merged.snapshot.nodes.shot).toMatchObject({
      data: { dialogue: "Mobile", durationSeconds: 10 },
    });
  } finally {
    doc.destroy();
  }
});
it.each(["0", "-1", "Infinity", "5seconds", "invalid"])(
  "rejects invalid duration %s without silently clearing it",
  (value) => {
    expect(() => canvasShotValue("durationSeconds", value)).toThrow("positive");
  }
);
it("rejects localized option values and edits to non-shot nodes", () => {
  expect(() => canvasShotValue("shotSize", "中景")).toThrow("option");
  const { doc, state } = seed();
  try {
    (doc.getMap("nodes").get("shot") as Y.Map<unknown>).set("type", "prompt");
    expect(() => editCanvasNode(state(), { nodeId: "shot", kind: "notes", value: "No" })).toThrow(
      "does not support"
    );
  } finally {
    doc.destroy();
  }
});
