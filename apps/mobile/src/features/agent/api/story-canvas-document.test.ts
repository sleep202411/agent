import { beforeEach, expect, it, vi } from "vitest";
import { openStoryCanvasDocument, reloadStoryCanvasDocument } from "./story-canvas-document";
const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, post: h.post } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { projectId: id(1), generation: 1 };
const doc = {
  id: id(2),
  owner: { kind: "story_project", projectId: id(1) },
  storyProjectId: id(1),
  platformProjectId: null,
  storyChapterId: null,
  type: "canvas",
  status: "active",
  currentSequence: 2,
  snapshotSequence: 1,
  crdtStateBase64: "AAA=",
};
const op = (sequence: number) => ({
  id: id(sequence + 10),
  documentId: id(2),
  sequence,
  operationType: "yjs_update",
  yjsUpdateBase64: "AQI=",
});
let controller: AbortController;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  controller = new AbortController();
  h.post.mockResolvedValue({ document: doc });
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("/operations") ? { operations: [op(2)] } : { document: doc }
  );
});
const open = () => openStoryCanvasDocument(scope, controller.signal);
it("loads the binary horizon and ordered operations without trusting a stale materialized snapshot", async () => {
  h.post.mockResolvedValue({ document: { ...doc, contentSnapshot: { assets: { stale: true } } } });
  h.get.mockResolvedValue({ operations: [op(2), op(3)] });
  expect(await open()).toEqual({ document: doc, operations: [op(2)], sequence: 2 });
  expect(h.get).toHaveBeenCalledWith(
    `/documents/${id(2)}/operations`,
    expect.objectContaining({ params: { afterSequence: 1, limit: 500 }, retry: false })
  );
});
it("paginates through a full log page", async () => {
  h.post.mockResolvedValue({ document: { ...doc, snapshotSequence: 0, currentSequence: 501 } });
  h.get
    .mockResolvedValueOnce({ operations: Array.from({ length: 500 }, (_, i) => op(i + 1)) })
    .mockResolvedValueOnce({ operations: [op(501)] });
  const result = await open();
  expect(result.operations).toHaveLength(501);
  expect(result.sequence).toBe(501);
  expect(h.get.mock.calls[1][1].params.afterSequence).toBe(500);
});
it("discards a partial log and reloads after compaction", async () => {
  h.post.mockResolvedValue({ document: { ...doc, currentSequence: 3 } });
  h.get
    .mockResolvedValueOnce({ operations: [op(2)] })
    .mockResolvedValueOnce({ operations: [] })
    .mockResolvedValueOnce({
      document: { ...doc, snapshotSequence: 3, currentSequence: 4, crdtStateBase64: "AQI=" },
    })
    .mockResolvedValueOnce({ operations: [op(4)] });
  const result = await open();
  expect(result.operations).toEqual([op(4)]);
  expect(result.document.crdtStateBase64).toBe("AQI=");
  expect(result.sequence).toBe(4);
  expect(h.post).toHaveBeenCalledOnce();
});
it("bounds resync retries for a persistently missing sequence", async () => {
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("/operations") ? { operations: [] } : { document: doc }
  );
  await expect(open()).rejects.toThrow("history changed");
  expect(h.get).toHaveBeenCalledTimes(5);
});
it.each([
  { storyProjectId: id(8) },
  { owner: { kind: "story_project", projectId: id(8) } },
  { storyChapterId: id(8) },
  { type: "script" },
  { crdtStateBase64: null },
  { snapshotSequence: 3 },
])("rejects an invalid document: %s", async (fields) => {
  h.post.mockResolvedValue({ document: { ...doc, ...fields } });
  await expect(open()).rejects.toThrow();
  expect(h.get).not.toHaveBeenCalled();
});
it("rejects foreign operations without attempting resync", async () => {
  h.get.mockResolvedValue({ operations: [{ ...op(2), documentId: id(9) }] });
  await expect(open()).rejects.toThrow("identity");
  expect(h.get).toHaveBeenCalledOnce();
});
it("rejects duplicate operation identities", async () => {
  h.post.mockResolvedValue({ document: { ...doc, currentSequence: 3 } });
  h.get.mockResolvedValue({ operations: [op(2), { ...op(3), id: op(2).id }] });
  await expect(open()).rejects.toThrow("identity");
});
it("does not silently skip a non-CRDT mutation", async () => {
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("/operations")
      ? { operations: [{ ...op(2), operationType: "patch" }] }
      : { document: doc }
  );
  await expect(open()).rejects.toThrow("history changed");
});
it("accepts comment sequence markers without inventing CRDT bytes", async () => {
  const comment = { ...op(2), operationType: "comment", yjsUpdateBase64: null };
  h.get.mockResolvedValue({ operations: [comment] });
  expect((await open()).operations).toEqual([comment]);
});
it.each(["abort", "account"])("retires %s changes before log reads", async (reason) => {
  h.post.mockImplementation(async () => {
    if (reason === "abort") controller.abort();
    else h.generation++;
    return { document: doc };
  });
  await expect(open()).rejects.toThrow();
  expect(h.get).not.toHaveBeenCalled();
});
it("preserves access errors and never retries bootstrap", async () => {
  h.post.mockRejectedValue(Error("Editing permission required"));
  await expect(open()).rejects.toThrow("Editing permission required");
  expect(h.post).toHaveBeenCalledOnce();
});
it("reloads the exact document and rejects a replaced identity", async () => {
  h.get.mockResolvedValue({ document: { ...doc, id: id(9) } });
  await expect(reloadStoryCanvasDocument(scope, id(2), controller.signal)).rejects.toThrow(
    "scope mismatch"
  );
  expect(h.post).not.toHaveBeenCalled();
});
it("opens a fully compacted canvas without requesting history", async () => {
  h.post.mockResolvedValue({ document: { ...doc, snapshotSequence: 2 } });
  expect(await open()).toEqual({
    document: { ...doc, snapshotSequence: 2 },
    operations: [],
    sequence: 2,
  });
  expect(h.get).not.toHaveBeenCalled();
});
it("rejects a regressed document during resynchronization", async () => {
  h.get
    .mockResolvedValueOnce({ operations: [] })
    .mockResolvedValueOnce({ document: { ...doc, currentSequence: 1 } });
  await expect(open()).rejects.toThrow("sequence regressed");
  expect(h.get).toHaveBeenCalledTimes(2);
});
it.each(["abort", "account"])("discards loaded history after an %s change", async (reason) => {
  h.get.mockImplementation(async () => {
    if (reason === "abort") controller.abort();
    else h.generation++;
    return { operations: [op(2)] };
  });
  await expect(open()).rejects.toThrow();
  expect(h.get).toHaveBeenCalledOnce();
});
it.each([null, "", "not base64!"])(
  "rejects missing or malformed update bytes: %s",
  async (bytes) => {
    h.get.mockResolvedValue({ operations: [{ ...op(2), yjsUpdateBase64: bytes }] });
    await expect(open()).rejects.toThrow();
    expect(h.get).toHaveBeenCalledOnce();
  }
);
it("does not retry permission loss while reading history", async () => {
  h.get.mockRejectedValue(Error("Document access revoked"));
  await expect(open()).rejects.toThrow("Document access revoked");
  expect(h.get).toHaveBeenCalledOnce();
});
