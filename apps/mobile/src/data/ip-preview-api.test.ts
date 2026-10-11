import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { fetchIpPreview } from "./ip-api";
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
vi.mock("@/i18n/locale-store", () => ({ getLocale: () => "en-US" }));
vi.mock("@/config", () => ({ appEnv: {}, resolveAssetUrl: (value: string) => value }));
beforeEach(() => vi.resetAllMocks());
const video = (url: string) => ({ kind: "video", url });
it("uses the public detail endpoint and official IP-trailer / episode-trailer / media priority", async () => {
  const signal = new AbortController().signal;
  for (const [trailerAsset, episodes, expected] of [
    [
      video("https://cdn.test/ip.mp4"),
      [{ trailerAsset: video("https://cdn.test/ep.mp4") }],
      "https://cdn.test/ip.mp4",
    ],
    [
      null,
      [
        {
          trailerAsset: video("https://cdn.test/ep.mp4"),
          mediaAsset: video("https://cdn.test/media.mp4"),
        },
      ],
      "https://cdn.test/ep.mp4",
    ],
    [null, [{ mediaAsset: video("https://cdn.test/media.mp4") }], "https://cdn.test/media.mp4"],
  ] as const) {
    vi.mocked(api.get).mockResolvedValue({
      ip: { id: "one", title: "One", trailerAsset, episodes },
    });
    expect(await fetchIpPreview("one", signal)).toBe(expected);
  }
  expect(api.get).toHaveBeenCalledWith(
    "/ip-commerce/ips/one",
    expect.objectContaining({ service: "aurora", signal, params: { locale: "en-US" } })
  );
});
it("never guesses URLs for missing, poster-only, or externally linked media", async () => {
  for (const ip of [
    undefined,
    {
      id: "one",
      title: "One",
      trailerAsset: { kind: "image", url: "https://cdn.test/poster.jpg" },
    },
    {
      id: "one",
      title: "One",
      trailerAsset: { kind: "video", externalUrl: "https://cdn.test/external.mp4" },
    },
  ]) {
    vi.mocked(api.get).mockResolvedValue({ ip });
    expect(await fetchIpPreview("one", new AbortController().signal)).toBeUndefined();
  }
});
it("rejects canceled, cross-IP, unsafe and unavailable responses", async () => {
  const c = new AbortController();
  c.abort();
  vi.mocked(api.get).mockResolvedValue({ ip: { id: "one", title: "One" } });
  await expect(fetchIpPreview("one", c.signal)).rejects.toThrow();
  vi.mocked(api.get).mockResolvedValue({ ip: { id: "other", title: "Other" } });
  await expect(fetchIpPreview("one", new AbortController().signal)).rejects.toThrow("identity");
  vi.mocked(api.get).mockResolvedValue({
    ip: { id: "one", title: "One", trailerAsset: video("javascript:alert(1)") },
  });
  await expect(fetchIpPreview("one", new AbortController().signal)).rejects.toThrow("URL");
  vi.mocked(api.get).mockRejectedValue(Error("403"));
  await expect(fetchIpPreview("one", new AbortController().signal)).rejects.toThrow("403");
});
