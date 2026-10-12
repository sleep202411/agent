import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { attachWorldVideoPlayback } from "./video-playback";
let video: HTMLVideoElement, button: HTMLButtonElement;
let paused: boolean, ready: number;
let playback: ReturnType<typeof attachWorldVideoPlayback>;
let play: ReturnType<typeof vi.fn<() => Promise<void>>>;
let error: ReturnType<typeof vi.fn<(error: unknown) => void>>;
let blocked: ReturnType<typeof vi.fn<(blocked: boolean) => void>>;
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
beforeEach(() => {
  document.body.innerHTML = "<video></video><button hidden>Resume</button>";
  video = document.querySelector("video")!;
  button = document.querySelector("button")!;
  paused = true;
  ready = 2;
  Object.defineProperty(video, "paused", { get: () => paused });
  Object.defineProperty(video, "readyState", { get: () => ready });
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  play = vi.fn().mockImplementation(async () => {
    paused = false;
    video.dispatchEvent(new Event("play"));
  });
  vi.spyOn(video, "play").mockImplementation(play);
  vi.spyOn(video, "pause").mockImplementation(() => {
    paused = true;
    video.dispatchEvent(new Event("pause"));
  });
  blocked = vi.fn();
  error = vi.fn();
  playback = attachWorldVideoPlayback(video, button, blocked, error);
});
afterEach(() => {
  playback.dispose();
  vi.restoreAllMocks();
});
it("recovers refusal synchronously in a document click, without restarting a stream", async () => {
  play.mockRejectedValueOnce(new DOMException("Tap required", "NotAllowedError"));
  playback.setStreaming(true);
  playback.setActive(true);
  await flush();
  expect(button.hidden).toBe(false);
  expect(blocked).toHaveBeenLastCalledWith(true);
  video.dispatchEvent(new Event("canplay"));
  await flush();
  expect(play).toHaveBeenCalledTimes(1);
  button.click();
  expect(play).toHaveBeenCalledTimes(2);
  await flush();
  expect(button.hidden).toBe(true);
  expect(blocked).toHaveBeenLastCalledWith(false);
  expect(error).not.toHaveBeenCalled();
});
it("holds unsolicited playback while inactive, then waits for ready data", async () => {
  ready = 0;
  playback.setStreaming(true);
  playback.setActive(true);
  expect(play).not.toHaveBeenCalled();
  ready = 2;
  video.dispatchEvent(new Event("loadeddata"));
  await flush();
  expect(paused).toBe(false);
  playback.setActive(false);
  expect(paused).toBe(true);
  paused = false;
  video.dispatchEvent(new Event("play"));
  expect(paused).toBe(true);
  playback.setActive(true);
  await flush();
  expect(paused).toBe(false);
});
it("shows useful recovery for an interrupted active stream but hides it during a host pause", async () => {
  playback.setStreaming(true);
  playback.setActive(true);
  await flush();
  video.pause();
  expect(button.hidden).toBe(false);
  playback.setActive(false);
  expect(button.hidden).toBe(true);
  playback.setActive(true);
  expect(button.hidden).toBe(false);
  button.click();
  await flush();
  expect(paused).toBe(false);
});
it("holds late playback after dispose and preserves non-policy errors", async () => {
  let resolve!: () => void;
  play.mockImplementationOnce(
    () =>
      new Promise<void>((r) => {
        resolve = r;
      })
  );
  playback.setStreaming(true);
  playback.setActive(true);
  playback.dispose();
  paused = false;
  resolve();
  await flush();
  expect(paused).toBe(true);
  expect(button.hidden).toBe(true);
  button.click();
  expect(play).toHaveBeenCalledTimes(1);
});
it("reports a real decoding failure unchanged", async () => {
  const failure = new Error("Codec failed");
  play.mockRejectedValueOnce(failure);
  playback.setStreaming(true);
  playback.setActive(true);
  await flush();
  expect(error).toHaveBeenCalledExactlyOnceWith(failure);
});
it("does not turn an interrupted old play attempt into a new stream failure", async () => {
  let reject!: (error: unknown) => void;
  play.mockImplementationOnce(
    () =>
      new Promise<void>((_, r) => {
        reject = r;
      })
  );
  playback.setStreaming(true);
  playback.setActive(true);
  playback.setActive(false);
  playback.setActive(true);
  reject(new DOMException("Interrupted by pause", "AbortError"));
  await flush();
  expect(error).not.toHaveBeenCalled();
  expect(button.hidden).toBe(false);
  button.click();
  await flush();
  expect(paused).toBe(false);
});
