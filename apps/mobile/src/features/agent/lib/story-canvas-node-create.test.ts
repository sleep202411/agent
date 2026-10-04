import { expect, it } from "vitest";
import * as Y from "yjs";
import { compareByOrder } from "@repo/shared";
import { createCanvasNode } from "../../../../canvas-editor/node-create";
import { encodeCanvasBytes, materializeCanvas } from "../../../../canvas-editor/state";
const id = "00000000-0000-4000-8000-000000000001";
const second = "00000000-0000-4000-8000-000000000002";
const position = { x: 120, y: -40 };
const empty = () => {
  const doc = new Y.Doc();
  try {
    return encodeCanvasBytes(Y.encodeStateAsUpdate(doc));
  } finally {
    doc.destroy();
  }
};
it.each(["prompt", "video", "audio"] as const)(
  "creates a Web-editable %s generation card",
  (type) => {
    const state = empty(),
      data = {
        name: "Scene",
        prompt: "Rain",
        modelId: "model",
        modelName: "Model",
        mode: "text_to_image",
        settings: { ratio: "16:9", seed: 42 },
      };
    const created = createCanvasNode(state, { nodeId: id, type, position, data });
    expect(created.snapshot.nodes[id]).toEqual({
      id,
      type,
      position,
      data: { ...data, references: {} },
    });
    expect(
      materializeCanvas(state, [created.yjsUpdateBase64!, created.yjsUpdateBase64!]).snapshot
    ).toEqual(created.snapshot);
    const web = new Y.Doc();
    try {
      Y.applyUpdate(
        web,
        Uint8Array.from(atob(created.state), (c) => c.charCodeAt(0))
      );
      const node = web.getMap("nodes").get(id) as Y.Map<unknown>;
      expect(node).toBeInstanceOf(Y.Map);
      expect(node.get("position")).toBeInstanceOf(Y.Map);
      const fields = node.get("data") as Y.Map<unknown>;
      fields.set("prompt", "Edited on Web");
      expect(fields.get("settings")).toEqual(data.settings);
    } finally {
      web.destroy();
    }
  }
);
it("preserves note text and never replaces an existing ID", () => {
  const command = {
    nodeId: id,
    type: "note" as const,
    position,
    data: { text: "第一行\nSecond line" },
  };
  const created = createCanvasNode(empty(), command);
  expect(created.snapshot.nodes[id]).toEqual({ id, type: "note", position, data: command.data });
  expect(() => createCanvasNode(created.state, command)).toThrow("already exists");
});
it("appends shots using shared fractional keys without renumbering existing shots", () => {
  const first = createCanvasNode(empty(), { nodeId: id, type: "shot", position });
  const next = createCanvasNode(first.state, { nodeId: second, type: "shot", position });
  const old = first.snapshot.nodes[id] as { data: { order: string } };
  const added = next.snapshot.nodes[second] as { data: { order: string } };
  expect(next.snapshot.nodes[id]).toEqual(first.snapshot.nodes[id]);
  expect(
    compareByOrder({ id, order: old.data.order }, { id: second, order: added.data.order })
  ).toBeLessThan(0);
});
it("concurrent creates converge and keep both nodes", () => {
  const state = empty();
  const a = createCanvasNode(state, { nodeId: id, type: "shot", position });
  const b = createCanvasNode(state, { nodeId: second, type: "shot", position });
  const left = materializeCanvas(a.state, [b.yjsUpdateBase64!]);
  const right = materializeCanvas(b.state, [a.yjsUpdateBase64!]);
  expect(left.snapshot).toEqual(right.snapshot);
  expect(Object.keys(left.snapshot.nodes).sort()).toEqual([id, second]);
});
it("rejects nonfinite placement and generation-state injection", () => {
  expect(() =>
    createCanvasNode(empty(), { nodeId: id, type: "shot", position: { x: Infinity, y: 0 } })
  ).toThrow();
  expect(() =>
    createCanvasNode(empty(), {
      nodeId: id,
      type: "note",
      position,
      data: { text: "", generation: { status: "ready" } },
    } as never)
  ).toThrow();
});
