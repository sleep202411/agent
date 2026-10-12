/* eslint-disable import/no-named-as-default-member -- hls.js types expose these statics on its default class. */
import HlsPlayer from "hls.js";
import type { VideoSource } from "expo-video";

type Events = {
  playingChange: { isPlaying: boolean; oldIsPlaying?: boolean };
  playToEnd: Record<string, never>;
  timeUpdate: { currentTime: number };
  statusChange: { status: "readyToPlay" | "error"; error?: { message: string; name?: string } };
};

/** The small imperative interface used by the cinematic renderer, backed by HTML video. */
export class BrowserVideoController {
  timeUpdateEventInterval = 0.25;
  staysActiveInBackground = false;
  private media: HTMLVideoElement | null = null;
  private hls?: HlsPlayer;
  private cleanup: () => void = () => {};
  private rejectLoad?: (error: Error) => void;
  private loopValue = false;
  private rateValue = 1;
  private listeners = new Map<keyof Events, Set<(event: never) => void>>();
  private sequence = 0;
  private playIntent = 0;

  get playbackRate() {
    return this.rateValue;
  }
  set playbackRate(value: number) {
    if (!Number.isFinite(value) || value <= 0)
      throw new RangeError("Playback rate must be finite and positive.");
    const previous = this.rateValue;
    this.rateValue = value;
    try {
      if (this.media) this.media.playbackRate = value;
    } catch (error) {
      this.rateValue = previous;
      throw error;
    }
  }
  get loop() {
    return this.loopValue;
  }
  set loop(value: boolean) {
    this.loopValue = value;
    if (this.media) this.media.loop = value;
  }
  get currentTime() {
    return this.media?.currentTime ?? 0;
  }
  set currentTime(value: number) {
    if (this.media) this.media.currentTime = value;
  }
  get duration() {
    return this.media?.duration ?? 0;
  }
  get status() {
    return this.media?.error
      ? "error"
      : this.media && this.media.readyState >= 1
        ? "readyToPlay"
        : "loading";
  }
  get playing() {
    return this.media ? !this.media.paused : false;
  }
  pause() {
    this.playIntent++;
    this.media?.pause();
  }
  play() {
    const media = this.media;
    const sequence = this.sequence;
    const intent = ++this.playIntent;
    if (media)
      void media.play().catch((error: unknown) => {
        if (this.media === media && this.sequence === sequence && this.playIntent === intent)
          this.emit("statusChange", {
            status: "error",
            error: {
              message:
                error &&
                typeof error === "object" &&
                "message" in error &&
                typeof error.message === "string"
                  ? error.message
                  : "Video playback failed",
              ...(error &&
              typeof error === "object" &&
              "name" in error &&
              error.name === "NotAllowedError"
                ? { name: error.name }
                : {}),
            },
          });
      });
  }
  addListener<K extends keyof Events>(name: K, listener: (event: Events[K]) => void) {
    const listeners = this.listeners.get(name) ?? new Set();
    listeners.add(listener as (event: never) => void);
    this.listeners.set(name, listeners);
    return {
      remove: () => {
        listeners.delete(listener as (event: never) => void);
      },
    };
  }
  private emit<K extends keyof Events>(name: K, event: Events[K]) {
    this.listeners.get(name)?.forEach((listener) => listener(event as never));
  }
  attach(media: HTMLVideoElement | null) {
    if (media === this.media) return;
    this.stopSource();
    this.media = media;
    if (media) {
      media.loop = this.loopValue;
      media.playbackRate = this.rateValue;
    }
  }
  private stopSource() {
    this.sequence++;
    this.rejectLoad?.(new Error("Video source replaced"));
    this.rejectLoad = undefined;
    this.cleanup();
    this.cleanup = () => {};
    this.hls?.destroy();
    this.hls = undefined;
    if (this.media) {
      this.media.pause();
      this.media.removeAttribute("src");
      this.media.load();
    }
  }
  async replaceAsync(source: VideoSource): Promise<void> {
    this.stopSource();
    const media = this.media;
    if (!media) throw new Error("Video surface is not mounted");
    const uri =
      typeof source === "string" ? source : typeof source === "object" ? source?.uri : null;
    if (!uri) return;
    const hlsSource =
      (typeof source === "object" && source?.contentType === "hls") ||
      /\.m3u8(?:[?#]|$)/i.test(uri);
    const sequence = this.sequence;
    await new Promise<void>((resolve, reject) => {
      let loaded = false;
      let failed = false;
      const fail = (message: string) => {
        if (sequence !== this.sequence || failed) return;
        failed = true;
        this.cleanup();
        this.hls?.destroy();
        this.hls = undefined;
        media.pause();
        if (!loaded) {
          this.rejectLoad = undefined;
          reject(new Error(message));
        } else this.emit("statusChange", { status: "error", error: { message } });
      };
      const rate = () => {
        if (media.playbackRate !== this.rateValue) media.playbackRate = this.rateValue;
      };
      const ready = () => {
        rate();
        loaded = true;
        this.rejectLoad = undefined;
        clearTimeout(timeout);
        resolve();
      };
      let wasPlaying = false;
      const playing = () => {
        const isPlaying = !media.paused;
        this.emit("playingChange", { isPlaying, oldIsPlaying: wasPlaying });
        wasPlaying = isPlaying;
      };
      const ended = () => this.emit("playToEnd", {});
      const time = () => this.emit("timeUpdate", { currentTime: media.currentTime });
      const error = () => fail(media.error?.message || "Video playback failed");
      const timeout = setTimeout(() => fail("Video loading timed out"), 30_000);
      this.rejectLoad = reject;
      media.addEventListener("loadedmetadata", ready);
      media.addEventListener("ratechange", rate);
      media.addEventListener("play", playing);
      media.addEventListener("pause", playing);
      media.addEventListener("ended", ended);
      media.addEventListener("timeupdate", time);
      media.addEventListener("error", error);
      this.cleanup = () => {
        clearTimeout(timeout);
        media.removeEventListener("loadedmetadata", ready);
        media.removeEventListener("ratechange", rate);
        media.removeEventListener("play", playing);
        media.removeEventListener("pause", playing);
        media.removeEventListener("ended", ended);
        media.removeEventListener("timeupdate", time);
        media.removeEventListener("error", error);
      };
      const nativeHls = !!media.canPlayType("application/vnd.apple.mpegurl");
      const preferNative = /Apple/.test(navigator.vendor) && nativeHls;
      if (hlsSource && !preferNative && HlsPlayer.isSupported()) {
        const hls = new HlsPlayer({ abrEwmaDefaultEstimate: 1_500_000, maxBufferLength: 20 });
        this.hls = hls;
        hls.on(HlsPlayer.Events.ERROR, (_event, data) => {
          if (data.fatal) fail(data.error?.message || data.details);
        });
        hls.attachMedia(media);
        hls.loadSource(uri);
      } else {
        if (hlsSource && !nativeHls) {
          fail("HLS playback is unavailable in this browser");
          return;
        }
        media.src = uri;
        media.load();
      }
    });
  }
}
