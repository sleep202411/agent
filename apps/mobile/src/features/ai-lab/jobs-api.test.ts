import { beforeEach, expect, it, vi } from "vitest";
import {
  generationRetryOutbox,
  retryPendingGeneration,
  cancelGeneration,
  generationCommand,
  generationOutbox,
  getGenerationJob,
  listGenerationJobs,
  recoverGeneration,
  submitPendingGeneration,
} from "./jobs-api";
const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  generation: 1,
  records: new Map<string, string>(),
}));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, post: h.post } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (ns: string, user: string, key: string) => ({
    read: () => h.records.get(`${ns}:${user}:${key}`) ?? null,
    write: (value: string) => h.records.set(`${ns}:${user}:${key}`, value),
  }),
}));
const key = "11111111-1111-4111-8111-111111111111",
  jobId = "22222222-2222-4222-8222-222222222222";
const command = () => ({
  clientKey: key,
  modelId: "model-one",
  schemaVersion: "v1",
  input: { prompt: "A lake", seed: 42 },
});
const job = () => ({
  id: jobId,
  idempotencyKey: key,
  modelId: "model-one",
  sourceSurface: "ai-lab",
  type: "image",
  status: "in_queue",
  stage: "queued",
  prompt: "A lake",
  input: { prompt: "A lake" },
  outputs: [],
  createdAt: "today",
  updatedAt: "today",
});
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.records.clear();
  h.generation = 1;
  h.get.mockResolvedValue({ jobs: [], nextCursor: null });
  h.post.mockResolvedValue({ request_id: jobId, status: "in_queue" });
});
it("requires a model or preset and serializable immutable inputs", () => {
  expect(generationCommand.safeParse(command()).success).toBe(true);
  for (const input of [{ x: undefined }, { x: NaN }, { x: () => 0 }])
    expect(generationCommand.safeParse({ ...command(), input }).success).toBe(false);
  expect(generationCommand.safeParse({ ...command(), modelId: undefined }).success).toBe(false);
});
it("saves before sending and uses the official source and client idempotency key", async () => {
  h.post.mockImplementation(async (path, config) => {
    expect(generationOutbox("alice", 1).read()).toEqual(command());
    expect(path).toBe("/ai/jobs");
    expect(config).toMatchObject({
      service: "aurora",
      retry: false,
      data: {
        modelId: "model-one",
        schemaVersion: "v1",
        input: command().input,
        idempotencyKey: key,
        sourceSurface: "ai-lab",
      },
    });
    expect(config.data).not.toHaveProperty("clientKey");
    return { request_id: jobId, status: "in_queue" };
  });
  await submitPendingGeneration(command(), "alice", 1, signal());
  expect(generationOutbox("alice", 1).read()).toBeNull();
});
it("recovers a lost receipt after restart without another paid submission", async () => {
  h.post.mockRejectedValueOnce(new Error("connection lost"));
  await expect(submitPendingGeneration(command(), "alice", 1, signal())).rejects.toThrow(
    "connection lost"
  );
  expect(generationOutbox("alice", 1).read()).toEqual(command());
  expect(generationOutbox("bob", 1).read()).toBeNull();
  h.get.mockResolvedValue({ jobs: [job()], nextCursor: null });
  expect(await submitPendingGeneration(command(), "alice", 1, signal())).toMatchObject({
    request_id: jobId,
  });
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(generationOutbox("alice", 1).read()).toBeNull();
});
it("replays the exact command/key if no receipt exists, rejecting edited pending work", async () => {
  h.post.mockRejectedValueOnce(new Error("offline"));
  await expect(submitPendingGeneration(command(), "alice", 1, signal())).rejects.toThrow();
  await expect(
    submitPendingGeneration({ ...command(), input: { prompt: "changed" } }, "alice", 1, signal())
  ).rejects.toThrow();
  await submitPendingGeneration(command(), "alice", 1, signal());
  expect(h.post.mock.calls[0][1].data).toEqual(h.post.mock.calls[1][1].data);
});
it("does not submit when receipt lookup fails or trust a mismatching lookup row", async () => {
  h.get.mockRejectedValueOnce(new Error("lookup unavailable"));
  await expect(submitPendingGeneration(command(), "alice", 1, signal())).rejects.toThrow(
    "lookup unavailable"
  );
  expect(h.post).not.toHaveBeenCalled();
  for (const patch of [
    { idempotencyKey: "other" },
    { sourceSurface: "other" },
    { modelId: "other" },
  ]) {
    h.get.mockResolvedValue({ jobs: [{ ...job(), ...patch }], nextCursor: null });
    await expect(recoverGeneration(command(), 1, signal())).rejects.toThrow("does not match");
  }
  h.get.mockResolvedValue({ jobs: [job(), { ...job(), id: key }], nextCursor: null });
  await expect(recoverGeneration(command(), 1, signal())).rejects.toThrow("Multiple");
});
it("rejects stale sessions before network and after a response without clearing pending work", async () => {
  generationOutbox("alice", 1).save(command());
  h.generation = 2;
  await expect(submitPendingGeneration(command(), "alice", 1, signal())).rejects.toThrow("expired");
  expect(h.get).not.toHaveBeenCalled();
  h.generation = 1;
  h.post.mockImplementation(async () => {
    h.generation = 2;
    return { request_id: jobId, status: "in_queue" };
  });
  await expect(submitPendingGeneration(command(), "alice", 1, signal())).rejects.toThrow("expired");
  h.generation = 1;
  expect(generationOutbox("alice", 1).read()).toEqual(command());
});
it("validates history and job/cancel identity without automatic write retries", async () => {
  await listGenerationJobs("video", 1, signal());
  expect(h.get.mock.calls[0][1]).toMatchObject({
    params: { type: "video", limit: 80 },
    retry: false,
  });
  h.get.mockResolvedValue(job());
  expect((await getGenerationJob(jobId, 1, signal())).id).toBe(jobId);
  await expect(getGenerationJob(key, 1, signal())).rejects.toThrow("does not match");
  h.post.mockResolvedValue(job());
  await cancelGeneration(jobId, 1, signal());
  expect(h.post.mock.calls[0]).toEqual([
    `/ai/jobs/${jobId}/cancel`,
    expect.objectContaining({ retry: false, service: "aurora" }),
  ]);
  await expect(cancelGeneration(key, 1, signal())).rejects.toThrow("does not match");
});
it("keeps pending work on malformed receipts or aborted requests", async () => {
  h.post.mockResolvedValue({ request_id: "bad", status: "completed" });
  await expect(submitPendingGeneration(command(), "alice", 1, signal())).rejects.toThrow();
  expect(generationOutbox("alice", 1).read()).toEqual(command());
  const c = new AbortController();
  c.abort();
  h.get.mockClear();
  await expect(submitPendingGeneration(command(), "alice", 1, c.signal)).rejects.toThrow("expired");
  expect(h.get).not.toHaveBeenCalled();
});

