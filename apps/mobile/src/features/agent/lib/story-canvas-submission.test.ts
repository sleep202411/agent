// @vitest-environment node
import { expect, it } from "vitest";
import * as Y from "yjs";
import { recordCanvasSubmission } from "../../../../canvas-editor/submission-edit";
import { canvasCardStateSchema } from "../../../../canvas-editor/card-state-schema";
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

it.each(["submission", "platform", "edit", "retry", "receipt", "authoring"] as const)(
  "records %s through the bundled runtime bridge",
  async (kind) => {
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
      document: {
        querySelector: () => ({ textContent: JSON.stringify({ sessionId: documentId }) }),
      },
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
    const snapshot = fixture(
      kind === "receipt"
        ? { status: "submitting", submissionKey: "attempt", submissionOwnerId: "alice" }
        : kind === "retry"
          ? { status: "failed", jobId: documentId }
          : undefined
    );
    host.__fizzCanvasReceive!(
      JSON.stringify({
        type: "submission",
        sessionId: documentId,
        documentId,
        requestId: 1,
        sequence: 0,
        snapshot,
        submission:
          kind === "authoring"
            ? {
                ownerId: "alice",
                type: "image",
                authoring: {
                  documentId,
                  documentBlockId: "card",
                  edit: {
                    before: canvasCardStateSchema.parse({ settings: { seed: 7 } }),
                    after: canvasCardStateSchema.parse({
                      prompt: "Autosaved",
                      settings: { seed: 7 },
                    }),
                  },
                },
              }
            : kind === "retry"
              ? {
                  ownerId: "alice",
                  type: "image",
                  retry: { documentId, documentBlockId: "card", jobId: documentId },
                }
              : kind === "receipt"
                ? {
                    ownerId: "alice",
                    type: "image",
                    receipt: {
                      documentId,
                      documentBlockId: "card",
                      submissionKey: "attempt",
                      jobId: documentId,
                    },
                  }
                : kind === "edit"
                  ? {
                      ...command,
                      cardEdit: {
                        before: canvasCardStateSchema.parse({ settings: { seed: 7 } }),
                        after: canvasCardStateSchema.parse({
                          modelId: "model",
                          prompt: "Lake",
                          mode: "image_to_image",
                          settings: { seed: 2 },
                        }),
                      },
                    }
                  : kind === "platform"
                    ? {
                        ...command,
                        submission: {
                          ...command.submission,
                          context: {
                            ...command.submission.context,
                            storyProjectId: undefined,
                            projectId: documentId,
                          },
                        },
                      }
                    : command,
      })
    );
    const result = canvasRuntimeMessage.parse(received.at(-1));
    if (result.type !== "edited" || !result.yjsUpdateBase64)
      throw Error("Missing submission delta");
    expect(materializeCanvas(snapshot, [result.yjsUpdateBase64]).snapshot).toEqual(result.snapshot);
    if (kind === "platform") {
      expect(result.snapshot.nodes.card).toHaveProperty(
        "data.generation.submission.context.projectId",
        documentId
      );
      expect(result.snapshot.nodes.card).not.toHaveProperty(
        "data.generation.submission.context.storyProjectId"
      );
    }
    if (kind === "edit")
      expect(result.snapshot.nodes.card).toHaveProperty("data.mode", "image_to_image");
    if (kind === "authoring") {
      expect(result.snapshot.nodes.card).toHaveProperty("data.prompt", "Autosaved");
      expect(result.snapshot.nodes.card).not.toHaveProperty("data.generation.submissionKey");
    } else
      expect(result.snapshot.nodes.card).toHaveProperty(
        "data.generation.submissionKey",
        kind === "retry" ? `retry:${documentId}` : "attempt"
      );
  }
);

