import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useWindowSize, type WindowSizeState } from "./use-window-size";
let root: Root, container: HTMLDivElement, state: WindowSizeState;
function Host() {
  const value = useWindowSize();
  useLayoutEffect(() => {
    state = value;
  }, [value]);
  return null;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  container.remove();
});
it("uses browser dimensions without VisualViewport", async () => {
  vi.stubGlobal("visualViewport", undefined);
  vi.stubGlobal("innerWidth", 800);
  vi.stubGlobal("innerHeight", 600);
  await act(async () => {
    root.render(<Host />);
  });
  await act(async () => vi.advanceTimersByTime(200));
  expect(state).toEqual({ width: 800, height: 600, offsetTop: 0, offsetLeft: 0, scale: 1 });
  vi.stubGlobal("innerHeight", 400);
  await act(async () => {
    window.dispatchEvent(new Event("resize"));
    vi.advanceTimersByTime(200);
  });
  expect(state.height).toBe(400);
});
it("tracks viewport panning without a resize", async () => {
  const viewport = Object.assign(new EventTarget(), {
    width: 800,
    height: 500,
    offsetTop: 0,
    offsetLeft: 0,
    scale: 1,
  });
  vi.stubGlobal("visualViewport", viewport);
  await act(async () => root.render(<Host />));
  await act(async () => vi.advanceTimersByTime(200));
  viewport.offsetTop = 125;
  await act(async () => {
    viewport.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(200);
  });
  expect(state.offsetTop).toBe(125);
});
it("cancels pending measurements after unmount", async () => {
  vi.stubGlobal("visualViewport", undefined);
  const read = vi.fn(() => 800);
  Object.defineProperty(window, "innerWidth", { configurable: true, get: read });
  await act(async () => root.render(<Host />));
  await act(async () => root.render(null));
  read.mockClear();
  await act(async () => {
    window.dispatchEvent(new Event("resize"));
    vi.runAllTimers();
  });
  expect(read).not.toHaveBeenCalled();
});