it("persists uncertain retries and explicitly recovers the same original job after restart", async () => {
  h.post.mockRejectedValueOnce(new Error("retry reply lost"));
  const command = { clientKey: key, jobId };
  await expect(retryPendingGeneration(command, "alice", 1, signal())).rejects.toThrow(
    "retry reply lost"
  );
  expect(generationRetryOutbox("alice", 1).read()).toEqual(command);
  await retryPendingGeneration(generationRetryOutbox("alice", 1).read()!, "alice", 1, signal());
  expect(h.post).toHaveBeenCalledTimes(2);
  expect(h.post.mock.calls.map(([path]) => path)).toEqual([
    `/ai/jobs/${jobId}/retry`,
    `/ai/jobs/${jobId}/retry`,
  ]);
  expect(generationRetryOutbox("alice", 1).read()).toBeNull();
  expect(generationRetryOutbox("bob", 1).read()).toBeNull();
});
it("clears only a validated retry receipt and sends no invented idempotency payload", async () => {
  await retryPendingGeneration({ clientKey: key, jobId }, "alice", 1, signal());
  expect(h.post.mock.calls[0][0]).toBe(`/ai/jobs/${jobId}/retry`);
  expect(h.post.mock.calls[0][1]).toMatchObject({ retry: false });
  expect(h.post.mock.calls[0][1]).not.toHaveProperty("data");
  expect(generationRetryOutbox("alice", 1).read()).toBeNull();
});
it("preserves structured prompt and reference bindings across an uncertain paid submission", async () => {
  const structured = {
    ...command(),
    referenceBindings: [
      {
        refId: "image-a",
        kind: "image" as const,
        label: "Image1",
        order: 1,
        url: "https://cdn.test/a",
        assetId: jobId,
      },
    ],
    promptDocument: {
      version: 1 as const,
      nodes: [
        { type: "text" as const, text: "Use " },
        { type: "asset_ref" as const, refId: "image-a", label: "Image1" },
      ],
    },
  };
  h.post.mockRejectedValueOnce(Error("lost response"));
  await expect(submitPendingGeneration(structured, "alice", 1, signal())).rejects.toThrow();
  expect(generationOutbox("alice", 1).read()).toEqual(structured);
  await submitPendingGeneration(structured, "alice", 1, signal());
  expect(h.post.mock.calls[1][1].data).toEqual(h.post.mock.calls[0][1].data);
  expect(generationCommand.safeParse({ ...structured, referenceBindings: [] }).success).toBe(false);
});
const workspaceA = "33333333-3333-4333-8333-333333333333",
  workspaceB = "44444444-4444-4444-8444-444444444444";
