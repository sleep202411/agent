import { describe, expect, it, vi } from "vitest";
import {
  StoryboardCoverageStore,
  storyboardStillUrl,
  type StoryboardNodeCoverage,
} from "./story-canvas-storyboard-coverage";

function coverage(patch: Partial<StoryboardNodeCoverage> = {}): StoryboardNodeCoverage {
  return {
    total: 1,
    ready: 1,
    thumbnailUrl: "https://cdn.example/still.jpg",
    previewVideoUrl: "https://cdn.example/clip.mp4",
    durationMs: 4_000,
    ...patch,
  };
}

describe("storyboard stills", () => {
  it("keeps image urls and rejects video files", () => {
    expect(storyboardStillUrl(coverage())).toBe("https://cdn.example/still.jpg");
    expect(
      storyboardStillUrl(coverage({ thumbnailUrl: "https://cdn.example/clip.mp4?x=1" }))
    ).toBeNull();
    expect(storyboardStillUrl(null)).toBeNull();
  });
});

describe("storyboard coverage store", () => {
  it("notifies only the node whose media changed", () => {
    const store = new StoryboardCoverageStore();
    const left = vi.fn();
    const right = vi.fn();
    store.subscribe("left", left);
    store.subscribe("right", right);
    store.replace(
      new Map([
        ["left", coverage({ thumbnailUrl: "https://cdn.example/a.jpg" })],
        ["right", coverage({ thumbnailUrl: "https://cdn.example/b.jpg" })],
      ])
    );
    expect(left).toHaveBeenCalledTimes(1);
    expect(right).toHaveBeenCalledTimes(1);

    store.replace(
      new Map([
        ["left", coverage({ thumbnailUrl: "https://cdn.example/a.jpg" })],
        ["right", coverage({ thumbnailUrl: "https://cdn.example/c.jpg" })],
      ])
    );
    expect(left).toHaveBeenCalledTimes(1);
    expect(right).toHaveBeenCalledTimes(2);
    expect(store.get("right")?.thumbnailUrl).toBe("https://cdn.example/c.jpg");
    expect(store.get("left")).toBe(store.get("left"));
  });
});