it("records a stable retry key only for the current failed job, preserving card content", () => {
  const retry = {
    ownerId: "alice",
    type: "image" as const,
    retry: { documentId, documentBlockId: "card", jobId: documentId },
  };
  const initial = fixture({ status: "failed", jobId: documentId, submissionKey: "old" });
  const result = recordCanvasSubmission(initial, documentId, retry);
  expect(result.snapshot.nodes.card).toHaveProperty("data.generation", {
    status: "submitting",
    submissionKey: `retry:${documentId}`,
    submissionOwnerId: "alice",
  });
  expect(result.snapshot.nodes.card).toHaveProperty("data.settings.seed", 7);
  expect(
    materializeCanvas(initial, [result.yjsUpdateBase64!, result.yjsUpdateBase64!]).snapshot
  ).toEqual(result.snapshot);
  expect(recordCanvasSubmission(result.state, documentId, retry).yjsUpdateBase64).toBeNull();
  expect(() =>
    recordCanvasSubmission(result.state, documentId, { ...retry, ownerId: "bob" })
  ).toThrow("another account");
  for (const generation of [
    undefined,
    { status: "done", jobId: documentId },
    { status: "failed", jobId: "other" },
    { status: "generating", jobId: documentId },
  ])
    expect(() => recordCanvasSubmission(fixture(generation), documentId, retry)).toThrow(
      "retry target"
    );
  const settled = fixture({ status: "done", jobId: "child", submissionKey: `retry:${documentId}` });
  expect(recordCanvasSubmission(settled, documentId, retry).yjsUpdateBase64).toBeNull();
});

it("attaches acknowledged legacy retries without replacing their recovery key or a newer run", async () => {
  const { applyCanvasGeneration } = await import("../../../../canvas-editor/generation-edit");
  const childId = "22222222-2222-4222-8222-222222222222";
  const retry = {
    ownerId: "alice",
    type: "image" as const,
    retry: { documentId, documentBlockId: "card", jobId: documentId },
  };
  const started = recordCanvasSubmission(
    fixture({ jobId: documentId, status: "failed" }),
    documentId,
    retry
  );
  const receipt = {
    ownerId: "alice",
    type: "image" as const,
    receipt: {
      documentId,
      documentBlockId: "card",
      submissionKey: `retry:${documentId}`,
      jobId: childId,
    },
  };
  const attached = recordCanvasSubmission(started.state, documentId, receipt);
  expect(materializeCanvas(started.state, [attached.yjsUpdateBase64!]).snapshot).toEqual(
    attached.snapshot
  );
  expect(recordCanvasSubmission(attached.state, documentId, receipt).yjsUpdateBase64).toBeNull();
  const settled = applyCanvasGeneration(attached.state, documentId, {
    id: childId,
    idempotencyKey: "legacy-key",
    type: "image",
    modelId: "model",
    status: "completed",
    documentId,
    documentBlockId: "card",
    sourceSurface: "fizzstudio-canvas",
    prompt: "Lake",
    createdAt: "2026-10-05T00:00:00Z",
    outputs: [],
  });
  expect(settled.snapshot.nodes.card).toHaveProperty(
    "data.generation.submissionKey",
    `retry:${documentId}`
  );
  expect(settled.snapshot.nodes.card).toHaveProperty("data.generation.submissionOwnerId", "alice");
  expect(recordCanvasSubmission(settled.state, documentId, retry).yjsUpdateBase64).toBeNull();
  expect(recordCanvasSubmission(settled.state, documentId, receipt).yjsUpdateBase64).toBeNull();
  expect(() =>
    recordCanvasSubmission(started.state, documentId, { ...receipt, ownerId: "bob" })
  ).toThrow("no longer belongs");
  expect(() =>
    recordCanvasSubmission(fixture({ submissionKey: "newer" }), documentId, receipt)
  ).toThrow("no longer belongs");
  expect(() =>
    recordCanvasSubmission(
      fixture({ submissionKey: `retry:${documentId}`, jobId: documentId }),
      documentId,
      receipt
    )
  ).toThrow("replaced");
});

