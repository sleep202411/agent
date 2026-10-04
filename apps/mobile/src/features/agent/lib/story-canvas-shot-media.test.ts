import { expect, it } from "vitest";
import * as Y from "yjs";
import { editCanvasShotMedia } from "../../../../canvas-editor/shot-media";
import { encodeCanvasBytes, materializeCanvas } from "../../../../canvas-editor/state";
const edgeId = "00000000-0000-4000-8000-000000000001";
function fixture(
  type = "image",
  data: Record<string, unknown> = {
    src: "https://example.test/image",
    label: " Still ",
    mediaAssetId: "asset",
    width: 512,
  }
) {
  const doc = new Y.Doc();
  const add = (id: string, type: string, data: Record<string, unknown>) => {
    const node = new Y.Map<unknown>();
    node.set("id", id);
    node.set("type", type);
    node.set("data", new Y.Map(Object.entries(data)));
    doc.getMap("nodes").set(id, node);
    return node.get("data") as Y.Map<unknown>;
  };
  const shot = add("shot", "shot", {
    label: "First",
    order: "V",
    dialogue: "Keep",
    references: { frame: [{ url: "manual", name: "Manual" }] },
  });
  add("source", type, data);
  doc.getMap("assets").set("asset", { id: "asset", url: "reusable" });
  return { doc, shot, add, state: () => encodeCanvasBytes(Y.encodeStateAsUpdate(doc)) };
}
it.each(["image", "panorama", "videoAsset"])(
  "attaches %s using Web edge handles and metadata",
  (type) => {
    const { doc, state } = fixture(type);
    try {
      const base = state();
      const result = editCanvasShotMedia(base, {
        action: "attach",
        nodeId: "shot",
        sourceId: "source",
        edgeId,
      });
      const field = type === "videoAsset" ? "clip" : "frame";
      expect(result.snapshot.edges[edgeId]).toEqual({
        id: edgeId,
        source: "source",
        target: "shot",
        sourceHandle: "output",
        targetHandle: "input",
      });
      expect(result.snapshot.nodes.shot).toMatchObject({
        data: {
          dialogue: "Keep",
          order: "V",
          references: {
            [field]: expect.arrayContaining([
              {
                id: edgeId,
                edgeId,
                sourceNodeId: "source",
                url: "https://example.test/image",
                kind: field === "clip" ? "video" : "image",
                name: "Still",
                assetId: "asset",
                width: 512,
              },
            ]),
          },
        },
      });
      expect(materializeCanvas(base, [result.yjsUpdateBase64!]).snapshot).toEqual(result.snapshot);
      expect(result.snapshot.assets.asset).toEqual({ id: "asset", url: "reusable" });
    } finally {
      doc.destroy();
    }
  }
);
it("binds generated output metadata and the original job identity", () => {
  const { doc, state } = fixture("video", {
    prompt: " Rain ",
    generation: {
      jobId: "job",
      outputs: [
        {
          url: "https://example.test/clip",
          assetId: "clip",
          durationSeconds: 2,
          bytes: 50,
          width: 0,
          height: -1,
        },
      ],
    },
  });
  try {
    const result = editCanvasShotMedia(state(), {
      action: "attach",
      nodeId: "shot",
      sourceId: "source",
      edgeId,
    });
    expect(result.snapshot.nodes.shot).toMatchObject({
      data: {
        references: {
          clip: [
            {
              id: edgeId,
              edgeId,
              sourceNodeId: "source",
              kind: "video",
              url: "https://example.test/clip",
              assetId: "clip",
              sourceJobId: "job",
              name: "Rain",
              durationSeconds: 2,
              bytes: 50,
            },
          ],
        },
      },
    });
  } finally {
    doc.destroy();
  }
});
it.each([undefined, "blob:local"])(
  "reserves a pending clip slot for %s without leaking local URLs",
  (url) => {
    const { doc, state, add } = fixture("video", { generation: { outputs: [{ url }] } });
    try {
      add("second", "videoAsset", { src: "https://example.test/second" });
      const result = editCanvasShotMedia(state(), {
        action: "attach",
        nodeId: "shot",
        sourceId: "source",
        edgeId,
      });
      expect(result.snapshot.nodes.shot).not.toHaveProperty("data.references.clip");
      expect(result.snapshot.edges[edgeId]).toBeDefined();
      expect(() =>
        editCanvasShotMedia(result.state, {
          action: "attach",
          nodeId: "shot",
          sourceId: "second",
          edgeId: "00000000-0000-4000-8000-000000000002",
        })
      ).toThrow("at most 1");
    } finally {
      doc.destroy();
    }
  }
);
it("counts manually bound frames toward the 24-frame limit", () => {
  const { doc, state, shot } = fixture();
  try {
    shot.set("references", { frame: Array.from({ length: 24 }, (_, i) => ({ url: String(i) })) });
    expect(() =>
      editCanvasShotMedia(state(), { action: "attach", nodeId: "shot", sourceId: "source", edgeId })
    ).toThrow("at most 24");
  } finally {
    doc.destroy();
  }
});
it("detaches only the selected binding and clears its cover pointer", () => {
  const { doc, state } = fixture();
  try {
    const bound = editCanvasShotMedia(state(), {
      action: "attach",
      nodeId: "shot",
      sourceId: "source",
      edgeId,
    });
    const preferred = editCanvasShotMedia(bound.state, {
      action: "prefer",
      nodeId: "shot",
      edgeId,
    });
    expect(preferred.snapshot.nodes.shot).toHaveProperty("data.preferredFrameEdgeId", edgeId);
    const result = editCanvasShotMedia(preferred.state, {
      action: "detach",
      nodeId: "shot",
      edgeId,
    });
    expect(result.snapshot.edges).toEqual({});
    expect(result.snapshot.nodes.shot).not.toHaveProperty("data.preferredFrameEdgeId");
    expect(result.snapshot.nodes.shot).toHaveProperty("data.references.frame", [
      { url: "manual", name: "Manual" },
    ]);
    expect(result.snapshot.nodes.source).toEqual(bound.snapshot.nodes.source);
    expect(result.snapshot.assets).toEqual(bound.snapshot.assets);
    expect(
      editCanvasShotMedia(result.state, { action: "detach", nodeId: "shot", edgeId })
        .yjsUpdateBase64
    ).toBeNull();
  } finally {
    doc.destroy();
  }
});
it("removes orphaned legacy bindings but rejects another shot's edge", () => {
  const { doc, state, shot } = fixture();
  try {
    shot.set("references", { frame: [{ edgeId, url: "legacy" }] });
    expect(
      editCanvasShotMedia(state(), { action: "detach", nodeId: "shot", edgeId }).snapshot.nodes.shot
    ).toHaveProperty("data.references.frame", []);
    doc
      .getMap("edges")
      .set(edgeId, new Y.Map(Object.entries({ id: edgeId, source: "source", target: "other" })));
    expect(() =>
      editCanvasShotMedia(state(), { action: "detach", nodeId: "shot", edgeId })
    ).toThrow("does not belong");
  } finally {
    doc.destroy();
  }
});
it("does not allow unavailable covers or duplicate source connections", () => {
  const { doc, state } = fixture();
  try {
    expect(() =>
      editCanvasShotMedia(state(), { action: "prefer", nodeId: "shot", edgeId })
    ).toThrow("no longer attached");
    const bound = editCanvasShotMedia(state(), {
      action: "attach",
      nodeId: "shot",
      sourceId: "source",
      edgeId,
    });
    expect(() =>
      editCanvasShotMedia(bound.state, {
        action: "attach",
        nodeId: "shot",
        sourceId: "source",
        edgeId: "00000000-0000-4000-8000-000000000002",
      })
    ).toThrow("already connected");
  } finally {
    doc.destroy();
  }
});
it.each(["audio", "audioAsset", "note", "constructor"])("rejects unsupported %s source", (type) => {
  const { doc, state } = fixture(type);
  try {
    expect(() =>
      editCanvasShotMedia(state(), { action: "attach", nodeId: "shot", sourceId: "source", edgeId })
    ).toThrow("image and video");
  } finally {
    doc.destroy();
  }
});
it("merges binding with concurrent dialogue while exact replay stays idempotent", () => {
  const { doc, state, shot } = fixture();
  try {
    const result = editCanvasShotMedia(state(), {
      action: "attach",
      nodeId: "shot",
      sourceId: "source",
      edgeId,
    });
    shot.set("dialogue", "Concurrent");
    const merged = materializeCanvas(state(), [result.yjsUpdateBase64!]);
    expect(merged.snapshot.nodes.shot).toHaveProperty("data.dialogue", "Concurrent");
    expect(merged.snapshot).toEqual(materializeCanvas(result.state, [state()]).snapshot);
    expect(materializeCanvas(merged.state, [result.yjsUpdateBase64!]).snapshot).toEqual(
      merged.snapshot
    );
  } finally {
    doc.destroy();
  }
});
