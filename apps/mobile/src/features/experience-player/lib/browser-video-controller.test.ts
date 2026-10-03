import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BrowserVideoController } from "./browser-video-controller";
const h = vi.hoisted(() => ({
  instances: [] as {
    callbacks: Record<string, (...args: any[]) => void>;
    destroy: ReturnType<typeof vi.fn>;
    loadSource: ReturnType<typeof vi.fn>;
    attachMedia: ReturnType<typeof vi.fn>;
  }[],
}));
vi.mock("hls.js", () => ({
  default: class {
    static Events = { ERROR: "error" };
    static isSupported = () => true;
    callbacks: Record<string, (...args: any[]) => void> = {};
    destroy = vi.fn();
    loadSource = vi.fn();
    attachMedia = vi.fn();
    constructor() {
      h.instances.push(this);
    }
    on(event: string, callback: (...args: any[]) => void) {
      this.callbacks[event] = callback;
    }
  },
}));
let player: BrowserVideoController;
let video: HTMLVideoElement;
beforeEach(() => {
  h.instances.length = 0;
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  player = new BrowserVideoController();
  video = document.createElement("video");
  player.attach(video);
});
afterEach(() => {
  player.attach(null);
  vi.restoreAllMocks();
});
it("loads HLS through MSE and forwards time/end events to the existing renderer", async () => {
  const time = vi.fn(),
    end = vi.fn();
  player.addListener("timeUpdate", time);
  player.addListener("playToEnd", end);
  const loading = player.replaceAsync({ uri: "https://test/master.m3u8", contentType: "hls" });
  expect(h.instances[0].loadSource).toHaveBeenCalledWith("https://test/master.m3u8");
  video.dispatchEvent(new Event("loadedmetadata"));
  await loading;
  player.currentTime = 2;
  video.dispatchEvent(new Event("timeupdate"));
  video.dispatchEvent(new Event("ended"));
  expect(time).toHaveBeenCalledWith({ currentTime: 2 });
  expect(end).toHaveBeenCalledOnce();
});
it("rejects obsolete loads and destroys their HLS instance on replacement", async () => {
  const old = player.replaceAsync({ uri: "https://test/old.m3u8", contentType: "hls" });
  const rejected = expect(old).rejects.toThrow("replaced");
  const next = player.replaceAsync("https://test/next.mp4");
  await rejected;
  expect(h.instances[0].destroy).toHaveBeenCalledOnce();
  video.dispatchEvent(new Event("loadedmetadata"));
  await next;
  expect(video.src).toBe("https://test/next.mp4");
});
it("rejects a fatal initial HLS failure without starting playback", async () => {
  const loading = player.replaceAsync({ uri: "https://test/master.m3u8", contentType: "hls" });
  const rejected = expect(loading).rejects.toThrow("Manifest refused");
  h.instances[0].callbacks.error("error", { fatal: true, error: new Error("Manifest refused") });
  await rejected;
  expect(video.play).not.toHaveBeenCalled();
  expect(h.instances[0].destroy).toHaveBeenCalledOnce();
});
it("reports fatal streaming errors after metadata and stops the stream", async () => {
  const error = vi.fn();
  player.addListener("statusChange", error);
  const loading = player.replaceAsync({ uri: "https://test/master.m3u8", contentType: "hls" });
  video.dispatchEvent(new Event("loadedmetadata"));
  await loading;
  h.instances[0].callbacks.error("error", { fatal: true, details: "segmentLoadError" });
  expect(error).toHaveBeenCalledWith({ status: "error", error: { message: "segmentLoadError" } });
  expect(h.instances[0].destroy).toHaveBeenCalledOnce();
});
it("uses native browser HLS when available and releases the video on detach", async () => {
  vi.spyOn(video, "canPlayType").mockReturnValue("probably");
  vi.spyOn(navigator, "vendor", "get").mockReturnValue("Apple Computer, Inc.");
  const loading = player.replaceAsync({ uri: "https://test/master.m3u8", contentType: "hls" });
  video.dispatchEvent(new Event("loadedmetadata"));
  await loading;
  expect(h.instances).toHaveLength(0);
  player.attach(null);
  expect(video.hasAttribute("src")).toBe(false);
  expect(video.pause).toHaveBeenCalled();
});

it("does not report an interrupted play request as a stream failure after pause", async () => {
  let rejectPlay!: (error: Error) => void;
  vi.mocked(video.play).mockImplementation(
    () =>
      new Promise<void>((_resolve, reject) => {
        rejectPlay = reject;
      })
  );
  const error = vi.fn();
  player.addListener("statusChange", error);
  player.play();
  player.pause();
  rejectPlay(new DOMException("The play request was interrupted by a call to pause", "AbortError"));
  await Promise.resolve();
  expect(error).not.toHaveBeenCalled();
});

it("ignores an older play rejection but still reports a current failure", async () => {
  const rejects: ((error: Error) => void)[] = [];
  vi.mocked(video.play).mockImplementation(
    () =>
      new Promise<void>((_resolve, reject) => {
        rejects.push(reject);
      })
  );
  const error = vi.fn();
  player.addListener("statusChange", error);
  player.play();
  player.play();
  rejects[0](new Error("Old play interrupted"));
  await Promise.resolve();
  expect(error).not.toHaveBeenCalled();
  rejects[1](new Error("Playback blocked"));
  await Promise.resolve();
  expect(error).toHaveBeenCalledWith({ status: "error", error: { message: "Playback blocked" } });
});

it("preserves autoplay refusal identity for recoverable pause without replacing the source", async () => {
  const error = vi.fn();
  player.addListener("statusChange", error);
  vi.mocked(video.play).mockRejectedValueOnce(new DOMException("Tap to play", "NotAllowedError"));
  player.currentTime = 12;
  player.play();
  await Promise.resolve();
  expect(error).toHaveBeenCalledWith({
    status: "error",
    error: { message: "Tap to play", name: "NotAllowedError" },
  });
  expect(player.currentTime).toBe(12);
  player.play();
  await Promise.resolve();
  expect(error).toHaveBeenCalledTimes(1);
});
