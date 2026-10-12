import { expect, it } from "vitest";
import * as Y from "yjs";
import { materializeCanvas } from "../../../../canvas-editor/state";
import { CANVAS_ROOTS } from "../../../../canvas-editor/schema";

const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const state = (doc: Y.Doc) => encode(Y.encodeStateAsUpdate(doc));
function fresh() {
  const doc = new Y.Doc();
  for (const root of CANVAS_ROOTS) doc.getMap(root);
  return doc;
}
function node(doc: Y.Doc) {
  const value = new Y.Map();
  value.set("id", "node-1");
  value.set("type", "image");
  value.set(
    "position",
    new Y.Map([
      ["x", 20],
      ["y", 30],
    ])
  );
  value.set(
    "data",
    new Y.Map<string | object>([
      ["prompt", "Original"],
      ["settings", { ratio: "16:9" }],
    ])
  );
  doc.getMap("nodes").set("node-1", value);
  return value;
}
it("materializes the Web nested-map schema and every collection", () => {
  const web = fresh();
  try {
    node(web);
    web.getMap("meta").set("title", "Project");
    web.getMap("edges").set(
      "edge-1",
      new Y.Map([
        ["source", "node-1"],
        ["target", "node-2"],
      ])
    );
    web.getMap("groups").set("group-1", { id: "group-1", nodeIds: ["node-1"], color: "red" });
    web
      .getMap("assets")
      .set("asset-1", { id: "asset-1", kind: "image", url: "https://example.com/image" });
    const result = materializeCanvas(state(web), []);
    expect(result.snapshot).toEqual(web.toJSON());
    expect(materializeCanvas(result.state, []).snapshot).toEqual(result.snapshot);
  } finally {
    web.destroy();
  }
});
it("replays edits and deletions after the snapshot instead of returning stale media", () => {
  const web = fresh();
  try {
    node(web);
    web.getMap("assets").set("old", { id: "old" });
    const base = state(web),
      updates: string[] = [];
    web.on("update", (bytes: Uint8Array) => updates.push(encode(bytes)));
    web.getMap("assets").delete("old");
    web.getMap("assets").set("new", { id: "new", kind: "video" });
    const data = (web.getMap("nodes").get("node-1") as Y.Map<unknown>).get(
      "data"
    ) as Y.Map<unknown>;
    data.set("prompt", "Updated");
    expect(materializeCanvas(base, updates).snapshot).toEqual(web.toJSON());
    expect(materializeCanvas(base, updates).snapshot.assets).not.toHaveProperty("old");
  } finally {
    web.destroy();
  }
});
it("converges concurrent field edits and tolerates duplicate updates", () => {
  const web = fresh(),
    mobile = fresh();
  try {
    node(web);
    Y.applyUpdate(mobile, Y.encodeStateAsUpdate(web));
    const base = state(web),
      updates: string[] = [];
    for (const doc of [web, mobile])
      doc.on("update", (bytes: Uint8Array) => updates.push(encode(bytes)));
    const webNode = web.getMap("nodes").get("node-1") as Y.Map<unknown>;
    const mobileNode = mobile.getMap("nodes").get("node-1") as Y.Map<unknown>;
    (webNode.get("data") as Y.Map<unknown>).set("prompt", "Web edit");
    (mobileNode.get("position") as Y.Map<unknown>).set("x", 400);
    const result = materializeCanvas(base, updates);
    expect(materializeCanvas(base, [...updates].reverse()).snapshot).toEqual(result.snapshot);
    expect(materializeCanvas(base, [...updates, ...updates]).snapshot).toEqual(result.snapshot);
    expect(result.snapshot.nodes["node-1"]).toMatchObject({
      data: { prompt: "Web edit" },
      position: { x: 400 },
    });
  } finally {
    web.destroy();
    mobile.destroy();
  }
});
it("rejects valid update bytes whose required earlier structs are missing", () => {
  const web = fresh(),
    empty = fresh();
  try {
    const value = node(web),
      updates: string[] = [];
    web.on("update", (bytes: Uint8Array) => updates.push(encode(bytes)));
    (value.get("data") as Y.Map<unknown>).set("prompt", "Depends on missing node");
    expect(() => materializeCanvas(state(empty), updates)).toThrow("history is incomplete");
  } finally {
    web.destroy();
    empty.destroy();
  }
});
it("rejects deletions whose original structs are missing", () => {
  const web = fresh(),
    empty = fresh();
  try {
    node(web);
    const updates: string[] = [];
    web.on("update", (bytes: Uint8Array) => updates.push(encode(bytes)));
    web.getMap("nodes").delete("node-1");
    expect(() => materializeCanvas(state(empty), updates)).toThrow("history is incomplete");
  } finally {
    web.destroy();
    empty.destroy();
  }
});
it.each(["", "%%%%", "////"])("rejects invalid binary state %s", (bad) => {
  const doc = fresh();
  try {
    expect(() => materializeCanvas(bad, [])).toThrow();
    expect(() => materializeCanvas(state(doc), [bad])).toThrow();
  } finally {
    doc.destroy();
  }
});
it("returned JSON is detached and cannot alter a reconstructed document", () => {
  const doc = fresh();
  try {
    doc.getMap("assets").set("asset", { tags: ["original"] });
    const result = materializeCanvas(state(doc), []);
    (result.snapshot.assets.asset as { tags: string[] }).tags.push("changed");
    expect(materializeCanvas(result.state, []).snapshot.assets.asset).toEqual({
      tags: ["original"],
    });
  } finally {
    doc.destroy();
  }
});
