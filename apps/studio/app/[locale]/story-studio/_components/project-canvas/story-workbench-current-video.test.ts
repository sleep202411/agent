import { describe, expect, it } from "vitest";
import type { StoryClipVideoSummary, StoryWorkbench } from "@/lib/story-projects-api";
import { projectConfirmedClipCurrentVideo } from "./story-workbench-current-video";

describe("confirmed current video projection", () => {
  it("upserts by graph node identity", () => {
    const workbench = {
      project: { production: { currentVideoCount: 0 } },
      video: {
        snapshotHash: "a",
        clips: [],
      },
    } as unknown as StoryWorkbench;
    const confirmed = {
      graphNodeId: "opening",
      selectionVersion: 1,
      currentVideo: { asset: { id: "asset" } },
    } as StoryClipVideoSummary;

    const next = projectConfirmedClipCurrentVideo(workbench, confirmed);
    expect(next?.video.clips).toEqual([confirmed]);
  });
});
