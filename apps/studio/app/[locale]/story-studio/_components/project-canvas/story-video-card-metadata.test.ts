import { describe, expect, it } from "vitest";
import type { StoryCurrentVideo } from "@/lib/story-projects-api";
import {
  formatFileSize,
  formatVideoContentType,
  formatVideoDuration,
  storyVideoCardMetadata,
} from "./story-video-card-metadata";

describe("story video card metadata", () => {
  it("formats editorial video facts in a stable priority order", () => {
    expect(
      storyVideoCardMetadata(
        currentVideo({
          durationMs: 5_000,
          width: 1920,
          height: 1080,
          sizeBytes: String(Math.round(12.4 * 1024 * 1024)),
          contentType: "video/mp4",
        })
      )
    ).toEqual([
      { key: "duration", value: "0:05" },
      { key: "dimensions", value: "1920×1080" },
      { key: "fileSize", value: "12.4 MB" },
      { key: "format", value: "MP4" },
    ]);
  });

  it("falls back to durable asset dimensions and duration", () => {
    const video = currentVideo({ durationMs: null, width: null, height: null });
    video.asset.durationSeconds = 65;
    video.asset.width = 1080;
    video.asset.height = 1920;

    expect(storyVideoCardMetadata(video).slice(0, 2)).toEqual([
      { key: "duration", value: "1:05" },
      { key: "dimensions", value: "1080×1920" },
    ]);
  });

  it("omits unknown or invalid facts instead of rendering placeholders", () => {
    expect(
      storyVideoCardMetadata(
        currentVideo({
          durationMs: null,
          width: null,
          height: null,
          sizeBytes: null,
          contentType: "application/octet-stream",
        })
      )
    ).toEqual([]);
  });

  it("formats long durations, exact byte units, and common video MIME types", () => {
    expect(formatVideoDuration(3_725_000)).toBe("1:02:05");
    expect(formatFileSize("1024")).toBe("1 KB");
    expect(formatFileSize("0")).toBeNull();
    expect(formatVideoContentType("video/quicktime")).toBe("MOV");
    expect(formatVideoContentType("video/webm; codecs=vp9")).toBe("WebM");
  });
});

function currentVideo(
  overrides: Partial<
    Pick<StoryCurrentVideo, "durationMs" | "width" | "height" | "sizeBytes" | "contentType">
  > = {}
): StoryCurrentVideo {
  return {
    asset: {
      id: "asset-1",
      kind: "video",
      status: "ready",
      moderationStatus: "approved",
      contentType: "video/mp4",
      width: null,
      height: null,
      durationSeconds: null,
      checksumSha256: null,
      previewUrl: "https://example.test/video.mp4",
    },
    variantId: "variant-1",
    checksumSha256: null,
    contentType: "video/mp4",
    durationMs: null,
    width: null,
    height: null,
    sizeBytes: null,
    browserSafeMp4: true,
    selectionVersion: 1,
    setByUserId: "user-1",
    setAt: "2026-07-23T00:00:00.000Z",
    ...overrides,
  };
}
