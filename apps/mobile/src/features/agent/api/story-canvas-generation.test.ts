import { beforeEach, expect, it, vi } from "vitest";
import { loadTrackedCanvasJobs } from "./story-canvas-generation";
import type { CanvasLoaded } from "../../../../canvas-editor/protocol";
const h = vi.hoisted(() => ({
  get: vi.fn(),
  lookup: vi.fn(),
  post: vi.fn(),
  read: vi.fn(),
  generation: 1,
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/durable-record", () => ({ durableRecord: vi.fn() }));
vi.mock("./story-canvas-document", () => ({ readStoryCanvasDocument: h.read }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.lookup, post: h.post } }));
vi.mock("@/features/ai-lab/jobs-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai-lab/jobs-api")>()),
  getGenerationJob: h.get,
  generationSession: (generation: number, signal: AbortSignal) => {
    signal.throwIfAborted();
    if (generation !== h.generation) throw Error("Session expired");
  },
}));
const projectId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";
const id = "33333333-3333-4333-8333-333333333333";
const scope = { projectId, documentId, generation: 1 };
const loaded = (): CanvasLoaded => ({
  type: "loaded",
  sessionId: id,
  requestId: 1,
  documentId,
  sequence: 1,
  state: "AAA=",
  snapshot: {
    meta: {},
    nodes: { card: { id: "card", type: "prompt", data: { generation: { jobId: id } } } },
    edges: {},
    groups: {},
    assets: {},
  },
});
const job = () => ({
  id,
  storyProjectId: projectId,
  projectId: null,
  documentId,
  documentBlockId: "card",
  sourceSurface: "fizzstudio-canvas",
  type: "image",
  modelId: "model",
  status: "completed",
  stage: "done",
  updatedAt: "2026-10-05T00:00:00.000Z",
  prompt: "Lake",
  createdAt: "2026-10-05T00:00:00.000Z",
  progress: null,
  queuePosition: null,
  error: null,
  outputs: [
    {
      id: "output",
      type: "image",
      url: "https://example.test/image",
      assetId: "asset",
      width: null,
    },
  ],
});
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.get.mockResolvedValue(job());
});
it("checks document ownership and normalizes tracked legacy jobs without sending generation", async () => {
  const signal = new AbortController().signal;
  const jobs = await loadTrackedCanvasJobs(scope, loaded(), signal);
  expect(h.read).toHaveBeenCalledWith(scope, documentId, signal);
  expect(h.get).toHaveBeenCalledWith(id, 1, signal);
  expect(jobs[0]).toMatchObject({ id, documentBlockId: "card", outputs: [{ assetId: "asset" }] });
  expect(jobs[0]!.error).toBeUndefined();
  expect(jobs[0]!.outputs[0]!.width).toBeUndefined();
  expect(h.read.mock.invocationCallOrder[0]).toBeLessThan(h.get.mock.invocationCallOrder[0]!);
});
it.each(["storyProjectId", "documentId", "documentBlockId", "sourceSurface", "type"])(
  "rejects mismatched %s without returning partial results",
  async (field) => {
    h.get.mockResolvedValue({ ...job(), [field]: "other" });
    await expect(
      loadTrackedCanvasJobs(scope, loaded(), new AbortController().signal)
    ).rejects.toThrow("belong");
  }
);
it("does not request untracked cards and stops on access loss or retired sessions", async () => {
  const empty = loaded();
  empty.snapshot.nodes = { card: { id: "card", type: "prompt", data: {} } };
  expect(await loadTrackedCanvasJobs(scope, empty, new AbortController().signal)).toEqual([]);
  expect(h.read).not.toHaveBeenCalled();
  expect(h.get).not.toHaveBeenCalled();
  h.read.mockRejectedValueOnce(Error("Access denied"));
  await expect(
    loadTrackedCanvasJobs(scope, loaded(), new AbortController().signal)
  ).rejects.toThrow("Access denied");
  expect(h.get).not.toHaveBeenCalled();
  h.get.mockImplementation(async () => {
    h.generation++;
    return job();
  });
  await expect(
    loadTrackedCanvasJobs(scope, loaded(), new AbortController().signal)
  ).rejects.toThrow("expired");
});

