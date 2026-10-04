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
