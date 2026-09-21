import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { ExperienceStillSegment } from "./experience-still-segment";
const mock = vi.hoisted(() => ({
  image: {} as { onLoad?: () => void; onError?: () => void },
  resolve: vi.fn(),
}));
vi.mock("react-native", () => ({
  StyleSheet: { absoluteFill: {} },
  View: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("expo-image", () => ({
  Image: (props: { onLoad?: () => void; onError?: () => void }) => {
    mock.image = props;
    return null;
  },
}));
vi.mock("../lib/experience-media-cache", () => ({ resolvePlaybackUri: mock.resolve }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
const displayed = vi.fn(),
  completed = vi.fn(),
  error = vi.fn(),
  timeline = vi.fn();
async function render(uri = "one") {
  await act(async () =>
    root.render(
      createElement(ExperienceStillSegment, {
        uri,
        fit: "contain",
        durationMs: 1000,
        timelineOffsetMs: 0,
        playbackIdentity: uri,
        presenting: true,
        onDisplayed: displayed,
        onHoldComplete: completed,
        onLoadError: error,
        onTimelineTimeMs: timeline,
      })
    )
  );
}
async function advance(ms: number) {
  await act(async () => vi.advanceTimersByTime(ms));
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
  vi.clearAllMocks();
  mock.resolve.mockImplementation(async (uri: string) => uri);
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
});
it("does not count URL resolution as a displayed image", async () => {
  await render();
  await advance(5000);
  expect(displayed).not.toHaveBeenCalled();
  expect(completed).not.toHaveBeenCalled();
  await act(async () => mock.image.onLoad?.());
  await advance(1000);
  expect(displayed).toHaveBeenCalledOnce();
  expect(completed).toHaveBeenCalledOnce();
});
it("does not complete after image loading fails", async () => {
  await render();
  await act(async () => mock.image.onError?.());
  await advance(5000);
  expect(error).toHaveBeenCalledOnce();
  expect(completed).not.toHaveBeenCalled();
});
it("ignores stale image events after replacement", async () => {
  await render();
  const old = mock.image;
  await render("two");
  await act(async () => {
    old.onLoad?.();
    old.onError?.();
  });
  await advance(1000);
  expect(displayed).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
  await act(async () => mock.image.onLoad?.());
  await advance(1000);
  expect(completed).toHaveBeenCalledOnce();
});
