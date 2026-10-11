import { expect, it, vi } from "vitest";
import { fetchIpDetail } from "./ip-api";
import { api } from "@/lib/api-client";
vi.mock("@/config", () => ({ appEnv: {}, resolveAssetUrl: (value: string) => value }));
vi.mock("@/i18n/locale-store", () => ({ getLocale: () => "en-US" }));
vi.mock("@/lib/api-client", () => ({
  api: { get: vi.fn() },
  ApiRequestError: class extends Error {},
}));
it("keeps canonical episode numbers separate from display positions for feedback", async () => {
  vi.mocked(api.get).mockResolvedValue({
    ip: {
      id: "ip",
      title: "IP",
      episodes: [
        {
          id: "four",
          episodeNo: 4,
          status: "published",
          mediaAsset: { url: "https://cdn.test/4.mp4" },
        },
        {
          id: "two",
          episodeNo: 2,
          status: "published",
          mediaAsset: { url: "https://cdn.test/2.mp4" },
        },
        {
          id: "locked",
          episodeNo: 1,
          status: "published",
          trailerAsset: { url: "https://cdn.test/trailer.mp4" },
        },
        {
          id: "draft",
          episodeNo: 3,
          status: "draft",
          mediaAsset: { url: "https://cdn.test/3.mp4" },
        },
      ],
    },
  });
  const detail = await fetchIpDetail("ip");
  expect(detail?.episodes.map((ep) => [ep.index, ep.episodeNo, ep.feedbackEligible])).toEqual([
    [1, 4, false],
    [2, 2, true],
    [3, 1, false],
    [4, 3, false],
  ]);
});

it("keeps full episode media separate from previews and follows Web preview priority", async () => {
  const ip = {
    id: "ip",
    title: "IP",
    episodes: [
      {
        id: "first",
        status: "published",
        mediaAsset: { kind: "video", url: "https://cdn.test/full.mp4" },
      },
      {
        id: "second",
        status: "published",
        trailerAsset: { kind: "video", url: "https://cdn.test/preview.mp4" },
        mediaAsset: { kind: "video", externalUrl: "https://private.test/unresolved.mp4" },
      },
      {
        id: "draft",
        status: "draft",
        mediaAsset: { kind: "video", url: "https://cdn.test/draft.mp4" },
      },
      {
        id: "image",
        status: "published",
        mediaAsset: { kind: "image", url: "https://cdn.test/picture.png" },
      },
    ],
  };
  vi.mocked(api.get).mockResolvedValue({ ip });
  const detail = await fetchIpDetail("ip");
  expect(detail?.previewVideoUrl).toBe("https://cdn.test/preview.mp4");
  expect(detail?.episodes.map((ep) => ep.mediaUrl)).toEqual([
    "https://cdn.test/full.mp4",
    undefined,
    undefined,
    undefined,
  ]);
  vi.mocked(api.get).mockResolvedValue({
    ip: { ...ip, trailerAsset: { kind: "video", url: "https://cdn.test/ip.mp4" } },
  });
  expect((await fetchIpDetail("ip"))?.previewVideoUrl).toBe("https://cdn.test/ip.mp4");
});
