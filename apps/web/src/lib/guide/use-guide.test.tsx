import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useGuide } from "./use-guide";
import { createGuideDriver } from "./driver";
import { markGuideCompleted } from "./guide-storage";
vi.mock("./driver", () => ({
  createGuideDriver: vi.fn(),
  toDriverSteps: (steps: unknown) => steps,
}));
vi.mock("./guide-storage", () => ({ isGuideCompleted: () => false, markGuideCompleted: vi.fn() }));
const translate = (key: string) => key;
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => translate }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
let latest: ReturnType<typeof useGuide>;
let active = true;
const driver = {
  setSteps: vi.fn(),
  drive: vi.fn(),
  isActive: () => active,
  destroy: vi.fn(() => {
    active = false;
  }),
};
function Probe({ ready }: { ready: boolean }) {
  const value = useGuide("storyboard", { ready, delay: 100 });
  useLayoutEffect(() => {
    latest = value;
  });
  return null;
}
async function render(ready = true) {
  await act(async () => root.render(<Probe ready={ready} />));
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  active = true;
  vi.mocked(createGuideDriver).mockReturnValue(
    driver as unknown as ReturnType<typeof createGuideDriver>
  );
  host = document.createElement("div");
  host.dataset.tourStep = "tabs";
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});
it("re-arms delayed startup after readiness interrupts the timer", async () => {
  await render();
  await render(false);
  await render();
  await act(async () => vi.advanceTimersByTimeAsync(100));
  expect(driver.drive).toHaveBeenCalledTimes(1);
});
it("does not create overlapping tours from repeated start actions", async () => {
  await render(false);
  act(() => {
    latest.start();
    latest.start();
  });
  expect(createGuideDriver).toHaveBeenCalledTimes(1);
});
it("does not mark unmount cleanup as completed and releases its timer", async () => {
  await render();
  await act(async () => vi.advanceTimersByTimeAsync(100));
  act(() => root.render(null));
  await act(async () => vi.advanceTimersByTimeAsync(500));
  expect(markGuideCompleted).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
it("records a finished tour once and ignores retained starts after unmount", async () => {
  await render();
  await act(async () => vi.advanceTimersByTimeAsync(100));
  active = false;
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(markGuideCompleted).toHaveBeenCalledTimes(1);
  const retained = latest.start;
  act(() => root.render(null));
  act(() => retained());
  expect(createGuideDriver).toHaveBeenCalledTimes(1);
});