it("isolates workspace outboxes and freezes the billing workspace through recovery", async () => {
  const intent = { ...command(), workspaceId: workspaceA };
  h.post.mockRejectedValueOnce(Error("lost response"));
  await expect(submitPendingGeneration(intent, "alice", 1, signal(), workspaceA)).rejects.toThrow();
  expect(generationOutbox("alice", 1, workspaceA).read()).toEqual(intent);
  expect(generationOutbox("alice", 1, workspaceB).read()).toBeNull();
  expect(generationOutbox("alice", 1).read()).toBeNull();
  expect(h.post.mock.calls[0][1].data.workspaceId).toBe(workspaceA);
  h.get.mockResolvedValue({ jobs: [{ ...job(), workspaceId: workspaceB }], nextCursor: null });
  await expect(submitPendingGeneration(intent, "alice", 1, signal(), workspaceA)).rejects.toThrow(
    "match"
  );
  expect(h.post).toHaveBeenCalledTimes(1);
  h.get.mockResolvedValue({ jobs: [{ ...job(), workspaceId: workspaceA }], nextCursor: null });
  await submitPendingGeneration(intent, "alice", 1, signal(), workspaceA);
  expect(h.get.mock.calls.at(-1)![1].params.workspaceId).toBe(workspaceA);
  expect(h.post).toHaveBeenCalledTimes(1);
  await expect(submitPendingGeneration(intent, "alice", 1, signal(), workspaceB)).rejects.toThrow(
    "workspace"
  );
});
it("rejects history and detail from another workspace and checks scope before retry or cancel", async () => {
  h.get.mockResolvedValueOnce({ jobs: [{ ...job(), workspaceId: workspaceB }], nextCursor: null });
  await expect(listGenerationJobs("image", 1, signal(), workspaceA)).rejects.toThrow("workspace");
  h.get.mockResolvedValue({ ...job(), workspaceId: workspaceB });
  await expect(getGenerationJob(jobId, 1, signal(), workspaceA)).rejects.toThrow("workspace");
  await expect(cancelGeneration(jobId, 1, signal(), workspaceA)).rejects.toThrow("workspace");
  await expect(
    retryPendingGeneration(
      { clientKey: key, jobId, workspaceId: workspaceA },
      "alice",
      1,
      signal(),
      workspaceA
    )
  ).rejects.toThrow("workspace");
  expect(h.post).not.toHaveBeenCalled();
  expect(generationRetryOutbox("alice", 1, workspaceA).read()).toBeNull();
});

it("pins project billing/history/recovery and rejects cross-project receipts", async () => {
  const workspaceId = "33333333-3333-4333-8333-333333333333",
    projectId = "44444444-4444-4444-8444-444444444444";
  const scope = { workspaceId, projectId },
    intent = { ...command(), ...scope };
  const good = { ...job(), ...scope };
  h.get.mockResolvedValue({ jobs: [good], nextCursor: null });
  await listGenerationJobs("image", 1, signal(), scope);
  expect(h.get.mock.calls.at(-1)![1].params).toMatchObject(scope);
  await submitPendingGeneration(intent, "alice", 1, signal(), scope);
  expect(h.post).not.toHaveBeenCalled();
  expect(generationOutbox("alice", 1, scope).read()).toBeNull();
  h.get.mockResolvedValue({ jobs: [{ ...good, projectId: jobId }], nextCursor: null });
  await expect(recoverGeneration(intent, 1, signal())).rejects.toThrow("match");
  h.get.mockResolvedValue({ ...good, projectId: jobId });
  await expect(cancelGeneration(jobId, 1, signal(), scope)).rejects.toThrow("match");
  await expect(
    retryPendingGeneration({ clientKey: key, jobId, ...scope }, "alice", 1, signal(), scope)
  ).rejects.toThrow("match");
  expect(h.post).not.toHaveBeenCalled();
});
it("isolates Story and Creative projects, preserves legacy records and refuses scope-conflicting writes", async () => {
  const workspaceId = "33333333-3333-4333-8333-333333333333",
    projectId = "44444444-4444-4444-8444-444444444444";
  const creative = { workspaceId, projectId },
    story = { workspaceId, storyProjectId: projectId };
  const intent = { ...command(), ...creative };
  generationOutbox("alice", 1, creative).save(intent);
  expect(generationOutbox("alice", 1, story).read()).toBeNull();
  expect(generationOutbox("alice", 1, workspaceId).read()).toBeNull();
  expect(generationOutbox("alice", 1).read()).toBeNull();
  expect(generationCommand.safeParse({ ...intent, storyProjectId: projectId }).success).toBe(false);
  expect(generationCommand.safeParse({ ...command(), projectId }).success).toBe(false);
  await expect(submitPendingGeneration(intent, "alice", 1, signal(), story)).rejects.toThrow(
    "match"
  );
  expect(h.post).not.toHaveBeenCalled();
});

