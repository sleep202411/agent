import { describe, expect, it } from "vitest";
import type { StoryClipVideoSummary, StoryWorkbench } from "@/lib/story-projects-api";
import { projectConfirmedClipCurrentVideo } from "./story-workbench-current-video";

describe("confirmed current video projection", () => {
  it("upserts by graph node identity", () => {
    const workbench = {
      project: { production: { currentVideoCount: 0, generatingClipCount: 0 } },
      video: {
        snapshotHash: "a",
        clips: [],
        trailer: { selectionVersion: 0, currentVideo: null, generation: null },
      },
    } as unknown as StoryWorkbench;
    const confirmed = {
      graphNodeId: "opening",
      selectionVersion: 1,
      currentVideo: { asset: { id: "asset" } },
      generation: null,
    } as StoryClipVideoSummary;

    const next = projectConfirmedClipCurrentVideo(workbench, confirmed);
    expect(next?.video.clips).toEqual([confirmed]);
  });
});
