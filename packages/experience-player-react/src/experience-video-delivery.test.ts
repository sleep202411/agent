// @vitest-environment jsdom

import type { MediaContext } from "@vidstack/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExperienceVideoProviderLoader } from "./experience-video-source";

afterEach(() => vi.restoreAllMocks());

describe("QuickTime native delivery", () => {
  it("loads the unchanged release URL into video.src without a MIME-gated source element", async () => {
    const video = document.createElement("video");
    const load = vi.spyOn(video, "load").mockImplementation(() => {});
    vi.spyOn(video, "canPlayType").mockReturnValue("");
    const loader = new ExperienceVideoProviderLoader();
    loader.target = video;
    const context = {
      $state: { clipStartTime: () => 2, clipEndTime: () => 0 },
    } as unknown as MediaContext;
    const provider = await loader.load(context);
    const source = {
      src: "/aurora/story-projects/p/builds/b/assets/a/variants/v/content",
      type: "video/quicktime",
    };

    try {
      await provider.loadSource(source, "metadata");
      expect(video.getAttribute("src")).toBe(`${source.src}#t=2`);
      expect(video.querySelector("source")).toBeNull();
      expect(video.crossOrigin).toBeNull();
      expect(load).toHaveBeenCalledTimes(1);
      expect(provider.currentSrc).toEqual(source);

      const next = {
        ...source,
        src: "/aurora/story-projects/p/builds/b/assets/next/variants/v/content",
      };
      await provider.loadSource(next, "metadata");
      expect(video.getAttribute("src")).toBe(`${next.src}#t=2`);
      expect(provider.currentSrc).toEqual(next);
      expect(load).toHaveBeenCalledTimes(2);
    } finally {
      provider.scope.dispose();
    }
  });
});