const uncertain = () => {
  const value = loaded();
  value.snapshot.nodes.card = {
    id: "card",
    type: "prompt",
    data: { generation: { status: "uncertain", submissionKey: "canvas:attempt" } },
  };
  return value;
};
it("recovers the exact uncertain submission without a second generation request", async () => {
  h.lookup.mockResolvedValue({
    jobs: [{ ...job(), idempotencyKey: "canvas:attempt" }],
    nextCursor: null,
  });
  const value = uncertain();
  const result = await loadTrackedCanvasJobs(scope, value, new AbortController().signal);
  expect(result).toHaveLength(1);
  expect(h.lookup).toHaveBeenCalledWith(
    "/ai/jobs",
    expect.objectContaining({
      retry: false,
      params: {
        storyProjectId: projectId,
        documentId,
        documentBlockId: "card",
        sourceSurface: "fizzstudio-canvas",
        idempotencyKey: "canvas:attempt",
        limit: 80,
      },
    })
  );
  expect(value.snapshot.nodes.card).toHaveProperty(
    "data.generation.submissionKey",
    "canvas:attempt"
  );
  expect(h.get).not.toHaveBeenCalled();
  expect(h.post).not.toHaveBeenCalled();
});
it("leaves an uncertain card intact on an empty lookup, ambiguity or mismatched receipt", async () => {
  const value = uncertain();
  const before = JSON.stringify(value);
  h.lookup.mockResolvedValue({ jobs: [], nextCursor: null });
  expect(await loadTrackedCanvasJobs(scope, value, new AbortController().signal)).toEqual([]);
  for (const response of [
    { jobs: [{ ...job(), idempotencyKey: "wrong" }], nextCursor: null },
    { jobs: [job(), job()], nextCursor: null },
    { jobs: [], nextCursor: "more" },
    {
      jobs: [{ ...job(), idempotencyKey: "canvas:attempt", documentBlockId: "other" }],
      nextCursor: null,
    },
  ]) {
    h.lookup.mockResolvedValue(response);
    await expect(
      loadTrackedCanvasJobs(scope, value, new AbortController().signal)
    ).rejects.toThrow();
  }
  expect(JSON.stringify(value)).toBe(before);
  expect(h.post).not.toHaveBeenCalled();
});
it("rejects a recovery reply arriving after account retirement", async () => {
  h.lookup.mockImplementation(async () => {
    h.generation++;
    return { jobs: [{ ...job(), idempotencyKey: "canvas:attempt" }], nextCursor: null };
  });
  await expect(
    loadTrackedCanvasJobs(scope, uncertain(), new AbortController().signal)
  ).rejects.toThrow("expired");
  expect(h.post).not.toHaveBeenCalled();
});

it("loads current catalog slots only for completed jobs with connected generation targets", async () => {
  const value = loaded();
  value.snapshot.nodes.target = {
    id: "target",
    type: "video",
    data: { modelId: "video-model", mode: "first_last_frame_to_video" },
  };
  value.snapshot.edges.wire = { id: "wire", source: "card", target: "target" };
  h.lookup.mockResolvedValue({
    version: "1",
    region: "global",
    presets: [],
    models: [
      {
        id: "video-model",
        name: "Video",
        type: "video",
        enabled: true,
        schemaVersion: "1",
        generationModes: ["text_to_video", "first_last_frame_to_video"],
        input_schema: {
          type: "object",
          properties: {
            startFrame: { type: "string", "x-ui": { control: "image_upload" } },
            endFrame: { type: "string", "x-ui": { control: "image_upload" } },
            referenceImages: {
              type: "array",
              maxItems: 9,
              items: { type: "string" },
              "x-ui": { control: "image_upload" },
            },
          },
        },
      },
    ],
  });
  const result = await loadTrackedCanvasJobs(scope, value, new AbortController().signal);
  expect(result[0]!.referenceTargets).toEqual({
    target: {
      modelId: "video-model",
      mode: "first_last_frame_to_video",
      fields: [
        { field: "startFrame", kind: "image", maxItems: 1 },
        { field: "endFrame", kind: "image", maxItems: 1 },
      ],
    },
  });
  expect(h.lookup).toHaveBeenCalledWith("/ai/models", expect.objectContaining({ retry: false }));
  expect(h.post).not.toHaveBeenCalled();
  value.snapshot.nodes.target = { id: "target", type: "video", data: { modelId: "video-model" } };
  const defaultMode = await loadTrackedCanvasJobs(scope, value, new AbortController().signal);
  expect(defaultMode[0]!.referenceTargets!.target!.fields).toEqual([]);
  h.lookup.mockClear();
  h.get.mockResolvedValue({ ...job(), status: "running" });
  await loadTrackedCanvasJobs(scope, value, new AbortController().signal);
  expect(h.lookup).not.toHaveBeenCalled();
});

it("does not poll converted panorama nodes or recreate their generation state", async () => {
  const value = loaded();
  value.snapshot.nodes.card = {
    id: "card",
    type: "panorama",
    data: { src: "https://example.test/pano", mediaAssetId: "asset" },
  };
  expect(await loadTrackedCanvasJobs(scope, value, new AbortController().signal)).toEqual([]);
  expect(h.get).not.toHaveBeenCalled();
  expect(h.lookup).not.toHaveBeenCalled();
});
