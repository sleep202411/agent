import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { fetchEarnings, formatEarnings } from "./api";
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
const page = {
  lifetimeEarned: "900719925474099312345",
  withdrawableBalance: "0",
  works: [],
  entries: [],
  nextCursor: null,
};
beforeEach(() => vi.resetAllMocks());
it("preserves integer precision and reads authenticated totals without a client user ID", async () => {
  vi.mocked(api.get).mockResolvedValue(page);
  const signal = new AbortController().signal;
  expect(await fetchEarnings("en-US", "all", "all", null, signal)).toEqual(page);
  expect(api.get).toHaveBeenCalledWith("/creator-earnings", {
    service: "aurora",
    signal,
    retry: false,
    cache: "no-store",
    params: { locale: "en-US", days: "all", limit: 10 },
  });
  expect(formatEarnings(page.lifetimeEarned, "en-US")).toBe("900,719,925,474,099,312,345");
});
it("passes work, time, locale and cursor filters", async () => {
  vi.mocked(api.get).mockResolvedValue(page);
  await fetchEarnings("zh-CN", "story:work", "30", "next", new AbortController().signal);
  expect(vi.mocked(api.get).mock.calls[0][1]?.params).toEqual({
    locale: "zh-CN",
    days: "30",
    limit: 10,
    work: "story:work",
    cursor: "next",
  });
});
it("rejects lossy numeric amounts rather than substituting zero", async () => {
  vi.mocked(api.get).mockResolvedValue({ ...page, lifetimeEarned: 123 });
  await expect(
    fetchEarnings("en-US", "all", "all", null, new AbortController().signal)
  ).rejects.toThrow();
});
