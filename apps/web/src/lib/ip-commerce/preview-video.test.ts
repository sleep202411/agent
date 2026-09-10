import { describe, expect, it } from "vitest";
import type { IpCommerceAsset } from "./api";
import { ipPreviewVideoUrl, previewVideoUrl } from "./preview-video";

const asset = (url: string | null): IpCommerceAsset => ({
  id: "video",
  kind: "video",
  url,
  externalUrl: "https://media.example.com/original.mp4",
  storageProvider: "external_url",
  bucket: null,
  objectKey: null,
  region: null,
  contentType: "video/mp4",
  width: null,
  height: null,
  durationSeconds: null,
});

describe("IP preview videos", () => {
  it("never revives an unavailable URL from externalUrl", () => {
    expect(previewVideoUrl(asset(null))).toBe("");
    expect(previewVideoUrl({ ...asset("cover.jpg"), kind: "image" })).toBe("");
  });

  it("keeps IP trailer, episode trailer, then episode media priority", () => {
    const episodes = [{ trailerAsset: asset("trailer.mp4"), mediaAsset: asset("episode.mp4") }];
    expect(ipPreviewVideoUrl({ trailerAsset: asset("ip.mp4"), episodes })).toBe("ip.mp4");
    expect(ipPreviewVideoUrl({ trailerAsset: null, episodes })).toBe("trailer.mp4");
    expect(
      ipPreviewVideoUrl({
        trailerAsset: null,
        episodes: [{ trailerAsset: null, mediaAsset: asset("episode.mp4") }],
      })
    ).toBe("episode.mp4");
  });

  it("finds playable video after an unavailable first episode", () => {
    expect(
      ipPreviewVideoUrl({
        trailerAsset: asset(null),
        episodes: [
          { trailerAsset: asset(null), mediaAsset: null },
          { trailerAsset: null, mediaAsset: asset("second.mp4") },
        ],
      })
    ).toBe("second.mp4");
  });

  it("leaves IPs with no public video empty", () => {
    expect(ipPreviewVideoUrl({ trailerAsset: null, episodes: [] })).toBe("");
    expect(
      ipPreviewVideoUrl({
        trailerAsset: null,
        episodes: [{ trailerAsset: null, mediaAsset: null }],
      })
    ).toBe("");
  });
});
