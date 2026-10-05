import { beforeEach, expect, it, vi } from "vitest";
import { canvasSubmissionForCommand, persistCanvasSubmission } from "./story-canvas-submission";
import type { CanvasUpdateCommand } from "../api/story-canvas-update";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("expo-modules-core", () => ({
  uuid: { v4: () => "55555555-5555-4555-8555-555555555555" },
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: {} }));
vi.mock("@/lib/durable-record", () => ({ durableRecord: vi.fn() }));
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
  input: { prompt: "Lake", seed: 2 },
};
let pending: CanvasUpdateCommand | null;
let allowed: boolean;
const queue = {
  read: () => pending,
  canPrepare: () => allowed && !pending,
  prepare: vi.fn((value: CanvasUpdateCommand) => {
    pending = value;
  }),
  resume: vi.fn(async (_signal: AbortSignal) => {
    pending = null;
    return true;
  }),
};
const encode = vi.fn(async () => "AAA=" as string | null);
beforeEach(() => {
  vi.clearAllMocks();
  h.generation = 1;
  pending = null;
  allowed = true;
  encode.mockResolvedValue("AAA=");
  queue.resume.mockImplementation(async () => {
    pending = null;
    return true;
  });
});
const save = (signal = new AbortController().signal) =>
  persistCanvasSubmission(scope, "alice", "image", command, signal, { queue, encode });
it("preserves the frozen request in the official Web submission shape", () => {
  expect(canvasSubmissionForCommand(scope, "alice", "image", command)).toEqual({
    ownerId: "alice",
    type: "image",
    submission: {
      idempotencyKey: id,
      context: {
        workspaceId: id,
        storyProjectId: id,
        documentId: id,
        documentBlockId: "card",
        sourceSurface: "fizzstudio-canvas",
      },
      modelId: "model",
      schemaVersion: "v1",
      input: { prompt: "Lake", seed: 2 },
    },
  });
  expect(() =>
    canvasSubmissionForCommand({ ...scope, documentId: "other" }, "alice", "image", command)
  ).toThrow("belong");
});
it("persists encoded bytes and waits for acknowledgement before returning", async () => {
  let acknowledge!: () => void;
  queue.resume.mockImplementationOnce(
    () =>
      new Promise<boolean>((resolve) => {
        acknowledge = () => {
          pending = null;
          resolve(true);
        };
      })
  );
  const done = vi.fn();
  const saving = save().then(done);
  await vi.waitFor(() => expect(queue.resume).toHaveBeenCalledOnce());
  expect(pending?.yjsUpdateBase64).toBe("AAA=");
  expect(done).not.toHaveBeenCalled();
  acknowledge();
  await saving;
  expect(done).toHaveBeenCalledOnce();
});
it("resumes lost bytes before re-reading, without replacing a pending update", async () => {
  queue.resume.mockRejectedValueOnce(Error("Lost reply"));
  await expect(save()).rejects.toThrow("Lost reply");
  const original = pending;
  encode.mockImplementationOnce(async () => {
    expect(pending).toBeNull();
    return null;
  });
  await save();
  expect(queue.prepare).toHaveBeenCalledExactlyOnceWith(original);
  expect(queue.resume).toHaveBeenCalledTimes(2);
});
it("rejects manual drafts and account/abort changes without encoding or saving", async () => {
  allowed = false;
  await expect(save()).rejects.toThrow("saved canvas action");
  expect(encode).not.toHaveBeenCalled();
  allowed = true;
  encode.mockImplementationOnce(async () => {
    h.generation++;
    return "AAA=";
  });
  await expect(save()).rejects.toThrow("expired");
  expect(queue.prepare).not.toHaveBeenCalled();
  h.generation = 1;
  const controller = new AbortController();
  controller.abort();
  await expect(save(controller.signal)).rejects.toThrow();
  expect(queue.resume).not.toHaveBeenCalled();
});
it("rechecks drafts after encoding and handles an already-recorded request as a no-op", async () => {
  encode.mockImplementationOnce(async () => {
    allowed = false;
    return "AAA=";
  });
  await expect(save()).rejects.toThrow("saved canvas action");
  expect(queue.prepare).not.toHaveBeenCalled();
  allowed = true;
  encode.mockResolvedValueOnce(null);
  await save();
  expect(queue.prepare).not.toHaveBeenCalled();
});
