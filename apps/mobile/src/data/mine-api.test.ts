import { expect, it, vi } from "vitest";
import { findMyWork, fetchMyWorksPage } from "./mine-api";
import { api } from "@/lib/api-client";
vi.mock("@/lib/api-client", () => ({ api: { postForm: vi.fn() } }));
vi.mock("@/config", () => ({
  appEnv: { assets: { bannerBaseUrl: "https://banner.test/" } },
  resolveAssetUrl: (path: string, base: string) => base + path,
}));
it.each(["array", "list", "records", "nested"])(
  "reads owner pages with %s wrapper, preserving private work and numeric visibility",
  async (shape) => {
    const rows = [
      { id: 1, title: "Public", viewStatus: 1 },
      { id: 2, title: "Private", viewStatus: "0", review: 0 },
      null,
    ];
    vi.mocked(api.postForm).mockResolvedValue(
      shape === "array" ? rows : shape === "nested" ? { data: { list: rows } } : { [shape]: rows }
    );
    const signal = new AbortController().signal;
    const result = await fetchMyWorksPage(2, signal);
    expect(result.works.map((w) => w.isPrivate)).toEqual([false, true]);
    expect(result.hasMore).toBe(false);
    expect(api.postForm).toHaveBeenLastCalledWith(
      "/vedio/query/mypersonal",
      { page: "2", pageSize: "30" },
      { service: "content", signal }
    );
  }
);
it("uses raw length for pagination even if malformed rows are removed", async () => {
  vi.mocked(api.postForm).mockResolvedValue(Array(30).fill(null));
  expect(await fetchMyWorksPage(1)).toEqual({ works: [], hasMore: true });
});
it("does not disguise malformed data or failed requests as an empty portfolio", async () => {
  vi.mocked(api.postForm).mockResolvedValue({});
  await expect(fetchMyWorksPage(1)).rejects.toThrow();
  vi.mocked(api.postForm).mockRejectedValueOnce(new Error("offline"));
  await expect(fetchMyWorksPage(1)).rejects.toThrow("offline");
});

it("finds an interrupted work on later owner pages", async () => {
  vi.mocked(api.postForm)
    .mockResolvedValueOnce(Array.from({ length: 30 }, (_, id) => ({ id, title: "old" })))
    .mockResolvedValueOnce([
      { id: 42, title: "Draft", introduction: "Continue", videoLink: "video/key", viewStatus: 0 },
    ]);
  const result = await findMyWork("42", new AbortController().signal);
  expect(result.introduction).toBe("Continue");
  expect(result.hasVideo).toBe(true);
  expect(result.isPrivate).toBe(true);
});
it("stops when a backend repeats the same full page", async () => {
  vi.mocked(api.postForm).mockResolvedValue(Array.from({ length: 30 }, (_, id) => ({ id })));
  await expect(findMyWork("foreign", new AbortController().signal)).rejects.toThrow(
    "did not advance"
  );
});
it("does not look up an aborted owner session", async () => {
  const controller = new AbortController();
  controller.abort();
  const count = vi.mocked(api.postForm).mock.calls.length;
  await expect(findMyWork("42", controller.signal)).rejects.toThrow();
  expect(api.postForm).toHaveBeenCalledTimes(count);
});
