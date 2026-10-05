import { expect, it } from "vitest";
import * as Y from "yjs";
import { editCanvasReferences } from "../../../../canvas-editor/reference-edit";
import { encodeCanvasBytes, materializeCanvas } from "../../../../canvas-editor/state";
import type {
  CanvasReferenceEdit,
  CanvasReferenceTarget,
} from "../../../../canvas-editor/reference-schema";
const edgeId = "00000000-0000-4000-8000-000000000001";
const slots: CanvasReferenceTarget = {
  modelId: "model",
  mode: "reference",
  fields: [
    { field: "images", kind: "image", maxItems: 2 },
    { field: "videos", kind: "video", maxItems: 1 },
    { field: "audios", kind: "audio", maxItems: 1 },
  ],
};
const attach = {
  action: "attach",
  nodeId: "target",
  sourceId: "source",
  edgeId,
  target: slots,
} as const;
function fixture(
  type = "image",
  data: Record<string, unknown> = {
    src: "/aurora/media/content",
    mediaAssetId: "asset",
    label: " Image ",
    width: 512,
  }
) {
  const doc = new Y.Doc();
  for (const [id, nodeType, value] of [
    ["target", "prompt", { prompt: "Keep", modelId: "model", mode: "reference", references: {} }],
    ["source", type, data],
  ] as const)
    doc.getMap("nodes").set(
      id,
      new Y.Map<unknown>([
        ["id", id],
        ["type", nodeType],
        ["data", new Y.Map(Object.entries(value))],
      ])
    );
  doc.getMap("assets").set("asset", { id: "asset", url: "keep" });
  const state = encodeCanvasBytes(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  return state;
}
function mutate(state: string, fn: (doc: Y.Doc) => void) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Uint8Array.from(Buffer.from(state, "base64")));
  fn(doc);
  const next = encodeCanvasBytes(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  return next;
}
const dataOf = (doc: Y.Doc, id: string) =>
  (doc.getMap("nodes").get(id) as Y.Map<unknown>).get("data") as Y.Map<unknown>;
