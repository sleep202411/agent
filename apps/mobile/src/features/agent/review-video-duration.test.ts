import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { reviewVideoDuration } from "./review-video-duration.native";
const h = vi.hoisted(() => ({
  listeners: new Map<string, (event: any) => void>(),
  remove: vi.fn(),
  release: vi.fn(),
  replace: vi.fn(),
  create: vi.fn(),
}));
vi.mock("expo-video", () => ({ createVideoPlayer: h.create }));
beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  h.listeners.clear();
  h.create.mockReturnValue({
    addListener: (name: string, fn: (event: any) => void) => {
      h.listeners.set(name, fn);
      return { remove: h.remove };
    },
    replaceAsync: h.replace,
    release: h.release,
  });
  h.replace.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());
it("reads metadata without playing and releases resources", async () => {
  const result = reviewVideoDuration("file:///clip.mp4", new AbortController().signal);
  h.listeners.get("sourceLoad")!({ duration: 60.2 });
  expect(await result).toBe(61);
  expect(h.replace).toHaveBeenCalledWith({ uri: "file:///clip.mp4", useCaching: false });
  expect(h.release).toHaveBeenCalledOnce();
  expect(h.remove).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});
it.each([0, NaN, Infinity, -1, 10800.1])(
  "rejects invalid/over-limit duration %s",
  async (duration) => {
    const result = reviewVideoDuration("blob:clip", new AbortController().signal);
    const assertion = expect(result).rejects.toThrow();
    h.listeners.get("sourceLoad")!({ duration });
    await assertion;
    expect(h.release).toHaveBeenCalledOnce();
  }
);
it("aborts stalled replacement and ignores its late rejection", async () => {
  let reject!: (error: Error) => void;
  h.replace.mockReturnValue(
    new Promise((_, r) => {
      reject = r;
    })
  );
  const controller = new AbortController();
  const result = reviewVideoDuration("file:///clip.mov", controller.signal);
  const assertion = expect(result).rejects.toThrow("cancelled");
  controller.abort(new Error("cancelled"));
  await assertion;
  reject(new Error("late decoder failure"));
  await Promise.resolve();
  expect(h.release).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it("times out a stalled decoder and surfaces codec errors", async () => {
  const result = reviewVideoDuration("file:///clip.mov", new AbortController().signal);
  const assertion = expect(result).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(30_000);
  await assertion;
  const second = reviewVideoDuration("file:///clip.mov", new AbortController().signal);
  const denied = expect(second).rejects.toThrow("Unsupported codec");
  h.listeners.get("statusChange")!({ status: "error", error: { message: "Unsupported codec" } });
  await denied;
  expect(h.release).toHaveBeenCalledTimes(2);
});
it("rejects remote and pre-aborted inputs before constructing a player", async () => {
  await expect(
    reviewVideoDuration("https://media.test/video", new AbortController().signal)
  ).rejects.toThrow("local");
  const controller = new AbortController();
  controller.abort();
  await expect(reviewVideoDuration("file:///clip.mp4", controller.signal)).rejects.toThrow();
  expect(h.create).not.toHaveBeenCalled();
});
