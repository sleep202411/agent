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

it("keeps protected actor sources available through durable media identity", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const snapshot = fixture();
  snapshot.nodes.shot.data.references.frame = [];
  Object.assign(snapshot.nodes.image.data, {
    src: `/aurora/media/assets/${id}/content`,
    mediaAssetId: id,
  });
  expect(
    canvasMediaView(snapshot, "shot").sources.find((item) => item.sourceId === "image")
  ).toMatchObject({ mediaAssetId: id, pending: false });
});
it("lists generation image/video/audio references without shot preferred-frame controls", () => {
  const snapshot = {
    ...fixture(),
    nodes: {
      ...fixture().nodes,
      target: {
        id: "target",
        type: "video",
        data: {
          name: "Generation",
          references: {
            sound: [
              {
                edgeId: "sound",
                sourceNodeId: "audio",
                kind: "audio",
                url: "https://example.test/sound",
              },
            ],
          },
        },
      },
      audio: { id: "audio", type: "audioAsset", data: { src: "https://example.test/sound" } },
    },
  };
  const view = canvasMediaView(snapshot, "target", {
    modelId: "model",
    fields: [{ field: "images", kind: "image", maxItems: 1 }],
  });
  expect(view.title).toBe("Generation");
  expect(view.explicitPreferred).toBe(false);
  expect(view.attached[0]).toMatchObject({ kind: "audio", preferred: false, key: "edge:sound" });
  expect(view.sources.find((row) => row.sourceId === "target")).toBeUndefined();
  expect(view.sources.find((row) => row.sourceId === "audio")).toBeUndefined();
  expect(view.sources.find((row) => row.sourceId === "image")).toMatchObject({ available: true });
  expect(view.sources.find((row) => row.sourceId === "video")).toMatchObject({ available: false });
});
it("uses legacy edge identity to avoid offering an already-connected source again", () => {
  const snapshot = {
    ...fixture(),
    nodes: {
      ...fixture().nodes,
      target: {
        id: "target",
        type: "prompt",
        data: {
          references: {
            images: [{ edgeId: "legacy", kind: "image", url: "https://example.test/old" }],
          },
        },
      },
    },
  };
  snapshot.edges.legacy = { id: "legacy", source: "image", target: "target" };
  const view = canvasMediaView(snapshot, "target");
  expect(view.attached[0]).toMatchObject({ sourceId: "image", needsRefresh: true });
  expect(view.sources.some((row) => row.sourceId === "image")).toBe(false);
});
it("shows removable missing-source wires and stable identities for duplicate-media imports", () => {
  const snapshot = {
    ...fixture(),
    nodes: {
      ...fixture().nodes,
      target: {
        id: "target",
        type: "prompt",
        data: {
          references: {
            images: [
              { id: "one", kind: "image", url: "https://example.test/same" },
              { id: "two", kind: "image", url: "https://example.test/same" },
            ],
          },
        },
      },
    },
  };
  snapshot.edges.missing = { id: "missing", source: "deleted", target: "target" };
  const view = canvasMediaView(snapshot, "target");
  expect(view.attached).toHaveLength(3);
  expect(view.attached[0]).toMatchObject({ referenceId: "one", field: "images" });
  expect(view.attached[1]).toMatchObject({ referenceId: "two", field: "images" });
  expect(view.attached[0]!.key).not.toBe(view.attached[1]!.key);
  expect(view.attached[2]).toMatchObject({
    key: "edge:missing",
    edgeId: "missing",
    missingSource: true,
  });
  expect(view.attached[2]!.url).toBeUndefined();
  snapshot.nodes.target.data.references.images.reverse();
  expect(canvasMediaView(snapshot, "target").attached[1]!.key).toBe(view.attached[0]!.key);
});
