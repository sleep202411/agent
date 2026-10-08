import { expect, it } from "vitest";
import { canvasStoryboard } from "./canvas-storyboard";
import type { CanvasSnapshot } from "../../../../canvas-editor/protocol";
const assetId = "11111111-1111-4111-8111-111111111111";
function fixture(): CanvasSnapshot {
  return {
    meta: {},
    groups: {},
    assets: {},
    nodes: {
      a: { id: "a", type: "shot", data: { order: "a1", preferredFrameEdgeId: "i2" } },
      b: { id: "b", type: "shot", data: { order: "a0" } },
      image: {
        id: "image",
        type: "image",
        data: { src: "https://media.test/first.png", mediaAssetId: assetId },
      },
      preferred: {
        id: "preferred",
        type: "prompt",
        data: {
          generation: {
            status: "done",
            outputs: [{ url: "https://media.test/preferred.png", assetId }],
          },
        },
      },
      video: {
        id: "video",
        type: "videoAsset",
        data: { src: "https://media.test/clip.mp4", mediaAssetId: assetId },
      },
    },
    edges: {
      i1: { id: "i1", source: "image", target: "a" },
      i2: { id: "i2", source: "preferred", target: "a" },
      v: { id: "v", source: "video", target: "b" },
    },
  };
}
it("uses saved fractional order, video priority, and the preferred still", () => {
  const snapshot = fixture();
  expect(canvasStoryboard(snapshot).rows.map((r) => [r.id, r.media?.id])).toEqual([
    ["b", "video"],
    ["a", "preferred"],
  ]);
  snapshot.edges.v = { id: "v", source: "video", target: "a" };
  expect(canvasStoryboard(snapshot).rows[1].media?.kind).toBe("video");
  expect(canvasStoryboard(snapshot).rows[0].media).toBeUndefined();
});
it("keeps older bound outputs without borrowing a new media identity", () => {
  const snapshot = fixture();
  (snapshot.nodes.a as any).data.references = {
    frame: [{ edgeId: "i2", url: "https://media.test/old.png" }],
  };
  expect(canvasStoryboard(snapshot).rows[1].media).toMatchObject({
    url: "https://media.test/old.png",
    mediaAssetId: undefined,
  });
});
it("does not play pending or failed generation", () => {
  const snapshot = fixture();
  (snapshot.nodes.preferred as any).data.generation.status = "generating";
  expect(canvasStoryboard(snapshot).rows[1].media?.id).toBe("image");
  (snapshot.nodes.image as any).data.src = "blob:local";
  expect(canvasStoryboard(snapshot).rows[1].media).toBeUndefined();
});
it("rejects inconsistent edge identities", () => {
  const snapshot = fixture();
  snapshot.edges.v = { id: "forged", source: "video", target: "a" };
  expect(() => canvasStoryboard(snapshot)).toThrow("identity");
});

it("keeps a saved bound output when a completed source no longer lists that output", () => {
  const snapshot = fixture();
  snapshot.nodes.preferred = {
    id: "preferred",
    type: "prompt",
    data: { generation: { status: "done", outputs: [] } },
  };
  snapshot.nodes.a = {
    id: "a",
    type: "shot",
    data: {
      order: "a1",
      preferredFrameEdgeId: "i2",
      references: { frame: [{ edgeId: "i2", url: "https://media.test/saved.png", assetId }] },
    },
  };
  expect(canvasStoryboard(snapshot).rows[1].media).toMatchObject({
    url: "https://media.test/saved.png",
    mediaAssetId: assetId,
  });
});

it("keeps empty editing placeholders while excluding them from the rough cut", () => {
  const snapshot = fixture();
  snapshot.nodes.empty = { id: "empty", type: "shot", data: { order: "a00" } };
  const result = canvasStoryboard(snapshot);
  expect(result.rows.map((row) => row.id)).toContain("empty");
  expect(result.playbackRows.map((row) => row.id)).toEqual(["b", "a"]);
  snapshot.edges = {};
  expect(canvasStoryboard(snapshot).playbackRows).toEqual([]);
});
