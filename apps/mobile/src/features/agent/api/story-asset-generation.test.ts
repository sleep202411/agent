import { beforeEach, expect, it, vi } from "vitest";
import {
  getAssetGeneration,
  assetGenerationInput,
  assetGenerationPending,
} from "./story-asset-generation";
const h = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn(), generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { post: h.post, get: h.get } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/durable-record", () => ({ durableRecord: vi.fn() }));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = {
  projectId: id(1),
  chapterId: id(2),
  assetId: id(4),
  purpose: "primary" as const,
  outputKind: "video" as const,
  generation: 1,
};
const path = `/story-projects/${id(1)}/chapters/${id(2)}/asset-specs/${id(4)}/generations`;
const result = (n = 5) => ({
  id: id(n),
  projectId: id(1),
  chapterId: id(2),
  target: { kind: "asset_spec", id: id(4), sequenceId: null },
  targetVersion: 2,
  outputKind: "video",
  purpose: "primary",
  retryOfGenerationId: null,
  aiJob: {
    id: id(8),
    modelId: "model",
    schemaVersion: "v1",
    status: "in_queue",
    stage: "queued",
    progress: null,
    error: null,
  },
  materialization: {
    status: "waiting_for_job",
    canRetry: false,
    attempts: 0,
    error: null,
    retryUrl: `/aurora${path}/${id(n)}/materialization/retry`,
  },
  statusUrl: `/aurora${path}/${id(n)}`,
  cancelUrl: `/aurora${path}/${id(n)}/cancel`,
  retryUrl: `/aurora${path}/${id(n)}/retry`,
  mediaVersions: [],
});
const command = {
  clientKey: id(9),
  action: "create" as const,
  input: {
    expectedVersion: 2,
    modelId: "model",
    schemaVersion: "v1",
    purpose: "primary" as const,
    outputKind: "video" as const,
    options: { duration: 5 },
  },
};
let raw: string | null;
const storage = {
  read: () => raw,
  write: vi.fn((s: string) => {
    raw = s;
  }),
};
beforeEach(() => {
  vi.resetAllMocks();
  raw = null;
  h.generation = 1;
  storage.write.mockImplementation((s) => {
    raw = s;
  });
  h.post.mockResolvedValue(result());
  h.get.mockResolvedValue(result());
});
it("persists before create and checks receipt before clearing", async () => {
  const store = assetGenerationPending(scope, "user", storage);
  h.post.mockImplementation(async () => {
    expect(store.read()).toEqual(command);
    return result();
  });
  await store.submit(command);
  expect(h.post).toHaveBeenCalledWith(path, {
    service: "aurora",
    retry: false,
    headers: { "Idempotency-Key": `asset-generation:${id(9)}` },
    data: command.input,
  });
  expect(store.read()).toBeNull();
});
it("reopens and retries identical paid command after ambiguous failure", async () => {
  h.post.mockRejectedValueOnce(Error("Lost reply"));
  await expect(assetGenerationPending(scope, "user", storage).submit(command)).rejects.toThrow(
    "Lost reply"
  );
  const reopened = assetGenerationPending(scope, "user", storage);
  await expect(reopened.submit({ ...command, clientKey: id(10) })).rejects.toThrow("pending");
  await reopened.submit(reopened.read()!);
  expect(h.post.mock.calls[0]).toEqual(h.post.mock.calls[1]);
});
it.each(["project", "clip", "version", "model", "url", "retry"])(
  "retains command when %s receipt mismatches",
  async (field) => {
    const value = result();
    if (field === "project") value.projectId = id(11);
    if (field === "clip") value.target.id = id(11);
    if (field === "version") value.targetVersion = 3;
    if (field === "model") value.aiJob.modelId = "different";
    if (field === "url") value.cancelUrl = "https://external.example/cancel";
    h.post.mockResolvedValue(field === "retry" ? { ...value, retryOfGenerationId: id(10) } : value);
    const store = assetGenerationPending(scope, "user", storage);
    await expect(store.submit(command)).rejects.toThrow();
    expect(store.read()).toEqual(command);
  }
);
it("retries a failed generation as a new, linked command", async () => {
  h.post.mockResolvedValue({ ...result(6), retryOfGenerationId: id(5) });
  await assetGenerationPending(scope, "user", storage).submit({
    action: "retry",
    generationId: id(5),
    clientKey: id(9),
    input: { expectedVersion: 2 },
  });
  expect(h.post.mock.calls[0][0]).toBe(`${path}/${id(5)}/retry`);
});
it.each(["cancel", "attach"] as const)(
  "keeps %s scoped to the original generation",
  async (action) => {
    const store = assetGenerationPending(scope, "user", storage);
    await store.submit({ action, generationId: id(5), clientKey: id(9) });
    expect(h.post.mock.calls[0][0]).toBe(
      `${path}/${id(5)}/${action === "attach" ? "materialization/retry" : "cancel"}`
    );
    expect(h.post.mock.calls[0][1].data).toBeUndefined();
    h.post.mockResolvedValue(result(6));
    await expect(store.submit({ action, generationId: id(5), clientKey: id(9) })).rejects.toThrow(
      "asset"
    );
  }
);
it("reads exact generation and rejects late account responses", async () => {
  await getAssetGeneration(scope, id(5), new AbortController().signal);
  h.get.mockImplementation(async () => {
    h.generation = 2;
    return result();
  });
  await expect(getAssetGeneration(scope, id(5), new AbortController().signal)).rejects.toThrow(
    "expired"
  );
});
it("does not dispatch when recovery is corrupt or unwritable", async () => {
  raw = "bad";
  await expect(assetGenerationPending(scope, "user", storage).submit(command)).rejects.toThrow();
  raw = null;
  storage.write.mockImplementation(() => {
    throw Error("Disk full");
  });
  await expect(assetGenerationPending(scope, "user", storage).submit(command)).rejects.toThrow(
    "Disk full"
  );
  expect(h.post).not.toHaveBeenCalled();
});
it.each([
  { prompt: "text" },
  { reference_images: ["asset:id"] },
  { seed: "https://example.com" },
  { start_frame: "x" },
  { duration: Infinity },
])("rejects server-owned or invalid options %j", (options) => {
  expect(assetGenerationInput.safeParse({ ...command.input, options }).success).toBe(false);
});
it("permits scalar catalog settings and paired optional model selection", () => {
  expect(
    assetGenerationInput.parse({
      expectedVersion: 2,
      options: { omni_reference_task_type: "omni", duration: 5, audio: true },
    }).options
  ).toHaveProperty("duration", 5);
  expect(assetGenerationInput.safeParse({ expectedVersion: 2, modelId: "only" }).success).toBe(
    false
  );
});