it("atomically saves authoring fields and detaches removed references with replayable recovery", () => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Uint8Array.from(Buffer.from(fixture(), "base64")));
  const node = doc.getMap("nodes").get("card") as Y.Map<unknown>;
  const data = node.get("data") as Y.Map<unknown>;
  data.set("references", {
    referenceImages: [
      { id: "ref", edgeId: "edge", sourceNodeId: "source", url: "https://example.com/ref.png" },
    ],
  });
  doc
    .getMap("edges")
    .set("edge", new Y.Map(Object.entries({ id: "edge", source: "source", target: "card" })));
  const before = canvasCardStateSchema.parse(data.toJSON());
  const after = {
    ...before,
    prompt: "Lake",
    modelId: "model",
    mode: "image_to_image",
    settings: { seed: 2 },
    references: { referenceImages: [] },
  };
  const state = encodeCanvasBytes(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  const edited = { ...command, cardEdit: { before, after } };
  const result = recordCanvasSubmission(state, documentId, edited);
  expect(result.snapshot.nodes.card).toHaveProperty("data.settings", { seed: 2 });
  expect(result.snapshot.nodes.card).toHaveProperty("data.mode", "image_to_image");
  expect(result.snapshot.nodes.card).toHaveProperty("data.references", { referenceImages: [] });
  expect(result.snapshot.nodes.card).toHaveProperty("data.name", "Keep name");
  expect(result.snapshot.edges.edge).toBeUndefined();
  expect(
    materializeCanvas(state, [result.yjsUpdateBase64!, result.yjsUpdateBase64!]).snapshot
  ).toEqual(result.snapshot);
  expect(recordCanvasSubmission(result.state, documentId, edited).yjsUpdateBase64).toBeNull();
  const conflict = {
    ...edited,
    cardEdit: { ...edited.cardEdit, before: { ...before, prompt: "someone else's version" } },
  };
  expect(() => recordCanvasSubmission(state, documentId, conflict)).toThrow(
    "changed while composing"
  );
});
it("rejects stale unedited authoring fields and rebound edges before starting a job", () => {
  const before = canvasCardStateSchema.parse({ settings: { seed: 99 } });
  const after = { ...before, prompt: "Lake", modelId: "model" };
  expect(() =>
    recordCanvasSubmission(fixture(), documentId, { ...command, cardEdit: { before, after } })
  ).toThrow("settings changed");
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Uint8Array.from(Buffer.from(fixture(), "base64")));
  const data = (doc.getMap("nodes").get("card") as Y.Map<unknown>).get("data") as Y.Map<unknown>;
  data.set("references", {
    referenceImages: [{ id: "ref", edgeId: "edge", sourceNodeId: "original" }],
  });
  doc
    .getMap("edges")
    .set("edge", new Y.Map(Object.entries({ id: "edge", source: "new-source", target: "card" })));
  const current = canvasCardStateSchema.parse(data.toJSON());
  const state = encodeCanvasBytes(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  expect(() =>
    recordCanvasSubmission(state, documentId, {
      ...command,
      cardEdit: {
        before: current,
        after: { ...current, prompt: "Lake", modelId: "model", references: {} },
      },
    })
  ).toThrow("connection changed");
});

it("autosaves authoring without creating or replacing a generation job", () => {
  const generation = { status: "generating", jobId: documentId };
  const before = canvasCardStateSchema.parse({ settings: { seed: 7 } });
  const authoring = {
    ownerId: "alice",
    type: "image" as const,
    authoring: {
      documentId,
      documentBlockId: "card",
      edit: {
        before,
        after: { ...before, prompt: "", settings: { seed: 9 } },
      },
    },
  };
  const result = recordCanvasSubmission(fixture(generation), documentId, authoring);
  expect(result.snapshot.nodes.card).toHaveProperty("data.generation", generation);
  expect(result.snapshot.nodes.card).toHaveProperty("data.settings.seed", 9);
  expect(result.snapshot.nodes.card).toHaveProperty("data.name", "Keep name");
  expect(recordCanvasSubmission(result.state, documentId, authoring).yjsUpdateBase64).toBeNull();
  expect(() => recordCanvasSubmission(fixture(undefined, true), documentId, authoring)).toThrow();
  const changed = {
    ...authoring,
    authoring: {
      ...authoring.authoring,
      edit: { before, after: { ...before, settings: { seed: 11 } } },
    },
  };
  expect(() => recordCanvasSubmission(result.state, documentId, changed)).toThrow("changed");
  const idle = recordCanvasSubmission(fixture(), documentId, authoring);
  expect(idle.snapshot.nodes.card).not.toHaveProperty("data.generation.status");
});

it("rejects frozen submissions with missing or ambiguous project owners", () => {
  for (const owner of [
    { projectId: undefined, storyProjectId: undefined },
    { projectId: documentId, storyProjectId: documentId },
  ]) {
    expect(() =>
      recordCanvasSubmission(fixture(), documentId, {
        ...command,
        submission: { ...command.submission, context: { ...command.submission.context, ...owner } },
      })
    ).toThrow();
  }
});
