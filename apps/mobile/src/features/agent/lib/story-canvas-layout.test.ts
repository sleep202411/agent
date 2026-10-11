import { expect, it } from "vitest";
import {
  canvasLayout,
  fitCanvasCamera,
  panCanvasCamera,
  zoomCanvasCamera,
} from "./story-canvas-layout";
import type { CanvasSnapshot } from "../../../../canvas-editor/protocol";
function fixture(): CanvasSnapshot {
  return {
    meta: {},
    assets: {},
    groups: { group: { id: "group", nodeIds: ["a", "b"], color: "blue" } },
    edges: {
      edge: { id: "edge", source: "a", target: "b" },
      dangling: { id: "dangling", source: "gone", target: "b" },
    },
    nodes: {
      a: {
        id: "a",
        type: "note",
        position: { x: -100, y: 20 },
        data: { text: "Note" },
        width: 9999,
        height: 1,
        measured: { width: 20, height: 20 },
      },
      b: {
        id: "b",
        type: "image",
        position: { x: 500, y: 400 },
        data: { label: "Image", src: "https://example.test/image" },
      },
    },
  };
}
it("projects persisted positions with Web geometry, ignoring old measurements", () => {
  const snapshot = fixture(),
    before = JSON.stringify(snapshot);
  const layout = canvasLayout(snapshot);
  expect(layout.nodes[0]).toMatchObject({ id: "a", x: -100, y: 20, width: 280, height: 188 });
  expect(layout.nodes[1]).toMatchObject({ id: "b", x: 500, y: 400, width: 320, height: 260 });
  expect(layout.groups[0]).toMatchObject({
    id: "group",
    x: -136,
    y: -16,
    width: 992,
    height: 712,
    color: "blue",
  });
  expect(layout.bounds).toEqual({ x: -160, y: -40, width: 1040, height: 760 });
  expect(JSON.stringify(snapshot)).toBe(before);
});
it("connects the right source edge to the left target edge and omits dangling wires", () => {
  expect(canvasLayout(fixture()).edges).toEqual([
    { id: "edge", source: "a", target: "b", path: "M 180 114 C 340 114, 340 530, 500 530" },
  ]);
});
it.each([
  ["note", 280, 188],
  ["image", 320, 260],
  ["videoAsset", 320, 220],
  ["audioAsset", 320, 156],
  ["shot", 320, 284],
  ["panorama", 360, 224],
  ["prompt", 360, 408],
  ["video", 360, 280],
  ["audio", 360, 216],
  ["constructor", 320, 240],
])("uses Web's %s geometry", (type, width, height) => {
  const snapshot = fixture();
  snapshot.nodes = { node: { id: "node", type, data: {} } };
  snapshot.groups = {};
  snapshot.edges = {};
  expect(canvasLayout(snapshot).nodes[0]).toMatchObject({ width, height, x: 0, y: 0 });
});
it.each([
  [{ kind: "character" }, 280, 140],
  [{ kind: "decision", choices: [1, 2, 3] }, 360, 356],
  [{ kind: "clip", description: "Scene", interactions: [1, 2] }, 320, 576],
])("reserves content-dependent story node bounds %s", (data, width, height) => {
  const snapshot = fixture();
  snapshot.nodes = { node: { id: "node", type: "storyCanvas", data } };
  snapshot.groups = {};
  snapshot.edges = {};
  expect(canvasLayout(snapshot).nodes[0]).toMatchObject({ width, height });
});
it("matches Web's zero-coordinate fallback for legacy missing or invalid positions", () => {
  const snapshot = fixture();
  (snapshot.nodes.a as { position: unknown }).position = { x: "bad", y: Infinity };
  expect(canvasLayout(snapshot).nodes[0]).toMatchObject({ x: 0, y: 0 });
});
it("rejects malformed identities and impossible geometry without a partial projection", () => {
  const snapshot = fixture();
  (snapshot.nodes.a as { id: string }).id = "different";
  expect(() => canvasLayout(snapshot)).toThrow();
  const huge = fixture();
  (huge.nodes.a as { position: unknown }).position = { x: Number.MAX_VALUE, y: 0 };
  expect(() => canvasLayout(huge)).toThrow();
});
it("fits negative world coordinates inside the available viewport", () => {
  const bounds = canvasLayout(fixture()).bounds;
  const camera = fitCanvasCamera(bounds, { width: 320, height: 480 });
  expect(camera).toEqual({ x: 360, y: 340, scale: 288 / 1040 });
  expect(bounds.height * camera.scale).toBeLessThanOrEqual(448);
});
it("pans in screen pixels at the current zoom and keeps zoom centered", () => {
  const camera = { x: 100, y: 200, scale: 0.5 };
  expect(panCanvasCamera(camera, 25, -50)).toEqual({ x: 50, y: 300, scale: 0.5 });
  expect(zoomCanvasCamera(camera, 2)).toEqual({ x: 100, y: 200, scale: 1 });
  expect(zoomCanvasCamera(camera, 100).scale).toBe(4);
  expect(zoomCanvasCamera(camera, 0)).toBe(camera);
  expect(panCanvasCamera(camera, NaN, 0)).toBe(camera);
});
it("provides an empty canvas viewport without mutating the document", () => {
  const snapshot = { meta: {}, nodes: {}, edges: {}, groups: {}, assets: {} };
  expect(canvasLayout(snapshot)).toEqual({
    nodes: [],
    edges: [],
    groups: [],
    bounds: { x: 0, y: 0, width: 640, height: 480 },
  });
});
it("projects a whole-group drag with identical deltas and preserves non-members", async () => {
  const { canvasDragPositions } = await import("./story-canvas-layout");
  const snapshot = {
    meta: {},
    assets: {},
    edges: {},
    groups: { g: { id: "g", nodeIds: ["a", "b"], color: "red" } },
    nodes: {
      a: { id: "a", type: "note", data: {}, position: { x: 0, y: 20 } },
      b: { id: "b", type: "note", data: {}, position: { x: 80, y: 40 } },
      c: { id: "c", type: "note", data: {}, position: { x: 500, y: 200 } },
    },
  };
  expect(canvasDragPositions(snapshot, { nodeId: "a", x: -10, y: 50 }, "g")).toEqual({
    action: "moveNodes",
    groupId: "g",
    positions: [
      { nodeId: "a", x: -10, y: 50 },
      { nodeId: "b", x: 70, y: 70 },
    ],
  });
  expect(canvasDragPositions(snapshot, { nodeId: "b", x: 100, y: 200 }).positions).toEqual([
    { nodeId: "b", x: 100, y: 200 },
  ]);
  expect(() => canvasDragPositions(snapshot, { nodeId: "c", x: 0, y: 0 }, "g")).toThrow(
    "membership"
  );
  expect(() => canvasDragPositions(snapshot, { nodeId: "a", x: Infinity, y: 0 }, "g")).toThrow();
  expect(snapshot.nodes.b.position).toEqual({ x: 80, y: 40 });
});
it("moves an arbitrary selection without moving other group members", async () => {
  const { canvasDragPositions } = await import("./story-canvas-layout");
  const snapshot = {
    meta: {},
    assets: {},
    edges: {},
    groups: { g: { id: "g", nodeIds: ["a", "b"], color: "red" } },
    nodes: {
      a: { id: "a", type: "note", data: {}, position: { x: -20, y: 10 } },
      b: { id: "b", type: "note", data: {}, position: { x: 80, y: 40 } },
      c: { id: "c", type: "note", data: {}, position: { x: 500, y: 200 } },
    },
  };
  expect(
    canvasDragPositions(snapshot, { nodeId: "c", x: 525, y: 180 }, undefined, ["a", "c"])
  ).toEqual({
    action: "moveNodes",
    positions: [
      { nodeId: "a", x: 5, y: -10 },
      { nodeId: "c", x: 525, y: 180 },
    ],
  });
  expect(snapshot.nodes.b.position).toEqual({ x: 80, y: 40 });
  for (const ids of [[], ["a"], ["c", "c"], ["c", "missing"]])
    expect(() =>
      canvasDragPositions(snapshot, { nodeId: "c", x: 525, y: 180 }, undefined, ids)
    ).toThrow("selection");
  expect(() =>
    canvasDragPositions(snapshot, { nodeId: "a", x: 5, y: 10 }, "g", ["a", "c"])
  ).toThrow("either");
});