it("separates three-view creation and verifies its purpose", async () => {
  const target = { ...scope, purpose: "turnaround" as const, outputKind: "image" as const };
  const input = {
    ...command,
    input: { ...command.input, purpose: "turnaround" as const, outputKind: "image" as const },
  };
  h.post.mockResolvedValue({ ...result(), outputKind: "image", purpose: "turnaround" });
  await assetGenerationPending(target, "user", storage).submit(input);
  expect(h.post.mock.calls[0][1].data.purpose).toBe("turnaround");
  h.post.mockResolvedValue({ ...result(), outputKind: "image", purpose: "primary" });
  await expect(assetGenerationPending(target, "user", storage).submit(input)).rejects.toThrow(
    "requested asset"
  );
  expect(assetGenerationPending(target, "user", storage).read()).toEqual(input);
});
it("rejects purpose or output mismatch before dispatch", async () => {
  await expect(
    assetGenerationPending(
      { ...scope, purpose: "turnaround", outputKind: "image" },
      "user",
      storage
    ).submit(command)
  ).rejects.toThrow("purpose or output");
  expect(h.post).not.toHaveBeenCalled();
});
it("disallows video three-view jobs", () => {
  expect(
    assetGenerationInput.safeParse({
      expectedVersion: 0,
      purpose: "turnaround",
      outputKind: "video",
    }).success
  ).toBe(false);
});
it("rejects another purpose when reading progress", async () => {
  h.get.mockResolvedValue({ ...result(), purpose: "turnaround" });
  await expect(getAssetGeneration(scope, id(5), new AbortController().signal)).rejects.toThrow(
    "requested asset"
  );
});
