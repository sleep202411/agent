// @vitest-environment jsdom

import { ErrorDetails, ErrorTypes, type ErrorData } from "hls.js";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  ExperienceMediaPlayer,
  type ExperienceMediaPlaybackHandle,
} from "./experience-media-player";
import {
  ExperiencePlaybackDelivery,
  ExperiencePlaybackDeliveryContext,
} from "./experience-playback-delivery";
import type { ExperiencePlayerVideoCopy } from "./experience-player-copy";

/**
 * The cut, asserted as a lifecycle rather than as pixels: jsdom cannot decode a
 * frame, so what is verifiable is *which element is mounted, what is copied off
 * it, and what covers the stage while the new source loads*. That is the whole
 * contract — one element for the life of the surface, and a still frame over it
 * from the source swap until the new source reports it is playing.
 *
 * `@vidstack/react`'s components are stubbed because driving the real player
 * needs a media pipeline jsdom does not have; everything else stays real. The
 * stub buys what the assertions need: the element's source and playback props
 * are visible in the DOM, its `playing`, `can-play` and `error` callbacks can be
 * fired on demand instead of waited for, and its provider exposes a `<video>`
 * whose readiness the test controls — which is what decides whether a frame can
 * be copied at all. An HLS source is played through a stand-in hls.js instance.
 * As in Vidstack, the provider attaches once the element is mounted, and the
 * player's `state` reports the position the test gives it.
 */
vi.mock("@vidstack/react", async () => {
  const { createElement, useEffect, useImperativeHandle, useRef } = await import("react");
  const actual = await vi.importActual<typeof import("@vidstack/react")>("@vidstack/react");

  function StubMediaPlayer({
    ref,
    src,
    loop,
    preload,
    keyDisabled,
    children,
    onPlaying,
    onCanPlay,
    onEnd,
    onTimeUpdate,
    onError,
    onHlsError,
    onPlay,
    onPause,
    onPlayFail,
    onProviderChange,
    onProviderLoaderChange,
  }: ElementCallbacks & {
    ref?: React.Ref<unknown>;
    src: string | { src: string; type?: string };
    loop?: boolean;
    preload?: string;
    keyDisabled?: boolean;
    children?: React.ReactNode;
    onPlaying?: () => void;
    onCanPlay?: () => void;
    onProviderLoaderChange?: () => void;
  }) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const hlsSourceRef = useRef(false);
    hlsSourceRef.current = typeof src !== "string" && src.type === "application/vnd.apple.mpegurl";
    // As in Vidstack: whatever the element fires reaches the callbacks of the
    // player's latest render.
    elementCallbacks.current = {
      onEnd,
      onTimeUpdate,
      onError,
      onHlsError,
      onPlay,
      onPause,
      onPlayFail,
      onProviderChange,
    };
    useImperativeHandle(
      ref,
      () => ({
        get provider() {
          const media = videoRef.current;
          return hlsSourceRef.current
            ? { type: "hls", instance: stubHls.current, media, video: media }
            : { type: "video", media, video: media };
        },
        get state() {
          return playerState.current;
        },
        muted: false,
        duration: 0,
        play: () => Promise.resolve(),
        pause: () => Promise.resolve(),
      }),
      []
    );
    useEffect(() => {
      if (!providerAttachment.deferred) {
        const media = videoRef.current;
        elementCallbacks.current.onProviderChange?.({ type: "video", media, video: media });
      }
    }, []);
    const uri = typeof src === "string" ? src : src.src;
    return createElement(
      "div",
      {
        "data-clip": uri,
        "data-type": typeof src === "string" ? "" : (src.type ?? ""),
        "data-loop": String(loop),
        "data-preload": preload,
        "data-key-disabled": String(keyDisabled),
      },
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
      createElement("button", {
        "data-fail": uri,
        onClick: () => onError?.({ message: "hls.js: manifestLoadError", code: 1 }),
      }),
      createElement("button", { "data-loader-change": uri, onClick: onProviderLoaderChange }),
      children
    );
  }

  /** The provider instance the player is handed: its element, and `load()`. */
  function StubMediaProvider({
    ref,
    children,
    mediaProps,
  }: {
    ref?: React.Ref<unknown>;
    children?: React.ReactNode;
    mediaProps?: { playsInline?: boolean };
  }) {
    const elementRef = useRef<HTMLDivElement>(null);
    useImperativeHandle(
      ref,
      () => ({
        // The real provider's element wraps its media element; here the stub
        // player owns the `<video>`, so the provider reads its parent.
        get el() {
          return elementRef.current?.parentElement ?? null;
        },
        load: providerLoad,
      }),
      []
    );
    return createElement(
      "div",
      { ref: elementRef, "data-plays-inline": String(mediaProps?.playsInline) },
      children
    );
  }

  return {
    ...actual,
    MediaPlayer: StubMediaPlayer,
    MediaProvider: StubMediaProvider,
    Poster: () => null,
    MediaAnnouncer: () => createElement("div", { "data-announcer": "" }),
  };
});

const providerLoad = vi.hoisted(() => vi.fn<(target: HTMLElement | null) => void>());

