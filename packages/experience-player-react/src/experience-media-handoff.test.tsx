// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  ExperienceMediaPlayer,
  type ExperienceMediaPlaybackHandle,
} from "./experience-media-player";
import type { ExperiencePlayerVideoCopy } from "./experience-player-copy";

/**
 * The cut, asserted as a lifecycle rather than as pixels: jsdom cannot decode a
 * frame, so what is verifiable is *which element is mounted, what is copied off
 * it, and what covers the stage while the new source loads*. That is the whole
 * contract — one element for the life of the surface, and a still frame over it
 * from the source swap until the new source reports it is playing.
 *
 * `@vidstack/react` is stubbed because driving the real player needs a media
 * pipeline jsdom does not have. The stub buys three things the assertions need:
 * the element's source is visible in the DOM, its `playing` callback can be fired
 * on demand instead of waited for, and its provider exposes a `<video>` whose
 * readiness the test controls — which is what decides whether a frame can be
 * copied at all.
 */
vi.mock("@vidstack/react", async () => {
  const { createElement, useImperativeHandle, useRef } = await import("react");
  const { VideoProviderLoader } =
    await vi.importActual<typeof import("@vidstack/react")>("@vidstack/react");

  function StubMediaPlayer({
    ref,
    src,
    children,
    onPlaying,
    onCanPlay,
  }: {
    ref?: React.Ref<unknown>;
    src: string | { src: string };
    children?: React.ReactNode;
    onPlaying?: () => void;
    onCanPlay?: () => void;
  }) {
    const videoRef = useRef<HTMLVideoElement>(null);
    useImperativeHandle(
      ref,
      () => ({
        provider: { type: "video", media: videoRef.current, video: videoRef.current },
        muted: false,
        duration: 0,
        play: () => Promise.resolve(),
        pause: () => Promise.resolve(),
      }),
      []
    );
    const uri = typeof src === "string" ? src : src.src;
    return createElement(
      "div",
      { "data-clip": uri },
      // A real `<video>`, because the assertions turn on its identity (a
      // remounted player is a different element, and a different element is a
      // different audible-playback verdict) and on its readiness.
      createElement("video", { ref: videoRef, "data-media-element": "" }),
      createElement("button", {
        type: "button",
        "data-signal": `playing:${uri}`,
        onClick: onPlaying,
      }),
      createElement("button", { "data-ready": uri, onClick: onCanPlay }),
      children
    );
  }

  return {
    VideoProviderLoader,
    MediaPlayer: StubMediaPlayer,
    MediaProvider: ({ children }: { children?: React.ReactNode }) =>
      createElement("div", null, children),
    Poster: () => null,
    MediaAnnouncer: () => createElement("div", { "data-announcer": "" }),
  };
});

const copy: ExperiencePlayerVideoCopy = {
  play: "Play",
  pause: "Pause",
  mute: "Mute",
  unmute: "Unmute",
  volume: "Volume",
  enterFullscreen: "Enter fullscreen",
  exitFullscreen: "Exit fullscreen",
  seekForward: "Seek forward",
  seekBackward: "Seek backward",
};