it.each(["image", "panorama", "videoAsset", "audioAsset", "prompt", "video", "audio"])(
  "attaches %s with metadata and exact replay",
  (type) => {
    const generated = ["prompt", "video", "audio"].includes(type);
    const kind = ["video", "videoAsset"].includes(type)
      ? "video"
      : ["audio", "audioAsset"].includes(type)
        ? "audio"
        : "image";
    const state = fixture(
      type,
      generated
        ? {
            prompt: " Output ",
            generation: {
              jobId: "job",
              outputs: [{ url: "/aurora/media/result", assetId: "asset", width: 512 }],
            },
          }
        : undefined
    );
    const result = editCanvasReferences(state, attach);
    expect(result.snapshot.edges[edgeId]).toEqual({
      id: edgeId,
      source: "source",
      target: "target",
      sourceHandle: "output",
      targetHandle: "input",
    });
    expect(result.snapshot.nodes.target).toHaveProperty(
      `data.references.${kind}s.0`,
      expect.objectContaining({
        edgeId,
        sourceNodeId: "source",
        kind,
        assetId: "asset",
        width: 512,
        ...(generated ? { sourceJobId: "job", name: "Output" } : { name: "Image" }),
      })
    );
    expect(result.snapshot.nodes.target).toHaveProperty("data.prompt", "Keep");
    expect(result.snapshot.assets.asset).toEqual({ id: "asset", url: "keep" });
    expect(
      materializeCanvas(state, [result.yjsUpdateBase64!, result.yjsUpdateBase64!]).snapshot
    ).toEqual(result.snapshot);
  }
);
it("reserves pending/blob sources and refreshes only after durable output arrives", () => {
  for (const data of [{}, { src: "blob:local" }]) {
    const pending = editCanvasReferences(fixture("image", data), attach);
    expect(pending.snapshot.nodes.target).toHaveProperty("data.references", {});
    expect(pending.snapshot.edges[edgeId]).toBeDefined();
    const ready = mutate(pending.state, (doc) =>
      dataOf(doc, "source").set("src", "https://example.test/ready")
    );
    const refresh = { action: "refresh", nodeId: "target", edgeId, target: slots } as const;
    const bound = editCanvasReferences(ready, refresh);
    expect(bound.snapshot.nodes.target).toHaveProperty(
      "data.references.images.0.url",
      "https://example.test/ready"
    );
    expect(editCanvasReferences(bound.state, refresh).yjsUpdateBase64).toBeNull();
  }
});
it("detaches after source/model removal without deleting other references or assets", () => {
  const attached = editCanvasReferences(fixture(), attach);
  const removed = mutate(attached.state, (doc) => {
    doc.getMap("nodes").delete("source");
    const data = dataOf(doc, "target");
    data.delete("modelId");
    data.set("references", {
      ...(data.get("references") as object),
      other: [{ id: "manual", url: "keep" }],
    });
  });
  const edit = { action: "detach", nodeId: "target", edgeId } as const;
  const result = editCanvasReferences(removed, edit);
  expect(result.snapshot.edges[edgeId]).toBeUndefined();
  expect(result.snapshot.nodes.target).toHaveProperty("data.references", {
    images: [],
    other: [{ id: "manual", url: "keep" }],
  });
  expect(result.snapshot.assets.asset).toBeDefined();
  expect(editCanvasReferences(result.state, edit).yjsUpdateBase64).toBeNull();
});
it("rejects self, duplicate, foreign, missing, changed-mode and unsupported connections", () => {
  const state = fixture(),
    attached = editCanvasReferences(state, attach);
  const cases: [string, CanvasReferenceEdit][] = [
    [state, { ...attach, sourceId: "target" }],
    [state, { ...attach, sourceId: "missing" }],
    [state, { ...attach, target: { ...slots, modelId: "changed" } }],
    [state, { ...attach, target: { ...slots, mode: "changed" } }],
    [state, { ...attach, target: { ...slots, fields: [] } }],
    [attached.state, attach],
    [attached.state, { ...attach, edgeId: "00000000-0000-4000-8000-000000000002" }],
    [attached.state, { action: "detach", nodeId: "source", edgeId }],
  ];
  for (const [base, edit] of cases) {
    const before = materializeCanvas(base, []).snapshot;
    expect(() => editCanvasReferences(base, edit)).toThrow();
    expect(materializeCanvas(base, []).snapshot).toEqual(before);
  }
});
it("routes past reservations and rejects full slots without creating orphan edges", () => {
  const base = mutate(fixture(), (doc) => {
    doc.getMap("nodes").set(
      "pending",
      new Y.Map<unknown>([
        ["id", "pending"],
        ["type", "prompt"],
        ["data", new Y.Map()],
      ])
    );
    doc
      .getMap("edges")
      .set(
        "pending",
        new Y.Map(Object.entries({ id: "pending", source: "pending", target: "target" }))
      );
  });
  const single: CanvasReferenceTarget = {
    ...slots,
    fields: [{ field: "start", kind: "image", maxItems: 1 }],
  };
  expect(() => editCanvasReferences(base, { ...attach, target: single })).toThrow(
    "at most 1 image"
  );
  const two: CanvasReferenceTarget = {
    ...single,
    fields: [...single.fields, { field: "end", kind: "image", maxItems: 1 }],
  };
  const result = editCanvasReferences(base, { ...attach, target: two });
  expect(result.snapshot.nodes.target).toHaveProperty("data.references.end.0.edgeId", edgeId);
  expect(result.snapshot.edges.pending).toBeDefined();
});
it("refreshes job/asset provenance and obsolete fields without changing the target mode", () => {
  const first = editCanvasReferences(
    fixture("prompt", {
      generation: { jobId: "old", outputs: [{ url: "https://example.test/old", assetId: "old" }] },
    }),
    attach
  );
  const fresh = mutate(first.state, (doc) => {
    dataOf(doc, "source").set("generation", {
      jobId: "new",
      outputs: [{ url: "https://example.test/new", assetId: "new", width: 0, bytes: 32 }],
    });
    dataOf(doc, "target").set("references", { obsolete: [{ edgeId, sourceNodeId: "source" }] });
  });
  const result = editCanvasReferences(fresh, {
    action: "refresh",
    nodeId: "target",
    edgeId,
    target: slots,
  });
  expect(result.snapshot.nodes.target).toHaveProperty("data.references.obsolete", []);
  expect(result.snapshot.nodes.target).toHaveProperty("data.references.images.0", {
    id: edgeId,
    edgeId,
    sourceNodeId: "source",
    url: "https://example.test/new",
    kind: "image",
    assetId: "new",
    sourceJobId: "new",
    bytes: 32,
  });
  expect(result.snapshot.nodes.target).toHaveProperty("data.mode", "reference");
});
it("removes one imported reference by field/id even when its model is unavailable", () => {
  const state = mutate(fixture(), (doc) => {
    const data = dataOf(doc, "target");
    data.delete("modelId");
    data.set("references", {
      images: [
        { id: "selected", url: "https://example.test/same", assetId: "asset" },
        { id: "keep", url: "https://example.test/same", assetId: "asset" },
      ],
      inactive: [{ id: "selected", url: "https://example.test/keep" }],
    });
  });
  const edit = {
    action: "removeReference",
    nodeId: "target",
    field: "images",
    referenceId: "selected",
  } as const;
  const result = editCanvasReferences(state, edit);
  expect(result.snapshot.nodes.target).toHaveProperty("data.references", {
    images: [{ id: "keep", url: "https://example.test/same", assetId: "asset" }],
    inactive: [{ id: "selected", url: "https://example.test/keep" }],
  });
  expect(result.snapshot.assets).toEqual(materializeCanvas(state, []).snapshot.assets);
  expect(result.snapshot.nodes.source).toEqual(materializeCanvas(state, []).snapshot.nodes.source);
  expect(
    materializeCanvas(state, [result.yjsUpdateBase64!, result.yjsUpdateBase64!]).snapshot
  ).toEqual(result.snapshot);
  expect(editCanvasReferences(result.state, edit).yjsUpdateBase64).toBeNull();
});
it("refuses ambiguous identities or references that have acquired a canvas connection", () => {
  for (const rows of [[{ id: "ref" }, { id: "ref" }], [{ id: "ref", edgeId: "foreign" }]]) {
    const state = mutate(fixture(), (doc) =>
      dataOf(doc, "target").set("references", { images: rows })
    );
    expect(() =>
      editCanvasReferences(state, {
        action: "removeReference",
        nodeId: "target",
        field: "images",
        referenceId: "ref",
      })
    ).toThrow(/identity|connection/);
  }
});
