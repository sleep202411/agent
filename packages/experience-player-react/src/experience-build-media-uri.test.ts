import { describe, expect, it } from "vitest";
import { BUILD_CONTENT_PATH, buildMediaEndpoint } from "./experience-build-media-uri";

const CONTENT =
  "/aurora/story-projects/project/builds/build/assets/asset/variants/original/content";

describe("buildMediaEndpoint", () => {
  it("keeps a relative build URI relative", () => {
    expect(buildMediaEndpoint(CONTENT, "playback")).toBe(
      "/aurora/story-projects/project/builds/build/assets/asset/variants/original/playback"
    );
    expect(buildMediaEndpoint(CONTENT, "poster")).toBe(
      "/aurora/story-projects/project/builds/build/assets/asset/variants/original/poster"
    );
  });

  it("keeps an absolute build URI on its own host, with its query", () => {
    expect(
      buildMediaEndpoint(`https://fizzdragon.fizzspace.cn${CONTENT}?locale=zh-CN`, "playback")
    ).toBe(
      "https://fizzdragon.fizzspace.cn/aurora/story-projects/project/builds/build/assets/asset/variants/original/playback?locale=zh-CN"
    );
  });

  it("keeps a protocol-relative build URI protocol-relative", () => {
    expect(buildMediaEndpoint(`//fizzdragon.fizzspace.cn${CONTENT}`, "poster")).toBe(
      "//fizzdragon.fizzspace.cn/aurora/story-projects/project/builds/build/assets/asset/variants/original/poster"
    );
  });

  it.each([
    "https://media.example.test/clip.mp4",
    "/aurora/story-projects/project/builds/build/assets/asset/variants/original/content/extra",
    "/aurora/story-projects/project/chapters/chapter/content",
    "http://[",
    "",
  ])("answers null for media that is not a frozen build clip: %s", (uri) => {
    expect(buildMediaEndpoint(uri, "playback")).toBeNull();
  });

  it("matches the build content path on the path alone", () => {
    expect(BUILD_CONTENT_PATH.test(CONTENT)).toBe(true);
    expect(BUILD_CONTENT_PATH.test(`${CONTENT}?x=1`)).toBe(false);
  });
});
