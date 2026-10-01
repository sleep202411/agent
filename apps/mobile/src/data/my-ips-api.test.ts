import { beforeEach, expect, it, vi } from "vitest";
import { fetchMyIpsPage } from "./ip-api";
const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/config", () => ({ appEnv: {}, resolveAssetUrl: (v: string) => v }));
vi.mock("@/i18n/locale-store", () => ({ getLocale: () => "zh-CN" }));
vi.mock("@/lib/api-client", () => ({
  api: { get: h.get },
  ApiRequestError: class extends Error {},
}));
beforeEach(() => {
  h.get.mockReset();
});
it("forwards cursor, locale and cancellation while retaining unpublished IPs", async () => {
  const signal = new AbortController().signal;
  h.get.mockResolvedValue({
    items: [
      { id: "one", title: "Draft", status: "draft", listingVisibility: "private" },
      { id: "two", title: "Published", status: "published", listingVisibility: "public" },
    ],
    nextCursor: "two",
  });
  const result = await fetchMyIpsPage("prior", signal);
  expect(h.get).toHaveBeenCalledWith("/ip-commerce/me/ips", {
    service: "aurora",
    signal,
    params: { cursor: "prior", limit: 50, locale: "zh-CN" },
  });
  expect(result.nextCursor).toBe("two");
  expect(result.items.map((x) => x.published)).toEqual([false, true]);
});
it("exposes transport and permission failures instead of returning an empty collection", async () => {
  h.get.mockRejectedValue(new Error("Access denied"));
  await expect(fetchMyIpsPage()).rejects.toThrow("Access denied");
});
it("rejects malformed or nonadvancing pages", async () => {
  for (const value of [
    { items: [], nextCursor: "old" },
    { items: [{ id: "one" }], nextCursor: null },
    { items: [{ id: "one", title: "IP" }], nextCursor: "other" },
    { items: [], nextCursor: undefined },
  ]) {
    h.get.mockResolvedValueOnce(value);
    await expect(fetchMyIpsPage("old")).rejects.toThrow("Invalid owned IP response");
  }
});
