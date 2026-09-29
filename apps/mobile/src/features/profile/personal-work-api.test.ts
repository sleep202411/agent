import { expect, it, vi } from "vitest";
import { getCreatorPersonalWorks, getPersonalWorkLink } from "./personal-work-api";
import { api } from "@/lib/api-client";
vi.mock("@/config", () => ({
  appEnv: { assets: { bannerBaseUrl: "https://banner.test/" } },
  resolveAssetUrl: (path: string, base: string) => base + path,
}));
vi.mock("@/lib/api-client", () => ({ api: { postForm: vi.fn() } }));
it("resolves a fresh signed URL through Web's permission-checked form contract", async () => {
  vi.mocked(api.postForm).mockResolvedValue("https://media.test/video?signature=abc");
  const signal = new AbortController().signal;
  expect(await getPersonalWorkLink("12", signal)).toBe("https://media.test/video?signature=abc");
  expect(api.postForm).toHaveBeenLastCalledWith(
    "/vedio/play/personal/getLink",
    { id: "12" },
    { service: "content", signal }
  );
});
it.each([
  null,
  {},
  "",
  "private/bucket/key",
  "javascript:alert(1)",
  "https://user:password@media.test/file",
])("rejects invalid media instead of constructing private bucket URLs: %j", async (response) => {
  vi.mocked(api.postForm).mockResolvedValue(response);
  await expect(getPersonalWorkLink("12")).rejects.toThrow();
});
it("propagates access errors without falling back to private storage", async () => {
  vi.mocked(api.postForm).mockRejectedValueOnce(new Error("Forbidden"));
  await expect(getPersonalWorkLink("12")).rejects.toThrow("Forbidden");
});

it("reads public creator videos using the public endpoint and filters explicit private rows", async () => {
  vi.mocked(api.postForm).mockResolvedValue([
    { id: 1, title: "Film", videoBanner: "one.jpg", viewStatus: 1 },
    { id: 2, title: "Private", viewStatus: 0 },
    null,
  ]);
  const signal = new AbortController().signal;
  expect(await getCreatorPersonalWorks("author", 2, signal)).toEqual({
    works: [{ id: "1", title: "Film", coverUrl: "https://banner.test/one.jpg" }],
    hasMore: false,
  });
  expect(api.postForm).toHaveBeenLastCalledWith(
    "/vedio/query/user/personal",
    { userId: "author", page: "2", pageSize: "20" },
    { service: "content", signal }
  );
});
it("uses raw page size so filtered pages still allow access to later works", async () => {
  vi.mocked(api.postForm).mockResolvedValue(
    Array.from({ length: 20 }, (_, id) => ({ id, viewStatus: 0 }))
  );
  expect(await getCreatorPersonalWorks("author", 1)).toEqual({ works: [], hasMore: true });
});
it("rejects malformed list responses instead of reporting an empty portfolio", async () => {
  vi.mocked(api.postForm).mockResolvedValue({ unexpected: [] });
  await expect(getCreatorPersonalWorks("author", 1)).rejects.toThrow("Invalid work list response");
});
