import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { probeReferenceAudio } from "./reference-audio-metadata.native";
const h = vi.hoisted(() => ({
  create: vi.fn(),
  replace: vi.fn(),
  remove: vi.fn(),
  unsubscribe: vi.fn(),
  listener: undefined as undefined | ((status: unknown) => void),
}));
vi.mock("expo-audio", () => ({ createAudioPlayer: h.create }));
beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  h.create.mockReturnValue({
    currentStatus: { isLoaded: false },
    replace: h.replace,
    remove: h.remove,
    addListener: (_: string, listener: (status: unknown) => void) => {
      h.listener = listener;
      return { remove: h.unsubscribe };
    },
  });
});
afterEach(() => vi.useRealTimers());
it("measures exact seconds without playing and releases the decoder", async () => {
  const p = probeReferenceAudio({ uri: "file:///clip.wav" }, new AbortController().signal);
  h.listener!({ isLoaded: true, duration: 2.125 });
  expect(await p).toEqual({ durationSeconds: 2.125 });
  expect(h.replace).toHaveBeenCalledWith({ uri: "file:///clip.wav" });
  expect(h.remove).toHaveBeenCalledOnce();
  expect(h.unsubscribe).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it.each([0, -1, NaN, Infinity])("rejects unknown/invalid duration %s", async (duration) => {
  const p = probeReferenceAudio({ uri: "file:///clip.mp3" }, new AbortController().signal);
  const check = expect(p).rejects.toThrow("duration");
  h.listener!({ isLoaded: true, duration });
  await check;
  expect(h.remove).toHaveBeenCalledOnce();
});
it("rejects decoder failures and live streams", async () => {
  for (const status of [{ error: "codec" }, { isLoaded: true, duration: 5, isLive: true }]) {
    const p = probeReferenceAudio({ uri: "file:///clip.mp3" }, new AbortController().signal);
    const check = expect(p).rejects.toThrow();
    h.listener!(status);
    await check;
  }
  expect(h.remove).toHaveBeenCalledTimes(2);
});
it("releases on timeout/abort and refuses remote input before decoding", async () => {
  let p = probeReferenceAudio({ uri: "file:///clip.mp3" }, new AbortController().signal);
  let check = expect(p).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(30000);
  await check;
  const c = new AbortController();
  p = probeReferenceAudio({ uri: "file:///clip.mp3" }, c.signal);
  check = expect(p).rejects.toThrow("cancelled");
  c.abort(new Error("cancelled"));
  await check;
  expect(h.remove).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
  h.create.mockClear();
  await expect(probeReferenceAudio({ uri: "https://cdn.test/a" }, c.signal)).rejects.toThrow();
  expect(h.create).not.toHaveBeenCalled();
});
