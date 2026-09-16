import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => {
  const fixture = { resize: () => {}, disconnect: vi.fn() };
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(fn: () => void) {
        fixture.resize = fn;
      }
      observe() {}
      disconnect = fixture.disconnect;
    }
  );
  return fixture;
});
import { useElementRect } from "./use-element-rect";
let root: Root, container: HTMLDivElement, target: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  container = document.createElement("div");
  target = document.createElement("div");
  document.body.append(container, target);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  container.remove();
  target.remove();
});
function Host() {
  useElementRect({ element: target });
  return null;
}
it("removes capturing window listeners on departure", async () => {
  const read = vi.spyOn(target, "getBoundingClientRect");
  await act(async () => root.render(<Host />));
  await act(async () => root.render(null));
  read.mockClear();
  await act(async () => {
    window.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("resize"));
    vi.runAllTimers();
  });
  expect(read).not.toHaveBeenCalled();
});
it("cancels pending observer animation frames on departure", async () => {
  const frame = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(42);
  const cancel = vi.spyOn(window, "cancelAnimationFrame");
  await act(async () => root.render(<Host />));
  act(() => h.resize());
  expect(frame).toHaveBeenCalled();
  await act(async () => root.render(null));
  expect(cancel).toHaveBeenCalledWith(42);
});
