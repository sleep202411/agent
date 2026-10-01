import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { probeReferenceVideo } from "./reference-video-metadata.native";
const h = vi.hoisted(() => ({
  listeners: new Map<string, (event: unknown) => void>(),
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
    addListener: (name: string, fn: (event: unknown) => void) => {
      h.listeners.set(name, fn);
      return { remove: h.remove };
    },
    replaceAsync: h.replace,
    release: h.release,
  });
  h.replace.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());
it("preserves exact seconds and pixel dimensions without playback and always releases", async () => {
  const p = probeReferenceVideo({ uri: "file:///a.mov" }, new AbortController().signal);
  h.listeners.get("sourceLoad")!({
    duration: 2.125,
    availableVideoTracks: [{ size: { width: 640, height: 480 } }],
  });
  expect(await p).toEqual({ durationSeconds: 2.125, width: 640, height: 480 });
  expect(h.replace).toHaveBeenCalledWith({ uri: "file:///a.mov", useCaching: false });
  expect(h.release).toHaveBeenCalledOnce();
  expect(h.remove).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});
it.each([0, NaN, Infinity, -1])("rejects invalid duration %s", async (duration) => {
  const p = probeReferenceVideo({ uri: "file:///a.mp4" }, new AbortController().signal);
  const check = expect(p).rejects.toThrow("duration");
  h.listeners.get("sourceLoad")!({
    duration,
    availableVideoTracks: [{ size: { width: 640, height: 480 } }],
  });
  await check;
  expect(h.release).toHaveBeenCalledOnce();
});
it("rejects missing dimensions, codecs and timed-out decoders", async () => {
  let p = probeReferenceVideo({ uri: "file:///a.mp4" }, new AbortController().signal);
  let check = expect(p).rejects.toThrow("dimensions");
  h.listeners.get("sourceLoad")!({ duration: 2, availableVideoTracks: [] });
  await check;
  p = probeReferenceVideo({ uri: "file:///a.mp4" }, new AbortController().signal);
  check = expect(p).rejects.toThrow("codec");
  h.listeners.get("statusChange")!({ status: "error", error: { message: "codec" } });
  await check;
  p = probeReferenceVideo({ uri: "file:///a.mp4" }, new AbortController().signal);
  check = expect(p).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(30000);
  await check;
  expect(h.release).toHaveBeenCalledTimes(3);
});
it("aborts stalled replacement and rejects remote inputs before player construction", async () => {
  const c = new AbortController();
  const p = probeReferenceVideo({ uri: "file:///a.mp4" }, c.signal);
  const check = expect(p).rejects.toThrow("cancelled");
  c.abort(new Error("cancelled"));
  await check;
  expect(h.release).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
  h.create.mockClear();
  await expect(
    probeReferenceVideo({ uri: "https://cdn.test/a" }, new AbortController().signal)
  ).rejects.toThrow("local");
  expect(h.create).not.toHaveBeenCalled();
});
