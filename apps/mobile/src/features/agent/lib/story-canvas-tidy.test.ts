// @vitest-environment node
import { expect, it } from "vitest";
import type { CanvasSnapshot } from "../../../../canvas-editor/protocol";
import { layoutCanvasTidyGraph } from "../../../../canvas-editor/tidy/engine";
import { canvasTidyRequest, canvasTidyBaseline } from "./story-canvas-tidy";
const snapshot = (): CanvasSnapshot => ({
  meta: {},
  assets: {},
  groups: {},
  nodes: Object.fromEntries(
    ["a", "b", "c", "d"].map((id, i) => [
      id,
      { id, type: i === 3 ? "shot" : "prompt", position: { x: 0, y: 0 }, data: { name: id } },
    ])
  ),
  edges: {
    ab: { id: "ab", source: "a", target: "b" },
    bc: { id: "bc", source: "b", target: "c" },
    ca: { id: "ca", source: "c", target: "a" },
  },
});
it("lays out cycles and disconnected cards without overlap or changing content", async () => {
  const state = snapshot(),
    original = JSON.stringify(state),
    request = canvasTidyRequest(state);
  const result = await layoutCanvasTidyGraph(request);
  expect(JSON.stringify(state)).toBe(original);
  expect(result.map((row) => row.id)).toEqual(["a", "b", "c", "d"]);
  for (let i = 0; i < result.length; i++)
    for (let j = i + 1; j < result.length; j++) {
      const a = result[i]!,
        b = result[j]!,
        sizeA = request.nodes[i]!,
        sizeB = request.nodes[j]!;
      expect(
        a.position.x + sizeA.width <= b.position.x ||
          b.position.x + sizeB.width <= a.position.x ||
          a.position.y + sizeA.height <= b.position.y ||
          b.position.y + sizeB.height <= a.position.y
      ).toBe(true);
    }
  expect(await layoutCanvasTidyGraph(request)).toEqual(result);
});
it("tidies only a multi-selection and ignores external wires, while a single selection targets all", () => {
  const selected = canvasTidyRequest(snapshot(), ["b", "c"]);
  expect(selected.nodes.map((node) => node.id)).toEqual(["b", "c"]);
  expect(selected.edges).toEqual([{ id: "0:bc", source: "b", target: "c" }]);
  expect(canvasTidyRequest(snapshot(), ["b"]).nodes).toHaveLength(4);
  expect(() => canvasTidyRequest(snapshot(), ["missing"])).toThrow("selection changed");
  expect(() => canvasTidyRequest(snapshot(), ["a", "a"])).toThrow("selection changed");
});
it("detects layout changes while permitting independent prompt edits", () => {
  const state = snapshot(),
    before = canvasTidyBaseline(state);
  (state.nodes.a as { data: { name: string } }).data.name = "New title";
  expect(canvasTidyBaseline(state)).toBe(before);
  delete state.edges.ca;
  expect(canvasTidyBaseline(state)).not.toBe(before);
});
it("preserves the original center with Web spacing and respects durable card dimensions", async () => {
  const state = snapshot();
  state.nodes = {
    a: { id: "a", type: "image", data: {}, position: { x: -500, y: 200 }, width: 800, height: 600 },
  };
  state.edges = {};
  const request = canvasTidyRequest(state);
  expect(request).toMatchObject({
    direction: "RIGHT",
    nodeSpacing: 72,
    layerSpacing: 120,
    componentSpacing: 180,
  });
  expect(request.nodes[0]).toMatchObject({ width: 800, height: 600 });
  expect(await layoutCanvasTidyGraph(request)).toEqual([
    { id: "a", position: { x: -500, y: 200 } },
  ]);
});
