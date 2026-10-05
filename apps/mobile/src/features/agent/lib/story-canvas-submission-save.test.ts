import type { getGenerationJob } from "@/features/ai-lab/jobs-api";
import { beforeEach, expect, it, vi } from "vitest";
import {
  canvasSubmissionForCommand,
  persistCanvasSubmission,
  persistCanvasRetry,
  persistCanvasReceipt,
} from "./story-canvas-submission";
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

it("verifies retry ownership and media type before persisting its recovery record", async () => {
  const readJob = vi.fn<typeof getGenerationJob>();
  const job = { type: "image", status: "failed" } as Awaited<ReturnType<typeof getGenerationJob>>;
  readJob.mockResolvedValue(job);
  const retry = {
    clientKey: id,
    jobId: id,
    workspaceId: id,
    storyProjectId: id,
    documentId: id,
    documentBlockId: "card",
    sourceSurface: "fizzstudio-canvas" as const,
  };
  const run = () =>
    persistCanvasRetry(
      scope,
      "alice",
      "image",
      retry,
      new AbortController().signal,
      { queue, encode },
      readJob
    );
  await run();
  expect(readJob).toHaveBeenCalledWith(id, 1, expect.any(AbortSignal), {
    workspaceId: id,
    storyProjectId: id,
    documentId: id,
    documentBlockId: "card",
    sourceSurface: "fizzstudio-canvas",
  });
  expect(encode).toHaveBeenCalledWith(
    {
      ownerId: "alice",
      type: "image",
      retry: { documentId: id, documentBlockId: "card", jobId: id },
    },
    expect.any(AbortSignal)
  );
  encode.mockClear();
  queue.prepare.mockClear();
  readJob.mockResolvedValue({ ...job, type: "video" });
  await expect(run()).rejects.toThrow("media type");
  readJob.mockResolvedValue({ ...job, status: "completed" });
  await expect(run()).rejects.toThrow("failed generation");
  readJob.mockImplementation(async () => {
    h.generation++;
    return job;
  });
  await expect(run()).rejects.toThrow("expired");
  expect(encode).not.toHaveBeenCalled();
  expect(queue.prepare).not.toHaveBeenCalled();
});

it("attaches only the returned receipt and permits legacy retry keys after scoped lookup", async () => {
  const readJob = vi.fn<typeof getGenerationJob>();
  const childId = "22222222-2222-4222-8222-222222222222";
  const job = { id: childId, type: "image", idempotencyKey: id } as Awaited<
    ReturnType<typeof getGenerationJob>
  >;
  readJob.mockResolvedValue(job);
  const receipt = { request_id: childId, status: "in_queue" as const };
  const run = (
    raw = command as
      | import("@/features/ai-lab/jobs-api").GenerationCommand
      | import("@/features/ai-lab/jobs-api").GenerationRetry
  ) =>
    persistCanvasReceipt(
      scope,
      "alice",
      "image",
      raw,
      receipt,
      new AbortController().signal,
      { queue, encode },
      readJob
    );
  await run();
  expect(encode).toHaveBeenLastCalledWith(
    {
      ownerId: "alice",
      type: "image",
      receipt: { documentId: id, documentBlockId: "card", submissionKey: id, jobId: childId },
    },
    expect.any(AbortSignal)
  );
  readJob.mockResolvedValue({ ...job, idempotencyKey: "legacy" });
  await expect(run()).rejects.toThrow("does not match");
  await run({ ...command, jobId: id });
  expect(encode).toHaveBeenLastCalledWith(
    {
      ownerId: "alice",
      type: "image",
      receipt: {
        documentId: id,
        documentBlockId: "card",
        submissionKey: `retry:${id}`,
        jobId: childId,
      },
    },
    expect.any(AbortSignal)
  );
  readJob.mockResolvedValue({ ...job, id });
  await expect(run({ ...command, jobId: id })).rejects.toThrow("does not match");
});
