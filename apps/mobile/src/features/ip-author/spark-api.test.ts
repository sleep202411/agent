import { beforeEach, expect, it, vi } from "vitest";
import { analyzeIpDocument } from "./spark-api";
const h = vi.hoisted(() => ({
  pick: vi.fn(),
  post: vi.fn(),
  generation: 1,
  platform: { OS: "web" },
}));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: h.pick }));
vi.mock("react-native", () => ({ Platform: h.platform }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: { postFormData: h.post } }));
const run = () => analyzeIpDocument(1, new AbortController().signal);
beforeEach(() => {
  vi.clearAllMocks();
  h.generation = 1;
  h.platform.OS = "web";
  h.post.mockResolvedValue({ name: "Suggested", description: "Brief" });
});
it("uses authenticated multipart analysis with the Web timeout and no automatic retries", async () => {
  const file = new File(["brief"], "brief.md", { type: "text/markdown" });
  h.pick.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "blob:test", file, name: file.name }],
  });
  expect(await run()).toEqual({ name: "Suggested", description: "Brief", fileName: "brief.md" });
  expect(h.post.mock.calls[0][0]).toBe("/spark/analyze");
  expect(h.post.mock.calls[0][1].get("file").name).toBe("brief.md");
  expect(h.post.mock.calls[0][2]).toMatchObject({
    service: "aurora",
    timeout: 300000,
    retry: false,
  });
});
it.each([
  ["a.exe", 10],
  ["a.pdf", 0],
  ["a.pdf", 10485761],
])("rejects unsupported or invalid documents %s", async (name, size) => {
  h.pick.mockResolvedValue({ canceled: false, assets: [{ uri: "file:///doc", name, size }] });
  await expect(run()).rejects.toThrow();
  expect(h.post).not.toHaveBeenCalled();
});
it("builds a native file part and stops after account changes", async () => {
  h.platform.OS = "ios";
  h.pick.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///a.docx", name: "a.docx", size: 100 }],
  });
  const append = vi.spyOn(FormData.prototype, "append");
  await run();
  expect(append).toHaveBeenCalledWith("file", {
    uri: "file:///a.docx",
    name: "a.docx",
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  append.mockRestore();
  h.post.mockClear();
  h.pick.mockImplementation(async () => {
    h.generation = 2;
    return { canceled: false, assets: [] };
  });
  await expect(run()).rejects.toThrow("expired");
  expect(h.post).not.toHaveBeenCalled();
});
it("returns quietly on picker cancellation and rejects invalid response shapes", async () => {
  h.pick.mockResolvedValue({ canceled: true });
  expect(await run()).toBeNull();
  expect(h.post).not.toHaveBeenCalled();
  const file = new File(["brief"], "brief.txt");
  h.pick.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "blob:test", file, name: file.name }],
  });
  h.post.mockResolvedValue({ name: 123 });
  await expect(run()).rejects.toThrow();
});
