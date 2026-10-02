import { VideoProviderLoader, type Src } from "@vidstack/react";
import { describe, expect, it } from "vitest";
import { ExperienceVideoProviderLoader, normalizeVideoSource } from "./experience-video-source";

const CONTENT_URL =
  "/aurora/story-projects/project/builds/build/assets/asset/variants/original/content";
const MOV_URL = "https://media.example.test/clip.mov";

describe("published video provider selection", () => {
  it("reproduces why a direct MOV works but an extensionless release URL does not", () => {
    const builtin = new VideoProviderLoader();
    expect(builtin.canPlay({ src: MOV_URL, type: "?" })).toBe(true);
    expect(builtin.canPlay({ src: CONTENT_URL, type: "?" })).toBe(false);
    // Even a successful HEAD returning the real MIME cannot rescue the
    // built-in loader: this MIME is absent from its source allowlist.
    expect(builtin.canPlay({ src: CONTENT_URL, type: "video/quicktime" })).toBe(false);
  });

  it.each([MOV_URL, CONTENT_URL])(
    "loads QuickTime natively for %s without format sniffing",
    (src) => {
      const source = normalizeVideoSource({ src, type: "video/quicktime" }) as Src;
      expect(source).toEqual({ src, type: "video/quicktime" });
      expect(new ExperienceVideoProviderLoader().canPlay(source)).toBe(true);
    }
  );

  it("normalizes the MIME while preserving the original signed delivery URL", () => {
    const src = `${CONTENT_URL}?signature=example&expires=123`;
    const source = normalizeVideoSource({
      src,
      type: ' Video/QuickTime; codecs="avc1,mp4a"',
    }) as Src;
    expect(source).toEqual({ src, type: "video/quicktime" });
    expect(new ExperienceVideoProviderLoader().canPlay(source)).toBe(true);
  });

  it.each(["video/mp4", "video/webm", "video/ogg"])(
    "keeps %s on the existing native path",
    (type) => {
      const source = normalizeVideoSource({ src: CONTENT_URL, type }) as Src;
      expect(source).toEqual({ src: CONTENT_URL, type });
      expect(new ExperienceVideoProviderLoader().canPlay(source)).toBe(true);
    }
  );

  it.each([
    "application/vnd.apple.mpegurl",
    "Application/X-MPEGURL",
    'application/vnd.apple.mpegurl; codecs="avc1.640028"',
  ])("hands a negotiated %s master to the HLS loader", (type) => {
    const master = "https://media.fizzspace.cn/hls/asset/master.m3u8";
    expect(normalizeVideoSource({ src: master, type })).toEqual({
      src: master,
      type: "application/vnd.apple.mpegurl",
    });
  });

  it.each(["application/vnd.apple.mpegurl", "application/dash+xml", "video/youtube", "image/png"])(
    "preserves the existing provider decision for %s",
    (type) => {
      const source = { src: CONTENT_URL, type };
      expect(new ExperienceVideoProviderLoader().canPlay(source)).toBe(
        new VideoProviderLoader().canPlay(source)
      );
    }
  );
});
