import { expect, it } from "vitest";
import * as Y from "yjs";
import {
  editCanvasShotMedia,
  reconcileCanvasShotMedia,
} from "../../../../canvas-editor/shot-media";
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
it("backfills a completed pending clip on the same reserved edge", () => {
  const { doc, state } = fixture("video", {});
  try {
    const pending = editCanvasShotMedia(state(), {
      action: "attach",
      nodeId: "shot",
      sourceId: "source",
      edgeId,
    });
    Y.applyUpdate(
      doc,
      Uint8Array.from(atob(pending.yjsUpdateBase64!), (c) => c.charCodeAt(0))
    );
    const source = doc.getMap("nodes").get("source") as Y.Map<unknown>;
    (source.get("data") as Y.Map<unknown>).set("generation", {
      outputs: [{ url: "https://example.test/done", assetId: "new" }],
    });
    const refreshed = editCanvasShotMedia(state(), { action: "refresh", nodeId: "shot", edgeId });
    expect(refreshed.snapshot.edges).toEqual(pending.snapshot.edges);
    expect(refreshed.snapshot.nodes.shot).toHaveProperty("data.references.clip", [
      expect.objectContaining({ edgeId, url: "https://example.test/done", assetId: "new" }),
    ]);
    expect(
      editCanvasShotMedia(refreshed.state, { action: "refresh", nodeId: "shot", edgeId })
        .yjsUpdateBase64
    ).toBeNull();
  } finally {
    doc.destroy();
  }
});
it("refreshes a bound URL while preserving metadata and preferred-frame identity", () => {
  const { doc, state } = fixture();
  try {
    const attached = editCanvasShotMedia(state(), {
      action: "attach",
      nodeId: "shot",
      sourceId: "source",
      edgeId,
    });
    Y.applyUpdate(
      doc,
      Uint8Array.from(atob(attached.yjsUpdateBase64!), (c) => c.charCodeAt(0))
    );
    const source = doc.getMap("nodes").get("source") as Y.Map<unknown>;
    (source.get("data") as Y.Map<unknown>).set("src", "https://example.test/new");
    (source.get("data") as Y.Map<unknown>).set("mediaAssetId", "different");
    const preferred = editCanvasShotMedia(state(), { action: "prefer", nodeId: "shot", edgeId });
    const refreshed = editCanvasShotMedia(preferred.state, {
      action: "refresh",
      nodeId: "shot",
      edgeId,
    });
    expect(refreshed.snapshot.nodes.shot).toHaveProperty("data.preferredFrameEdgeId", edgeId);
    expect(refreshed.snapshot.nodes.shot).toHaveProperty("data.references.frame", [
      { url: "manual", name: "Manual" },
      expect.objectContaining({
        edgeId,
        url: "https://example.test/new",
        assetId: "asset",
        name: "Still",
      }),
    ]);
  } finally {
    doc.destroy();
  }
});
it("leaves unresolved sources pending and rejects a removed refresh edge", () => {
  const { doc, state } = fixture("video", {});
  try {
    const pending = editCanvasShotMedia(state(), {
      action: "attach",
      nodeId: "shot",
      sourceId: "source",
      edgeId,
    });
    expect(
      editCanvasShotMedia(pending.state, { action: "refresh", nodeId: "shot", edgeId })
        .yjsUpdateBase64
    ).toBeNull();
    expect(() =>
      editCanvasShotMedia(state(), { action: "refresh", nodeId: "shot", edgeId })
    ).toThrow("connection changed");
  } finally {
    doc.destroy();
  }
});

