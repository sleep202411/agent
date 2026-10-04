import { expect, it } from "vitest";
import * as Y from "yjs";
import { editCanvasPositions } from "../../../../canvas-editor/position-edit";
import { canvasPositionEditSchema } from "../../../../canvas-editor/position-schema";
import { encodeCanvasBytes, materializeCanvas } from "../../../../canvas-editor/state";
function fixture() {
  const doc = new Y.Doc();
  for (const id of ["a", "b"])
    doc.getMap("nodes").set(
      id,
      new Y.Map<unknown>([
        ["id", id],
        ["type", "note"],
        ["data", new Y.Map([["text", id]])],
        [
          "position",
          new Y.Map<unknown>([
            ["x", 10],
            ["y", 20],
            ["extra", "keep"],
          ]),
        ],
      ])
    );
  doc.getMap("edges").set("wire", { id: "wire", source: "a", target: "b" });
  doc.getMap("groups").set("group", { id: "group", nodeIds: ["a", "b"], color: "red" });
  doc.getMap("assets").set("media", { url: "keep" });
  return { doc, state: () => encodeCanvasBytes(Y.encodeStateAsUpdate(doc)) };
}
it("commits multi-node final coordinates in one replayable delta without touching content or links", () => {
  const { doc, state } = fixture();
  try {
    const base = state(),
      before = materializeCanvas(base, []).snapshot;
    const result = editCanvasPositions(base, {
      action: "moveNodes",
      positions: [
        { nodeId: "a", x: -100.5, y: 0 },
        { nodeId: "b", x: 800, y: 300 },
      ],
    });
    expect(result.snapshot.nodes.a).toMatchObject({
      data: { text: "a" },
      position: { x: -100.5, y: 0, extra: "keep" },
    });
    expect(result.snapshot.nodes.b).toHaveProperty("position.x", 800);
    for (const key of ["edges", "groups", "assets"] as const)
      expect(result.snapshot[key]).toEqual(before[key]);
    expect(
      materializeCanvas(base, [result.yjsUpdateBase64!, result.yjsUpdateBase64!]).snapshot
    ).toEqual(result.snapshot);
    expect(materializeCanvas(state(), []).snapshot).toEqual(before);
    expect(
      editCanvasPositions(result.state, {
        action: "moveNodes",
        positions: [{ nodeId: "a", x: -100.5, y: 0 }],
      }).yjsUpdateBase64
    ).toBeNull();
  } finally {
    doc.destroy();
  }
});
it("merges a concurrent content edit and unrelated-node move without replacing their CRDT maps", () => {
  const { doc, state } = fixture();
  try {
    const result = editCanvasPositions(state(), {
      action: "moveNodes",
      positions: [{ nodeId: "a", x: 200, y: 400 }],
    });
    const a = doc.getMap("nodes").get("a") as Y.Map<unknown>;
    const b = doc.getMap("nodes").get("b") as Y.Map<unknown>;
    const data = a.get("data") as Y.Map<unknown>;
    const pos = a.get("position");
    data.set("text", "Concurrent text");
    (b.get("position") as Y.Map<unknown>).set("x", 900);
    Y.applyUpdate(
      doc,
      Uint8Array.from(atob(result.yjsUpdateBase64!), (c) => c.charCodeAt(0))
    );
    expect(a.get("data")).toBe(data);
    expect(a.get("position")).toBe(pos);
    expect(a.toJSON()).toMatchObject({
      data: { text: "Concurrent text" },
      position: { x: 200, y: 400 },
    });
    expect(b.toJSON()).toHaveProperty("position.x", 900);
  } finally {
    doc.destroy();
  }
});
it.each([undefined, { x: 7, y: 9 }, "invalid"])(
  "repairs legacy non-map positions like Web: %j",
  (legacy) => {
    const { doc, state } = fixture();
    try {
      const a = doc.getMap("nodes").get("a") as Y.Map<unknown>;
      if (legacy === undefined) a.delete("position");
      else a.set("position", legacy);
      const result = editCanvasPositions(state(), {
        action: "moveNodes",
        positions: [{ nodeId: "a", x: 1, y: 2 }],
      });
      expect(result.snapshot.nodes.a).toHaveProperty("position", { x: 1, y: 2 });
      expect(result.snapshot.nodes.a).toHaveProperty("data.text", "a");
    } finally {
      doc.destroy();
    }
  }
);
it("rejects a missing member before mutating the selection", () => {
  const { doc, state } = fixture();
  try {
    const before = state();
    expect(() =>
      editCanvasPositions(before, {
        action: "moveNodes",
        positions: [
          { nodeId: "a", x: 0, y: 0 },
          { nodeId: "missing", x: 1, y: 1 },
        ],
      })
    ).toThrow("unavailable");
    expect(state()).toBe(before);
  } finally {
    doc.destroy();
  }
});
it.each(
  [
    [],
    [{ nodeId: "a", x: NaN, y: 0 }],
    [{ nodeId: "a", x: Infinity, y: 0 }],
    [{ nodeId: "", x: 0, y: 0 }],
    [
      { nodeId: "a", x: 0, y: 0 },
      { nodeId: "a", x: 1, y: 1 },
    ],
  ].map((positions) => ({ positions }))
)("rejects invalid move selection $positions", ({ positions }) => {
  expect(canvasPositionEditSchema.safeParse({ action: "moveNodes", positions }).success).toBe(
    false
  );
});
it("rejects a node with a mismatched identity", () => {
  const { doc, state } = fixture();
  try {
    (doc.getMap("nodes").get("a") as Y.Map<unknown>).set("id", "other");
    expect(() =>
      editCanvasPositions(state(), {
        action: "moveNodes",
        positions: [{ nodeId: "a", x: 1, y: 1 }],
      })
    ).toThrow("unavailable");
  } finally {
    doc.destroy();
  }
});
