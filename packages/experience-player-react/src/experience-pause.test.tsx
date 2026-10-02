// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import {
  ExperienceRuntimeManifestSchema,
  type ExperienceRuntimeManifest,
  type ExperienceThemeConfig,
} from "@repo/shared/experience-runtime";
import { ExperiencePlayer, type ExperiencePlayerProps } from "./experience-player";
import type { ExperiencePlayerCopy } from "./experience-player-copy";

/**
 * The paused state, driven through the real player. Only Vidstack is stubbed —
 * it needs a media pipeline jsdom does not have — so every play the player
 * starts reaches `HTMLMediaElement.prototype.play`, which each test answers the
 * way a browser would: a Low Power Mode iPad refuses with `NotAllowedError`.
 * What the element would report (`can-play`, `playing`, `pause`, `end`) is
 * fired by hand, per clip.
 */

/** What the element sourced with each clip reports through. */
interface ClipCallbacks {
  onCanPlay?: () => void;
  onPlaying?: () => void;
  onPause?: () => void;
  onEnd?: () => void;
  onTimeUpdate?: (detail: { currentTime: number }) => void;
}

const clips = vi.hoisted(() => new Map<string, ClipCallbacks>());

vi.mock("@vidstack/react", async () => {
  const { createElement, useEffect, useImperativeHandle, useRef } = await import("react");
  const actual = await vi.importActual<typeof import("@vidstack/react")>("@vidstack/react");

  function StubMediaPlayer({
    ref,
    src,
    children,
    onProviderChange,
    ...callbacks
  }: ClipCallbacks & {
    ref?: React.Ref<unknown>;
    src: string | { src: string };
    children?: React.ReactNode;
    onProviderChange?: (provider: unknown) => void;
  }) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const uri = typeof src === "string" ? src : src.src;
    clips.set(uri, callbacks);
    useImperativeHandle(
      ref,
      () => ({
        get provider() {
          return { type: "video", media: videoRef.current, video: videoRef.current };
        },
        state: { currentTime: 0, duration: 0, ended: false, seekableEnd: 0 },
        muted: false,
        duration: 0,
      }),
      []
    );
    useEffect(() => {
      const media = videoRef.current;
      onProviderChange?.({ type: "video", media, video: media });
      // Once, as the element mounts.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return createElement(
      "div",
      { "data-video-source": uri },
      createElement("video", { ref: videoRef }),
      children
    );
  }

  return {
    ...actual,
    MediaPlayer: StubMediaPlayer,
    MediaProvider: ({ children }: { children?: React.ReactNode }) =>
      createElement("div", null, children),
    Poster: () => null,
    MediaAnnouncer: () => null,
  };
});

vi.mock("./experience-media-warm", () => ({ warmExperienceMedia: vi.fn(() => Promise.resolve()) }));

const HASH = "a".repeat(64);

const copy = {
  invalidManifest: "Invalid manifest",
  manifestRoot: "Manifest",
  interactiveFilm: "Interactive film",
  starting: "Starting",
  start: "Start",
  endingEyebrow: "Ending",
  unknownEnding: (endingId: string) => endingId,
  playAgain: "Play again",
  runtimeError: "Runtime error",
  restart: "Restart",
  mediaError: (assetId: string) => assetId,
  videoLabel: (rendererInstanceId: string) => rendererInstanceId,
  noVisibleChoices: "No visible choices",
  continue: "Continue",
  emptySequence: "No footage yet",
  loadingMedia: "Loading",
  regionLabel: "Experience player",
  video: {
    play: "Play",
    pause: "Pause",
    mute: "Mute",
    unmute: "Unmute",
    volume: "Volume",
    enterFullscreen: "Enter fullscreen",
    exitFullscreen: "Exit fullscreen",
    seekForward: "Seek forward",
    seekBackward: "Seek backward",
  },
} as ExperiencePlayerCopy;

const theme: ExperienceThemeConfig = {
  schemaVersion: 1,
  colorScheme: "dark",
  tokens: {},
  rendererStyles: {},
  motion: { reducedMotionBehavior: "preserve" },
};

