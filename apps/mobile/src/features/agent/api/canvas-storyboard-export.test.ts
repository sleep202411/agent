import { beforeEach, expect, it, vi } from "vitest";
import { canvasStoryboardExport } from "./canvas-storyboard-export";
const h = vi.hoisted(() => ({
  generation: 1,
  read: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  pending: false,
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({
  api: { get: h.get, post: h.post },
  ApiRequestError: class extends Error {
    status = 400;
  },
}));
vi.mock("./platform-canvas-document", () => ({
  readPlatformCanvasDocument: h.read,
  platformCanvasUpdatePending: () => ({ read: () => h.pending }),
}));
vi.mock("@/lib/durable-record", () => ({ durableRecord: vi.fn() }));
const id = "11111111-1111-4111-8111-111111111111";
const scope = {
  kind: "platform" as const,
  workspaceId: id,
  projectId: id,
  sectionId: id,
  documentId: id,
  generation: 1,
};
const job = {
  id,
  sequence: 3,
  width: 1280,
  height: 720,
  status: "queued",
  error: null,
  expiresAt: "2026-10-09T00:00:00Z",
};
let raw: string | null;
const client = () =>
  canvasStoryboardExport(scope, "user", {
    read: () => raw,
    write: (value) => {
      raw = value;
    },
  });
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.clearAllMocks();
  raw = null;
  h.generation = 1;
  h.pending = false;
  h.read.mockResolvedValue({});
  h.post.mockResolvedValue(job);
});
it("reauthorizes the document and submits an idempotent sequence-bound request", async () => {
  await client().create(id, 3, signal());
  expect(h.post).toHaveBeenCalledWith(
    "/storyboard-exports",
    expect.objectContaining({
      retry: false,
      data: { requestId: id, documentId: id, expectedSequence: 3, width: 1280, height: 720 },
    })
  );
  expect(client().read()).toBeNull();
});
it("retries identical bytes and request ID after a lost response and restart", async () => {
  h.post.mockRejectedValueOnce(Error("Network lost"));
  await expect(client().create(id, 3, signal())).rejects.toThrow("Network lost");
  await client().create("22222222-2222-4222-8222-222222222222", 9, signal());
  expect(h.post.mock.calls[0][1].data).toEqual(h.post.mock.calls[1][1].data);
});
it("blocks exports while a canvas mutation is pending", async () => {
  h.pending = true;
  await expect(client().create(id, 3, signal())).rejects.toThrow("pending");
  expect(h.post).not.toHaveBeenCalled();
});
it("blocks revoked access and late responses after account switching", async () => {
  h.read.mockRejectedValueOnce(Error("revoked"));
  await expect(client().list(signal())).rejects.toThrow("revoked");
  expect(h.get).not.toHaveBeenCalled();
  h.post.mockImplementationOnce(async () => {
    h.generation++;
    return job;
  });
  await expect(client().create(id, 3, signal())).rejects.toThrow("expired");
});
it.each([
  "http://private.test/file",
  "https://user:secret@private.test/file",
  "file:///private/file",
])("rejects unsafe download %s", async (url) => {
  h.post.mockResolvedValue({ url, expiresAt: new Date(Date.now() + 60000).toISOString() });
  await expect(client().download(id, signal())).rejects.toThrow();
});
