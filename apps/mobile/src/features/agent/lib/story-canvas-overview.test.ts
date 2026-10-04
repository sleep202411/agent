import { expect, it } from "vitest";
import { canvasOverview } from "./story-canvas-overview";
const empty = { meta: {}, nodes: {}, edges: {}, groups: {}, assets: {} };
it("reads Web node content and keeps durable media identity", () => {
  const mediaAssetId = "00000000-0000-4000-8000-000000000001";
  const value = canvasOverview({
    ...empty,
    nodes: { n: { id: "n", type: "image", data: { label: "Scene", prompt: "Rain" } } },
    assets: { a: { id: "a", kind: "video", url: "https://example.com/movie", mediaAssetId } },
  });
  expect(value.nodes[0]).toMatchObject({ title: "Scene", text: "Rain" });
  expect(value.assets[0].mediaAssetId).toBe(mediaAssetId);
});
it("does not invent a media identity for canvas-local assets", () => {
  expect(
    canvasOverview({ ...empty, assets: { a: { id: "a", kind: "image", url: "" } } }).assets[0]
      .mediaAssetId
  ).toBeUndefined();
});
it("fails explicitly rather than hiding malformed canvas content", () => {
  expect(() => canvasOverview({ ...empty, nodes: { bad: { type: "image" } } })).toThrow();
  expect(() =>
    canvasOverview({
      ...empty,
      assets: { bad: { id: "bad", kind: "video", url: "", mediaAssetId: "invalid" } },
    })
  ).toThrow();
});
it("derives shot numbers from Web keys while retaining non-shot positions", () => {
  const nodes = {
    c: { id: "c", type: "shot", data: { order: "k" } },
    note: { id: "note", type: "note", data: { text: "Note" } },
    b: { id: "b", type: "shot", data: { order: "V" } },
    a: { id: "a", type: "shot", data: { order: "V" } },
    last: { id: "last", type: "shot", data: {} },
  };
  const overview = canvasOverview({ ...empty, nodes });
  expect(overview.nodes.map(({ id, shotNumber }) => [id, shotNumber])).toEqual([
    ["a", 1],
    ["note", undefined],
    ["b", 2],
    ["c", 3],
    ["last", 4],
  ]);
});