const localized = (value: string) => ({ "en-US": value });

/** A rejection as a browser raises it, told apart by `name` alone. */
function domException(name: string, message = `${name} from the test browser`): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

// ── Manifest building ───────────────────────────────────────────────────────

type Node = ExperienceRuntimeManifest["graph"]["nodes"][number];
type Binding = Node["eventBindings"][number];

function videoAsset(assetId: string, uri: string) {
  return {
    assetId,
    kind: "video" as const,
    orientationPolicy: "single-master" as const,
    variants: [
      {
        variantId: `${assetId}.landscape`,
        sourceAssetId: `${assetId}.source`,
        sha256: HASH,
        uri,
        mediaType: "video/mp4",
        orientation: "landscape" as const,
        width: 1920,
        height: 1080,
        durationMs: 5_000,
      },
    ],
  };
}

function videoRenderer(instanceId: string, assetId: string, layer = 0) {
  return {
    instanceId,
    rendererId: "core.video",
    layer,
    config: {
      fit: "cover",
      sequence: [{ clipId: `${instanceId}.clip`, assetId, endBehavior: { behavior: "advance" } }],
      autoplay: true,
    },
    bindings: {},
  };
}

const goto = (sceneId: string) => ({ kind: "scene.goto", sceneId });
const finish = { kind: "ending.complete", endingId: "ending.done" };

function on(type: string, sourceId: string | undefined, actions: unknown[], qualifierId?: string) {
  return {
    bindingId: `${type}:${sourceId ?? "scene"}:${qualifierId ?? ""}`,
    on: { type, ...(sourceId ? { sourceId } : {}), ...(qualifierId ? { qualifierId } : {}) },
    routes: [{ routeId: "go", actions }],
  } as unknown as Binding;
}

const mediaEnded = (instanceId: string, actions: unknown[]) =>
  on("renderer.outcome", instanceId, actions, "media-ended");

/** A scene that plays one clip, then does `then`. */
function videoScene(sceneId: string, assetId: string, then: unknown[]) {
  const renderer = videoRenderer(`video.${sceneId}`, assetId);
  return {
    kind: "scene",
    sceneId,
    clock: { kind: "renderer", rendererInstanceId: renderer.instanceId },
    renderers: [renderer],
    anchors: [],
    gestures: [],
    timeline: { cues: [] },
    eventBindings: [mediaEnded(renderer.instanceId, then)],
  } as unknown as Node;
}

function textScene(sceneId: string, body: string, extra: Record<string, unknown> = {}) {
  return {
    kind: "scene",
    sceneId,
    clock: { kind: "none" },
    renderers: [
      {
        instanceId: `text.${sceneId}`,
        rendererId: "core.text",
        layer: 0,
        config: { body: localized(body), completion: "passive" },
        bindings: {},
      },
    ],
    anchors: [],
    gestures: [],
    timeline: { cues: [] },
    eventBindings: [on("scene.entered", undefined, [finish])],
    ...extra,
  } as unknown as Node;
}

const REQUIREMENTS: Record<string, unknown> = {
  "core.video": {
    rendererId: "core.video",
    apiVersion: "1.0.0",
    configSchemaVersion: "1.0.0",
    requiredCapabilities: ["core.video"],
    outcomes: [{ outcomeType: "media-ended" }],
    commands: [{ commandType: "play" }, { commandType: "pause" }],
  },
  "core.text": {
    rendererId: "core.text",
    apiVersion: "1.0.0",
    configSchemaVersion: "1.0.0",
    requiredCapabilities: ["core.text"],
    outcomes: [],
    commands: [],
  },
  "core.choice": {
    rendererId: "core.choice",
    apiVersion: "1.0.0",
    configSchemaVersion: "1.0.0",
    requiredCapabilities: ["core.choice"],
    outcomes: [{ outcomeType: "choice-selected" }],
    commands: [{ commandType: "open" }],
  },
  "core.world-model": {
    rendererId: "core.world-model",
    apiVersion: "1.0.0",
    configSchemaVersion: "1.0.0",
    requiredCapabilities: ["core.world-model"],
    outcomes: [{ outcomeType: "world-completed" }],
    commands: [{ commandType: "end" }],
  },
};

