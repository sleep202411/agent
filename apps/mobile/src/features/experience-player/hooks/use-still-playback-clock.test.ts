import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useStillPlaybackClock } from "./use-still-playback-clock";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let identity = "still-a";
let ready = true;
let presenting = true;
let durationMs = 1000;
let timelineOffsetMs = 2000;
let initialPositionMs = 0;
let initiallyCompleted = false;
let playbackRate = 1;
let seek: (positionMs: number) => boolean;
const onDisplayed = vi.fn();
let onHoldComplete = vi.fn();
const onTimelineTimeMs = vi.fn();
function Probe() {
  const seekClock = useStillPlaybackClock({
    identity,
    ready,
    presenting,
    durationMs,
    timelineOffsetMs,
    onDisplayed,
    onHoldComplete,
    onTimelineTimeMs,
    initialPositionMs,
    initiallyCompleted,
    playbackRate,
  });
  useEffect(() => {
    seek = seekClock;
  }, [seekClock]);
  return null;
}
async function render() {
  root ??= createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(Probe)));
}
async function advance(ms: number) {
  await act(async () => vi.advanceTimersByTime(ms));
}
beforeEach(() => vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] }));
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.useRealTimers();
  vi.clearAllMocks();
  identity = "still-a";
  ready = true;
  presenting = true;
  durationMs = 1000;
  timelineOffsetMs = 2000;
  initialPositionMs = 0;
  initiallyCompleted = false;
  playbackRate = 1;
  onHoldComplete = vi.fn();
});
it("resumes a saved still after readiness and pause without repeating its display transition", async () => {
  initialPositionMs = 750;
  ready = false;
  await render();
  await advance(5000);
  ready = true;
  presenting = false;
  await render();
  await advance(5000);
  expect(onHoldComplete).not.toHaveBeenCalled();
  presenting = true;
  await render();
  expect(onTimelineTimeMs).toHaveBeenLastCalledWith(2750);
  await advance(250);
  expect(onHoldComplete).toHaveBeenCalledOnce();
  expect(onDisplayed).not.toHaveBeenCalled();
});
it("does not complete a restored finished still a second time", async () => {
  initialPositionMs = 1000;
  initiallyCompleted = true;
  await render();
  await advance(10000);
  expect(onHoldComplete).not.toHaveBeenCalled();
  expect(onDisplayed).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
it("waits for media readiness and completes exactly once at the timeline offset", async () => {
  ready = false;
  await render();
  await advance(5000);
  expect(onDisplayed).not.toHaveBeenCalled();
  ready = true;
  await render();
  await advance(1000);
  await advance(5000);
  expect(onDisplayed).toHaveBeenCalledTimes(1);
  expect(onHoldComplete).toHaveBeenCalledTimes(1);
  expect(onTimelineTimeMs).toHaveBeenLastCalledWith(3000);
  expect(vi.getTimerCount()).toBe(0);
});
it("does not count paused time and resumes the remaining hold", async () => {
  await render();
  await advance(500);
  presenting = false;
  await render();
  await advance(5000);
  expect(onHoldComplete).not.toHaveBeenCalled();
  presenting = true;
  await render();
  await advance(500);
  expect(onDisplayed).toHaveBeenCalledTimes(1);
  expect(onHoldComplete).toHaveBeenCalledTimes(1);
});
it("uses current duration, offset and completion callbacks without restarting elapsed time", async () => {
  durationMs = 500;
  await render();
  await advance(250);
  const oldComplete = onHoldComplete;
  onHoldComplete = vi.fn();
  durationMs = 1000;
  timelineOffsetMs = 4000;
  await render();
  await advance(250);
  expect(onHoldComplete).not.toHaveBeenCalled();
  await advance(500);
  expect(onHoldComplete).toHaveBeenCalledTimes(1);
  expect(oldComplete).not.toHaveBeenCalled();
  expect(onTimelineTimeMs).toHaveBeenLastCalledWith(5000);
});
it("resets elapsed time and completed state for replacement media", async () => {
  await render();
  await advance(750);
  identity = "still-b";
  await render();
  await advance(250);
  expect(onHoldComplete).not.toHaveBeenCalled();
  await advance(750);
  expect(onHoldComplete).toHaveBeenCalledTimes(1);
  identity = "still-c";
  await render();
  await advance(1000);
  expect(onHoldComplete).toHaveBeenCalledTimes(2);
  expect(onDisplayed).toHaveBeenCalledTimes(3);
});
it("clears active timers on unmount", async () => {
  await render();
  await advance(250);
  await act(async () => root!.unmount());
  root = undefined;
  await advance(1000);
  expect(onHoldComplete).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("changes rate without moving elapsed time backwards or replaying display", async () => {
  durationMs = 2000;
  await render();
  await advance(500);
  playbackRate = 2;
  await render();
  expect(onTimelineTimeMs).toHaveBeenLastCalledWith(2500);
  await advance(500);
  expect(onTimelineTimeMs).toHaveBeenLastCalledWith(3500);
  playbackRate = 1;
  await render();
  await advance(500);
  expect(onHoldComplete).toHaveBeenCalledOnce();
  expect(onDisplayed).toHaveBeenCalledOnce();
  expect(onTimelineTimeMs).toHaveBeenLastCalledWith(4000);
});
it("does not accrue time when rate changes while paused", async () => {
  await render();
  await advance(250);
  presenting = false;
  await render();
  playbackRate = 2;
  await render();
  await advance(10000);
  expect(onHoldComplete).not.toHaveBeenCalled();
  presenting = true;
  await render();
  expect(onTimelineTimeMs).toHaveBeenLastCalledWith(2250);
  await advance(250);
  expect(onHoldComplete).not.toHaveBeenCalled();
  await advance(250);
  expect(onHoldComplete).toHaveBeenCalledOnce();
});
it("resets replacement media while retaining its requested rate", async () => {
  playbackRate = 2;
  await render();
  await advance(250);
  identity = "replacement";
  await render();
  expect(onTimelineTimeMs).toHaveBeenLastCalledWith(2000);
  await advance(250);
  expect(onHoldComplete).not.toHaveBeenCalled();
  await advance(250);
  expect(onHoldComplete).toHaveBeenCalledOnce();
});

it("seeks a paused still without completing or replaying its display", async () => {
  durationMs = 2000;
  await render();
  await advance(1000);
  presenting = false;
  await render();
  await act(async () => {
    expect(seek(250)).toBe(true);
  });
  expect(onTimelineTimeMs).toHaveBeenLastCalledWith(2250);
  await advance(10000);
  expect(onHoldComplete).not.toHaveBeenCalled();
  presenting = true;
  playbackRate = 2;
  await render();
  await advance(1000);
  expect(onHoldComplete).toHaveBeenCalledOnce();
  expect(onDisplayed).toHaveBeenCalledOnce();
  expect(seek(0)).toBe(false);
});
it("does not seek unloaded media and resets the running time anchor on seek", async () => {
  ready = false;
  await render();
  expect(seek(500)).toBe(false);
  ready = true;
  await render();
  await advance(500);
  await act(async () => {
    expect(seek(0)).toBe(true);
  });
  await advance(500);
  expect(onHoldComplete).not.toHaveBeenCalled();
  await advance(500);
  expect(onHoldComplete).toHaveBeenCalledOnce();
});