it("does not replace an uncertain retry with another job or command", async () => {
  const original = { clientKey: key, jobId };
  generationRetryOutbox("alice", 1).save(original);
  for (const changed of [
    { ...original, jobId: key },
    { ...original, clientKey: jobId },
  ]) {
    await expect(retryPendingGeneration(changed, "alice", 1, signal())).rejects.toThrow(
      "saved generation retry"
    );
  }
  expect(h.post).not.toHaveBeenCalled();
  expect(generationRetryOutbox("alice", 1).read()).toEqual(original);
});
it("retains the original retry after malformed receipts and session changes", async () => {
  const original = { clientKey: key, jobId };
  h.post.mockResolvedValueOnce({ request_id: "bad", status: "in_queue" });
  await expect(retryPendingGeneration(original, "alice", 1, signal())).rejects.toThrow();
  expect(generationRetryOutbox("alice", 1).read()).toEqual(original);
  h.post.mockImplementationOnce(async () => {
    h.generation = 2;
    return { request_id: key, status: "in_queue" };
  });
  await expect(retryPendingGeneration(original, "alice", 1, signal())).rejects.toThrow("expired");
  expect(generationRetryOutbox("alice", 2).read()).toEqual(original);
});

const canvasScope = () => ({
  workspaceId: "33333333-3333-4333-8333-333333333333",
  storyProjectId: "44444444-4444-4444-8444-444444444444",
  documentId: "55555555-5555-4555-8555-555555555555",
  documentBlockId: "card-one",
  sourceSurface: "fizzstudio-canvas" as const,
});
it("submits and recovers canvas jobs with their complete card identity", async () => {
  const scope = canvasScope(),
    intent = { ...command(), ...scope };
  h.post.mockImplementation(async (_path, options) => {
    expect(options.data).toMatchObject({ ...scope, idempotencyKey: key });
    expect(generationOutbox("alice", 1, scope).read()).toEqual(intent);
    throw new Error("Reply lost");
  });
  await expect(submitPendingGeneration(intent, "alice", 1, signal(), scope)).rejects.toThrow(
    "Reply lost"
  );
  expect(h.get.mock.calls[0]![1].params).toMatchObject({ ...scope, idempotencyKey: key });
  expect(generationOutbox("alice", 1, scope).read()).toEqual(intent);
  expect(generationOutbox("alice", 1, { ...scope, documentBlockId: "card-two" }).read()).toBeNull();
  expect(
    generationOutbox("alice", 1, {
      workspaceId: scope.workspaceId,
      storyProjectId: scope.storyProjectId,
    }).read()
  ).toBeNull();
  h.get.mockResolvedValue({ jobs: [{ ...job(), ...scope }], nextCursor: null });
  await expect(submitPendingGeneration(intent, "alice", 1, signal(), scope)).resolves.toMatchObject(
    { request_id: jobId }
  );
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(generationOutbox("alice", 1, scope).read()).toBeNull();
});
it.each(["documentId", "documentBlockId", "sourceSurface", "storyProjectId"] as const)(
  "rejects incomplete canvas commands missing %s",
  (field) => {
    const intent = { ...command(), ...canvasScope() };
    delete (intent as Record<string, unknown>)[field];
    expect(generationCommand.safeParse(intent).success).toBe(false);
  }
);
it("rejects another card's recovery, history, read, cancellation and retry", async () => {
  const scope = canvasScope(),
    wrong = { ...job(), ...scope, documentBlockId: "other" };
  h.get.mockResolvedValue({ jobs: [wrong], nextCursor: null });
  await expect(recoverGeneration({ ...command(), ...scope }, 1, signal())).rejects.toThrow("match");
  await expect(listGenerationJobs("image", 1, signal(), scope)).rejects.toThrow("match");
  h.get.mockResolvedValue(wrong);
  await expect(getGenerationJob(jobId, 1, signal(), scope)).rejects.toThrow("match");
  await expect(cancelGeneration(jobId, 1, signal(), scope)).rejects.toThrow("match");
  await expect(
    retryPendingGeneration({ clientKey: key, jobId, ...scope }, "alice", 1, signal(), scope)
  ).rejects.toThrow("match");
  expect(h.post).not.toHaveBeenCalled();
});
it("never stores canvas commands in account-wide or project-only outboxes", async () => {
  const scope = canvasScope(),
    intent = { ...command(), ...scope };
  for (const storageScope of [
    undefined,
    { workspaceId: scope.workspaceId, storyProjectId: scope.storyProjectId },
  ]) {
    await expect(
      submitPendingGeneration(intent, "alice", 1, signal(), storageScope)
    ).rejects.toThrow("exact document");
    await expect(
      retryPendingGeneration(
        { ...scope, clientKey: key, jobId },
        "alice",
        1,
        signal(),
        storageScope
      )
    ).rejects.toThrow("exact document");
  }
  expect(h.records.size).toBe(0);
  expect(h.post).not.toHaveBeenCalled();
});
it("rejects stale sessions and wrong canvas surfaces without clearing recovery", async () => {
  const scope = canvasScope(),
    intent = { ...command(), ...scope };
  generationOutbox("alice", 1, scope).save(intent);
  h.get.mockResolvedValue({
    jobs: [{ ...job(), ...scope, sourceSurface: "ai-lab" }],
    nextCursor: null,
  });
  await expect(submitPendingGeneration(intent, "alice", 1, signal(), scope)).rejects.toThrow(
    "match"
  );
  expect(generationOutbox("alice", 1, scope).read()).toEqual(intent);
  h.generation++;
  await expect(submitPendingGeneration(intent, "alice", 1, signal(), scope)).rejects.toThrow(
    "expired"
  );
  expect(h.post).not.toHaveBeenCalled();
});

