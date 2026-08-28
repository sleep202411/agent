import { describe, expect, it } from "vitest";
import { advanceStoryTimelinePlayback, storyTimelineItemAtTime } from "./story-timeline-playback";

const items = [
  { id: "a", startMs: 0, durationMs: 4_000 },
  { id: "b", startMs: 4_000, durationMs: 6_000 },
];

describe("story timeline playback", () => {
  it("uses half-open clip ranges so boundaries select the next clip", () => {
    expect(storyTimelineItemAtTime(items, 3_999)?.id).toBe("a");
    expect(storyTimelineItemAtTime(items, 4_000)?.id).toBe("b");
    expect(storyTimelineItemAtTime(items, 10_000)?.id).toBe("b");
  });

  it("advances from the requested playhead and stops at the sequence end", () => {
    expect(advanceStoryTimelinePlayback(4_000, 2_500, 10_000)).toEqual({
      timeMs: 6_500,
      ended: false,
    });
    expect(advanceStoryTimelinePlayback(9_000, 2_500, 10_000)).toEqual({
      timeMs: 10_000,
      ended: true,
    });
  });
});
