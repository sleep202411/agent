import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePausableTimeout } from "./use-pausable-timeout";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let running = true;
let enabled = true;
let playbackRate = 1;
let remaining: () => number;
let initialRemainingMs: number | undefined;
const done = vi.fn();
function Harness() {
  const readRemaining = usePausableTimeout({
    running,
    enabled,
    durationMs: 3000,
    onTimeout: done,
    initialRemainingMs,
    playbackRate,
  });
  useEffect(() => {
    remaining = readRemaining;
  }, [readRemaining]);
  return null;
}
const render = () => act(async () => root.render(<Harness />));
const advance = (ms: number) =>
  act(async () => {
    vi.advanceTimersByTime(ms);
  });
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  root = createRoot(document.createElement("div"));
  running = enabled = true;
  playbackRate = 1;
  initialRemainingMs = undefined;
  done.mockClear();
});
it("resumes the remaining hold and retains it over pauses", async () => {
  initialRemainingMs = 500;
  running = false;
  await render();
  await advance(10000);
  running = true;
  await render();
  await advance(250);
  running = false;
  await render();
  await advance(10000);
  running = true;
  await render();
  await advance(249);
  expect(done).not.toHaveBeenCalled();
  await advance(1);
  expect(done).toHaveBeenCalledOnce();
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
});
it("retains the remaining charge timeout across repeated pauses", async () => {
  await render();
  await advance(1000);
  running = false;
  await render();
  await advance(20000);
  expect(done).not.toHaveBeenCalled();
  running = true;
  await render();
  await advance(1000);
  running = false;
  await render();
  await advance(20000);
  running = true;
  await render();
  await advance(999);
  expect(done).not.toHaveBeenCalled();
  await advance(1);
  expect(done).toHaveBeenCalledTimes(1);
  running = false;
  await render();
  running = true;
  await render();
  await advance(10000);
  expect(done).toHaveBeenCalledTimes(1);
});
it("starts a full new window when a gesture gate is reopened", async () => {
  await render();
  await advance(2000);
  enabled = false;
  await render();
  await advance(10000);
  enabled = true;
  await render();
  await advance(2999);
  expect(done).not.toHaveBeenCalled();
  await advance(1);
  expect(done).toHaveBeenCalledTimes(1);
});

it("preserves remaining story time across rate changes and pauses", async () => {
  await render();
  await advance(500);
  expect(remaining()).toBe(2500);
  playbackRate = 2;
  await render();
  await advance(500);
  expect(remaining()).toBe(1500);
  running = false;
  await render();
  playbackRate = 1.5;
  await render();
  await advance(10000);
  expect(remaining()).toBe(1500);
  running = true;
  await render();
  await advance(999);
  expect(done).not.toHaveBeenCalled();
  await advance(1);
  expect(done).toHaveBeenCalledOnce();
  expect(remaining()).toBe(0);
});
