import { beforeEach, expect, it, vi } from "vitest";
import { findNextVideo } from "./next-video";
const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get } }));
vi.mock("@/i18n/locale-store", () => ({ getLocale: () => "zh-CN" }));
const video = (id: string) => ({ id, trailerAsset: { kind: "video", url: "preview.mp4" } });
beforeEach(() => h.get.mockReset());
it("skips empty pages and non-video entries after the current channel", async () => {
  h.get
    .mockResolvedValueOnce({ items: [video("earlier"), video("current")], nextCursor: "a" })
    .mockResolvedValueOnce({
      items: [{ id: "image", trailerAsset: { kind: "image", url: "image.jpg" } }],
      nextCursor: "b",
    })
    .mockResolvedValueOnce({ items: [video("next")], nextCursor: null });
  const signal = new AbortController().signal;
  expect(await findNextVideo("current", signal)).toBe("next");
  expect(h.get.mock.calls[2]).toEqual([
    "/ip-commerce/ips",
    { service: "aurora", params: { locale: "zh-CN", limit: 20, cursor: "b" }, signal },
  ]);
});
it("recognizes an episode preview without using its URL as playback authorization", async () => {
  h.get.mockResolvedValue({
    items: [
      video("current"),
      { id: "next", episodes: [{ trailerAsset: { kind: "video", url: "preview.mp4" } }] },
    ],
    nextCursor: null,
  });
  expect(await findNextVideo("current", new AbortController().signal)).toBe("next");
});
it.each(["missing", "last"])("never wraps or guesses when current is %s", async (id) => {
  h.get.mockResolvedValue({ items: [video("first"), video("last")], nextCursor: null });
  expect(await findNextVideo(id, new AbortController().signal)).toBeNull();
});
it("surfaces upstream failure and rejects cursor loops", async () => {
  h.get.mockRejectedValueOnce(new Error("Catalogue unavailable"));
  await expect(findNextVideo("current", new AbortController().signal)).rejects.toThrow(
    "Catalogue unavailable"
  );
  h.get.mockResolvedValue({ items: [video("current")], nextCursor: "repeat" });
  await expect(findNextVideo("current", new AbortController().signal)).rejects.toThrow(
    "repeated cursor"
  );
});
it("stops when the route retires during a page read", async () => {
  const controller = new AbortController();
  h.get.mockImplementation(async () => {
    controller.abort();
    return { items: [video("current"), video("next")], nextCursor: null };
  });
  await expect(findNextVideo("current", controller.signal)).rejects.toThrow();
  expect(h.get).toHaveBeenCalledTimes(1);
});
