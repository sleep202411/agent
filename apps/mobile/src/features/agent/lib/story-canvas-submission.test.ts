// @vitest-environment node
import { expect, it } from "vitest";
import * as Y from "yjs";
import { recordCanvasSubmission } from "../../../../canvas-editor/submission-edit";
import type { CanvasSubmission } from "../../../../canvas-editor/submission-schema";
import { encodeCanvasBytes, materializeCanvas } from "../../../../canvas-editor/state";
const documentId = "11111111-1111-4111-8111-111111111111";
const command: CanvasSubmission = {
  ownerId: "alice",
  type: "image",
  submission: {
    context: {
      workspaceId: documentId,
      storyProjectId: documentId,
      documentId,
      documentBlockId: "card",
      sourceSurface: "fizzstudio-canvas",
    },
    idempotencyKey: "attempt",
    modelId: "model",
    schemaVersion: "v1",
    input: { prompt: "Lake", seed: 2 },
  },
};
function fixture(generation?: unknown, locked = false) {
  const doc = new Y.Doc();
  doc.getMap("nodes").set(
    "card",
    new Y.Map<unknown>(
      Object.entries({
        id: "card",
        type: "prompt",
        data: new Y.Map<unknown>(
          Object.entries({
            generation,
            locked,
            name: "Keep name",
            references: {},
            settings: { seed: 7 },
          })
        ),
      })
    )
  );
  const result = encodeCanvasBytes(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  return result;
}
it("records the complete Web recovery payload without modifying unrelated card fields", () => {
  const state = fixture();
  const result = recordCanvasSubmission(state, documentId, command);
  expect(result.yjsUpdateBase64).not.toBeNull();
  expect(
    materializeCanvas(state, [result.yjsUpdateBase64!, result.yjsUpdateBase64!]).snapshot
  ).toEqual(result.snapshot);
  expect(result.snapshot.nodes.card).toHaveProperty("data.generation", {
    status: "submitting",
    submissionOwnerId: "alice",
    submissionKey: "attempt",
    submission: command.submission,
  });
  expect(result.snapshot.nodes.card).toHaveProperty("data.name", "Keep name");
  expect(result.snapshot.nodes.card).toHaveProperty("data.settings.seed", 7);
  expect(result.snapshot.nodes.card).toHaveProperty("data.prompt", "Lake");
  expect(recordCanvasSubmission(result.state, documentId, command).yjsUpdateBase64).toBeNull();
});
it("rejects active runs, locked cards, mismatched documents and changed recovery bodies", () => {
  expect(() =>
    recordCanvasSubmission(
      fixture({ status: "generating", jobId: documentId }),
      documentId,
      command
    )
  ).toThrow("pending");
  expect(() => recordCanvasSubmission(fixture(undefined, true), documentId, command)).toThrow(
    "cannot"
  );
  expect(() => recordCanvasSubmission(fixture(), "other", command)).toThrow("another document");
  const result = recordCanvasSubmission(fixture(), documentId, command);
  expect(() =>
    recordCanvasSubmission(result.state, documentId, { ...command, ownerId: "bob" })
  ).toThrow("another account");
  expect(() =>
    recordCanvasSubmission(result.state, documentId, {
      ...command,
      submission: { ...command.submission, input: { prompt: "Changed" } },
    })
  ).toThrow("request changed");
});
it("accepts settled runs and reordered payload keys but never regresses an acknowledged same-key job", () => {
  const result = recordCanvasSubmission(
    fixture({ status: "done", jobId: documentId }),
    documentId,
    command
  );
  const reordered = {
    ...command,
    submission: { ...command.submission, input: { seed: 2, prompt: "Lake" } },
  };
  expect(recordCanvasSubmission(result.state, documentId, reordered).yjsUpdateBase64).toBeNull();
  const settled = fixture({ status: "done", submissionKey: "attempt", jobId: documentId });
  expect(recordCanvasSubmission(settled, documentId, command).yjsUpdateBase64).toBeNull();
});

it("records submissions through the bundled runtime bridge", async () => {
  const { runInNewContext } = await import("node:vm");
  const { webcrypto } = await import("node:crypto");
  const { default: bundle } = await import("../canvas-data/runtime-bundle.json");
  const { canvasRuntimeMessage } = await import("../../../../canvas-editor/protocol");
  const received: unknown[] = [];
  const host = {
    addEventListener() {},
    __fizzCanvasReceive: undefined as undefined | ((raw: string) => void),
  };
  runInNewContext(bundle, {
    window: host,
    document: { querySelector: () => ({ textContent: JSON.stringify({ sessionId: documentId }) }) },
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
  host.__fizzCanvasReceive!(
    JSON.stringify({
      type: "submission",
      sessionId: documentId,
      documentId,
      requestId: 1,
      sequence: 0,
      snapshot,
      submission: command,
    })
  );
  const result = canvasRuntimeMessage.parse(received.at(-1));
  if (result.type !== "edited" || !result.yjsUpdateBase64) throw Error("Missing submission delta");
  expect(materializeCanvas(snapshot, [result.yjsUpdateBase64]).snapshot).toEqual(result.snapshot);
  expect(result.snapshot.nodes.card).toHaveProperty("data.generation.submissionKey", "attempt");
});
