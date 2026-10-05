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
  const snapshot = fixture();
  const request = {
    type: "generation",
    sessionId,
    requestId: 1,
    documentId,
    sequence: 7,
    snapshot,
    job,
  };
  host.__fizzCanvasReceive!(JSON.stringify(request));
  expect(received.at(-1)).toMatchObject({
    type: "edited",
    documentId,
    sequence: 7,
    snapshot: { assets: { result: { mediaAssetId: "asset" } } },
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