function film(input: {
  nodes: Node[];
  assets?: unknown[];
  capabilities?: string[];
  inputActions?: unknown[];
  audio?: unknown;
}): ExperienceRuntimeManifest {
  const capabilities = [
    "core.video",
    "core.text",
    ...(input.capabilities ?? []),
    ...(input.audio ? ["audio.core"] : []),
  ];
  return ExperienceRuntimeManifestSchema.parse({
    manifestType: "fizzdragon.experience",
    schemaVersion: 2,
    channel: "preview",
    gameId: "experience.pause",
    buildId: "build.pause.001",
    contentVersion: "build.pause.001",
    completionPolicy: "finite",
    metadata: { title: localized("Pause") },
    compatibility: {
      engineApiVersion: "2.0.0",
      experienceApiVersion: "1.0.0",
      semanticRulesVersion: 1,
      requiredCapabilities: capabilities,
    },
    localization: { defaultLocale: "en-US", locales: ["en-US"] },
    stateDefinitions: [],
    inputActions: input.inputActions ?? [],
    rendererRequirements: Object.keys(REQUIREMENTS)
      .filter((rendererId) => capabilities.includes(rendererId))
      .map((rendererId) => REQUIREMENTS[rendererId]),
    assets: [
      {
        assetId: "theme.default.config",
        kind: "data",
        sourceAssetId: "source.theme.default.config",
        sha256: HASH,
        uri: "/runtime-assets/theme.default.json",
        mediaType: "application/json",
        format: "json",
      },
      ...(input.assets ?? []),
    ],
    theme: { themeId: "theme.default", apiVersion: "1.0.0", configAssetId: "theme.default.config" },
    telemetryDefinitions: [],
    endings: [{ endingId: "ending.done", title: localized("Done"), kind: "success" }],
    ...(input.audio ? { audio: input.audio } : {}),
    graph: { entrySceneId: input.nodes[0]!.sceneId, nodes: input.nodes },
  });
}

/** Two clips back to back, then the ending. */
function twoClipFilm() {
  return film({
    assets: [videoAsset("asset.a", "/a.mp4"), videoAsset("asset.b", "/b.mp4")],
    nodes: [
      videoScene("scene.a", "asset.a", [goto("scene.b")]),
      videoScene("scene.b", "asset.b", [finish]),
    ],
  });
}

const viewportAnchor = (anchorId: string, x: number) => ({
  anchorId,
  space: { kind: "viewport" },
  geometry: { default: { kind: "rect", rect: { x, y: 0.3, width: 0.2, height: 0.4 } } },
  motion: { kind: "fixed" },
});

// ── The browser ─────────────────────────────────────────────────────────────

