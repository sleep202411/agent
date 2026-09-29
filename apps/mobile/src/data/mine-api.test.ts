import { expect, it, vi } from "vitest";
import { fetchMyWorksPage } from "./mine-api";
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
