import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useFixedPlaybackClock } from "./use-fixed-playback-clock";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let running = true;
let playbackRate = 1;
let identity = "scene-a";
let initialPositionMs = 0;
let initiallyCompleted = false;
const time = vi.fn();
const done = vi.fn();
function Probe() {
  useFixedPlaybackClock({
    identity,
    enabled: true,
    running,
    playbackRate,
    durationMs: 2000,
    initialPositionMs,
    initiallyCompleted,
    onTime: time,
    onCompleted: done,
  });
  return null;
}
const render = () => act(async () => root.render(<Probe />));
const advance = (ms: number) =>
  act(async () => {
    vi.advanceTimersByTime(ms);
  });
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["performance", "requestAnimationFrame", "cancelAnimationFrame"] });
  root = createRoot(document.createElement("div"));
  running = true;
  playbackRate = 1;
  identity = "scene-a";
  initialPositionMs = 0;
  initiallyCompleted = false;
  vi.clearAllMocks();
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
});
it("keeps rate changes continuous and excludes paused wall time", async () => {
  await render();
  await advance(512);
  expect(time).toHaveBeenLastCalledWith(512);
  playbackRate = 2;
  await render();
  await advance(512);
  expect(time).toHaveBeenLastCalledWith(1536);
  running = false;
  await render();
  playbackRate = 1;
  await render();
  await advance(10000);
  expect(time).toHaveBeenLastCalledWith(1536);
  running = true;
  await render();
  await advance(480);
  expect(time).toHaveBeenLastCalledWith(2000);
  expect(done).toHaveBeenCalledOnce();
  playbackRate = 2;
  await render();
  await advance(10000);
  expect(done).toHaveBeenCalledOnce();
});
it("restores a checkpoint at double speed and resets for the next scene", async () => {
  initialPositionMs = 1000;
  playbackRate = 2;
  await render();
  await advance(512);
  expect(done).toHaveBeenCalledOnce();
  identity = "scene-b";
  initialPositionMs = 0;
  await render();
  await advance(512);
  expect(time).toHaveBeenLastCalledWith(1024);
  expect(done).toHaveBeenCalledOnce();
});
it("does not replay a completed checkpoint or retain frames after unmount", async () => {
  initiallyCompleted = true;
  await render();
  await advance(10000);
  expect(done).not.toHaveBeenCalled();
  expect(time).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
