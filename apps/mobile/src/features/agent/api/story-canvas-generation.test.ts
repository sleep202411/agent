import { beforeEach, expect, it, vi } from "vitest";
import { loadTrackedCanvasJobs } from "./story-canvas-generation";
import type { CanvasLoaded } from "../../../../canvas-editor/protocol";
const h = vi.hoisted(() => ({ get: vi.fn(), read: vi.fn(), generation: 1 }));
vi.mock("./story-canvas-document", () => ({ readStoryCanvasDocument: h.read }));
vi.mock("@/features/ai-lab/jobs-api", () => ({
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
