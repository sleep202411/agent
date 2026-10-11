import { beforeEach, expect, it, vi } from "vitest";
import { loadStoryScriptSnapshot } from "./story-production-api";
const h = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn(), generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { post: h.post, get: h.get } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.post.mockResolvedValue({ document: { id: "doc" } });
  h.get.mockResolvedValue({ document: { id: "doc", contentSnapshot: {} } });
});
it("loads the ensured document", async () => {
  expect(await loadStoryScriptSnapshot("project", "chapter")).toMatchObject({ id: "doc" });
  expect(h.get.mock.calls[0][0]).toBe("/documents/doc");
});
it("does not fetch a document under a different account", async () => {
  h.post.mockImplementation(async () => {
    h.generation++;
    return { document: { id: "doc" } };
  });
  await expect(loadStoryScriptSnapshot("project", "chapter")).rejects.toThrow("expired");
  expect(h.get).not.toHaveBeenCalled();
});
it("does not dispatch an aborted request", async () => {
  const c = new AbortController();
  c.abort();
  await expect(loadStoryScriptSnapshot("project", "chapter", c.signal)).rejects.toThrow("expired");
  expect(h.post).not.toHaveBeenCalled();
});
it("rejects mismatched document identity", async () => {
  h.get.mockResolvedValue({ document: { id: "other" } });
  await expect(loadStoryScriptSnapshot("project", "chapter")).rejects.toThrow("identity mismatch");
});
it("rejects late document response after account change", async () => {
  h.get.mockImplementation(async () => {
    h.generation++;
    return { document: { id: "doc" } };
  });
  await expect(loadStoryScriptSnapshot("project", "chapter")).rejects.toThrow("expired");
});
