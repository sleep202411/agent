import { beforeEach, expect, it, vi } from "vitest";
import { fetchCreatorServices } from "./creator-service-api";
import { fetchCreatorIps } from "./ip-api";
import { fetchCrewsByUser } from "./crew-api";
const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api-client", () => ({
  api: { get: h.get },
  ApiRequestError: class extends Error {},
}));
vi.mock("@/config", () => ({ appEnv: { assets: {} }, resolveAssetUrl: (p: string) => p }));
vi.mock("@/i18n/locale-store", () => ({ getLocale: () => "en-US" }));
beforeEach(() => {
  h.get.mockReset();
});
it.each([
  ["services", () => fetchCreatorServices(12, { creatorId: "artist" })],
  ["IPs", () => fetchCreatorIps("artist")],
  ["crews", () => fetchCrewsByUser("artist")],
] as const)("preserves %s transport errors and genuine empty results", async (_name, load) => {
  h.get.mockRejectedValueOnce(new Error("Upstream unavailable"));
  await expect(load()).rejects.toThrow("Upstream unavailable");
  h.get.mockResolvedValue({ items: [] });
  await expect(load()).resolves.toEqual([]);
});

it("loads all public creator IP pages with stable locale and deduplicated cards", async () => {
  const item = (id: string) => ({ id, title: id, genreCodes: [] });
  h.get
    .mockResolvedValueOnce({ items: [item("one")], nextCursor: "next" })
    .mockResolvedValueOnce({ items: [item("one"), item("two")], nextCursor: null });
  const signal = new AbortController().signal;
  const result = await fetchCreatorIps("artist/id", 12, signal);
  expect(result.map((item) => item.id)).toEqual(["one", "two"]);
  expect(h.get).toHaveBeenLastCalledWith(
    "/ip-commerce/creators/artist%2Fid/ips",
    expect.objectContaining({
      signal,
      retry: false,
      params: { locale: "en-US", limit: 12, cursor: "next" },
    })
  );
});
it("rejects cursor cycles rather than silently truncating or looping", async () => {
  h.get
    .mockResolvedValueOnce({ items: [], nextCursor: "a" })
    .mockResolvedValueOnce({ items: [], nextCursor: "b" })
    .mockResolvedValueOnce({ items: [], nextCursor: "a" });
  await expect(fetchCreatorIps("artist")).rejects.toThrow("Invalid creator IP page");
  expect(h.get).toHaveBeenCalledTimes(3);
});
it("does not turn a failed later page into a successful incomplete portfolio", async () => {
  h.get
    .mockResolvedValueOnce({ items: [{ id: "one", title: "One" }], nextCursor: "next" })
    .mockRejectedValueOnce(Error("Next page unavailable"));
  await expect(fetchCreatorIps("artist")).rejects.toThrow("Next page unavailable");
});
it("does not request another page after cancellation", async () => {
  const controller = new AbortController();
  h.get.mockImplementationOnce(async () => {
    controller.abort();
    return { items: [], nextCursor: "next" };
  });
  await expect(fetchCreatorIps("artist", 12, controller.signal)).rejects.toThrow();
  expect(h.get).toHaveBeenCalledTimes(1);
});
