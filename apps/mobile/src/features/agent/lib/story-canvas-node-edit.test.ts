import { expect, it } from "vitest";
import * as Y from "yjs";
import { editCanvasNode } from "../../../../canvas-editor/node-edit";
import { materializeCanvas, encodeCanvasBytes } from "../../../../canvas-editor/state";
function seed(type = "prompt") {
  const doc = new Y.Doc(),
    node = new Y.Map(),
    data = new Y.Map();
  node.set("id", "n");
  node.set("type", type);
  node.set("data", data);
  node.set(
    "position",
    new Y.Map([
      ["x", 40],
      ["y", 50],
    ])
  );
  data.set("prompt", "Original");
  data.set("settings", { model: "model", ratio: "16:9" });
  doc.getMap("nodes").set("n", node);
  return { doc, data, state: () => encodeCanvasBytes(Y.encodeStateAsUpdate(doc)) };
}
it("edits note text without trimming or changing other fields", () => {
  const { doc, data, state } = seed("note");
  try {
    data.set("text", "Original note");
    const next = editCanvasNode(state(), {
      nodeId: "n",
      kind: "text",
      value: "  第一行\nSecond line  ",
    });
    expect(next.snapshot.nodes.n).toMatchObject({
      data: { text: "  第一行\nSecond line  ", settings: { model: "model", ratio: "16:9" } },
    });
    expect(
      editCanvasNode(next.state, { nodeId: "n", kind: "text", value: "  第一行\nSecond line  " })
        .yjsUpdateBase64
    ).toBeNull();
    expect(() =>
      editCanvasNode(next.state, { nodeId: "n", kind: "rename", value: "Unsupported" })
    ).toThrow();
  } finally {
    doc.destroy();
  }
});
it.each(["prompt", "video", "audio"])(
  "renames %s generation cards in the Web name field",
  (type) => {
    const { doc, state } = seed(type);
    try {
      const edited = editCanvasNode(state(), { nodeId: "n", kind: "rename", value: "  Scene  " });
      const node = edited.snapshot.nodes.n as { data: Record<string, unknown>; position: unknown };
      expect(node.data).toEqual({
        prompt: "Original",
        settings: { model: "model", ratio: "16:9" },
        name: "Scene",
      });
      expect(node.position).toEqual({ x: 40, y: 50 });
      expect(materializeCanvas(state(), [edited.yjsUpdateBase64!]).snapshot).toEqual(
        edited.snapshot
      );
    } finally {
      doc.destroy();
    }
  }
);
it.each(["image", "videoAsset", "audioAsset"])(
  "renames %s and matching assets without changing unrelated metadata",
  (type) => {
    const { doc, data, state } = seed(type);
    try {
      data.set("mediaAssetId", "media");
      doc
        .getMap("assets")
        .set("a", { id: "a", mediaAssetId: "media", name: "Old", kind: "image", url: "media-url" });
      doc.getMap("assets").set("b", { id: "media", name: "Legacy", kind: "image" });
      doc.getMap("assets").set("c", { id: "other", name: "Keep" });
      const result = editCanvasNode(state(), { nodeId: "n", kind: "rename", value: " New " });
      expect(result.snapshot.assets.a).toEqual({
        id: "a",
        mediaAssetId: "media",
        name: "New",
        kind: "image",
        url: "media-url",
      });
      expect(result.snapshot.assets.b).toMatchObject({ name: "New" });
      expect(result.snapshot.assets.c).toEqual({ id: "other", name: "Keep" });
      const cleared = editCanvasNode(result.state, { nodeId: "n", kind: "rename", value: " " });
      expect(cleared.snapshot.assets.a).not.toHaveProperty("name");
    } finally {
      doc.destroy();
    }
  }
);
it("preserves a concurrent Web position change while editing the prompt", () => {
  const { doc, state } = seed();
  try {
    const base = state();
    const mobile = editCanvasNode(base, { nodeId: "n", kind: "prompt", value: "Mobile prompt" });
    const node = doc.getMap("nodes").get("n") as Y.Map<unknown>;
    (node.get("position") as Y.Map<unknown>).set("x", 900);
    const a = materializeCanvas(state(), [mobile.yjsUpdateBase64!]);
    const b = materializeCanvas(mobile.state, [state()]);
    expect(a.snapshot).toEqual(b.snapshot);
    expect(a.snapshot.nodes.n).toMatchObject({
      position: { x: 900 },
      data: { prompt: "Mobile prompt" },
    });
  } finally {
    doc.destroy();
  }
});
it("does not generate a new operation when the field is unchanged", () => {
  const { doc, state } = seed();
  try {
    expect(
      editCanvasNode(state(), { nodeId: "n", kind: "prompt", value: "Original" }).yjsUpdateBase64
    ).toBeNull();
  } finally {
    doc.destroy();
  }
});
it("rejects missing nodes, unsupported types, and locked prompts", () => {
  const { doc, data, state } = seed();
  try {
    expect(() =>
      editCanvasNode(state(), { nodeId: "missing", kind: "rename", value: "x" })
    ).toThrow("unavailable");
    data.set("locked", true);
    expect(() => editCanvasNode(state(), { nodeId: "n", kind: "prompt", value: "x" })).toThrow(
      "does not support"
    );
    (doc.getMap("nodes").get("n") as Y.Map<unknown>).set("type", "unknown");
    expect(() => editCanvasNode(state(), { nodeId: "n", kind: "rename", value: "x" })).toThrow(
      "does not support"
    );
  } finally {
    doc.destroy();
  }
});
