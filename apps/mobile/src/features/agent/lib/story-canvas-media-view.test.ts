import { expect, it } from "vitest";
import { canvasMediaView } from "./story-canvas-media-view";
function fixture() {
  return {
    meta: {},
    groups: {},
    assets: {},
    edges: {} as Record<string, unknown>,
    nodes: {
      shot: {
        id: "shot",
        type: "shot",
        data: {
          label: "Shot",
          references: {
            frame: [
              {
                edgeId: "bound",
                sourceNodeId: "image",
                name: "Still",
                url: "https://example.test/frame",
              },
            ],
          },
        },
      },
      image: {
        id: "image",
        type: "image",
        data: { label: "Image", src: "https://example.test/frame" },
      },
      video: { id: "video", type: "video", data: { name: "Video" } },
      another: { id: "another", type: "videoAsset", data: { src: "https://example.test/video" } },
    },
  };
}
it("shows references even when legacy edges are missing and derives the first cover", () => {
  const result = canvasMediaView(fixture(), "shot");
  expect(result.attached[0]).toMatchObject({
    name: "Still",
    edgeId: "bound",
    kind: "image",
    preferred: true,
  });
  expect(result.sources.map((source) => source.sourceId)).toEqual(["video", "another"]);
});
it("shows pending reservations and disables another clip without inventing playback", () => {
  const snapshot = fixture();
  snapshot.edges.pending = { id: "pending", source: "video", target: "shot" };
  const result = canvasMediaView(snapshot, "shot");
  expect(result.attached[1]).toMatchObject({
    edgeId: "pending",
    sourceId: "video",
    kind: "video",
    pending: true,
  });
  expect(result.attached[1].url).toBeUndefined();
  expect(result.sources).toEqual([
    expect.objectContaining({ sourceId: "another", available: false }),
  ]);
});
it("never previews session-local or executable URLs", () => {
  const snapshot = fixture();
  snapshot.nodes.shot.data.references.frame[0].url = "javascript:alert(1)";
  snapshot.nodes.another.data.src = "blob:session";
  const result = canvasMediaView(snapshot, "shot");
  expect(result.attached[0].url).toBeUndefined();
  expect(result.sources.find((source) => source.sourceId === "another")).toMatchObject({
    pending: true,
  });
});
it("refuses missing or non-shot targets", () => {
  expect(() => canvasMediaView(fixture(), "missing")).toThrow();
  expect(() => canvasMediaView(fixture(), "image")).toThrow("unavailable");
});
it("previews completed unbound sources and identifies stale bound URLs", () => {
  const snapshot = fixture();
  snapshot.edges.completed = { id: "completed", source: "another", target: "shot" };
  snapshot.nodes.image.data.src = "https://example.test/replacement";
  const view = canvasMediaView(snapshot, "shot");
  expect(view.attached.find((item) => item.edgeId === "completed")).toMatchObject({
    pending: true,
    needsRefresh: true,
    url: "https://example.test/video",
  });
  expect(view.attached.find((item) => item.edgeId === "bound")).toMatchObject({
    needsRefresh: true,
    url: "https://example.test/frame",
  });
});
