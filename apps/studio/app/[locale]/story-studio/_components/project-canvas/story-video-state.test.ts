import { describe, expect, it } from "vitest";
import type { StoryVideoGeneration, StoryWorkbench } from "@/lib/story-projects-api";
import { isActiveVideoGeneration, workbenchHasActiveGeneration } from "./story-video-state";

describe("story video state", () => {
  it("recognizes only active generation statuses", () => {
    expect(isActiveVideoGeneration({ status: "running" } as StoryVideoGeneration)).toBe(true);
    expect(isActiveVideoGeneration({ status: "superseded" } as StoryVideoGeneration)).toBe(false);
  });

  it("checks both clip and trailer generations", () => {
    const workbench = {
      video: {
        clips: [],
        trailer: { generation: { status: "queued" }, currentVideo: null, selectionVersion: 0 },
      },
    } as unknown as StoryWorkbench;
    expect(workbenchHasActiveGeneration(workbench)).toBe(true);
  });
});
