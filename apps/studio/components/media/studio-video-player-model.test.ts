import { describe, expect, it } from "vitest";
import {
  CANVAS_VIDEO_FULL_CONTROLS_MIN_ZOOM,
  CANVAS_VIDEO_INTERACTIVE_MIN_ZOOM,
  resolveCanvasVideoControlDensity,
  resolveStudioVideoManualInteraction,
  resolveStudioVideoControlGeometry,
} from "./studio-video-player-model";

describe("canvas video control density", () => {
  it("keeps overview nodes non-interactive", () => {
    expect(resolveCanvasVideoControlDensity(0.16)).toBeNull();
    expect(resolveCanvasVideoControlDensity(CANVAS_VIDEO_INTERACTIVE_MIN_ZOOM - 0.001)).toBeNull();
    expect(resolveCanvasVideoControlDensity(Number.NaN)).toBeNull();
  });

  it("uses one large control at compact zoom", () => {
    expect(resolveCanvasVideoControlDensity(CANVAS_VIDEO_INTERACTIVE_MIN_ZOOM)).toBe("compact");
    expect(resolveCanvasVideoControlDensity(CANVAS_VIDEO_FULL_CONTROLS_MIN_ZOOM - 0.001)).toBe(
      "compact"
    );
  });

  it("shows the full control strip only when its 32px targets remain usable", () => {
    expect(resolveCanvasVideoControlDensity(CANVAS_VIDEO_FULL_CONTROLS_MIN_ZOOM)).toBe("full");
    expect(resolveCanvasVideoControlDensity(1.4)).toBe("full");
  });

  it("keeps transformed control geometry within its visual bounds", () => {
    expect(resolveStudioVideoControlGeometry(0.75)).toEqual({
      controlSize: 40,
      timeFontSize: 13,
    });
    expect(resolveStudioVideoControlGeometry(1)).toEqual({
      controlSize: 32,
      timeFontSize: 11,
    });
    expect(resolveStudioVideoControlGeometry(1.4)).toEqual({
      controlSize: 28,
      timeFontSize: 10,
    });
    expect(resolveStudioVideoControlGeometry(Number.NaN)).toEqual({
      controlSize: 32,
      timeFontSize: 11,
    });
  });

  it("does not turn paused non-playback controls into a future manual play intent", () => {
    expect(resolveStudioVideoManualInteraction({ paused: true, togglesPlayback: false })).toEqual({
      cancelAutoPlayRequest: false,
      claimManualPlayback: false,
    });
    expect(resolveStudioVideoManualInteraction({ paused: true, togglesPlayback: true })).toEqual({
      cancelAutoPlayRequest: true,
      claimManualPlayback: false,
    });
  });

  it("lets any direct control gesture take over an already playing preview", () => {
    expect(resolveStudioVideoManualInteraction({ paused: false, togglesPlayback: false })).toEqual({
      cancelAutoPlayRequest: false,
      claimManualPlayback: true,
    });
  });
});