function wire(doc: Y.Doc, id: string, source: string, target = "shot") {
  doc.getMap("edges").set(id, new Y.Map(Object.entries({ id, source, target })));
}
it("reconciles completed and regenerated shot media in one replayable update", () => {
  const { doc, shot, add, state } = fixture();
  try {
    wire(doc, "old", "source");
    shot.set("preferredFrameEdgeId", "old");
    shot.set("references", {
      frame: [{ edgeId: "old", sourceNodeId: "source", url: "old-url", assetId: "old-asset" }],
    });
    add("generated", "video", {
      generation: { jobId: "job", outputs: [{ url: "https://example.test/clip" }] },
    });
    wire(doc, "pending", "generated");
    const base = state();
    const result = reconcileCanvasShotMedia(base);
    expect(result.yjsUpdateBase64).not.toBeNull();
    expect(result.snapshot.nodes.shot).toMatchObject({
      data: {
        dialogue: "Keep",
        preferredFrameEdgeId: "old",
        references: {
          frame: [
            {
              edgeId: "old",
              sourceNodeId: "source",
              url: "https://example.test/image",
              assetId: "old-asset",
            },
          ],
          clip: [
            expect.objectContaining({
              edgeId: "pending",
              sourceJobId: "job",
              url: "https://example.test/clip",
            }),
          ],
        },
      },
    });
    expect(materializeCanvas(base, [result.yjsUpdateBase64!]).snapshot).toEqual(result.snapshot);
    shot.set("dialogue", "Concurrent");
    const merged = materializeCanvas(state(), [result.yjsUpdateBase64!, result.yjsUpdateBase64!]);
    expect(merged.snapshot.nodes.shot).toHaveProperty("data.dialogue", "Concurrent");
    expect(merged.snapshot.assets).toEqual(result.snapshot.assets);
    expect(reconcileCanvasShotMedia(merged.state).yjsUpdateBase64).toBeNull();
  } finally {
    doc.destroy();
  }
});
it("removes only rejected unbound wires and preserves source assets and other targets", () => {
  const { doc, shot, add, state } = fixture();
  try {
    shot.set("references", { frame: Array.from({ length: 24 }, (_, i) => ({ url: String(i) })) });
    add("audio", "audioAsset", { src: "https://example.test/audio" });
    add("note", "note", { text: "Keep" });
    wire(doc, "full", "source");
    wire(doc, "audio-wire", "audio");
    wire(doc, "missing", "gone");
    wire(doc, "self", "shot");
    wire(doc, "other", "source", "note");
    const result = reconcileCanvasShotMedia(state());
    expect(Object.keys(result.snapshot.edges)).toEqual(["other"]);
    expect(Object.keys(result.snapshot.nodes)).toEqual(["shot", "source", "audio", "note"]);
    expect(result.snapshot.assets.asset).toEqual({ id: "asset", url: "reusable" });
    expect(result.snapshot.nodes.shot).toHaveProperty(
      "data.references.frame",
      shot.get("references") && (shot.get("references") as { frame: unknown[] }).frame
    );
  } finally {
    doc.destroy();
  }
});
it("keeps an existing binding when a duplicate pending wire is rejected", () => {
  const { doc, shot, state } = fixture();
  try {
    shot.set("references", { frame: [{ edgeId: "bound", sourceNodeId: "source", url: "old" }] });
    wire(doc, "bound", "source");
    wire(doc, "duplicate", "source");
    const result = reconcileCanvasShotMedia(state());
    expect(Object.keys(result.snapshot.edges)).toEqual(["bound"]);
    expect(result.snapshot.nodes.shot).toHaveProperty("data.references.frame", [
      expect.objectContaining({ edgeId: "bound", url: "https://example.test/image" }),
    ]);
  } finally {
    doc.destroy();
  }
});
it("leaves missing bound sources and unresolved outputs unchanged", () => {
  const { doc, shot, add, state } = fixture("prompt", {});
  try {
    shot.set("references", { frame: [{ edgeId: "gone", url: "retained" }] });
    wire(doc, "gone", "missing-source");
    wire(doc, "waiting", "source");
    add("blob", "videoAsset", { src: "blob:local" });
    wire(doc, "blob-wire", "blob");
    expect(reconcileCanvasShotMedia(state()).yjsUpdateBase64).toBeNull();
  } finally {
    doc.destroy();
  }
});
it("refreshes existing legacy bindings without revalidating their kind", () => {
  const { doc, shot, state } = fixture("audioAsset", { src: "https://example.test/new" });
  try {
    shot.set("references", { legacy: [{ edgeId: "legacy", url: "old", name: "Keep" }] });
    wire(doc, "legacy", "source");
    const result = reconcileCanvasShotMedia(state());
    expect(result.snapshot.nodes.shot).toHaveProperty("data.references.legacy", [
      { edgeId: "legacy", url: "https://example.test/new", name: "Keep" },
    ]);
    expect(result.snapshot.edges.legacy).toBeDefined();
  } finally {
    doc.destroy();
  }
});
it("returns no partial delta when a later malformed binding aborts reconciliation", () => {
  const { doc, add, state } = fixture();
  try {
    wire(doc, "valid", "source");
    add("bad-shot", "shot", { references: { frame: "invalid" } });
    wire(doc, "invalid", "source", "bad-shot");
    const before = state();
    expect(() => reconcileCanvasShotMedia(before)).toThrow();
    expect(state()).toEqual(before);
    expect(materializeCanvas(before, []).snapshot.nodes.shot).toHaveProperty(
      "data.references.frame",
      [{ url: "manual", name: "Manual" }]
    );
  } finally {
    doc.destroy();
  }
});