describe("ExperiencePlayer paused state", () => {
  let container: HTMLDivElement;
  let root: Root;
  let play: MockInstance<(this: HTMLMediaElement) => Promise<void>>;
  /** How the browser answers each play(): resolves, or rejects with this. */
  let refuseWith: Error | null;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    clips.clear();
    refuseWith = null;
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: () => ({
        matches: false,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    });
    // The spatial layer measures a real box before it renders any control.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 1280,
      bottom: 720,
      width: 1280,
      height: 720,
      toJSON: () => ({}),
    });
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockImplementation(() => (refuseWith ? Promise.reject(refuseWith) : Promise.resolve()));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, "visibilityState");
  });

  const render = async (
    runtime: ExperienceRuntimeManifest,
    extra: Partial<ExperiencePlayerProps> = {}
  ) => {
    await act(async () => {
      root.render(
        <ExperiencePlayer
          runtime={runtime}
          locale="en-US"
          copy={copy}
          loadTheme={() => Promise.resolve(theme)}
          {...extra}
        />
      );
    });
  };

  /** Lets every promise the last step started settle, and React with them. */
  const settle = async () => {
    for (let turn = 0; turn < 5; turn += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  };

  const fire = async (uri: string, event: Exclude<keyof ClipCallbacks, "onTimeUpdate">) => {
    const callbacks = clips.get(uri);
    if (!callbacks) throw new Error(`No element was ever sourced with ${uri}.`);
    await act(async () => {
      callbacks[event]?.();
    });
    await settle();
  };

  /** The clip's position, as its element reports it: the scene clock follows. */
  const playedTo = async (uri: string, seconds: number) => {
    await act(async () => {
      clips.get(uri)?.onTimeUpdate?.({ currentTime: seconds });
    });
    await settle();
  };

  const element = (uri: string) => {
    const media = container.querySelector<HTMLVideoElement>(`[data-video-source="${uri}"] video`);
    if (!media) throw new Error(`No element holds ${uri}.`);
    return media;
  };

  const button = (label: string) =>
    [...container.querySelectorAll("button")].find((item) => item.textContent === label);

  const start = async () => {
    const control = button(copy.start);
    if (!control) throw new Error(`Start is not offered: ${container.textContent ?? ""}`);
    await act(async () => {
      control.click();
    });
    await settle();
  };

  /** Mounts the film, lets its entry clips buffer, and presses Start. */
  const startFilm = async (
    runtime: ExperienceRuntimeManifest,
    entryClips: string[],
    extra: Partial<ExperiencePlayerProps> = {}
  ) => {
    await render(runtime, extra);
    for (const uri of entryClips) await fire(uri, "onCanPlay");
    await start();
  };

  const storyLayer = () => {
    const layer = container.querySelector<HTMLElement>("[data-experience-story-layer]");
    if (!layer) throw new Error("The stage has no story layer.");
    return layer;
  };

  const pausedFor = () => storyLayer().getAttribute("data-experience-paused");

  const expectRefusedPause = () => {
    // A tap recovers a refusal, so it is a paused story, never the failure.
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(container.textContent).not.toContain(copy.runtimeError);
    expect(pausedFor()).toBe("refused");
    expect(storyLayer().hasAttribute("inert")).toBe(true);
  };

  // ── Refusals ──────────────────────────────────────────────────────────────

  describe("a refused play", () => {
    it("pauses the story at Start instead of failing it", async () => {
      // Low Power Mode from load: even the play inside the click is refused.
      refuseWith = domException("NotAllowedError");
      await startFilm(twoClipFilm(), ["/a.mp4"]);

      expectRefusedPause();
      expect(button(copy.start)).toBeUndefined();
      // Unlocked inside the click, then played by the clip hold with sound and,
      // once refused, muted: refused again, sound was not the reason.
      expect(play).toHaveBeenCalledTimes(3);
      expect(element("/a.mp4").muted).toBe(true);
    });

    it("plays the entry clip inside the Start click, before anything is awaited", async () => {
      await render(twoClipFilm());
      await fire("/a.mp4", "onCanPlay");
      let insideClick = false;
      const playedInsideClick: boolean[] = [];
      play.mockImplementation(() => {
        playedInsideClick.push(insideClick);
        return Promise.resolve();
      });

      await act(async () => {
        insideClick = true;
        button(copy.start)!.click();
        insideClick = false;
      });
      await settle();

      // That play is what WebKit grants the element on.
      expect(playedInsideClick[0]).toBe(true);
      expect(pausedFor()).toBeNull();
    });

    it("pauses the story when the next clip's play is refused", async () => {
      await startFilm(twoClipFilm(), ["/a.mp4"]);
      expect(pausedFor()).toBeNull();

      refuseWith = domException("NotAllowedError");
      await fire("/a.mp4", "onEnd");
      await fire("/b.mp4", "onCanPlay");

      // The cut put a new clip on the element, and its registration played it.
      expect(container.querySelector('[data-video-source="/b.mp4"]')).not.toBeNull();
      expectRefusedPause();
    });

    it("pauses the story when its own play command is refused", async () => {
      const runtime = film({
        assets: [videoAsset("asset.a", "/a.mp4")],
        capabilities: ["input.tap", "spatial.anchor"],
        inputActions: [
          { actionId: "input.hold", label: localized("Hold it"), required: false },
          { actionId: "input.go", label: localized("Go on"), required: false },
        ],
        nodes: [
          {
            ...videoScene("scene.a", "asset.a", [finish]),
            anchors: [viewportAnchor("anchor.hold", 0.1), viewportAnchor("anchor.go", 0.6)],
            gestures: [
              {
                gestureId: "gesture.hold",
                kind: "tap",
                anchorId: "anchor.hold",
                inputActionId: "input.hold",
                maxDurationMs: 500,
              },
              {
                gestureId: "gesture.go",
                kind: "tap",
                anchorId: "anchor.go",
                inputActionId: "input.go",
                maxDurationMs: 500,
              },
            ],
            eventBindings: [
              mediaEnded("video.scene.a", [finish]),
              on("gesture.completed", "gesture.hold", [
                {
                  kind: "renderer.command",
                  instanceId: "video.scene.a",
                  commandType: "pause",
                  payload: {},
                },
              ]),
              on("gesture.completed", "gesture.go", [
                {
                  kind: "renderer.command",
                  instanceId: "video.scene.a",
                  commandType: "play",
                  payload: {},
                },
              ]),
            ],
          } as unknown as Node,
        ],
      });
      await startFilm(runtime, ["/a.mp4"]);
      // Gestures route once the scene clock has started.
      await playedTo("/a.mp4", 0.1);
      const tap = async (label: string) => {
        const target = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
        if (!target) throw new Error(`No ${label} control.`);
        await act(async () => {
          target.click();
        });
        await settle();
      };

      await tap("Hold it");
      expect(pausedFor()).toBeNull();
      refuseWith = domException("NotAllowedError");
      await tap("Go on");

      expectRefusedPause();
    });

    it("pauses the story when a charge gate lifts onto a refused play, and drops the press", async () => {
      const runtime = film({
        assets: [videoAsset("asset.a", "/a.mp4")],
        capabilities: ["input.press-hold", "spatial.anchor"],
        inputActions: [{ actionId: "input.charge", label: localized("Charge"), required: true }],
        nodes: [
          {
            ...videoScene("scene.a", "asset.a", [finish]),
            anchors: [viewportAnchor("anchor.charge", 0.4)],
            gestures: [
              {
                gestureId: "gesture.charge",
                kind: "press-hold",
                anchorId: "anchor.charge",
                inputActionId: "input.charge",
                durationMs: 1_000,
                releaseBehavior: "reset",
                cancelOnPointerExit: true,
                timelineControl: true,
                activeWindow: { startMs: 0, endMs: 3_000 },
                branchAtMs: 500,
              },
            ],
            eventBindings: [
              mediaEnded("video.scene.a", [finish]),
              on("gesture.completed", "gesture.charge", [goto("scene.cleared")]),
              on("gesture.cancelled", "gesture.charge", [goto("scene.failed")]),
              on("gesture.timed-out", "gesture.charge", [goto("scene.failed")]),
            ],
          } as unknown as Node,
          textScene("scene.cleared", "cleared"),
          textScene("scene.failed", "failed"),
        ],
      });
      await startFilm(runtime, ["/a.mp4"]);
      // Past the branch frame, so a press that was judged would route at once.
      await playedTo("/a.mp4", 0.6);
      const hotspot = container.querySelector<HTMLButtonElement>('button[aria-label="Charge"]')!;
      const layer = hotspot.closest(".pointer-events-none.absolute.inset-0");
      const pointer = (type: string) => {
        const event = new MouseEvent(type, { bubbles: true, button: 0 });
        Object.defineProperty(event, "pointerId", { value: 1 });
        return event;
      };
      expect(hotspot.getAttribute("aria-pressed")).toBe("false");

      // The press lifts the gate, and the clip's play is refused.
      refuseWith = domException("NotAllowedError");
      await act(async () => {
        hotspot.dispatchEvent(pointer("pointerdown"));
      });
      await settle();

      expectRefusedPause();
      // A pause is not a release: the press is dropped, its gate back over the
      // clip, and neither branch taken.
      expect(hotspot.getAttribute("aria-pressed")).toBe("false");
      await act(async () => {
        hotspot.dispatchEvent(pointer("pointerup"));
        hotspot.dispatchEvent(pointer("lostpointercapture"));
        hotspot.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      });
      await settle();
      expect(container.textContent).not.toContain("cleared");
      expect(container.textContent).not.toContain("failed");
      // The layer stays as it was: the gestures it has settled stay settled.
      expect(container.querySelector('button[aria-label="Charge"]')).toBe(hotspot);
      expect(hotspot.closest(".pointer-events-none.absolute.inset-0")).toBe(layer);
    });

    it("stays silent about an interrupted play, and pauses for nothing", async () => {
      refuseWith = domException("AbortError");
      await startFilm(twoClipFilm(), ["/a.mp4"]);

      expect(container.querySelector('[role="alertdialog"]')).toBeNull();
      expect(pausedFor()).toBeNull();
    });

    it("still shows a real playback failure, verbatim", async () => {
      refuseWith = domException("NotSupportedError", "The element has no supported sources.");
      await startFilm(twoClipFilm(), ["/a.mp4"]);

      expect(container.querySelector('[role="alertdialog"]')).not.toBeNull();
      expect(container.textContent).toContain("The element has no supported sources.");
      expect(pausedFor()).toBeNull();
    });
  });

  describe("a world stream", () => {
    const worldFilm = () =>
      film({
        capabilities: ["core.world-model"],
        nodes: [
          {
            kind: "scene",
            sceneId: "scene.world",
            clock: { kind: "none" },
            renderers: [
              {
                instanceId: "world.primary",
                rendererId: "core.world-model",
                layer: 0,
                config: {
                  projectId: "0197f4a2-0800-7000-8000-000000000001",
                  worldId: "0197f4a2-0800-7000-8000-000000000002",
                  maxExperienceSeconds: 90,
                  autoplay: true,
                },
                bindings: {},
              },
            ],
            anchors: [],
            gestures: [],
            timeline: { cues: [] },
            eventBindings: [on("renderer.outcome", "world.primary", [finish], "world-completed")],
          } as unknown as Node,
        ],
      });

    const reportFromWorld = async (error: unknown) => {
      await startFilm(worldFilm(), [], {
        renderWorldModel: ({ onError }) => (
          <button type="button" data-world-error="" onClick={() => onError(error)}>
            world
          </button>
        ),
      });
      await act(async () => {
        container.querySelector<HTMLButtonElement>("[data-world-error]")!.click();
      });
      await settle();
    };

    it("pauses the story when its element will not play without a tap", async () => {
      await reportFromWorld(domException("NotAllowedError"));
      expectRefusedPause();
    });

    it("shows any other failure of the stream verbatim", async () => {
      await reportFromWorld(new Error("The world session expired."));
      expect(container.querySelector('[role="alertdialog"]')).not.toBeNull();
      expect(container.textContent).toContain("The world session expired.");
    });
  });

  describe("Web Audio", () => {
    const DURATION_MS = 6_000;
    let frames: Array<() => void>;
    let nowMs: number;
    let resumes: number;
    let suspends: number;
    let resumeRefusal: Error | null;

    beforeEach(() => {
      frames = [];
      nowMs = 0;
      resumes = 0;
      suspends = 0;
      resumeRefusal = null;
      vi.spyOn(performance, "now").mockImplementation(() => nowMs);
      vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
        frames.push(() => callback(nowMs));
        return frames.length;
      });
      vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
      const gainNode = () => ({
        gain: {
          value: 1,
          setValueAtTime() {},
          linearRampToValueAtTime() {},
          cancelScheduledValues() {},
        },
        connect() {},
        disconnect() {},
      });
      vi.stubGlobal(
        "AudioContext",
        class {
          state = "suspended";
          destination = {};
          currentTime = 0;
          createGain = gainNode;
          resume = () => {
            resumes += 1;
            if (resumeRefusal) return Promise.reject(resumeRefusal);
            this.state = "running";
            return Promise.resolve();
          };
          suspend = () => {
            suspends += 1;
            this.state = "suspended";
            return Promise.resolve();
          };
          close = () => Promise.resolve();
        }
      );
    });

    const runFrames = async () => {
      const pending = frames;
      frames = [];
      await act(async () => {
        pending.forEach((frame) => frame());
      });
    };

    /** A text beat on the fixed clock, then the next scene; with a sound graph. */
    const timedFilm = (after: Node, capabilities: string[] = []) =>
      film({
        capabilities,
        audio: { buses: [{ busId: "master", role: "master" }] },
        nodes: [
          textScene("scene.beat", "beat", {
            clock: { kind: "fixed", durationMs: DURATION_MS },
            eventBindings: [on("scene.clock-ended", undefined, [goto(after.sceneId)])],
          }),
          after,
        ],
      });

    it("pauses the story when it will not start without a tap, and freezes the clock", async () => {
      resumeRefusal = domException("NotAllowedError");
      await startFilm(timedFilm(textScene("scene.after", "after")), []);

      expectRefusedPause();
      // Story time stands still: the beat does not end behind the pause.
      nowMs = DURATION_MS * 2;
      await runFrames();
      await runFrames();
      expect(container.textContent).toContain("beat");
      expect(container.textContent).not.toContain("after");
    });

    it("is suspended with the story when a clip is stopped from outside", async () => {
      const runtime = twoClipFilm();
      runtime.compatibility.requiredCapabilities.push("audio.core");
      runtime.audio = {
        buses: [{ busId: "master", role: "master", defaultGain: 1, defaultMuted: false }],
        cues: [],
        snapshots: [],
        duckingRules: [],
      };
      await startFilm(runtime, ["/a.mp4"]);
      await fire("/a.mp4", "onPlaying");
      expect(resumes).toBe(1);
      expect(suspends).toBe(0);

      Object.defineProperty(element("/a.mp4"), "paused", { value: true, configurable: true });
      await fire("/a.mp4", "onPause");

      expect(pausedFor()).toBe("user");
      expect(suspends).toBe(1);
    });

    it("comes back after an access flow, which suspends it for the dialog", async () => {
      let owned = false;
      const requirement = {
        key: "node:scene.after",
        communityPointPrice: 20,
        title: localized("After"),
      };
      const runtime = timedFilm(textScene("scene.after", "after", { access: requirement }), [
        "commerce.community-points",
      ]);
      await startFilm(runtime, [], {
        access: {
          canAccess: () => owned,
          requestAccess: async () => {
            owned = true;
            return true;
          },
          formatPrice: (amount) => `${amount} points`,
        },
      });
      expect(resumes).toBe(1);

      nowMs = DURATION_MS;
      await runFrames();
      await settle();

      expect(container.textContent).toContain("after");
      // Resumed when the flow ended — not left suspended for the rest of the film.
      expect(resumes).toBe(2);
      expect(pausedFor()).toBeNull();
    });
  });

  // ── Pauses from outside ───────────────────────────────────────────────────

  describe("a clip stopped from outside", () => {
    /** The element paused short of its end, and its `pause` delivered. */
    const stopFromOutside = async (uri: string) => {
      Object.defineProperty(element(uri), "paused", { value: true, configurable: true });
      await fire(uri, "onPause");
    };

    it("pauses the story with it", async () => {
      await startFilm(twoClipFilm(), ["/a.mp4"]);
      await fire("/a.mp4", "onPlaying");

      await stopFromOutside("/a.mp4");

      expect(pausedFor()).toBe("user");
      expect(storyLayer().hasAttribute("inert")).toBe(true);
      expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    });

    it("pauses it as hidden when the page is", async () => {
      await startFilm(twoClipFilm(), ["/a.mp4"]);
      await fire("/a.mp4", "onPlaying");
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });

      await stopFromOutside("/a.mp4");

      expect(pausedFor()).toBe("hidden");
    });

    it("does not take the pause iOS makes when the player starts another clip for one", async () => {
      const runtime = film({
        assets: [videoAsset("asset.main", "/main.mp4"), videoAsset("asset.side", "/side.mp4")],
        nodes: [
          {
            ...videoScene("scene.a", "asset.main", [finish]),
            renderers: [
              videoRenderer("video.scene.a", "asset.main"),
              videoRenderer("video.side", "asset.side", 1),
            ],
          } as unknown as Node,
        ],
      });
      await startFilm(runtime, ["/main.mp4", "/side.mp4"]);
      await fire("/main.mp4", "onPlaying");
      await fire("/side.mp4", "onPlaying");

      // One audible element at a time: the side clip playing paused the main one.
      Object.defineProperty(element("/side.mp4"), "paused", { value: false, configurable: true });
      await stopFromOutside("/main.mp4");
      expect(pausedFor()).toBeNull();

      // A system interruption stops them all.
      await stopFromOutside("/side.mp4");
      expect(pausedFor()).toBe("user");
    });

    it("holds an outcome that lands during the pause until the story resumes", async () => {
      await startFilm(twoClipFilm(), ["/a.mp4"]);
      await fire("/a.mp4", "onPlaying");
      await stopFromOutside("/a.mp4");

      // An `ended` the element had already queued.
      await fire("/a.mp4", "onEnd");

      expect(container.querySelector('[data-video-source="/b.mp4"]')).toBeNull();
      expect(pausedFor()).toBe("user");
    });
  });

  // ── Gates ─────────────────────────────────────────────────────────────────

  it("does not play the ended clip again when a paid choice is declined", async () => {
    const choice = {
      instanceId: "choice.a",
      rendererId: "core.choice",
      layer: 100,
      bindings: {},
      config: {
        decisionId: "decision.a",
        initiallyOpen: false,
        choices: [{ choiceId: "next", label: localized("Next scene") }],
      },
    };
    const runtime = film({
      assets: [videoAsset("asset.a", "/a.mp4"), videoAsset("asset.b", "/b.mp4")],
      capabilities: ["core.choice", "commerce.community-points"],
      nodes: [
        {
          ...videoScene("scene.a", "asset.a", [
            { kind: "renderer.command", instanceId: "choice.a", commandType: "open", payload: {} },
          ]),
          renderers: [videoRenderer("video.scene.a", "asset.a"), choice],
          eventBindings: [
            mediaEnded("video.scene.a", [
              {
                kind: "renderer.command",
                instanceId: "choice.a",
                commandType: "open",
                payload: {},
              },
            ]),
            {
              bindingId: "choice.next",
              on: {
                type: "renderer.outcome",
                sourceId: "choice.a",
                qualifierId: "choice-selected",
              },
              routes: [
                {
                  routeId: "next",
                  access: {
                    key: "route:next",
                    communityPointPrice: 20,
                    title: localized("Next scene"),
                  },
                  actions: [goto("scene.b")],
                },
              ],
            },
          ],
        } as unknown as Node,
        videoScene("scene.b", "asset.b", [finish]),
      ],
    });
    const requestAccess = vi.fn(async () => false);
    await startFilm(runtime, ["/a.mp4"], {
      access: {
        canAccess: () => false,
        requestAccess,
        formatPrice: (amount) => `${amount} points`,
      },
    });
    Object.defineProperty(element("/a.mp4"), "ended", { value: true, configurable: true });
    await fire("/a.mp4", "onEnd");
    const option = [...container.querySelectorAll("button span")]
      .find((item) => item.textContent === "Next scene")
      ?.closest("button");
    if (!option) throw new Error("The choice never opened.");
    play.mockClear();

    await act(async () => {
      option.click();
    });
    await settle();

    expect(requestAccess).toHaveBeenCalledOnce();
    // The access hold lifted, and the clip under the choice had ended: playing
    // it again would start it over behind the decision.
    expect(play).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  });
});
