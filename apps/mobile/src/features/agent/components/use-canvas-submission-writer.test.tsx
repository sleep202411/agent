import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CanvasLoaded } from "../../../../canvas-editor/protocol";
import { useCanvasSubmissionWriter } from "./use-canvas-submission-writer";
const h = vi.hoisted(() => ({
  generation: 1,
  reader: null as null | { onResult(value: CanvasLoaded): void; onError(message: string): void },
  encoder: null as null | { onResult(value: string | null): void; onError(message: string): void },
  prepare: vi.fn(),
  resume: vi.fn(),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("expo-modules-core", () => ({
  uuid: { v4: () => "55555555-5555-4555-8555-555555555555" },
}));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/api-client", () => ({ api: {} }));
vi.mock("@/lib/durable-record", () => ({ durableRecord: vi.fn() }));
vi.mock("../lib/story-canvas-reconciliation", () => ({
  canvasReconciliation: () => ({
    read: () => null,
    canPrepare: () => true,
    prepare: h.prepare,
    resume: h.resume,
  }),
}));
vi.mock("./story-canvas-reader", () => ({
  StoryCanvasReader: (props: NonNullable<typeof h.reader>) => {
    h.reader = props;
    return null;
  },
}));
vi.mock("./story-canvas-encoder", () => ({
  StoryCanvasEncoder: (props: NonNullable<typeof h.encoder>) => {
    h.encoder = props;
    return null;
  },
}));
const id = "11111111-1111-4111-8111-111111111111";
const scope = { projectId: id, documentId: id, generation: 1 };
const command = {
  clientKey: id,
  workspaceId: id,
  storyProjectId: id,
  documentId: id,
  documentBlockId: "card",
  sourceSurface: "fizzstudio-canvas" as const,
  modelId: "model",
  schemaVersion: "v1",
  input: { prompt: "Lake" },
};
let writer: ReturnType<typeof useCanvasSubmissionWriter>;
function Host({ currentScope = scope }: { currentScope?: typeof scope }) {
  const value = useCanvasSubmissionWriter(currentScope, "alice", "image");
  useLayoutEffect(() => {
    writer = value;
  }, [value]);
  return value.bridge;
}
let root: Root;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  h.generation = 1;
  h.reader = null;
  h.encoder = null;
  h.resume.mockResolvedValue(true);
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Host />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
async function start(controller = new AbortController()) {
  let result!: Promise<unknown>;
  await act(async () => {
    result = writer.beforeSubmit(command, controller.signal).then(
      () => "saved",
      (error: Error) => error.message
    );
  });
  return { result, controller };
}
it("reads and encodes before awaiting the document acknowledgement", async () => {
  let ack!: () => void;
  h.resume.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        ack = resolve;
      })
  );
  const { result } = await start();
  expect(h.prepare).not.toHaveBeenCalled();
  await act(async () => h.reader!.onResult({ documentId: id } as CanvasLoaded));
  await act(async () => h.encoder!.onResult("delta"));
  expect(h.prepare).toHaveBeenCalledWith({
    clientKey: "55555555-5555-4555-8555-555555555555",
    yjsUpdateBase64: "delta",
  });
  const done = vi.fn();
  void result.then(done);
  expect(done).not.toHaveBeenCalled();
  await act(async () => ack());
  expect(await result).toBe("saved");
});
it("rejects a retired account callback instead of leaving the composer waiting", async () => {
  const { result } = await start();
  h.generation++;
  await act(async () => h.reader!.onResult({ documentId: id } as CanvasLoaded));
  expect(await result).toContain("expired");
  expect(h.prepare).not.toHaveBeenCalled();
});
it("cancels on unmount and ignores the late reader", async () => {
  const { result } = await start();
  const reader = h.reader!;
  await act(async () => root.unmount());
  expect(await result).toContain("interrupted");
  await act(async () => reader.onResult({ documentId: id } as CanvasLoaded));
  expect(h.prepare).not.toHaveBeenCalled();
});
it("allows a new attempt after abort without accepting the old callback", async () => {
  const first = await start();
  const old = h.reader!;
  await act(async () => first.controller.abort());
  expect(await first.result).toContain("interrupted");
  const second = await start();
  await act(async () => old.onError("old error"));
  await act(async () => h.reader!.onResult({ documentId: id } as CanvasLoaded));
  await act(async () => h.encoder!.onResult(null));
  expect(await second.result).toBe("saved");
  expect(h.prepare).not.toHaveBeenCalled();
});
it("rejects a different document and concurrent attempts", async () => {
  const { result } = await start();
  await expect(writer.beforeSubmit(command, new AbortController().signal)).rejects.toThrow(
    "already in progress"
  );
  await act(async () => h.reader!.onResult({ documentId: "other" } as CanvasLoaded));
  expect(await result).toContain("document changed");
  expect(h.prepare).not.toHaveBeenCalled();
});

it("retires the previous scope and rejects retained submit callbacks", async () => {
  const retired = writer.beforeSubmit;
  const { result } = await start();
  await act(async () =>
    root.render(
      <Host currentScope={{ ...scope, projectId: "22222222-2222-4222-8222-222222222222" }} />
    )
  );
  expect(await result).toContain("interrupted");
  await expect(retired(command, new AbortController().signal)).rejects.toThrow("expired");
  expect(h.prepare).not.toHaveBeenCalled();
});

it("returns verified authoring conflicts with the fresh card and no write", async () => {
  const { CANVAS_CARD_CONFLICT, CanvasCardConflictError } =
    await import("../../../../canvas-editor/card-state-schema");
  let outcome!: Promise<unknown>;
  await act(async () => {
    outcome = writer.beforeSubmit(command, new AbortController().signal).catch((error) => error);
  });
  await act(async () =>
    h.reader!.onResult({
      documentId: id,
      snapshot: { nodes: { card: { data: { prompt: "Latest" } } } },
    } as unknown as CanvasLoaded)
  );
  await act(async () => h.encoder!.onError(CANVAS_CARD_CONFLICT + "prompt changed"));
  const error = await outcome;
  expect(error).toBeInstanceOf(CanvasCardConflictError);
  expect((error as InstanceType<typeof CanvasCardConflictError>).current.prompt).toBe("Latest");
  expect(h.prepare).not.toHaveBeenCalled();
});
