// @vitest-environment node
import { expect, it } from "vitest";
import * as Y from "yjs";
import { applyCanvasGeneration } from "../../../../canvas-editor/generation-edit";
import { type CanvasGenerationJob } from "../../../../canvas-editor/generation-schema";
import { encodeCanvasBytes, materializeCanvas } from "../../../../canvas-editor/state";
const documentId = "11111111-1111-4111-8111-111111111111";
const job: CanvasGenerationJob = {
  id: "22222222-2222-4222-8222-222222222222",
  documentId,
  documentBlockId: "card",
  sourceSurface: "fizzstudio-canvas",
  idempotencyKey: "attempt",
  modelId: "image-model",
  type: "image",
  status: "completed",
  prompt: "A lake",
  createdAt: "2026-10-05T00:00:00.000Z",
  outputs: [{ id: "result", assetId: "asset", type: "image", url: "https://example.test/image" }],
};
function fixture(
  generation: unknown = { status: "uncertain", submissionKey: "attempt" },
  asset?: unknown
) {
  const doc = new Y.Doc();
  const data = new Y.Map<unknown>(
    Object.entries({ modelId: "image-model", prompt: "Retain current draft", generation })
  );
  doc
    .getMap("nodes")
    .set("card", new Y.Map<unknown>(Object.entries({ id: "card", type: "prompt", data })));
  doc.getMap("nodes").set(
    "note",
    new Y.Map<unknown>(
      Object.entries({
        id: "note",
        type: "note",
        data: new Y.Map(Object.entries({ text: "Keep" })),
      })
    )
  );
  if (asset) doc.getMap("assets").set("result", asset);
  const state = encodeCanvasBytes(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  return state;
}
it("replays a recovered result as a delta and adds durable generated media exactly once", () => {
  const state = fixture();
  const result = applyCanvasGeneration(state, documentId, job);
  expect(result.yjsUpdateBase64).not.toBeNull();
  expect(
    materializeCanvas(state, [result.yjsUpdateBase64!, result.yjsUpdateBase64!]).snapshot
  ).toEqual(result.snapshot);
  expect(result.snapshot.nodes.card).toHaveProperty("data.prompt", "Retain current draft");
  expect(result.snapshot.nodes.card).toHaveProperty(
    "data.generation",
    expect.objectContaining({ jobId: job.id, status: "done", submissionKey: "attempt" })
  );
  expect(result.snapshot.nodes.note).toHaveProperty("data.text", "Keep");
  expect(result.snapshot.assets.result).toMatchObject({
    mediaAssetId: "asset",
    source: "generated",
    prompt: "A lake",
    createdAt: Date.parse(job.createdAt),
  });
  expect(applyCanvasGeneration(result.state, documentId, job).yjsUpdateBase64).toBeNull();
  expect(
    applyCanvasGeneration(result.state, documentId, { ...job, status: "running", outputs: [] })
      .yjsUpdateBase64
  ).toBeNull();
});
it("does not replace another document, deleted card, or newer submission", () => {
  expect(() => applyCanvasGeneration(fixture(), job.id, job)).toThrow("another document");
  expect(() =>
    applyCanvasGeneration(fixture(), documentId, { ...job, documentBlockId: "gone" })
  ).toThrow("unavailable");
  expect(() =>
    applyCanvasGeneration(
      fixture({ status: "queued", submissionKey: "new-attempt" }),
      documentId,
      job
    )
  ).toThrow("another run");
  expect(() =>
    applyCanvasGeneration(fixture({ status: "queued", jobId: documentId }), documentId, job)
  ).toThrow("another run");
  expect(() => applyCanvasGeneration(fixture(), documentId, { ...job, type: "video" })).toThrow(
    "match"
  );
});
it("recovers a missing projection only for the matching model and never clobbers library edits", () => {
  expect(() =>
    applyCanvasGeneration(fixture(null), documentId, { ...job, modelId: "different" })
  ).toThrow("another run");
  const saved = {
    id: "result",
    mediaAssetId: "asset",
    kind: "image",
    source: "generated",
    url: job.outputs[0]!.url,
    name: "User renamed",
    createdAt: 1,
  };
  const result = applyCanvasGeneration(fixture(null, saved), documentId, job);
  expect(result.snapshot.assets.result).toEqual(saved);
  const refreshed = applyCanvasGeneration(result.state, documentId, {
    ...job,
    outputs: [{ ...job.outputs[0]!, url: "https://example.test/refreshed" }],
  });
  expect(refreshed.snapshot.assets.result).toEqual({
    ...saved,
    url: "https://example.test/refreshed",
  });
  const conflict = fixture(null, { ...saved, source: "uploaded" });
  expect(() => applyCanvasGeneration(conflict, documentId, job)).toThrow("conflicts");
  expect(materializeCanvas(conflict, []).snapshot.nodes.card).toHaveProperty(
    "data.generation",
    null
  );
});
it("keeps failed details and hydrates a completed receipt with delayed outputs", () => {
  const failed = applyCanvasGeneration(fixture(), documentId, {
    ...job,
    status: "failed",
    outputs: [],
    error: { code: "PROVIDER_ERROR", userMessage: "Provider rejected input" },
  });
  expect(failed.snapshot.nodes.card).toHaveProperty(
    "data.generation.error",
    "Provider rejected input"
  );
  expect(failed.snapshot.assets).toEqual({});
  const receipt = applyCanvasGeneration(fixture(), documentId, { ...job, outputs: [] });
  expect(receipt.snapshot.assets).toEqual({});
  expect(
    applyCanvasGeneration(receipt.state, documentId, job).snapshot.assets.result
  ).toHaveProperty("mediaAssetId", "asset");
});

it("applies results through the shipped bridge and rejects mismatched document identity", async () => {
  const { runInNewContext } = await import("node:vm");
  const { webcrypto } = await import("node:crypto");
  const { default: bundle } = await import("../canvas-data/runtime-bundle.json");
  const sessionId = "33333333-3333-4333-8333-333333333333";
  const received: unknown[] = [];
  const host = {
    addEventListener() {},
    __fizzCanvasReceive: undefined as undefined | ((raw: string) => void),
  };
  runInNewContext(bundle, {
    window: host,
    document: { querySelector: () => ({ textContent: JSON.stringify({ sessionId }) }) },
    parent: { postMessage: (raw: string) => received.push(JSON.parse(raw)) },
    crypto: webcrypto,
    URL,
    TextEncoder,
    TextDecoder,
    atob,
    btoa,
    setTimeout,
    clearTimeout,
    console,
  });
  const snapshot = connected();
  const request = {
    type: "generation",
    sessionId,
    requestId: 1,
    documentId,
    sequence: 7,
    snapshot,
    job: routedJob,
  };
  host.__fizzCanvasReceive!(JSON.stringify(request));
  expect(received.at(-1)).toMatchObject({
    type: "edited",
    documentId,
    sequence: 7,
    snapshot: {
      assets: { result: { mediaAssetId: "asset" } },
      nodes: { target: { data: { references: { referenceImages: [{ edgeId: "wire" }] } } } },
    },
  });
  const { canvasRuntimeMessage } = await import("../../../../canvas-editor/protocol");
  const result = canvasRuntimeMessage.parse(received.at(-1));
  if (result.type !== "edited" || !result.yjsUpdateBase64) throw Error("Missing generation delta");
  expect(materializeCanvas(snapshot, [result.yjsUpdateBase64]).snapshot).toEqual(result.snapshot);
  host.__fizzCanvasReceive!(JSON.stringify({ ...request, requestId: 2, documentId: sessionId }));
  expect(received.at(-1)).toMatchObject({
    type: "error",
    message: "Generation belongs to another document.",
  });
});

function connected(refs: unknown = {}, mode = "image_to_image") {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Uint8Array.from(Buffer.from(fixture(), "base64")));
  doc.getMap("nodes").set(
    "target",
    new Y.Map<unknown>(
      Object.entries({
        id: "target",
        type: "prompt",
        data: new Y.Map<unknown>(
          Object.entries({
            modelId: "target-model",
            mode,
            references: refs,
            prompt: "Keep target prompt",
          })
        ),
      })
    )
  );
  doc
    .getMap("edges")
    .set("wire", new Y.Map(Object.entries({ id: "wire", source: "card", target: "target" })));
  const state = encodeCanvasBytes(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  return state;
}
const routedJob: CanvasGenerationJob = {
  ...job,
  referenceTargets: {
    target: {
      modelId: "target-model",
      mode: "image_to_image",
      fields: [{ field: "referenceImages", kind: "image", maxItems: 2 }],
    },
  },
};
it("backfills a connected generation input, preserves other references and replays idempotently", () => {
  const state = connected({
    referenceImages: [{ id: "manual", url: "https://example.test/manual" }],
    referenceAudios: [{ id: "sound" }],
  });
  const saved = applyCanvasGeneration(state, documentId, routedJob);
  expect(saved.snapshot.nodes.target).toHaveProperty("data.prompt", "Keep target prompt");
  expect(saved.snapshot.nodes.target).toHaveProperty("data.references", {
    referenceImages: [
      { id: "manual", url: "https://example.test/manual" },
      {
        id: "wire",
        edgeId: "wire",
        sourceNodeId: "card",
        url: job.outputs[0]!.url,
        kind: "image",
        name: "A lake",
        assetId: "asset",
      },
    ],
    referenceAudios: [{ id: "sound" }],
  });
  expect(materializeCanvas(state, [saved.yjsUpdateBase64!]).snapshot).toEqual(saved.snapshot);
  expect(applyCanvasGeneration(saved.state, documentId, routedJob).yjsUpdateBase64).toBeNull();
  const refreshed = applyCanvasGeneration(saved.state, documentId, {
    ...routedJob,
    outputs: [{ ...job.outputs[0]!, url: "https://example.test/new", width: 1024 }],
  });
  expect(refreshed.snapshot.nodes.target).toHaveProperty(
    "data.references.referenceImages.1.width",
    1024
  );
  expect(refreshed.snapshot.nodes.target).toHaveProperty(
    "data.references.referenceImages.1.url",
    "https://example.test/new"
  );
});
it("leaves full, unsupported and changed-mode targets untouched without losing the result", () => {
  for (const state of [
    connected({ referenceImages: [{ id: "a" }, { id: "b" }] }),
    connected({}, "text_to_image"),
    connected({ referenceImages: "invalid" }),
  ]) {
    const before = materializeCanvas(state, []).snapshot.nodes.target;
    const result = applyCanvasGeneration(state, documentId, routedJob);
    expect(result.snapshot.nodes.target).toEqual(before);
    expect(result.snapshot.assets.result).toBeDefined();
  }
  const state = connected();
  const unsupported = {
    ...routedJob,
    referenceTargets: {
      target: {
        ...routedJob.referenceTargets!.target!,
        fields: [{ field: "audio", kind: "audio" as const, maxItems: 1 }],
      },
    },
  };
  expect(applyCanvasGeneration(state, documentId, unsupported).snapshot.nodes.target).toEqual(
    materializeCanvas(state, []).snapshot.nodes.target
  );
  const running = applyCanvasGeneration(state, documentId, { ...routedJob, status: "running" });
  expect(running.snapshot.nodes.target).toHaveProperty("data.references", {});
});
it("refreshes an already-completed card's previously unbound wire and removes its obsolete slot binding", () => {
  const state = connected({ obsolete: [{ edgeId: "wire", url: "https://example.test/old" }] });
  const first = applyCanvasGeneration(state, documentId, job);
  const backfilled = applyCanvasGeneration(first.state, documentId, routedJob);
  expect(backfilled.snapshot.nodes.target).toHaveProperty("data.references.obsolete", []);
  expect(backfilled.snapshot.nodes.target).toHaveProperty(
    "data.references.referenceImages.0.edgeId",
    "wire"
  );
  expect(applyCanvasGeneration(backfilled.state, documentId, routedJob).yjsUpdateBase64).toBeNull();
});

it("ignores removed wires and targets whose model changed since catalog discovery", () => {
  for (const mutate of [
    (doc: Y.Doc) => doc.getMap("edges").delete("wire"),
    (doc: Y.Doc) =>
      ((doc.getMap("nodes").get("target") as Y.Map<unknown>).get("data") as Y.Map<unknown>).set(
        "modelId",
        "different"
      ),
  ]) {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, Uint8Array.from(Buffer.from(connected(), "base64")));
    mutate(doc);
    const state = encodeCanvasBytes(Y.encodeStateAsUpdate(doc));
    doc.destroy();
    expect(
      applyCanvasGeneration(state, documentId, routedJob).snapshot.nodes.target
    ).toHaveProperty("data.references", {});
  }
});
it("allocates multiple wires against fresh capacity without causing a reconciliation write loop", () => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Uint8Array.from(Buffer.from(connected(), "base64")));
  doc
    .getMap("edges")
    .set("wire2", new Y.Map(Object.entries({ id: "wire2", source: "card", target: "target" })));
  const state = encodeCanvasBytes(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  const result = applyCanvasGeneration(state, documentId, routedJob);
  expect(result.snapshot.nodes.target).toHaveProperty("data.references.referenceImages.length", 2);
  expect(applyCanvasGeneration(result.state, documentId, routedJob).yjsUpdateBase64).toBeNull();
});
it.each(["video", "audio"] as const)(
  "propagates a completed %s with its durable media metadata",
  (kind) => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, Uint8Array.from(Buffer.from(connected(), "base64")));
    (doc.getMap("nodes").get("card") as Y.Map<unknown>).set("type", kind);
    const state = encodeCanvasBytes(Y.encodeStateAsUpdate(doc));
    doc.destroy();
    const result = applyCanvasGeneration(state, documentId, {
      ...routedJob,
      type: kind,
      outputs: [{ ...job.outputs[0]!, type: kind, durationSeconds: 8, bytes: 1024 }],
      referenceTargets: {
        target: {
          ...routedJob.referenceTargets!.target!,
          fields: [{ field: "media", kind, maxItems: 1 }],
        },
      },
    });
    expect(result.snapshot.nodes.target).toHaveProperty(
      "data.references.media.0",
      expect.objectContaining({ kind, durationSeconds: 8, bytes: 1024, assetId: "asset" })
    );
  }
);
it("routes to the second frame when the first frame is occupied", () => {
  const result = applyCanvasGeneration(
    connected({ startFrame: [{ id: "existing" }] }),
    documentId,
    {
      ...routedJob,
      referenceTargets: {
        target: {
          ...routedJob.referenceTargets!.target!,
          fields: [
            { field: "startFrame", kind: "image", maxItems: 1 },
            { field: "endFrame", kind: "image", maxItems: 1 },
          ],
        },
      },
    }
  );
  expect(result.snapshot.nodes.target).toHaveProperty("data.references.startFrame", [
    { id: "existing" },
  ]);
  expect(result.snapshot.nodes.target).toHaveProperty("data.references.endFrame.0.edgeId", "wire");
});