/** What the one element reports through: the player's media events. */
interface ElementCallbacks {
  onEnd?: () => void;
  onTimeUpdate?: (detail: { currentTime: number }) => void;
  onError?: (detail: { message: string; code: number }) => void;
  onHlsError?: (detail: ErrorData) => void;
  onPlay?: () => void;
  onPause?: () => void;
  onPlayFail?: (detail: Error) => void;
  onProviderChange?: (provider: unknown) => void;
}

const elementCallbacks = vi.hoisted(() => ({ current: {} as ElementCallbacks }));

/** Vidstack's view of the clip: where it last heard the element was. */
const playerState = vi.hoisted(() => ({
  current: { currentTime: 0, duration: 0, ended: false, seekableEnd: 0 },
}));

/** Set to hold the provider back until the test attaches it. */
const providerAttachment = vi.hoisted(() => ({ deferred: false }));

/** The slice of an hls.js instance the player reaches for when a stream fails. */
class FakeHls {
  static readonly ErrorTypes = ErrorTypes;
  static readonly ErrorDetails = ErrorDetails;
  readonly detachMedia = vi.fn();
}

const stubHls = vi.hoisted(() => ({ current: null as FakeHls | null }));

const CONTENT_A = "/aurora/story-projects/p/builds/b/assets/a/variants/original/content";
const MASTER_A = "https://media.fizzspace.cn/hls/a/master.m3u8";
const CONTENT_B = "/aurora/story-projects/p/builds/b/assets/b/variants/original/content";
const MASTER_B = "https://media.fizzspace.cn/hls/b/master.m3u8";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function hlsAnswer(master: string): Response {
  return jsonResponse(200, {
    code: 200,
    data: { url: master, contentType: "application/vnd.apple.mpegurl" },
  });
}

/** A fatal hls.js media error, as hls.js raises it. */
function fatalMediaError(details: ErrorDetails, message: string): ErrorData {
  return { type: ErrorTypes.MEDIA_ERROR, details, fatal: true, error: new Error(message) };
}