it("retains the paid request until its canvas receipt is acknowledged", async () => {
  const acknowledge = vi.fn(async (): Promise<void> => {
    throw Error("Canvas save interrupted");
  });
  await expect(
    submitPendingGeneration(command(), "alice", 1, signal(), undefined, acknowledge)
  ).rejects.toThrow("Canvas save interrupted");
  expect(generationOutbox("alice", 1).read()).toEqual(command());
  h.get.mockResolvedValue({ jobs: [job()], nextCursor: null });
  acknowledge.mockResolvedValueOnce(undefined);
  await submitPendingGeneration(command(), "alice", 1, signal(), undefined, acknowledge);
  expect(h.post).toHaveBeenCalledOnce();
  expect(acknowledge).toHaveBeenCalledTimes(2);
  expect(generationOutbox("alice", 1).read()).toBeNull();
});
it("retains the original retry target after failed acknowledgement or account retirement", async () => {
  const command = { clientKey: key, jobId };
  const acknowledge = vi.fn(async (): Promise<void> => {
    throw Error("Canvas save interrupted");
  });
  await expect(
    retryPendingGeneration(command, "alice", 1, signal(), undefined, acknowledge)
  ).rejects.toThrow("interrupted");
  expect(generationRetryOutbox("alice", 1).read()).toEqual(command);
  acknowledge.mockImplementationOnce(async () => {
    h.generation++;
  });
  await expect(
    retryPendingGeneration(command, "alice", 1, signal(), undefined, acknowledge)
  ).rejects.toThrow("expired");
  h.generation = 1;
  expect(generationRetryOutbox("alice", 1).read()).toEqual(command);
  acknowledge.mockResolvedValueOnce(undefined);
  await retryPendingGeneration(command, "alice", 1, signal(), undefined, acknowledge);
  expect(h.post.mock.calls.map(([path]) => path)).toEqual(Array(3).fill(`/ai/jobs/${jobId}/retry`));
  expect(generationRetryOutbox("alice", 1).read()).toBeNull();
});