describe("ExperienceMediaPlayer cut cover", () => {
  let container: HTMLDivElement;
  let root: Root;
  let drawImage: Mock<(image: CanvasImageSource, x: number, y: number) => void>;
  let onPlaybackHandle: Mock<(handle: ExperienceMediaPlaybackHandle | null) => void>;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    onPlaybackHandle = vi.fn<(handle: ExperienceMediaPlaybackHandle | null) => void>();
    drawImage = vi.fn<(image: CanvasImageSource, x: number, y: number) => void>();
    // jsdom has no 2D context to hand out, so the cover canvas gets one that
    // records what was drawn into it.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  /**
   * Renders the surface for one clip. The uri and the identity are given
   * separately because their pairing is the subject: a cut moves both, a device
   * rotation re-resolves the uri under one identity, and a tail wait loop moves
   * the identity and the start time while keeping the uri.
   *
   * `frameReady` is the element's side of the story — whether the source it now
   * holds has a decoded frame that could be copied when the next clip arrives.
   */
  const renderClip = async (
    clip: { uri: string; identity: string; clipStartTime?: number },
    options: { frameReady?: boolean } = {}
  ) => {
    await act(async () => {
      root.render(
        <ExperienceMediaPlayer
          source={{ src: clip.uri, type: "video/mp4" }}
          title="Clip"
          autoPlay={false}
          muted={false}
          loop={false}
          clipStartTime={clip.clipStartTime}
          onEnd={() => {}}
          onTimeUpdate={() => {}}
          onPlaybackError={() => {}}
          onPlaybackHandle={onPlaybackHandle}
          playbackIdentity={clip.identity}
          copy={copy}
        />
      );
    });
    setFrameReady(options.frameReady ?? true);
  };

  /** The next clip of a sequence: new source, new identity. */
  const showClip = (clipId: string, options: { frameReady?: boolean } = {}) =>
    renderClip({ uri: `/${clipId}.mp4`, identity: `renderer:0:sequence:${clipId}` }, options);

  /** Handles the host was given, in order, with the deregistrations dropped. */
  const registeredHandles = (): ExperienceMediaPlaybackHandle[] =>
    onPlaybackHandle.mock.calls.flatMap(([handle]) => (handle ? [handle] : []));

  /** The one `<video>` the surface owns. */
  const video = (): HTMLVideoElement => {
    const element = container.querySelector<HTMLVideoElement>("[data-media-element]");
    if (!element) throw new Error("No media element is mounted.");
    return element;
  };

  /** jsdom decodes nothing, so readiness is declared. `HAVE_ENOUGH_DATA` with
   *  intrinsic dimensions is an element with a frame to copy; zeroes are the
   *  element a freshly swapped source leaves behind. */
  const setFrameReady = (ready: boolean) => {
    const element = video();
    Object.defineProperty(element, "readyState", { value: ready ? 4 : 0, configurable: true });
    Object.defineProperty(element, "videoWidth", { value: ready ? 1920 : 0, configurable: true });
    Object.defineProperty(element, "videoHeight", { value: ready ? 1080 : 0, configurable: true });
  };

  const stillFrame = (): HTMLCanvasElement => {
    const canvas = container.querySelector<HTMLCanvasElement>("[data-experience-still-frame]");
    if (!canvas) throw new Error("The surface has no still frame to cover a cut with.");
    return canvas;
  };

  const mountedClip = () => container.querySelector("[data-clip]")?.getAttribute("data-clip");

  const signalPlaying = async (uri: string) => {
    const button = container.querySelector<HTMLButtonElement>(`[data-signal="playing:${uri}"]`);
    if (!button) throw new Error(`No clip is able to signal playing:${uri}.`);
    await act(async () => {
      button.click();
    });
  };

  it("covers a cut with the outgoing frame, on the one element it keeps", async () => {
    await showClip("a");
    const element = video();

    await showClip("b");

    // The cut. The element is the same one — WebKit blessed THAT element for
    // audible playback inside the start click, and a replacement would be
    // refused sound — so the frame it was showing is copied off it and stacked
    // over it while the new source loads.
    expect(video()).toBe(element);
    expect(container.querySelectorAll("[data-media-element]")).toHaveLength(1);
    expect(mountedClip()).toBe("/b.mp4");
    expect(drawImage).toHaveBeenCalledWith(element, 0, 0);
    expect(stillFrame().hidden).toBe(false);

    await signalPlaying("/b.mp4");

    // Uncovered only once the new source is presenting frames of its own.
    expect(stillFrame().hidden).toBe(true);
  });

  it("holds the frame it has when a second cut finds nothing to copy", async () => {
    await showClip("a");
    await showClip("b", { frameReady: false });
    expect(drawImage).toHaveBeenCalledTimes(1);

    await showClip("c");

    // Two cuts before anything painted. `/b.mp4` never decoded a frame, so there
    // was nothing to copy at the second cut and `/a.mp4` goes on covering —
    // nothing is on a timer that could drop it, and a stale frame beats a hole.
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(stillFrame().hidden).toBe(false);

    await signalPlaying("/c.mp4");

    expect(stillFrame().hidden).toBe(true);
  });

  it("leaves the cut uncovered when the frame cannot be copied", async () => {
    drawImage.mockImplementation(() => {
      throw new DOMException("Tainted canvases may not be drawn to.", "SecurityError");
    });
    await showClip("a");

    await showClip("b");

    // Degrades to the backdrop flash this replaced, never to a blank cover: the
    // resize that precedes a refused draw has already emptied the bitmap.
    expect(stillFrame().hidden).toBe(true);
    expect(mountedClip()).toBe("/b.mp4");
  });

  it("does not cover a seek that keeps the source", async () => {
    await showClip("a");
    // Nothing is covered until something is cut away from.
    expect(stillFrame().hidden).toBe(true);

    await renderClip({ uri: "/a.mp4", identity: "renderer:0:loop:a:11", clipStartTime: 11 });

    // The tail wait loop: same source, new start time. The element seeks and goes
    // on showing its frame, so there is nothing to cover — and covering it would
    // freeze the stage, because a seek inside a buffered source need not report
    // `playing` again.
    expect(drawImage).not.toHaveBeenCalled();
    expect(stillFrame().hidden).toBe(true);
  });

  it("spends the user gesture on the element before the source can play", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    await showClip("a", { frameReady: false });
    registeredHandles().at(-1)!.activate();
    expect(play).toHaveBeenCalledOnce();
    expect(pause).not.toHaveBeenCalled();
  });

  it("does not start a waiting play after the host pauses it", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    await showClip("a");
    const handle = registeredHandles().at(-1)!;
    const pending = handle.play();
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    handle.pause();
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-ready="/a.mp4"]')!.click();
    });
    await rejected;
    expect(play).not.toHaveBeenCalled();
    await handle.play();
    expect(play).toHaveBeenCalledOnce();
  });

  it("does not mute or retry an abandoned autoplay refusal", async () => {
    let reject!: (error: unknown) => void;
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(
      () =>
        new Promise<void>((_, fail) => {
          reject = fail;
        })
    );
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    await showClip("a");
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-ready="/a.mp4"]')!.click();
    });
    const handle = registeredHandles().at(-1)!;
    const pending = handle.play();
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve();
    handle.pause();
    reject(new DOMException("Blocked", "NotAllowedError"));
    await rejected;
    expect(play).toHaveBeenCalledOnce();
    expect(container.querySelector("video")!.muted).toBe(false);
  });

  it("ignores retained controls after the source is replaced", async () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    await showClip("a");
    const old = registeredHandles().at(-1)!;
    await showClip("b");
    const video = container.querySelector("video")!;
    video.currentTime = 3;
    video.muted = false;
    pause.mockClear();
    old.pause();
    old.seek(20);
    old.setMuted(true);
    expect(pause).not.toHaveBeenCalled();
    expect(video.currentTime).toBe(3);
    expect(video.muted).toBe(false);
  });

  it("offers the host a handle for every source it covers", async () => {
    await showClip("a");
    const [first] = registeredHandles();

    // A rotation: the same clip re-resolved to its other orientation. The source
    // changes, so the element is blanked and covered like any cut — and the host
    // is handed a new handle to play it with. Without that the newly loaded
    // source would sit there unplayed, and the still frame would have no
    // `playing` coming to take it down.
    await renderClip({ uri: "/a-portrait.mp4", identity: "renderer:0:sequence:a" });

    const handles = registeredHandles();
    expect(handles).toHaveLength(2);
    expect(handles[1]).not.toBe(first);
    expect(stillFrame().hidden).toBe(false);

    await signalPlaying("/a-portrait.mp4");

    expect(stillFrame().hidden).toBe(true);
  });
});
