// @vitest-environment node
import { expect, it } from "vitest";
import * as Y from "yjs";
import {
  applyCanvasGeneration,
  isCanvasPanoramaOutput,
} from "../../../../canvas-editor/generation-edit";
import type { CanvasGenerationJob } from "../../../../canvas-editor/generation-schema";
import { reconcileCanvasShotMedia } from "../../../../canvas-editor/shot-media";
import { encodeCanvasBytes, materializeCanvas } from "../../../../canvas-editor/state";
const documentId = "11111111-1111-4111-8111-111111111111";
const job: CanvasGenerationJob = {
  id: "22222222-2222-4222-8222-222222222222",
  documentId,
  documentBlockId: "card",
  sourceSurface: "fizzstudio-canvas",
  modelId: "panorama-model",
  type: "image",
  status: "completed",
  prompt: "Landscape",
  createdAt: "2026-10-05T00:00:00.000Z",
  outputs: [
    {
      id: "output",
      assetId: "asset",
      type: "image",
      url: "https://example.test/pano",
      width: 2048,
      height: 1024,
    },
  ],
};
function fixture(mode = "image_to_panorama", modelId = "model", asset?: unknown) {
  const doc = new Y.Doc();
  doc.getMap("nodes").set(
    "card",
    new Y.Map<unknown>(
      Object.entries({
        id: "card",
        type: "prompt",
        position: { x: 24, y: 80 },
        selected: true,
        parentId: "group",
        data: new Y.Map<unknown>(
          Object.entries({
            mode,
            modelId,
            prompt: "Current label",
            generation: { jobId: job.id, status: "generating" },
            references: { referenceImages: [{ edgeId: "input", sourceNodeId: "source" }] },
          })
        ),
      })
    )
  );
  doc.getMap("nodes").set(
    "shot",
    new Y.Map<unknown>(
      Object.entries({
        id: "shot",
        type: "shot",
        data: new Y.Map(Object.entries({ label: "Shot", references: {} })),
      })
    )
  );
  for (const [id, source, target] of [
    ["input", "source", "card"],
    ["output-wire", "card", "shot"],
  ])
    doc.getMap("edges").set(id!, new Y.Map(Object.entries({ id, source, target })));
  doc.getMap("groups").set("group", { id: "group", nodeIds: ["card"] });
  if (asset) doc.getMap("assets").set("output", asset);
  const state = encodeCanvasBytes(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  return state;
}
it("converts panorama output atomically while preserving identity, placement, grouping and wires", () => {
  const state = fixture();
  const before = materializeCanvas(state, []).snapshot;
  const saved = applyCanvasGeneration(state, documentId, job);
  expect(saved.snapshot.nodes.card).toEqual({
    id: "card",
    type: "panorama",
    position: { x: 24, y: 80 },
    selected: true,
    parentId: "group",
    data: { src: job.outputs[0]!.url, mediaAssetId: "asset", label: "Current label" },
  });
  expect(saved.snapshot.edges).toEqual(before.edges);
  expect(saved.snapshot.groups).toEqual(before.groups);
  expect(saved.snapshot.assets.output).toMatchObject({
    panorama: true,
    mediaAssetId: "asset",
    width: 2048,
    height: 1024,
  });
  expect(
    materializeCanvas(state, [saved.yjsUpdateBase64!, saved.yjsUpdateBase64!]).snapshot
  ).toEqual(saved.snapshot);
  expect(applyCanvasGeneration(saved.state, documentId, job).yjsUpdateBase64).toBeNull();
  expect(
    applyCanvasGeneration(saved.state, documentId, { ...job, status: "running", outputs: [] })
      .yjsUpdateBase64
  ).toBeNull();
});
it.each(["hunyuan-image", "world-model", "PANORAMA"])("recognizes Web's %s model hint", (model) => {
  expect(
    applyCanvasGeneration(fixture("image_to_image", model), documentId, job).snapshot.nodes.card
  ).toHaveProperty("type", "panorama");
});
it("retains the composer for ordinary models, unfinished jobs, and non-panorama images", () => {
  expect(
    applyCanvasGeneration(fixture("image_to_image"), documentId, job).snapshot.nodes.card
  ).toHaveProperty("type", "prompt");
  for (const change of [
    { status: "running" as const },
    { status: "failed" as const },
    { outputs: [] },
    { outputs: [{ ...job.outputs[0]!, width: 1024 }] },
    { outputs: [{ ...job.outputs[0]!, width: undefined }] },
  ])
    expect(
      applyCanvasGeneration(fixture(), documentId, { ...job, ...change }).snapshot.nodes.card
    ).toHaveProperty("type", "prompt");
});
it("validates the shared-library collision before any conversion", () => {
  const state = fixture(undefined, undefined, { source: "uploaded", kind: "image" });
  expect(() => applyCanvasGeneration(state, documentId, job)).toThrow("conflicts");
  expect(materializeCanvas(state, []).snapshot.nodes.card).toHaveProperty("type", "prompt");
});
it("does not identify videos, zero dimensions or missing dimensions as panoramas", () => {
  expect(isCanvasPanoramaOutput(job.outputs[0])).toBe(true);
  expect(isCanvasPanoramaOutput(undefined)).toBe(false);
  expect(isCanvasPanoramaOutput({ ...job.outputs[0]!, type: "video" })).toBe(false);
  expect(isCanvasPanoramaOutput({ ...job.outputs[0]!, height: 0 })).toBe(false);
  expect(isCanvasPanoramaOutput({ ...job.outputs[0]!, height: undefined })).toBe(false);
});

it("keeps the panorama usable by the existing shot reconciliation flow", () => {
  const converted = applyCanvasGeneration(fixture(), documentId, job);
  const reconciled = reconcileCanvasShotMedia(converted.state);
  expect(reconciled.snapshot.nodes.shot).toHaveProperty(
    "data.references.frame.0",
    expect.objectContaining({ sourceNodeId: "card", assetId: "asset", url: job.outputs[0]!.url })
  );
  expect(reconciled.snapshot.edges.input).toEqual(converted.snapshot.edges.input);
  expect(reconcileCanvasShotMedia(reconciled.state).yjsUpdateBase64).toBeNull();
});
it("converts through the shipped runtime and returns a replayable delta", async () => {
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
  const state = fixture();
  host.__fizzCanvasReceive!(
    JSON.stringify({
      type: "generation",
      sessionId,
      requestId: 1,
      documentId,
      sequence: 2,
      snapshot: state,
      job,
    })
  );
  const { canvasRuntimeMessage } = await import("../../../../canvas-editor/protocol");
  const result = canvasRuntimeMessage.parse(received.at(-1));
  if (result.type !== "edited" || !result.yjsUpdateBase64) throw Error("Missing conversion delta");
  expect(result.snapshot.nodes.card).toHaveProperty("type", "panorama");
  expect(materializeCanvas(state, [result.yjsUpdateBase64]).snapshot).toEqual(result.snapshot);
});
