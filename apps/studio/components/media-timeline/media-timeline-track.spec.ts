import { describe, expect, it } from "vitest";
import {
  applyTimelineRangeDelta,
  normalizeTimelineRange,
  timelinePixelsToSeconds,
  timelineRangePreviewTime,
  timelineSecondsToPixels,
} from "./media-timeline-track";

describe("media timeline coordinates", () => {
  it("maps time and pixels in both directions", () => {
    expect(timelineSecondsToPixels(5, 1_000, 10)).toBe(500);
    expect(timelinePixelsToSeconds(250, 1_000, 10)).toBe(2.5);
  });

  it("clamps coordinates to the visible duration", () => {
    expect(timelineSecondsToPixels(12, 1_000, 10)).toBe(1_000);
    expect(timelinePixelsToSeconds(-40, 1_000, 10)).toBe(0);
    expect(timelinePixelsToSeconds(1_200, 1_000, 10)).toBe(10);
  });

  it("normalizes ranges without allowing a range to escape the timeline", () => {
    expect(normalizeTimelineRange({ startSeconds: 9.8, endSeconds: 15 }, 10, 1)).toEqual({
      startSeconds: 9,
      endSeconds: 10,
    });
  });

  it("uses the full duration when the minimum range is longer than the media", () => {
    expect(normalizeTimelineRange({ startSeconds: 2, endSeconds: 3 }, 4, 8)).toEqual({
      startSeconds: 0,
      endSeconds: 4,
    });
  });

  it("moves a range without allowing either edge to escape the timeline", () => {
    expect(applyTimelineRangeDelta({ startSeconds: 2, endSeconds: 5 }, "move", 8, 10, 1)).toEqual({
      startSeconds: 7,
      endSeconds: 10,
    });
    expect(applyTimelineRangeDelta({ startSeconds: 2, endSeconds: 5 }, "move", -8, 10, 1)).toEqual({
      startSeconds: 0,
      endSeconds: 3,
    });
  });

  it("resizes one range edge while preserving the minimum duration", () => {
    expect(
      applyTimelineRangeDelta({ startSeconds: 2, endSeconds: 5 }, "resize-start", 10, 10, 1)
    ).toEqual({ startSeconds: 4, endSeconds: 5 });
    expect(
      applyTimelineRangeDelta({ startSeconds: 2, endSeconds: 5 }, "resize-end", -10, 10, 1)
    ).toEqual({ startSeconds: 2, endSeconds: 3 });
  });

  it("selects the edited boundary as the frame to preview", () => {
    const value = { startSeconds: 2, endSeconds: 5 };
    expect(timelineRangePreviewTime(value, "move")).toBe(2);
    expect(timelineRangePreviewTime(value, "resize-start")).toBe(2);
    expect(timelineRangePreviewTime(value, "resize-end")).toBe(5);
  });
});