/** A `/playback` answer the test releases when it is ready to. */
function deferredResponse() {
  let release!: (response: Response) => void;
  const response = new Promise<Response>((resolve) => {
    release = resolve;
  });
  return { response, release };
}

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
    stubHls.current = new FakeHls();
    playerState.current = { currentTime: 0, duration: 0, ended: false, seekableEnd: 0 };
    providerAttachment.deferred = false;
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
    clip: {
      uri: string;
      identity: string;
      clipStartTime?: number;
      loop?: boolean;
      poster?: string;
    },
    options: {
      frameReady?: boolean;
      delivery?: ExperiencePlaybackDelivery;
      onEnd?: () => void;
      onTimeUpdate?: (seconds: number) => void;
      onContentSize?: (size: { width: number; height: number }) => void;
      onPlaybackError?: (message?: string) => void;
      onPlaybackInterrupted?: () => void;
      onPlaybackRefused?: () => void;
    } = {}
  ) => {
    await act(async () => {
      root.render(
        // Always provided — null plays clips as declared — so a test that adds a
        // delivery keeps the same tree, and with it the same element.
        <ExperiencePlaybackDeliveryContext.Provider value={options.delivery ?? null}>
          <ExperienceMediaPlayer
            source={{ src: clip.uri, type: "video/mp4" }}
            title="Clip"
            poster={clip.poster}
            autoPlay={false}
            muted={false}
            loop={clip.loop ?? false}
            clipStartTime={clip.clipStartTime}
            onEnd={options.onEnd ?? (() => {})}
            onTimeUpdate={options.onTimeUpdate ?? (() => {})}
            onPlaybackError={options.onPlaybackError ?? (() => {})}
            onPlaybackHandle={onPlaybackHandle}
            onPlaybackInterrupted={options.onPlaybackInterrupted}
            onPlaybackRefused={options.onPlaybackRefused}
            onContentSize={options.onContentSize}
            playbackIdentity={clip.identity}
            copy={copy}
          />
        </ExperiencePlaybackDeliveryContext.Provider>
      );
    });
    if (container.querySelector("[data-media-element]")) setFrameReady(options.frameReady ?? true);
  };

  /** Something the element fires, delivered as Vidstack delivers it. */
  const emit = async (fire: (element: ElementCallbacks) => void) => {
    await act(async () => {
      fire(elementCallbacks.current);
    });
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
    // Synchronously, inside the activation that calls it — not after the wait
    // for readiness, which would leave the activation behind.
    const playing = registeredHandles().at(-1)!.playInGesture();
    expect(play).toHaveBeenCalledOnce();
    expect(play.mock.contexts[0]).toBe(video());
    expect(pause).not.toHaveBeenCalled();
    await expect(playing).resolves.toBeUndefined();
  });

  it("offers nothing to unlock once the clip has ended", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    await showClip("a");
    const handle = registeredHandles().at(-1)!;
    Object.defineProperty(video(), "ended", { value: true, configurable: true });

    // Playing an ended clip starts it over; the hold effect skips it, and a tap
    // has nothing to unlock on it either.
    expect(handle.ended()).toBe(true);
    expect(handle.playInGesture()).toBeNull();
    expect(play).not.toHaveBeenCalled();
  });

  it("counts a clip Vidstack has ended as ended", async () => {
    await showClip("a");
    playerState.current = { currentTime: 5, duration: 5, ended: true, seekableEnd: 5 };
    expect(registeredHandles().at(-1)!.ended()).toBe(true);
  });

  it("names the element a handle plays, and none once the handle is withdrawn", async () => {
    await showClip("a");
    const first = registeredHandles().at(-1)!;
    expect(first.element()).toBe(video());
    await showClip("b");
    expect(first.element()).toBeNull();
    expect(registeredHandles().at(-1)!.element()).toBe(video());
  });

  it("offers a handle only once the provider is on the element", async () => {
    providerAttachment.deferred = true;
    await showClip("a");

    // Before the provider attaches, a Start tap would play nothing inside the
    // click, and WebKit grants playback only to an element a click played.
    expect(registeredHandles()).toHaveLength(0);

    await act(async () => {
      elementCallbacks.current.onProviderChange?.({
        type: "video",
        media: video(),
        video: video(),
      });
    });

    expect(registeredHandles()).toHaveLength(1);
    expect(registeredHandles()[0]!.playbackIdentity).toBe("renderer:0:sequence:a");

    // A provider torn down (a loader change) withdraws the handle with it.
    await act(async () => {
      elementCallbacks.current.onProviderChange?.(null);
    });
    expect(onPlaybackHandle.mock.calls.at(-1)?.[0]).toBeNull();
  });

  it("turns off Vidstack's keyboard and keeps the element inline from its first render", async () => {
    await showClip("a");
    // No key may toggle, seek, mute or fullscreen the story's clip.
    expect(container.querySelector("[data-clip]")?.getAttribute("data-key-disabled")).toBe("true");
    // A play before Vidstack is ready must not open iPhone's native player.
    expect(container.querySelector("[data-plays-inline]")?.getAttribute("data-plays-inline")).toBe(
      "true"
    );
  });

  /** The element, paused `remaining` seconds from the end of a `duration` clip. */
  const pauseNearEnd = (duration: number, remaining: number) => {
    const element = video();
    Object.defineProperty(element, "paused", { value: true, configurable: true });
    playerState.current = {
      currentTime: duration - remaining,
      duration,
      ended: false,
      seekableEnd: duration,
    };
    return element;
  };

  it("ends a clip resumed in its last frames instead of letting Vidstack start it over", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    await showClip("a");
    const handle = registeredHandles().at(-1)!;
    const element = pauseNearEnd(5.5, 0.08);

    // Vidstack restarts a clip played within 0.1 s of its end, judging by the
    // position it last heard of — which WebKit updates only after `play`. So the
    // clip is not played at all: it is taken to its end, which ends it.
    expect(handle.playInGesture()).toBeNull();
    expect(play).not.toHaveBeenCalled();
    expect(element.currentTime).toBe(5.5);

    element.currentTime = 5.42;
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-ready="/a.mp4"]')!.click();
    });
    await handle.play();
    expect(play).not.toHaveBeenCalled();
    expect(element.currentTime).toBe(5.5);
  });

  it("plays a clip on from anywhere short of its last frames", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    await showClip("a");
    const handle = registeredHandles().at(-1)!;
    const element = pauseNearEnd(5.5, 0.4);
    element.currentTime = 5.1;

    await handle.playInGesture();
    expect(play).toHaveBeenCalledOnce();
    expect(element.currentTime).toBe(5.1);
  });

  /** A clip the host has played, which the element has started presenting. */
  const playingClip = async (
    clipId: string,
    callbacks: { onPlaybackInterrupted?: () => void; onPlaybackRefused?: () => void } = {}
  ) => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    await renderClip(
      { uri: `/${clipId}.mp4`, identity: `renderer:0:sequence:${clipId}` },
      callbacks
    );
    await act(async () => {
      container.querySelector<HTMLButtonElement>(`[data-ready="/${clipId}.mp4"]`)!.click();
    });
    const handle = registeredHandles().at(-1)!;
    await handle.play();
    await signalPlaying(`/${clipId}.mp4`);
    return handle;
  };

  /** The element stopped, and its `pause` delivered, as the system stops it. */
  const pauseFromOutside = async (options: { ended?: boolean; paused?: boolean } = {}) => {
    const element = video();
    Object.defineProperty(element, "paused", {
      value: options.paused ?? true,
      configurable: true,
    });
    Object.defineProperty(element, "ended", { value: options.ended ?? false, configurable: true });
    await emit((callbacks) => callbacks.onPause?.());
  };

  it("reports a pause it did not ask for, once, after the clip played", async () => {
    const onPlaybackInterrupted = vi.fn();
    await playingClip("a", { onPlaybackInterrupted });

    await pauseFromOutside();
    await pauseFromOutside();

    // A call, headphones out, the OS controls: the story pauses with the clip.
    // Reported once: the clip is no longer one the player wants playing.
    expect(onPlaybackInterrupted).toHaveBeenCalledOnce();
  });

  it("does not report the pauses that are the player's own or the clip's end", async () => {
    const onPlaybackInterrupted = vi.fn();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const handle = await playingClip("a", { onPlaybackInterrupted });

    // The clip's end: the element pauses just before `ended`.
    await pauseFromOutside({ ended: true });
    // Vidstack's own announcement as a clip ends, while the element plays on.
    await pauseFromOutside({ paused: false });
    // A pause the player asked for.
    handle.pause();
    await pauseFromOutside();

    expect(onPlaybackInterrupted).not.toHaveBeenCalled();
  });

  it("does not report a pause before the clip has played, or after it was cut away from", async () => {
    const onPlaybackInterrupted = vi.fn();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    await renderClip(
      { uri: "/a.mp4", identity: "renderer:0:sequence:a" },
      { onPlaybackInterrupted }
    );
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-ready="/a.mp4"]')!.click();
    });
    void registeredHandles().at(-1)!.play();
    await act(async () => {});

    // Asked to play, but still loading: a pause now is the load's, not the viewer's.
    await pauseFromOutside();
    expect(onPlaybackInterrupted).not.toHaveBeenCalled();

    await signalPlaying("/a.mp4");
    await renderClip(
      { uri: "/b.mp4", identity: "renderer:0:sequence:b" },
      { onPlaybackInterrupted }
    );

    // The cut: the next clip waits for the host to play it.
    await pauseFromOutside();
    expect(onPlaybackInterrupted).not.toHaveBeenCalled();
  });

  it("does not report the pause Vidstack makes as the player unmounts", async () => {
    const onPlaybackInterrupted = vi.fn();
    await playingClip("a", { onPlaybackInterrupted });
    const element = video();
    const { onPause } = elementCallbacks.current;

    // Vidstack pauses a playing element as it disconnects: the player's own pause.
    act(() => root.unmount());
    Object.defineProperty(element, "paused", { value: true, configurable: true });
    onPause?.();

    expect(onPlaybackInterrupted).not.toHaveBeenCalled();
    root = createRoot(container);
  });

  it("stops a play it did not ask for", async () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const handle = await playingClip("a");
    handle.pause();
    pause.mockClear();

    // Chrome resuming background media, Vidstack playing on after a seek to the
    // end, the OS controls: the story decides when its clip runs.
    await emit((callbacks) => callbacks.onPlay?.());
    expect(pause).toHaveBeenCalledOnce();
    expect(pause.mock.contexts[0]).toBe(video());

    pause.mockClear();
    await handle.play();
    await emit((callbacks) => callbacks.onPlay?.());
    expect(pause).not.toHaveBeenCalled();
  });

  it("reports a refused play Vidstack started itself while the clip should play", async () => {
    const onPlaybackRefused = vi.fn();
    const onPlaybackError = vi.fn();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const handle = await playingClip("a", { onPlaybackRefused });
    await renderClip(
      { uri: "/a.mp4", identity: "renderer:0:sequence:a" },
      { onPlaybackRefused, onPlaybackError }
    );
    const refusal = new DOMException("Not allowed by the user agent.", "NotAllowedError");

    // The next turn of a loop, refused: dropped, the film would freeze silently.
    await emit((callbacks) => callbacks.onPlayFail?.(refusal));
    expect(onPlaybackRefused).toHaveBeenCalledOnce();
    expect(onPlaybackError).not.toHaveBeenCalled();

    // Held by the player, the clip is not one it wants playing.
    handle.pause();
    await emit((callbacks) => callbacks.onPlayFail?.(refusal));
    expect(onPlaybackRefused).toHaveBeenCalledOnce();

    // A real failure from the same event still reaches the viewer.
    await emit((callbacks) =>
      callbacks.onPlayFail?.(new DOMException("No supported sources.", "NotSupportedError"))
    );
    expect(onPlaybackError).toHaveBeenCalledExactlyOnceWith("No supported sources.");
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

  it("hands the same element back to the provider when its loader changes", async () => {
    await showClip("a");
    const element = video();
    providerLoad.mockClear();

    // A cut between an HLS clip and a progressive one swaps hls.js for the
    // native loader. Vidstack only runs a loader when given the element, so
    // without this the new provider is never built and the element stays empty.
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-loader-change="/a.mp4"]')!.click();
    });

    expect(providerLoad).toHaveBeenCalledExactlyOnceWith(element);
  });

  it("buffers the whole clip ahead of Start", async () => {
    await showClip("a");
    expect(container.querySelector("[data-clip]")?.getAttribute("data-preload")).toBe("auto");
  });

  /** A delivery that negotiates build clips through `answers`, in order. */
  const negotiatingDelivery = (answers: Array<Response | Promise<Response>>) => {
    const fetch = vi.fn<typeof globalThis.fetch>(() => {
      const next = answers.shift();
      if (!next) throw new Error("Unexpected negotiation request.");
      return Promise.resolve(next);
    });
    const delivery = new ExperiencePlaybackDelivery({
      adaptive: true,
      fetch,
      acceptsHls: () => true,
    });
    return { delivery, fetch };
  };

  it("holds the outgoing clip, with no handle, while the next one is negotiated", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const answer = deferredResponse();
    const { delivery } = negotiatingDelivery([answer.response]);
    await renderClip({ uri: "/a.mp4", identity: "renderer:0:sequence:a" }, { delivery });
    const element = video();
    expect(registeredHandles()).toHaveLength(1);

    await renderClip(
      { uri: CONTENT_B, identity: "renderer:0:sequence:b", loop: true },
      { delivery }
    );

    // Nothing to source yet: the element keeps the clip — and the frame — it
    // has, and the host holds no handle that could replay the clip just left.
    expect(mountedClip()).toBe("/a.mp4");
    expect(container.querySelector("[data-clip]")?.getAttribute("data-loop")).toBe("false");
    expect(onPlaybackHandle.mock.calls.at(-1)?.[0]).toBeNull();
    expect(drawImage).not.toHaveBeenCalled();

    await act(async () => {
      answer.release(
        jsonResponse(200, {
          code: 200,
          data: { url: MASTER_B, contentType: "application/vnd.apple.mpegurl" },
        })
      );
    });

    // The answer swaps the source on the same element, covered like any cut.
    expect(video()).toBe(element);
    expect(mountedClip()).toBe(MASTER_B);
    const player = container.querySelector("[data-clip]")!;
    expect(player.getAttribute("data-type")).toBe("application/vnd.apple.mpegurl");
    expect(player.getAttribute("data-loop")).toBe("true");
    expect(drawImage).toHaveBeenCalledWith(element, 0, 0);
    expect(stillFrame().hidden).toBe(false);
    const handle = registeredHandles().at(-1);
    expect(handle?.playbackIdentity).toBe("renderer:0:sequence:b");
    expect(delivery.hasStagedOrWarmed(CONTENT_B)).toBe(true);
  });

  it("pauses the outgoing clip during a negotiated cut, and gives none of its events to the next", async () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const answer = deferredResponse();
    const { delivery } = negotiatingDelivery([hlsAnswer(MASTER_A), answer.response]);
    const outgoing = { src: CONTENT_A, type: "video/mp4" };
    await delivery.resolve(outgoing);
    await renderClip({ uri: CONTENT_A, identity: "renderer:0:sequence:a" }, { delivery });
    expect(pause).not.toHaveBeenCalled();
    const incoming = {
      onEnd: vi.fn(),
      onTimeUpdate: vi.fn(),
      onContentSize: vi.fn(),
      onPlaybackError: vi.fn(),
    };

    await renderClip(
      { uri: CONTENT_B, identity: "renderer:0:sequence:b" },
      { delivery, ...incoming }
    );

    // The cut is waiting on `/playback`, so the element still holds the clip the
    // viewer left. Held, not played on under the next clip: it is paused on its
    // frame, and what it reports meanwhile is not the next clip's to hear — its
    // time would run the next scene's clock, its end would end the next clip.
    expect(mountedClip()).toBe(MASTER_A);
    expect(pause).toHaveBeenCalledOnce();
    expect(pause.mock.contexts[0]).toBe(video());
    const decodeError = fatalMediaError(ErrorDetails.BUFFER_APPEND_ERROR, "Failed to append");
    await emit((element) => element.onTimeUpdate?.({ currentTime: 7.5 }));
    await emit((element) => element.onEnd?.());
    await emit((element) => element.onHlsError?.(decodeError));
    await emit((element) => element.onHlsError?.(decodeError));
    await emit((element) => element.onError?.({ message: "hls.js: fragLoadError", code: 1 }));
    expect(incoming.onTimeUpdate).not.toHaveBeenCalled();
    expect(incoming.onEnd).not.toHaveBeenCalled();
    expect(incoming.onContentSize).not.toHaveBeenCalled();
    expect(incoming.onPlaybackError).not.toHaveBeenCalled();
    // A failure is still the outgoing clip's own: its answer is retired, and
    // hls.js is left to Vidstack rather than stopped under a clip about to load.
    expect(delivery.peek(outgoing)).toBeUndefined();
    expect(stubHls.current!.detachMedia).not.toHaveBeenCalled();

    await act(async () => {
      answer.release(hlsAnswer(MASTER_B));
    });

    // On the element, the incoming clip is the one the element reports for.
    expect(mountedClip()).toBe(MASTER_B);
    await emit((element) => element.onTimeUpdate?.({ currentTime: 0.5 }));
    await emit((element) => element.onEnd?.());
    expect(incoming.onTimeUpdate).toHaveBeenCalledExactlyOnceWith(0.5);
    expect(incoming.onContentSize).toHaveBeenCalledWith({ width: 1920, height: 1080 });
    expect(incoming.onEnd).toHaveBeenCalledOnce();
    expect(pause).toHaveBeenCalledOnce();
  });

  it("plays build clips as declared, cutting at once, when adaptive playback is off", async () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const fetch = vi.fn<typeof globalThis.fetch>();
    const delivery = new ExperiencePlaybackDelivery({
      adaptive: false,
      fetch,
      acceptsHls: () => true,
    });
    await renderClip({ uri: CONTENT_A, identity: "renderer:0:sequence:a" }, { delivery });
    const onEnd = vi.fn();

    await renderClip({ uri: CONTENT_B, identity: "renderer:0:sequence:b" }, { delivery, onEnd });

    // The .com path: no `/playback`, the progressive file on the element — so
    // the native loader, never hls.js — and a cut with nothing to wait for.
    expect(fetch).not.toHaveBeenCalled();
    expect(mountedClip()).toBe(CONTENT_B);
    expect(container.querySelector("[data-clip]")?.getAttribute("data-type")).toBe("video/mp4");
    expect(registeredHandles().at(-1)?.playbackIdentity).toBe("renderer:0:sequence:b");
    await emit((element) => element.onEnd?.());
    expect(onEnd).toHaveBeenCalledOnce();
    expect(pause).not.toHaveBeenCalled();
  });

  it("keeps the tail loop and a rotation playing, and reporting, on the same clip", async () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const answer = deferredResponse();
    const { delivery } = negotiatingDelivery([answer.response]);
    const onTimeUpdate = vi.fn();
    await renderClip(
      { uri: "/a.mp4", identity: "renderer:0:sequence:a" },
      { delivery, onTimeUpdate }
    );

    // The tail wait loop: a new identity on the same source, sought, not cut.
    await renderClip(
      { uri: "/a.mp4", identity: "renderer:0:loop:a:11", clipStartTime: 11 },
      { delivery, onTimeUpdate }
    );
    await emit((element) => element.onTimeUpdate?.({ currentTime: 11.5 }));
    expect(onTimeUpdate).toHaveBeenLastCalledWith(11.5);

    // A rotation re-resolves the same clip to a file still being negotiated:
    // until it lands, the clip on the element is still the one the host plays.
    await renderClip(
      { uri: CONTENT_B, identity: "renderer:0:loop:a:11", clipStartTime: 11 },
      { delivery, onTimeUpdate }
    );
    expect(mountedClip()).toBe("/a.mp4");
    await emit((element) => element.onTimeUpdate?.({ currentTime: 12 }));
    expect(onTimeUpdate).toHaveBeenLastCalledWith(12);
    expect(onPlaybackHandle.mock.calls.at(-1)?.[0]?.playbackIdentity).toBe("renderer:0:loop:a:11");
    expect(pause).not.toHaveBeenCalled();
  });

  it("shows the poster, and offers nothing, while a first clip is negotiated", async () => {
    const answer = deferredResponse();
    const { delivery } = negotiatingDelivery([answer.response]);

    await renderClip(
      { uri: CONTENT_B, identity: "renderer:0:sequence:b", poster: "/b-poster.jpg" },
      { delivery }
    );

    const pending = container.querySelector("[data-experience-video-pending]");
    expect(pending).not.toBeNull();
    expect(pending?.querySelector("img")?.getAttribute("src")).toBe("/b-poster.jpg");
    expect(container.querySelector("[data-media-element]")).toBeNull();
    expect(onPlaybackHandle).not.toHaveBeenCalled();

    await act(async () => {
      answer.release(jsonResponse(200, { code: 200, data: null }));
    });

    expect(container.querySelector("[data-experience-video-pending]")).toBeNull();
    expect(mountedClip()).toBe(CONTENT_B);
    expect(registeredHandles().at(-1)?.playbackIdentity).toBe("renderer:0:sequence:b");
  });

  it("reports a refused clip once, verbatim, and does not ask again on re-render", async () => {
    const { delivery, fetch } = negotiatingDelivery([
      jsonResponse(410, {
        code: "STORY_BUILD_ASSET_DELETED",
        message: "This clip was removed by its author.",
      }),
    ]);
    const onPlaybackError = vi.fn();

    await renderClip(
      { uri: CONTENT_B, identity: "renderer:0:sequence:b" },
      { delivery, onPlaybackError }
    );

    expect(onPlaybackError).toHaveBeenCalledOnce();
    expect(onPlaybackError).toHaveBeenCalledWith("This clip was removed by its author.");

    const rerendered = vi.fn();
    await renderClip(
      { uri: CONTENT_B, identity: "renderer:0:sequence:b" },
      { delivery, onPlaybackError: rerendered }
    );

    expect(fetch).toHaveBeenCalledOnce();
    expect(rerendered).not.toHaveBeenCalled();
    expect(container.querySelector("[data-experience-video-pending]")).not.toBeNull();
  });

  it.each([
    ["on its first clip", false],
    ["after a cut into it", true],
  ])("retires the negotiated answer when the stream fails fatally, %s", async (_label, cut) => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const { delivery, fetch } = negotiatingDelivery([
      jsonResponse(200, {
        code: 200,
        data: { url: MASTER_B, contentType: "application/vnd.apple.mpegurl" },
      }),
    ]);
    const onPlaybackError = vi.fn();
    const declared = { src: CONTENT_B, type: "video/mp4" };
    // Answered ahead of the cut, as the look-ahead does: the element takes the
    // answer straight from the delivery instead of asking for it itself.
    await delivery.resolve(declared);
    if (cut) await renderClip({ uri: "/a.mp4", identity: "renderer:0:sequence:a" }, { delivery });
    await renderClip(
      { uri: CONTENT_B, identity: "renderer:0:sequence:b" },
      { delivery, onPlaybackError }
    );
    expect(mountedClip()).toBe(MASTER_B);

    await act(async () => {
      container.querySelector<HTMLButtonElement>(`[data-fail="${MASTER_B}"]`)!.click();
    });

    // Restarting asks the server again rather than replaying a failed master.
    expect(delivery.peek(declared)).toBeUndefined();
    expect(onPlaybackError).toHaveBeenCalledWith("hls.js: manifestLoadError");
    // And the failed clip stops where it is, rather than playing on behind the error.
    expect(pause).toHaveBeenCalledOnce();
    expect(pause.mock.contexts[0]).toBe(video());

    // …but only a restart: the failed element neither asks again behind the
    // error on a re-render nor swaps its source.
    await renderClip(
      { uri: CONTENT_B, identity: "renderer:0:sequence:b" },
      { delivery, onPlaybackError: vi.fn() }
    );
    expect(fetch).toHaveBeenCalledOnce();
    expect(mountedClip()).toBe(MASTER_B);
  });

  /** An HLS clip on the element, answered ahead of time as the look-ahead does. */
  const renderHlsClip = async (
    uri: string,
    master: string,
    identity: string,
    onPlaybackError: (message?: string) => void
  ) => {
    const { delivery } = negotiatingDelivery([hlsAnswer(master)]);
    const declared = { src: uri, type: "video/mp4" };
    await delivery.resolve(declared);
    await renderClip({ uri, identity }, { delivery, onPlaybackError });
    expect(mountedClip()).toBe(master);
    return { delivery, declared };
  };

  it("reports a fatal media error that one recovery did not cure, once, verbatim", async () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const onPlaybackError = vi.fn();
    const { delivery, declared } = await renderHlsClip(
      CONTENT_B,
      MASTER_B,
      "renderer:0:sequence:b",
      onPlaybackError
    );
    const playing = registeredHandles().at(-1)!.play();
    const failed = expect(playing).rejects.toThrow("Failed to append segment");
    const appendError = fatalMediaError(
      ErrorDetails.BUFFER_APPEND_ERROR,
      "Failed to append segment"
    );

    await emit((element) => element.onHlsError?.(appendError));

    // The first is left to the `recoverMediaError()` Vidstack runs next.
    expect(stubHls.current!.detachMedia).not.toHaveBeenCalled();
    expect(onPlaybackError).not.toHaveBeenCalled();
    expect(delivery.peek(declared)).toBeDefined();
    expect(pause).not.toHaveBeenCalled();

    await emit((element) => element.onHlsError?.(appendError));

    // The second is the stream, not a hiccup. hls.js lets go of the element, so
    // that recovery has nothing to re-attach, and the failure takes the path of
    // every fatal one: the answer retired, the waiting play failed, the message
    // shown as hls.js wrote it.
    expect(stubHls.current!.detachMedia).toHaveBeenCalledOnce();
    expect(onPlaybackError).toHaveBeenCalledExactlyOnceWith("Failed to append segment");
    expect(delivery.peek(declared)).toBeUndefined();
    expect(pause).toHaveBeenCalledOnce();
    await failed;
  });

  it("takes a failed clip out of the story: nothing the element reports after is passed on", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const { delivery } = negotiatingDelivery([hlsAnswer(MASTER_B)]);
    await delivery.resolve({ src: CONTENT_B, type: "video/mp4" });
    const host = {
      onEnd: vi.fn(),
      onTimeUpdate: vi.fn(),
      onContentSize: vi.fn(),
      onPlaybackError: vi.fn(),
    };
    await renderClip({ uri: CONTENT_B, identity: "renderer:0:sequence:b" }, { delivery, ...host });
    const appendError = fatalMediaError(ErrorDetails.BUFFER_APPEND_ERROR, "Failed to append");
    await emit((element) => element.onHlsError?.(appendError));
    await emit((element) => element.onHlsError?.(appendError));
    expect(host.onPlaybackError).toHaveBeenCalledExactlyOnceWith("Failed to append");

    // hls.js let go of the element, but the element may still play what it had
    // buffered and end early. None of that is the story's: its end would take
    // the clip's exit — choices, a scene change, an ending — behind the error.
    // And a second failure from the dying element (Chrome's own demuxer text,
    // say) must not bury the first.
    await emit((element) => element.onTimeUpdate?.({ currentTime: 5.9 }));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(`[data-ready="${MASTER_B}"]`)!.click();
    });
    await emit((element) => element.onEnd?.());
    await emit((element) =>
      element.onError?.({ message: "PipelineStatus::DEMUXER_ERROR_COULD_NOT_OPEN", code: 4 })
    );
    await emit((element) => element.onHlsError?.(appendError));
    expect(host.onTimeUpdate).not.toHaveBeenCalled();
    expect(host.onContentSize).not.toHaveBeenCalled();
    expect(host.onEnd).not.toHaveBeenCalled();
    expect(host.onPlaybackError).toHaveBeenCalledOnce();
  });

  it("gives a clip that failed on the element no recovery from hls.js", async () => {
    const onPlaybackError = vi.fn();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    await renderHlsClip(CONTENT_B, MASTER_B, "renderer:0:sequence:b", onPlaybackError);

    await emit((element) => element.onError?.({ message: "PIPELINE_ERROR_DECODE", code: 3 }));
    await emit((element) =>
      element.onHlsError?.(fatalMediaError(ErrorDetails.BUFFER_APPEND_ERROR, "Failed to append"))
    );

    // The failure already reported stands, and hls.js lets go of the element, so
    // the recovery Vidstack runs next cannot reload the clip behind the error.
    expect(onPlaybackError).toHaveBeenCalledExactlyOnceWith("PIPELINE_ERROR_DECODE");
    expect(stubHls.current!.detachMedia).toHaveBeenCalledOnce();
  });

  it.each([
    [ErrorDetails.MANIFEST_INCOMPATIBLE_CODECS_ERROR, "no level with compatible codecs found"],
    [ErrorDetails.BUFFER_INCOMPATIBLE_CODECS_ERROR, "could not create source buffer"],
  ])("gives up at once on %s", async (details, message) => {
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const onPlaybackError = vi.fn();
    const { delivery, declared } = await renderHlsClip(
      CONTENT_B,
      MASTER_B,
      "renderer:0:sequence:b",
      onPlaybackError
    );

    await emit((element) => element.onHlsError?.(fatalMediaError(details, message)));
    // Ending a MediaSource that never reached its metadata is an error of its
    // own to Chrome, which the element reports next.
    await emit((element) =>
      element.onError?.({ message: "PipelineStatus::DEMUXER_ERROR_COULD_NOT_OPEN", code: 4 })
    );

    // A browser that cannot decode the codecs will not decode them on a retry,
    // and the viewer is shown why, not the demuxer's echo of it.
    expect(stubHls.current!.detachMedia).toHaveBeenCalledOnce();
    expect(onPlaybackError).toHaveBeenCalledExactlyOnceWith(message);
    expect(delivery.peek(declared)).toBeUndefined();
  });

  it("allows every source its own recovery", async () => {
    const onPlaybackError = vi.fn();
    const appendError = fatalMediaError(ErrorDetails.BUFFER_APPEND_ERROR, "Failed to append");
    const { delivery } = negotiatingDelivery([hlsAnswer(MASTER_A), hlsAnswer(MASTER_B)]);
    await delivery.resolve({ src: CONTENT_A, type: "video/mp4" });
    await delivery.resolve({ src: CONTENT_B, type: "video/mp4" });
    await renderClip(
      { uri: CONTENT_A, identity: "renderer:0:sequence:a" },
      { delivery, onPlaybackError }
    );
    await emit((element) => element.onHlsError?.(appendError));

    await renderClip(
      { uri: CONTENT_B, identity: "renderer:0:sequence:b" },
      { delivery, onPlaybackError }
    );
    expect(mountedClip()).toBe(MASTER_B);
    await emit((element) => element.onHlsError?.(appendError));

    expect(onPlaybackError).not.toHaveBeenCalled();
    expect(stubHls.current!.detachMedia).not.toHaveBeenCalled();
  });

  it("gives a source its recovery again each time it comes back to the element", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const onPlaybackError = vi.fn();
    const appendError = fatalMediaError(ErrorDetails.BUFFER_APPEND_ERROR, "Failed to append");
    const { delivery } = negotiatingDelivery([hlsAnswer(MASTER_A), hlsAnswer(MASTER_B)]);
    await delivery.resolve({ src: CONTENT_A, type: "video/mp4" });
    await delivery.resolve({ src: CONTENT_B, type: "video/mp4" });
    // A hub scene's opening has the same identity and source on every visit.
    const hub = { uri: CONTENT_A, identity: "hub.video:0:sequence:a" };
    await renderClip(hub, { delivery, onPlaybackError });
    await emit((element) => element.onHlsError?.(appendError));

    await renderClip({ uri: CONTENT_B, identity: "room.video:0:sequence:b" }, { delivery });
    await renderClip(hub, { delivery, onPlaybackError });
    expect(mountedClip()).toBe(MASTER_A);

    // A fresh load of the hub clip: its first glitch is recovered as on the
    // first visit, and only a second one on this load is the stream's.
    await emit((element) => element.onHlsError?.(appendError));
    expect(onPlaybackError).not.toHaveBeenCalled();
    expect(stubHls.current!.detachMedia).not.toHaveBeenCalled();
    await emit((element) => element.onHlsError?.(appendError));
    expect(onPlaybackError).toHaveBeenCalledExactlyOnceWith("Failed to append");
  });

  it("leaves hls.js errors that are not fatal media errors to hls.js and Vidstack", async () => {
    const onPlaybackError = vi.fn();
    await renderHlsClip(CONTENT_B, MASTER_B, "renderer:0:sequence:b", onPlaybackError);
    const stall: ErrorData = {
      type: ErrorTypes.MEDIA_ERROR,
      details: ErrorDetails.BUFFER_STALLED_ERROR,
      fatal: false,
      error: new Error("Playback stalling"),
    };
    // Fatal network errors reach `onError` through Vidstack instead.
    const network: ErrorData = {
      type: ErrorTypes.NETWORK_ERROR,
      details: ErrorDetails.MANIFEST_LOAD_ERROR,
      fatal: true,
      error: new Error("HTTP 404"),
    };

    for (const error of [stall, stall, network, network]) {
      await emit((element) => element.onHlsError?.(error));
    }

    expect(onPlaybackError).not.toHaveBeenCalled();
    expect(stubHls.current!.detachMedia).not.toHaveBeenCalled();
  });
});
