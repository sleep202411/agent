// @vitest-environment jsdom

import { act, StrictMode, useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import {
  ExperienceRuntimeManifestSchema,
  type ExperienceRuntimeManifest,
  type ExperienceThemeConfig,
} from "@repo/shared/experience-runtime";
import {
  ExperiencePlayer,
  type ExperiencePlayerProps,
  type ExperienceWorldModelRendererProps,
} from "./experience-player";
import type { ExperiencePlayerCopy } from "./experience-player-copy";
import type {
  ExperiencePlayerUI,
  ExperienceStartUIProps,
  ExperienceChoicesUIProps,
  ExperiencePauseUIProps,
  ExperiencePlaybackUIProps,
} from "./experience-ui";
import { journeyMapTestCopy } from "./experience-journey-test-copy";
import { ExperienceDefaultMainMenuUI } from "./experience-main-menu";
import type { GameSession } from "@repo/game-sdk";

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
  };
});

vi.mock("./experience-media-warm", () => ({ warmExperienceMedia: vi.fn(() => Promise.resolve()) }));

const HASH = "a".repeat(64);

const copy = {
  journeyMap: journeyMapTestCopy,
  invalidManifest: "Invalid manifest",
  manifestRoot: "Manifest",
  interactiveFilm: "Interactive film",
  starting: "Starting",
  start: "Start",
  mainMenu: "Main menu",
  returnToMenu: "Return to main menu",
  continueGame: "Continue game",
  codeMenu: { failed: "Custom menu failed", retry: "Retry", restore: "Use default menu" },
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
  video: { unmute: "Unmute" },
  playback: {
    transport: {
      controlsLabel: "Playback controls",
      rewind10: "Back 10 seconds",
      forward10: "Forward 10 seconds",
      progressLabel: "Clip progress",
      speedLabel: "Playback speed",
      watchedOnlyHint: "You can seek only within footage you have watched.",
      interactionBlocked: "Playback controls are unavailable during an interaction.",
    },
    pause: "Pause",
    resume: "Resume",
    paused: "Paused",
    continuePlaying: "Tap to continue",
    interrupted: "This device needs a tap to keep playing.",
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
    outcomes: [{ outcomeType: "text-completed" }],
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

/** A text beat timed by the fixed scene clock, then `after`. */
function beatFilm(durationMs = 6_000, after = textScene("scene.after", "after")) {
  return film({
    nodes: [
      textScene("scene.beat", "beat", {
        clock: { kind: "fixed", durationMs },
        eventBindings: [on("scene.clock-ended", undefined, [goto(after.sceneId)])],
      }),
      after,
    ],
  });
}

/** A text scene that waits for its Continue: nothing in it runs on time. */
function silentFilm() {
  return film({
    nodes: [
      {
        kind: "scene",
        sceneId: "scene.read",
        clock: { kind: "none" },
        renderers: [
          {
            instanceId: "text.read",
            rendererId: "core.text",
            layer: 0,
            config: { body: localized("Read at leisure"), completion: "continue" },
            bindings: {},
          },
        ],
        anchors: [],
        gestures: [],
        timeline: { cues: [] },
        eventBindings: [on("renderer.outcome", "text.read", [finish], "text-completed")],
      } as unknown as Node,
    ],
  });
}

/** A world stream scene, holding one live element the host renders. */
function worldStreamFilm() {
  return film({
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
}

/** A clip with its choice already open over it. */
function choiceFilm() {
  const choice = {
    instanceId: "choice.a",
    rendererId: "core.choice",
    layer: 100,
    bindings: {},
    config: {
      decisionId: "decision.a",
      initiallyOpen: true,
      choices: [{ choiceId: "next", label: localized("Next scene") }],
    },
  };
  return film({
    assets: [videoAsset("asset.a", "/a.mp4")],
    capabilities: ["core.choice"],
    nodes: [
      {
        ...videoScene("scene.a", "asset.a", [finish]),
        renderers: [videoRenderer("video.scene.a", "asset.a"), choice],
        eventBindings: [
          mediaEnded("video.scene.a", [finish]),
          on("renderer.outcome", "choice.a", [finish], "choice-selected"),
        ],
      } as unknown as Node,
    ],
  });
}

/** A clip with one hotspot over it: a tap, or a press-hold that charges the clip or not. */
function gestureFilm(gesture: "tap" | "hold" | "charge") {
  const label = { tap: "Go on", hold: "Hold", charge: "Charge" }[gesture];
  const shape =
    gesture === "tap"
      ? { kind: "tap", maxDurationMs: 500 }
      : {
          kind: "press-hold",
          durationMs: 1_000,
          releaseBehavior: "reset",
          cancelOnPointerExit: true,
          activeWindow: { startMs: 0, endMs: 3_000 },
          branchAtMs: 500,
          ...(gesture === "charge" ? { timelineControl: true } : {}),
        };
  return film({
    assets: [videoAsset("asset.a", "/a.mp4")],
    capabilities: [gesture === "tap" ? "input.tap" : "input.press-hold", "spatial.anchor"],
    inputActions: [{ actionId: "input.act", label: localized(label), required: true }],
    nodes: [
      {
        ...videoScene("scene.a", "asset.a", [finish]),
        anchors: [viewportAnchor("anchor.act", 0.4)],
        gestures: [
          {
            gestureId: "gesture.act",
            anchorId: "anchor.act",
            inputActionId: "input.act",
            ...shape,
          },
        ],
        eventBindings: [
          mediaEnded("video.scene.a", [finish]),
          on("gesture.completed", "gesture.act", [goto("scene.cleared")]),
          on("gesture.cancelled", "gesture.act", [goto("scene.failed")]),
          on("gesture.timed-out", "gesture.act", [goto("scene.failed")]),
        ],
      } as unknown as Node,
      textScene("scene.cleared", "cleared"),
      textScene("scene.failed", "failed"),
    ],
  });
}

/** A rect in screen pixels, as `getBoundingClientRect` reports it. */
function box(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}

/** A pointer event jsdom can dispatch: it has no PointerEvent constructor. */
function pointer(type: string) {
  const event = new MouseEvent(type, { bubbles: true, button: 0 });
  Object.defineProperty(event, "pointerId", { value: 1 });
  return event;
}

/** A world renderer that hands its element over, and records the hold it was given. */
function StreamDouble({
  paused,
  onMediaElement,
  held,
}: ExperienceWorldModelRendererProps & { held: boolean[] }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    onMediaElement(ref.current);
    return () => onMediaElement(null);
  }, [onMediaElement]);
  useEffect(() => {
    held.push(paused);
  }, [held, paused]);
  return <video ref={ref} data-world-stream="" />;
}

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
    Reflect.deleteProperty(navigator, "mediaSession");
    Reflect.deleteProperty(window.screen, "width");
    Reflect.deleteProperty(window.screen, "height");
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
        if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0);
        else await new Promise((resolve) => setTimeout(resolve, 0));
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

  it("opens the map from home without starting the game or spending story time, then restores focus", async () => {
    const onStateChange = vi.fn();
    await render(choiceFilm(), { onStateChange });
    await fire("/a.mp4", "onCanPlay");
    const initial = structuredClone(onStateChange.mock.lastCall?.[0]);
    const primary = button(copy.start)!;
    expect(container.querySelector('[data-experience-screen="menu"]')).not.toBeNull();
    expect(
      container.querySelector("[data-experience-landscape-viewport]")?.hasAttribute("inert")
    ).toBe(true);
    const map = button(copy.journeyMap.open)!;
    await act(async () => {
      map.focus();
      map.click();
    });
    await settle();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(onStateChange.mock.lastCall?.[0]).toEqual(initial);
    expect(play).not.toHaveBeenCalled();
    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>(`button[aria-label="${copy.journeyMap.close}"]`)!
        .click();
    });
    await settle();
    expect(document.activeElement).toBe(map);
    expect(primary.disabled).toBe(false);
    expect(container.querySelector('[data-experience-screen="menu"]')).not.toBeNull();
  });

  it("returns to a fixed home screen and continues the same run, media element, and position", async () => {
    const onStateChange = vi.fn();
    const onCheckpoint = vi.fn();
    await startFilm(twoClipFilm(), ["/a.mp4"], { onStateChange, onCheckpoint });
    await fire("/a.mp4", "onPlaying");
    await playedTo("/a.mp4", 0.5);
    const media = element("/a.mp4");
    const state = structuredClone(onStateChange.mock.lastCall?.[0]);
    await act(async () => {
      button(copy.mainMenu)!.click();
    });
    await settle();
    expect(container.querySelector("[data-experience-main-menu]")).not.toBeNull();
    expect(container.querySelector("[data-experience-paused-frame]")).toBeNull();
    expect(element("/a.mp4")).toBe(media);
    expect(media.paused).toBe(true);
    expect(onStateChange.mock.lastCall?.[0]).toEqual(state);
    expect(onCheckpoint.mock.lastCall?.[0].playback.sceneTimeMs).toBe(500);
    const continueButton = button(copy.continueGame)!;
    expect(document.activeElement).toBe(continueButton);
    play.mockClear();
    await act(async () => {
      continueButton.click();
    });
    await settle();
    expect(container.querySelector('[data-experience-screen="game"]')).not.toBeNull();
    expect(container.querySelector("[data-experience-main-menu]")).toBeNull();
    expect(element("/a.mp4")).toBe(media);
    expect(onStateChange.mock.lastCall?.[0]).toEqual(state);
    expect(play).toHaveBeenCalled();
  });

  it("gives custom home screens bounded actions and revokes sessions after unmounting", async () => {
    let session!: GameSession;
    const ui: ExperiencePlayerUI = {
      apiVersion: 1,
      mainMenu: (props) => {
        session = props.session;
        return <ExperienceDefaultMainMenuUI {...props} />;
      },
    };
    await render(choiceFilm(), { ui });
    expect(await session.invoke("continue")).toEqual({ ok: false, reason: "unavailable" });
    await fire("/a.mp4", "onCanPlay");
    const oldSession = session;
    await act(async () => {
      await session.invoke("start");
    });
    await settle();
    await act(async () => {
      await oldSession.invoke("return-menu");
    });
    await settle();
    expect(session).toBe(oldSession);
    await act(async () => {
      root.unmount();
    });
    expect(await oldSession.invoke("open-map")).toEqual({ ok: false, reason: "disposed" });
    // Restore a root so the shared afterEach still owns a mounted React root.
    root = createRoot(container);
  });

  it("keeps a live SDK through StrictMode replay and gives an explicit new game a fresh session", async () => {
    let session!: GameSession;
    const ui: ExperiencePlayerUI = {
      apiVersion: 1,
      mainMenu: (props) => {
        session = props.session;
        return <ExperienceDefaultMainMenuUI {...props} />;
      },
    };
    const runtime = choiceFilm();
    const loadTheme = () => Promise.resolve(theme);
    await act(async () => {
      root.render(
        <StrictMode>
          <ExperiencePlayer
            runtime={runtime}
            locale="en-US"
            copy={copy}
            ui={ui}
            loadTheme={loadTheme}
          />
        </StrictMode>
      );
    });
    await fire("/a.mp4", "onCanPlay");
    const first = session;
    await act(async () => {
      expect(await first.invoke("start")).toEqual({ ok: true });
    });
    await settle();
    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-experience-choice]")!.click();
    });
    await settle();
    expect(first.getSnapshot().status).toBe("completed");
    await act(async () => {
      expect(await first.invoke("return-menu")).toEqual({ ok: true });
    });
    await settle();
    expect(button(copy.continueGame)).toBeUndefined();
    expect(button(copy.playAgain)).toBeDefined();
    await act(async () => {
      expect(await first.invoke("restart")).toEqual({ ok: true });
    });
    await settle();
    expect(session).not.toBe(first);
    expect(await first.invoke("open-map")).toEqual({ ok: false, reason: "disposed" });
    expect(session.getSnapshot().started).toBe(false);
  });

  it("renders frozen themes and live authoring overrides through the same player without resetting playback", async () => {
    const runtime = choiceFilm();
    runtime.appearance = {
      version: 1,
      presentation: {
        copy: { start: { "en-US": "Enter" } },
        theme: {
          version: 1,
          name: "Gold",
          css: '[data-experience-ui-region="start"] [data-ui-part="primary"] { color: #d6b77a; }',
          assets: [],
        },
      },
    };
    await render(runtime);
    await fire("/a.mp4", "onCanPlay");
    expect(button("Enter")).toBeDefined();
    expect(container.querySelector('[data-theme-package="true"] style')?.textContent).toContain(
      "#d6b77a"
    );
    await act(async () => button("Enter")!.click());
    await settle();
    await playedTo("/a.mp4", 1);
    const media = element("/a.mp4");
    const pause = container.querySelector<HTMLButtonElement>(
      `button[aria-label="${copy.playback.pause}"]`
    )!;
    await act(async () => pause.click());
    await settle();
    const checkpointBefore = container.querySelector('input[type="range"]')?.getAttribute("value");
    const appearance = {
      ...runtime.appearance,
      presentation: {
        ...runtime.appearance.presentation,
        theme: {
          version: 1 as const,
          name: "Silver",
          css: '[data-experience-ui-region="start"] [data-ui-part="primary"] { color: #dddddd; }[data-experience-ui-region="choices"] [data-ui-part="list"]{flex-direction:row}',
          assets: [],
        },
      },
    };
    await render(runtime, { ui: { apiVersion: 1, appearance } });
    expect(element("/a.mp4")).toBe(media);
    expect(container.querySelector('[data-theme-package="true"] style')?.textContent).toContain(
      "#ddd"
    );
    expect(container.querySelector("style")?.textContent).toContain("flex-direction:row");
    expect(container.querySelector('input[type="range"]')?.getAttribute("value")).toBe(
      checkpointBefore
    );
    expect(pausedFor()).not.toBeNull();
    expect(button(copy.restart)).toBeDefined();
  });

  it("exposes the native controls body and inputs beneath the shared playback region", async () => {
    await startFilm(choiceFilm(), ["/a.mp4"]);
    await playedTo("/a.mp4", 1);
    for (const part of ["controls", "progress", "pause", "rate"]) {
      expect(
        container.querySelector(`[data-experience-ui-region="playback"] [data-ui-part="${part}"]`)
      ).not.toBeNull();
    }
  });

  it("routes all four UI slots through live runtime guards and preserves media when renderers update", async () => {
    let startView!: ExperienceStartUIProps;
    let choicesView!: ExperienceChoicesUIProps;
    let playbackView!: ExperiencePlaybackUIProps;
    let pauseView!: ExperiencePauseUIProps;
    const ui: ExperiencePlayerUI = {
      apiVersion: 1,
      copy: { start: { "en-US": "Enter story" } },
      start: (props) => {
        startView = props;
        return <button onClick={props.onStart}>{props.actionLabel}</button>;
      },
      choices: (props) => {
        choicesView = props;
        return <button onClick={() => props.onChoose(props.choices[0]!.id)}>Custom choice</button>;
      },
      playback: (props) => {
        playbackView = props;
        return <button onClick={props.onTogglePause}>Custom pause</button>;
      },
      pause: (props) => {
        pauseView = props;
        return (
          <button ref={props.resumeRef} onClick={props.onResume}>
            Custom resume
          </button>
        );
      },
    };
    const reporter = {
      onStart: vi.fn(async () => ({ sessionId: "custom-ui" })),
      onProgress: vi.fn(async () => {}),
      onComplete: vi.fn(async () => {}),
    };
    const runtime = choiceFilm();
    let resolveTheme!: (value: ExperienceThemeConfig) => void;
    const pendingTheme = new Promise<ExperienceThemeConfig>((resolve) => {
      resolveTheme = resolve;
    });
    const extra = { ui, playSessionReporter: reporter, loadTheme: () => pendingTheme };
    await render(runtime, extra);
    expect(startView.state).toBe("loading");
    expect(startView.actionLabel).toBe(copy.loadingMedia);
    await act(async () => startView.onStart());
    expect(reporter.onStart).not.toHaveBeenCalled();
    await act(async () => resolveTheme(theme));
    await fire("/a.mp4", "onCanPlay");
    expect(startView.actionLabel).toBe("Enter story");
    await act(async () => {
      startView.onStart();
      startView.onStart();
    });
    await settle();
    expect(reporter.onStart).toHaveBeenCalledTimes(1);
    await playedTo("/a.mp4", 1);
    const video = element("/a.mp4");
    const oldChoose = choicesView.onChoose;
    const oldPlayback = playbackView;
    await act(async () => {
      playbackView.onRate(3);
      playbackView.onSeek(Number.NaN);
    });
    expect(video.currentTime).toBe(0);
    expect(playbackView.rate).toBe(1);
    await act(async () => oldChoose("unknown"));
    expect(reporter.onComplete).not.toHaveBeenCalled();
    await act(async () => playbackView.onTogglePause());
    const oldRestart = pauseView.onRestart;
    await act(async () => oldChoose("next"));
    expect(reporter.onComplete).not.toHaveBeenCalled();
    expect(choicesView.disabled).toBe(true);
    await act(async () => pauseView.onResume());
    await render(runtime, { ...extra, ui: { ...ui, copy: { start: { "en-US": "Begin" } } } });
    await act(async () => oldRestart());
    expect(element("/a.mp4")).toBe(video);
    expect(choicesView.disabled).toBe(false);
    await act(async () => choicesView.onChoose("next"));
    await settle();
    expect(reporter.onComplete).toHaveBeenCalledTimes(1);
    const completedTime = video.currentTime;
    const completedRate = video.playbackRate;
    await act(async () => {
      oldPlayback.onSeek(0);
      oldPlayback.onRate(2);
      oldPlayback.onTogglePause();
    });
    expect(video.currentTime).toBe(completedTime);
    expect(video.playbackRate).toBe(completedRate);
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("shows a late report only after the ending completion is saved", async () => {
    let resolveStart!: (value: { sessionId: string }) => void;
    let resolveComplete!: () => void;
    const pendingStart = new Promise<{ sessionId: string }>((resolve) => {
      resolveStart = resolve;
    });
    const pendingComplete = new Promise<void>((resolve) => {
      resolveComplete = resolve;
    });
    const reporter = {
      onStart: vi.fn(() => pendingStart),
      onProgress: vi.fn(async () => {}),
      onComplete: vi.fn(() => pendingComplete),
    };
    const runtime = film({
      nodes: [
        textScene("scene.end", "The end", {
          eventBindings: [on("scene.entered", undefined, [finish])],
        }),
      ],
    });
    await render(runtime, {
      playSessionReporter: reporter,
      endingExtra: (id) => (id ? <div data-report-id={id}>Saved report</div> : null),
    });
    await start();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.querySelector("[data-report-id]")).toBeNull();
    await act(async () => {
      resolveStart({ sessionId: "late-report" });
    });
    await settle();
    expect(reporter.onComplete).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[data-report-id]")).toBeNull();
    await act(async () => {
      resolveComplete();
    });
    await settle();
    expect(container.querySelector("[data-report-id]")?.getAttribute("data-report-id")).toBe(
      "late-report"
    );
  });

  it("keeps a failed report save visible and retries the same session", async () => {
    const reporter = {
      onStart: vi.fn(async () => ({ sessionId: "retry-report" })),
      onProgress: vi.fn(async () => {}),
      onComplete: vi
        .fn()
        .mockRejectedValueOnce(new Error("Report service unavailable"))
        .mockResolvedValueOnce(undefined),
    };
    const runtime = film({
      nodes: [
        textScene("scene.end", "The end", {
          eventBindings: [on("scene.entered", undefined, [finish])],
        }),
      ],
    });
    await render(runtime, {
      copy: { ...copy, retryReport: "Retry saving report" },
      playSessionReporter: reporter,
      endingExtra: (id) => (id ? <div data-report-id={id}>Saved report</div> : null),
    });
    await start();
    expect(container.textContent).toContain("Report service unavailable");
    expect(container.querySelector("[data-report-id]")).toBeNull();
    await act(async () => {
      button("Retry saving report")!.click();
    });
    await settle();
    expect(reporter.onStart).toHaveBeenCalledTimes(1);
    expect(reporter.onComplete).toHaveBeenCalledTimes(2);
    expect(reporter.onComplete.mock.calls[1]?.[0]).toBe("retry-report");
    expect(container.textContent).not.toContain("Report service unavailable");
    expect(container.querySelector("[data-report-id]")?.getAttribute("data-report-id")).toBe(
      "retry-report"
    );
  });

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
    const worldFilm = worldStreamFilm;

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

    it("ignores abandoned world callbacks after replaying the same scene", async () => {
      let stream!: ExperienceWorldModelRendererProps;
      const states = vi.fn<NonNullable<ExperiencePlayerProps["onStateChange"]>>();
      const held: boolean[] = [];
      await startFilm(worldFilm(), [], {
        onStateChange: states,
        renderWorldModel: (props) => {
          stream = props;
          return <StreamDouble {...props} held={held} />;
        },
      });
      const abandoned = { onCompleted: stream.onCompleted, onError: stream.onError };
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>(`button[aria-label="${copy.journeyMap.open}"]`)!
          .click();
      });
      await settle();
      const replay = document.body.querySelector<HTMLButtonElement>(
        '[data-journey-node="scene.world"] button'
      );
      expect(replay).not.toBeNull();
      await act(async () => {
        replay!.click();
      });
      await settle();
      expect(document.body.querySelector('[role="dialog"]')).toBeNull();
      const current = stream;
      expect(current.onCompleted).not.toBe(abandoned.onCompleted);
      expect(states.mock.lastCall?.[0]).toMatchObject({
        currentSceneId: "scene.world",
        status: "active",
      });

      await act(async () => {
        abandoned.onCompleted();
      });
      await settle();
      expect(states.mock.lastCall?.[0]).toMatchObject({
        currentSceneId: "scene.world",
        status: "active",
      });
      expect(document.body.querySelector('[role="dialog"]')).toBeNull();

      await act(async () => {
        abandoned.onError(new Error("Abandoned world stream failed."));
      });
      await settle();
      expect(container.querySelector('[role="alertdialog"]')).toBeNull();
      expect(container.textContent).not.toContain("Abandoned world stream failed.");

      await act(async () => {
        abandoned.onError(domException("NotAllowedError"));
      });
      await settle();
      expect(pausedFor()).toBeNull();

      await act(async () => {
        current.onCompleted();
      });
      await settle();
      expect(states.mock.lastCall?.[0]).toMatchObject({
        currentSceneId: "scene.world",
        status: "completed",
        completedEndingId: "ending.done",
      });
      expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    });

    it("plays the stream's element inside the tap that recovers it, and holds it with the story", async () => {
      const held: boolean[] = [];
      refuseWith = domException("NotAllowedError");
      await startFilm(worldFilm(), [], {
        renderWorldModel: (props) => <StreamDouble {...props} held={held} />,
      });

      // The player played the stream's element itself, and the device refused.
      expectRefusedPause();
      expect(held.at(-1)).toBe(true);

      refuseWith = null;
      const plays = await playsDuring(() => pausedFrame()!.click());

      const stream = container.querySelector<HTMLVideoElement>("[data-world-stream]");
      expect(plays).toContainEqual({ inside: true, element: stream });
      expect(pausedFor()).toBeNull();
      expect(held.at(-1)).toBe(false);
    });

    it("keeps Space for the stream's own moves, while the toggle still pauses it", async () => {
      await startFilm(worldFilm(), [], {
        renderWorldModel: (props) => <StreamDouble {...props} held={[]} />,
      });

      expect((await keySpace(document.body)).defaultPrevented).toBe(false);
      expect(pausedFor()).toBeNull();
      expect(toggle()?.hasAttribute("aria-keyshortcuts")).toBe(false);

      await press(toggle());
      expect(pausedFor()).toBe("user");
    });
  });

  describe("Web Audio", () => {
    const DURATION_MS = 6_000;
    let frames: Array<() => void>;
    let nowMs: number;
    let resumes: number;
    let suspends: number;
    let resumeRefusal: Error | null;
    /** The contexts the player made, as the test browser keeps them. */
    let contexts: { state: AudioContextState }[];
    const audio = () => contexts.at(-1)!;
    /** Resumes waiting on their sound device, which starts when the test says. */
    let waitingOnDevice: Array<() => void>;
    const startDevice = async () => {
      const waiting = waitingOnDevice;
      waitingOnDevice = [];
      await act(async () => {
        waiting.forEach((start) => start());
      });
      await settle();
    };

    beforeEach(() => {
      frames = [];
      nowMs = 0;
      resumes = 0;
      suspends = 0;
      resumeRefusal = null;
      contexts = [];
      waitingOnDevice = [];
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
      // As Chromium has it: a resume runs the context only once its device has
      // started, and reads "suspended" until then; a suspend takes effect at once.
      vi.stubGlobal(
        "AudioContext",
        class {
          state: AudioContextState = "suspended";
          destination = {};
          currentTime = 0;
          createGain = gainNode;
          constructor() {
            contexts.push(this);
          }
          resume = () => {
            resumes += 1;
            if (resumeRefusal) return Promise.reject(resumeRefusal);
            return new Promise<void>((resolve) =>
              waitingOnDevice.push(() => {
                this.state = "running";
                resolve();
              })
            );
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

    /** Two clips back to back, with a sound graph. */
    const soundFilm = () => {
      const runtime = twoClipFilm();
      runtime.compatibility.requiredCapabilities.push("audio.core");
      runtime.audio = {
        buses: [{ busId: "master", role: "master", defaultGain: 1, defaultMuted: false }],
        cues: [],
        snapshots: [],
        duckingRules: [],
      };
      return runtime;
    };

    it("is suspended with a pause, and resumed inside the tap that ends it", async () => {
      await startFilm(soundFilm(), ["/a.mp4"]);
      await startDevice();
      expect(audio().state).toBe("running");

      await keySpace(document.body);
      expect(audio().state).toBe("suspended");

      const before = resumes;
      let resumedInsideTap = 0;
      await act(async () => {
        pausedFrame()!.click();
        resumedInsideTap = resumes - before;
      });
      await startDevice();
      expect(resumedInsideTap).toBe(1);
      expect(audio().state).toBe("running");
      expect(pausedFor()).toBeNull();
    });

    it("stays suspended when the story pauses again while its device is still starting", async () => {
      // A Low Power Mode device: the tap's own play is refused again, in the
      // very tap whose resume has yet to start the sound device.
      refuseWith = domException("NotAllowedError");
      await startFilm(soundFilm(), ["/a.mp4"]);
      expectRefusedPause();
      // Start's own resume, as late: the refusal paused the story first.
      await startDevice();
      expect(audio().state).toBe("suspended");

      await press(pausedFrame());
      expectRefusedPause();
      await startDevice();

      // The resume settled after the pause had asked for the context to hold:
      // the cues stay frozen behind the paused frame.
      expect(audio().state).toBe("suspended");
    });

    it("is suspended with the story when a clip is stopped from outside", async () => {
      await startFilm(soundFilm(), ["/a.mp4"]);
      await startDevice();
      await fire("/a.mp4", "onPlaying");
      expect(audio().state).toBe("running");
      expect(suspends).toBe(0);

      Object.defineProperty(element("/a.mp4"), "paused", { value: true, configurable: true });
      await fire("/a.mp4", "onPause");

      expect(pausedFor()).toBe("user");
      expect(audio().state).toBe("suspended");
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
      let heldForTheDialog: AudioContextState | null = null;
      await startFilm(runtime, [], {
        access: {
          canAccess: () => owned,
          requestAccess: async () => {
            heldForTheDialog = audio().state;
            owned = true;
            return true;
          },
          formatPrice: (amount) => `${amount} points`,
        },
      });
      await startDevice();
      expect(audio().state).toBe("running");

      nowMs = DURATION_MS;
      await runFrames();
      await settle();
      await startDevice();

      expect(container.textContent).toContain("after");
      expect(heldForTheDialog).toBe("suspended");
      // Resumed when the flow ended — not left suspended for the rest of the film.
      expect(audio().state).toBe("running");
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

  it("starts every run of an authoring playtest at the chosen scene", async () => {
    // The entry waits for its Continue, and only then leads to the chosen scene.
    const intro = {
      kind: "scene",
      sceneId: "scene.intro",
      clock: { kind: "none" },
      renderers: [
        {
          instanceId: "text.intro",
          rendererId: "core.text",
          layer: 0,
          config: { body: localized("intro"), completion: "continue" },
          bindings: {},
        },
      ],
      anchors: [],
      gestures: [],
      timeline: { cues: [] },
      eventBindings: [
        on("renderer.outcome", "text.intro", [goto("scene.chosen")], "text-completed"),
      ],
    } as unknown as Node;
    const scenes: string[] = [];
    await render(film({ nodes: [intro, textScene("scene.chosen", "chosen")] }), {
      startSceneId: "scene.chosen",
      onStateChange: (state) => scenes.push(state.currentSceneId),
    });
    await start();
    expect(container.textContent).toContain(copy.endingEyebrow);

    // Play again is a new run, and it starts where the first one did.
    await press(button(copy.playAgain));
    await start();

    expect(container.textContent).toContain(copy.endingEyebrow);
    expect(scenes).toContain("scene.chosen");
    expect(scenes).not.toContain("scene.intro");
  });

  // ── The frame's controls ──────────────────────────────────────────────────

  /** The pause toggle, by the label it carries now. */
  const toggle = () =>
    [
      ...container.querySelectorAll<HTMLButtonElement>("[data-experience-frame-controls] button"),
    ].find(
      (item) =>
        item.getAttribute("aria-label") === copy.playback.pause ||
        item.getAttribute("aria-label") === copy.playback.resume
    );

  const pausedFrame = () =>
    container.querySelector<HTMLButtonElement>("[data-experience-paused-frame]");

  const frameControls = () =>
    container.querySelector<HTMLElement>("[data-experience-frame-controls]");

  const mediaStage = () => {
    const stage = container.querySelector<HTMLElement>("[data-experience-media-stage]");
    if (!stage) throw new Error("The player has no film frame.");
    return stage;
  };

  /** A tap: one click event, inside which the player has to do its unlocking. */
  const press = async (target: HTMLElement | null | undefined) => {
    if (!target) throw new Error("There is nothing to press.");
    await act(async () => {
      target.click();
    });
    await settle();
  };

  /** Each native play() the tap leads to, and whether it ran inside the tap. */
  const playsDuring = async (tap: () => void) => {
    let inside = false;
    const plays: { inside: boolean; element: HTMLMediaElement }[] = [];
    play.mockImplementation(function (this: HTMLMediaElement) {
      plays.push({ inside, element: this });
      return refuseWith ? Promise.reject(refuseWith) : Promise.resolve();
    });
    await act(async () => {
      inside = true;
      tap();
      inside = false;
    });
    await settle();
    return plays;
  };

  const keySpace = async (target: EventTarget, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", {
      key: " ",
      code: "Space",
      bubbles: true,
      cancelable: true,
      ...init,
    });
    await act(async () => {
      target.dispatchEvent(event);
    });
    await settle();
    return event;
  };

  const setPageVisibility = async (state: DocumentVisibilityState) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await settle();
  };

  describe("the story map's two entrances", () => {
    const journeyTrigger = (source: "corner" | "transport") =>
      container.querySelector<HTMLButtonElement>(
        `[data-experience-journey-map-trigger="${source}"]`
      );
    const closeMap = () =>
      document.body.querySelector<HTMLButtonElement>(
        `button[aria-label="${copy.journeyMap.close}"]`
      );

    it.each(["corner", "transport"] as const)(
      "returns focus to the %s entrance and resumes the film after closing",
      async (source) => {
        await startFilm(twoClipFilm(), ["/a.mp4"]);
        await playedTo("/a.mp4", 0.5);
        expect(journeyTrigger("corner")).not.toBeNull();
        expect(journeyTrigger("transport")).not.toBeNull();
        const trigger = journeyTrigger(source)!;
        trigger.focus();
        play.mockClear();
        vi.mocked(HTMLMediaElement.prototype.pause).mockClear();

        await press(trigger);

        expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
        expect(pausedFor()).toBe("user");
        expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
        expect(play).not.toHaveBeenCalled();
        expect(journeyTrigger("corner")).toBeNull();
        expect(journeyTrigger("transport")).toBeNull();

        await press(closeMap());

        expect(document.body.querySelector('[role="dialog"]')).toBeNull();
        expect(pausedFor()).toBeNull();
        expect(play).toHaveBeenCalled();
        expect(journeyTrigger(source)).not.toBeNull();
        expect(document.activeElement).toBe(journeyTrigger(source));
        expect(container.querySelector('[data-video-source="/a.mp4"]')).not.toBeNull();
        expect(container.querySelector('[data-video-source="/b.mp4"]')).toBeNull();
      }
    );

    it.each(["corner", "transport"] as const)(
      "keeps the viewer's pause when the map opened from the %s entrance closes",
      async (source) => {
        await startFilm(twoClipFilm(), ["/a.mp4"]);
        await playedTo("/a.mp4", 0.5);
        await press(mediaStage());
        expect(pausedFor()).toBe("user");
        const trigger = journeyTrigger(source)!;
        expect(trigger).not.toBeNull();
        trigger.focus();
        play.mockClear();

        await press(trigger);
        await press(closeMap());

        expect(document.body.querySelector('[role="dialog"]')).toBeNull();
        expect(pausedFor()).toBe("user");
        expect(play).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(journeyTrigger(source));
        expect(pausedFrame()).not.toBeNull();
      }
    );

    it("falls back to the corner entrance after replay leaves the transport bar behind", async () => {
      const original = choiceFilm().graph.nodes[0]!;
      if (original.kind !== "scene") throw new Error("The choice fixture needs a scene.");
      const runtime = film({
        assets: [videoAsset("asset.a", "/a.mp4")],
        capabilities: ["core.choice"],
        nodes: [
          {
            ...original,
            sceneId: "scene.choice",
            clock: { kind: "none" },
            renderers: original.renderers.filter(
              (renderer) => renderer.rendererId === "core.choice"
            ),
            eventBindings: [
              on("renderer.outcome", "choice.a", [goto("scene.a")], "choice-selected"),
            ],
          },
          videoScene("scene.a", "asset.a", [finish]),
        ],
      });
      let currentSceneId = "";
      await startFilm(runtime, [], {
        onStateChange: (state) => {
          currentSceneId = state.currentSceneId;
        },
      });
      await press(
        container.querySelector<HTMLButtonElement>("[data-experience-choice-overlay] button")
      );
      await fire("/a.mp4", "onCanPlay");
      await playedTo("/a.mp4", 0.5);
      const trigger = journeyTrigger("transport")!;
      expect(trigger).not.toBeNull();
      trigger.focus();
      await press(trigger);

      await press(
        document.body.querySelector<HTMLButtonElement>('[data-journey-node="scene.choice"] button')
      );

      expect(currentSceneId).toBe("scene.choice");
      expect(document.body.querySelector('[role="dialog"]')).toBeNull();
      expect(journeyTrigger("transport")).toBeNull();
      expect(journeyTrigger("corner")).not.toBeNull();
      expect(document.activeElement).toBe(journeyTrigger("corner"));
      expect(
        container.querySelector("[data-experience-choice-overlay] button")?.textContent
      ).toContain("Next scene");
      expect(pausedFor()).toBeNull();
    });
  });

  describe("the frame's controls", () => {
    it("keep no pause toggle over the film itself: its picture pauses", async () => {
      await startFilm(twoClipFilm(), ["/a.mp4"]);

      expect(toggle()).toBeUndefined();
    });

    it("stand over a world stream, outside the story, and pause and resume it", async () => {
      await startFilm(worldStreamFilm(), [], {
        renderWorldModel: (props) => <StreamDouble {...props} held={[]} />,
      });
      const control = toggle();
      expect(control).toBeDefined();
      expect(control!.getAttribute("aria-label")).toBe(copy.playback.pause);
      // Space belongs to the world's own moves, so the toggle claims no shortcut.
      expect(control!.hasAttribute("aria-keyshortcuts")).toBe(false);
      expect(control!.closest("[data-experience-media-stage]")).toBe(mediaStage());
      expect(control!.closest("[data-experience-story-layer]")).toBeNull();

      await press(control);

      expect(pausedFor()).toBe("user");
      expect(toggle()!.getAttribute("aria-label")).toBe(copy.playback.resume);
      expect(pausedFrame()?.getAttribute("aria-label")).toBe(copy.playback.resume);
      expect(mediaStage().querySelector('[role="status"]')?.textContent).toBe(copy.playback.paused);

      // Anywhere on the paused frame: the story under it takes no input.
      await press(pausedFrame());

      expect(pausedFor()).toBeNull();
      expect(pausedFrame()).toBeNull();
      expect(toggle()!.getAttribute("aria-label")).toBe(copy.playback.pause);
      expect(mediaStage().querySelector('[role="status"]')?.textContent).toBe("");
    });

    it("play the clips inside the tap that resumes, before anything is awaited", async () => {
      await startFilm(twoClipFilm(), ["/a.mp4"]);
      await keySpace(document.body);

      const plays = await playsDuring(() => pausedFrame()!.click());

      // That play is what WebKit grants the element on.
      expect(plays[0]).toEqual({ inside: true, element: element("/a.mp4") });
      expect(pausedFor()).toBeNull();
    });

    it("move the story on when they resume a clip in its last frames", async () => {
      await startFilm(twoClipFilm(), ["/a.mp4"]);
      await fire("/a.mp4", "onPlaying");
      await keySpace(document.body);
      // Paused 80 ms from the end of a 5 s clip: Vidstack would start it over.
      const clip = element("/a.mp4");
      Object.defineProperty(clip, "paused", { value: true, configurable: true });
      Object.defineProperty(clip, "currentTime", {
        value: 4.92,
        configurable: true,
        writable: true,
      });

      const plays = await playsDuring(() => pausedFrame()!.click());

      // Not played, and not sought to its end — which Chromium never reports
      // as ended — but ended: the next scene's clip is on the element.
      expect(plays.map((entry) => entry.element)).not.toContain(clip);
      expect(container.querySelector('[data-video-source="/b.mp4"]')).not.toBeNull();
      await fire("/b.mp4", "onCanPlay");
      expect(play.mock.contexts).toContain(element("/b.mp4"));
      expect(pausedFor()).toBeNull();
    });

    it("turn with the frame on an upright phone, where no host chrome reaches", async () => {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        writable: true,
        value: (query: string) => ({
          matches:
            query === "(pointer: coarse) and (hover: none)" || query === "(orientation: portrait)",
          addEventListener: () => {},
          removeEventListener: () => {},
        }),
      });
      Object.defineProperty(window.screen, "width", { configurable: true, value: 390 });
      Object.defineProperty(window.screen, "height", { configurable: true, value: 844 });
      vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue(box(0, 0, 390, 844));
      // Muted playback is allowed, audible is not: the unmute pill turns with
      // the frame as the toggle did, being the control the frame carries.
      play.mockImplementation(function (this: HTMLMediaElement) {
        return this.muted ? Promise.resolve() : Promise.reject(domException("NotAllowedError"));
      });

      await startFilm(twoClipFilm(), ["/a.mp4"]);

      const turned = container.querySelector("[data-experience-frame-rotated]");
      expect(turned).not.toBeNull();
      expect(turned!.contains(button(copy.video.unmute)!)).toBe(true);
      // The frame's top runs down the side of the screen, away from the host's chrome.
      expect(mediaStage().style.getPropertyValue("--experience-chrome-inset-top")).toBe("0px");
    });

    it("know the band above the picture, to clear the host's chrome by what it leaves", async () => {
      // A 16:9 film in a taller shell is letterboxed 90px from the top.
      vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue(box(0, 0, 1280, 900));

      await startFilm(twoClipFilm(), ["/a.mp4"]);

      expect(mediaStage().style.getPropertyValue("--experience-frame-inset-top")).toBe("90px");
      // How far the host's chrome reaches is the host's to say.
      expect(mediaStage().style.getPropertyValue("--experience-chrome-inset-top")).toBe("");
    });

    it("are not offered before Start, nor at the ending", async () => {
      await render(twoClipFilm());
      await fire("/a.mp4", "onCanPlay");
      expect(frameControls()).toBeNull();

      await start();
      expect(frameControls()).not.toBeNull();

      await fire("/a.mp4", "onEnd");
      await fire("/b.mp4", "onCanPlay");
      await fire("/b.mp4", "onEnd");
      expect(container.textContent).toContain(copy.endingEyebrow);
      expect(frameControls()).toBeNull();
    });

    it("are not offered over a failure", async () => {
      refuseWith = domException("NotSupportedError");
      await startFilm(twoClipFilm(), ["/a.mp4"]);

      expect(container.querySelector('[role="alertdialog"]')).not.toBeNull();
      expect(frameControls()).toBeNull();
    });

    it("offer no toggle in a beat with nothing to pause", async () => {
      await startFilm(silentFilm(), []);

      expect(container.textContent).toContain("Read at leisure");
      expect(toggle()).toBeUndefined();
    });

    it("step aside for an interaction under them, and come back over the paused frame", async () => {
      play.mockImplementation(function (this: HTMLMediaElement) {
        return this.muted ? Promise.resolve() : Promise.reject(domException("NotAllowedError"));
      });
      await startFilm(gestureFilm("tap"), ["/a.mp4"]);
      await playedTo("/a.mp4", 0.1);
      const cluster = frameControls()!;
      // Every box in this test sits on every other: the hotspot is under the pill.
      expect(cluster.hasAttribute("data-experience-gesture-covered")).toBe(true);

      await keySpace(document.body);
      // Paused, the story takes no input, so nothing under the controls can be hit.
      expect(cluster.hasAttribute("data-experience-gesture-covered")).toBe(false);
      await press(pausedFrame());
      expect(cluster.hasAttribute("data-experience-gesture-covered")).toBe(true);

      // A hotspot elsewhere in the frame leaves the controls where they are.
      vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (
        this: HTMLElement
      ) {
        if (this.closest("[data-experience-frame-controls]")) return box(1216, 16, 44, 44);
        if (this.hasAttribute("data-experience-gesture-available")) return box(512, 216, 256, 288);
        return box(0, 0, 1280, 720);
      });
      await playedTo("/a.mp4", 0.2);
      expect(cluster.hasAttribute("data-experience-gesture-covered")).toBe(false);
    });
  });

  // ── A refusal, recovered ──────────────────────────────────────────────────

  describe("the paused frame after a refusal", () => {
    it("asks for one tap, says why, and recovers with it, sound included", async () => {
      refuseWith = domException("NotAllowedError");
      await startFilm(twoClipFilm(), ["/a.mp4"]);
      const frame = pausedFrame()!;
      expect(frame.getAttribute("data-experience-paused-frame")).toBe("refused");
      expect(frame.getAttribute("aria-label")).toBe(copy.playback.continuePlaying);
      expect(frame.textContent).toContain(copy.playback.continuePlaying);
      const hint = document.getElementById(frame.getAttribute("aria-describedby") ?? "");
      expect(hint?.textContent).toBe(copy.playback.interrupted);
      // The refusal muted the clip on its way to failing.
      expect(element("/a.mp4").muted).toBe(true);

      // A tap is a user activation: the device plays now.
      refuseWith = null;
      const plays = await playsDuring(() => frame.click());

      expect(plays[0]).toEqual({ inside: true, element: element("/a.mp4") });
      expect(pausedFor()).toBeNull();
      expect(container.querySelector('[role="alertdialog"]')).toBeNull();
      // Sound is not what was refused, so the tap brings it back.
      expect(element("/a.mp4").muted).toBe(false);
    });

    it("leaves sound the viewer left off, off", async () => {
      // Audible playback refused, muted playback allowed: the film plays muted
      // and offers to turn sound on, which the viewer does not take.
      play.mockImplementation(function (this: HTMLMediaElement) {
        return this.muted ? Promise.resolve() : Promise.reject(domException("NotAllowedError"));
      });
      await startFilm(twoClipFilm(), ["/a.mp4"]);
      expect(pausedFor()).toBeNull();
      expect(button(copy.video.unmute)).toBeDefined();

      await keySpace(document.body);
      expect(button(copy.video.unmute)).toBeUndefined();
      let mutedThroughTheTap = false;
      await act(async () => {
        pausedFrame()!.click();
        mutedThroughTheTap = element("/a.mp4").muted;
      });
      await settle();

      // The tap that resumes is no answer to the offer to turn sound on.
      expect(mutedThroughTheTap).toBe(true);
      expect(element("/a.mp4").muted).toBe(true);
      expect(button(copy.video.unmute)).toBeDefined();
    });

    it("takes focus, but never from the host's own UI", async () => {
      refuseWith = domException("NotAllowedError");
      await startFilm(twoClipFilm(), ["/a.mp4"]);
      expect(document.activeElement).toBe(pausedFrame());
      refuseWith = null;
      await press(pausedFrame());
      expect(pausedFor()).toBeNull();

      // The viewer is typing in a host composer when the next cut is refused.
      const composer = document.createElement("textarea");
      document.body.appendChild(composer);
      try {
        composer.focus();
        refuseWith = domException("NotAllowedError");
        await fire("/a.mp4", "onEnd");
        await fire("/b.mp4", "onCanPlay");
        expectRefusedPause();
        expect(document.activeElement).toBe(composer);
      } finally {
        composer.remove();
      }
    });
  });

  /**
   * A mouse click as Chrome, Edge, and Firefox off the Mac make it: the press
   * focuses the button unless the page prevents that, then the click lands.
   */
  const click = async (target: HTMLElement | null | undefined) => {
    if (!target) throw new Error("There is nothing to click.");
    await act(async () => {
      const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
      target.dispatchEvent(down);
      if (!down.defaultPrevented) target.focus();
      target.click();
    });
    await settle();
  };

  it("gives focus back, on resume, to what the pause took it from", async () => {
    await startFilm(beatFilm(), []);
    const article = container.querySelector<HTMLElement>('[data-experience-renderer="core.text"]')!;
    // The text scene takes focus as it opens.
    expect(document.activeElement).toBe(article);

    // The picture's tap takes no focus from a pointer, so the pause still
    // finds it on the text.
    await click(article);
    expect(pausedFor()).toBe("user");
    // `inert` takes focus off the story as it pauses; jsdom leaves that to the test.
    article.blur();
    await click(pausedFrame());

    expect(pausedFor()).toBeNull();
    expect(document.activeElement).toBe(article);
    // So Space scrolls the text again, rather than pausing the film.
    expect((await keySpace(article)).defaultPrevented).toBe(false);
    expect(pausedFor()).toBeNull();
  });

  it("hands the focus the paused frame held to the toggle, rather than dropping it", async () => {
    refuseWith = domException("NotAllowedError");
    await startFilm(worldStreamFilm(), [], {
      renderWorldModel: (props) => <StreamDouble {...props} held={[]} />,
    });
    expect(pausedFor()).toBe("refused");
    expect(document.activeElement).toBe(pausedFrame());
    refuseWith = null;

    // Enter on the focused frame: a click, for a button.
    await press(pausedFrame());

    expect(pausedFor()).toBeNull();
    expect(document.activeElement).toBe(toggle());
  });

  // ── The page and the OS ───────────────────────────────────────────────────

  describe("a page put away", () => {
    it("pauses the film, which stays paused when the page comes back", async () => {
      await startFilm(twoClipFilm(), ["/a.mp4"]);

      await setPageVisibility("hidden");
      expect(pausedFor()).toBe("hidden");
      await setPageVisibility("visible");
      expect(pausedFor()).toBe("hidden");
      expect(pausedFrame()?.getAttribute("aria-label")).toBe(copy.playback.resume);

      // The viewer resumes it, here with Space.
      expect((await keySpace(document.body)).defaultPrevented).toBe(true);
      expect(pausedFor()).toBeNull();
    });

    it("leaves a beat with nothing to lose as it is", async () => {
      await startFilm(silentFilm(), []);
      await setPageVisibility("hidden");
      expect(pausedFor()).toBeNull();
    });

    it("pauses a film whose Start settled while the page was away", async () => {
      await render(twoClipFilm());
      await fire("/a.mp4", "onCanPlay");
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });

      await start();

      expect(pausedFor()).toBe("hidden");
    });

    it("holds a clip that a purchase opens behind a page put away at a beat with nothing to lose", async () => {
      // A decision beat: a choice alone, with no footage, clock or sound.
      const decide = {
        kind: "scene",
        sceneId: "scene.decide",
        clock: { kind: "none" },
        renderers: [
          {
            instanceId: "choice.d",
            rendererId: "core.choice",
            layer: 100,
            bindings: {},
            config: {
              decisionId: "decision.d",
              initiallyOpen: true,
              choices: [{ choiceId: "next", label: localized("Paid way on") }],
            },
          },
        ],
        anchors: [],
        gestures: [],
        timeline: { cues: [] },
        eventBindings: [
          {
            bindingId: "choice.next",
            on: { type: "renderer.outcome", sourceId: "choice.d", qualifierId: "choice-selected" },
            routes: [
              {
                routeId: "next",
                access: {
                  key: "route:next",
                  communityPointPrice: 20,
                  title: localized("Paid way on"),
                },
                actions: [goto("scene.b")],
              },
            ],
          },
        ],
      } as unknown as Node;
      const runtime = film({
        assets: [videoAsset("asset.a", "/a.mp4"), videoAsset("asset.b", "/b.mp4")],
        capabilities: ["core.choice", "commerce.community-points"],
        nodes: [
          videoScene("scene.a", "asset.a", [goto("scene.decide")]),
          decide,
          videoScene("scene.b", "asset.b", [finish]),
        ],
      });
      let owned = false;
      let settlePurchase!: (allowed: boolean) => void;
      await startFilm(runtime, ["/a.mp4"], {
        access: {
          canAccess: () => owned,
          requestAccess: () =>
            new Promise<boolean>((resolve) => {
              settlePurchase = resolve;
            }),
          formatPrice: (amount) => `${amount} points`,
        },
      });
      await fire("/a.mp4", "onEnd");
      const option = [...container.querySelectorAll("button span")]
        .find((item) => item.textContent === "Paid way on")
        ?.closest("button");
      if (!option) throw new Error("The decision never opened.");
      await press(option);

      // Put away while the purchase settles: the beat has nothing to lose.
      await setPageVisibility("hidden");
      expect(pausedFor()).toBeNull();
      owned = true;
      play.mockClear();
      await act(async () => {
        settlePurchase(true);
      });
      await settle();
      await fire("/b.mp4", "onCanPlay");

      // The clip it opens does not play behind the page, and waits for the viewer.
      expect(play.mock.contexts).not.toContain(element("/b.mp4"));
      expect(pausedFor()).toBe("hidden");
      await setPageVisibility("visible");
      await press(pausedFrame());
      expect(play.mock.contexts).toContain(element("/b.mp4"));
      expect(pausedFor()).toBeNull();
    });
  });

  describe("Space", () => {
    it("toggles the film from the page", async () => {
      await startFilm(twoClipFilm(), ["/a.mp4"]);

      expect((await keySpace(document.body)).defaultPrevented).toBe(true);
      expect(pausedFor()).toBe("user");
      await keySpace(document.body);
      expect(pausedFor()).toBeNull();
    });

    it("is left to a focused choice", async () => {
      await startFilm(choiceFilm(), ["/a.mp4"]);
      const option = [...container.querySelectorAll("button span")]
        .find((item) => item.textContent === "Next scene")
        ?.closest("button");
      if (!option) throw new Error("The choice is not open.");
      option.focus();

      expect((await keySpace(option)).defaultPrevented).toBe(false);
      expect(pausedFor()).toBeNull();
    });

    it("is left to a text scene, which scrolls by it", async () => {
      await startFilm(beatFilm(), []);
      const article = container.querySelector<HTMLElement>(
        '[data-experience-renderer="core.text"]'
      )!;

      expect((await keySpace(article)).defaultPrevented).toBe(false);
      expect(pausedFor()).toBeNull();
      // The frame carries no toggle over a film the picture itself pauses.
      expect(toggle()).toBeUndefined();
    });

    it("is not taken with a modifier, on repeat, while composing, or from outside the player", async () => {
      await startFilm(twoClipFilm(), ["/a.mp4"]);
      const presses: KeyboardEventInit[] = [
        { shiftKey: true },
        { ctrlKey: true },
        { altKey: true },
        { metaKey: true },
        { repeat: true },
        { isComposing: true },
      ];
      for (const init of presses) {
        expect((await keySpace(document.body, init)).defaultPrevented).toBe(false);
      }
      const outside = document.createElement("div");
      outside.tabIndex = 0;
      document.body.appendChild(outside);
      try {
        expect((await keySpace(outside)).defaultPrevented).toBe(false);
      } finally {
        outside.remove();
      }

      expect(pausedFor()).toBeNull();
    });
  });

  describe("the OS media controls", () => {
    let handlers: Map<MediaSessionAction, MediaSessionActionHandler | null>;

    beforeEach(() => {
      handlers = new Map();
      Object.defineProperty(navigator, "mediaSession", {
        configurable: true,
        value: {
          setActionHandler: (
            action: MediaSessionAction,
            handler: MediaSessionActionHandler | null
          ) => void handlers.set(action, handler),
        },
      });
    });

    const osPress = async (action: MediaSessionAction) => {
      const handler = handlers.get(action);
      if (!handler) throw new Error(`The OS controls have no ${action}.`);
      await act(async () => {
        handler({ action });
      });
      await settle();
    };

    it("play and pause the story, and never seek it", async () => {
      await startFilm(twoClipFilm(), ["/a.mp4"]);
      for (const seek of ["seekto", "seekforward", "seekbackward"] as const) {
        expect(handlers.get(seek)).toBeNull();
      }

      await osPress("pause");
      expect(pausedFor()).toBe("user");
      await osPress("play");
      expect(pausedFor()).toBeNull();
    });

    it("cannot take back a refusal, which only a tap can", async () => {
      refuseWith = domException("NotAllowedError");
      await startFilm(twoClipFilm(), ["/a.mp4"]);

      await osPress("play");

      expect(pausedFor()).toBe("refused");
    });

    it("are claimed back whenever media is staged, and let go with the player", async () => {
      await startFilm(twoClipFilm(), ["/a.mp4"]);
      // A Vidstack player clears every action as it goes.
      for (const action of ["play", "pause", "seekto", "seekforward", "seekbackward"] as const) {
        handlers.set(action, null);
      }

      await fire("/a.mp4", "onEnd");
      await fire("/b.mp4", "onCanPlay");
      expect(handlers.get("play")).toBeTypeOf("function");
      expect(handlers.get("pause")).toBeTypeOf("function");

      await act(async () => {
        root.render(<></>);
      });
      expect(handlers.get("play")).toBeNull();
      expect(handlers.get("pause")).toBeNull();
    });
  });

  // ── Story time ────────────────────────────────────────────────────────────

  describe("story time through a pause", () => {
    beforeEach(() => {
      // Fake time moves performance.now, timers and frames together.
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    const elapse = async (ms: number) => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    };

    it("freezes a fixed scene clock, which ends after its running time", async () => {
      await startFilm(beatFilm(6_000), []);
      await elapse(2_000);

      await keySpace(document.body);
      await elapse(10_000);
      expect(container.textContent).toContain("beat");
      expect(container.textContent).not.toContain("after");

      await press(pausedFrame());
      await elapse(3_900);
      expect(container.textContent).not.toContain("after");
      await elapse(200);
      expect(container.textContent).toContain("after");
    });

    it("freezes a placeholder's beat", async () => {
      const runtime = film({
        nodes: [
          {
            kind: "scene",
            sceneId: "scene.shot",
            clock: { kind: "none" },
            renderers: [
              {
                instanceId: "video.shot",
                rendererId: "core.video",
                layer: 0,
                config: { fit: "cover", sequence: [], autoplay: true },
                bindings: {},
              },
            ],
            anchors: [],
            gestures: [],
            timeline: { cues: [] },
            eventBindings: [mediaEnded("video.shot", [goto("scene.after")])],
          } as unknown as Node,
          textScene("scene.after", "after"),
        ],
      });
      await startFilm(runtime, []);
      await elapse(3_000);

      await keySpace(document.body);
      await elapse(20_000);
      expect(container.textContent).toContain(copy.emptySequence);

      await press(pausedFrame());
      await elapse(2_990);
      expect(container.textContent).not.toContain("after");
      await elapse(20);
      expect(container.textContent).toContain("after");
    });

    it("freezes a still's screen time", async () => {
      const still = {
        assetId: "asset.still",
        kind: "video",
        orientationPolicy: "single-master",
        variants: [
          {
            variantId: "asset.still.landscape",
            sourceAssetId: "asset.still.source",
            sha256: HASH,
            uri: "/still.png",
            mediaType: "image/png",
            orientation: "landscape",
            width: 1920,
            height: 1080,
          },
        ],
      };
      const shot = videoScene("scene.still", "asset.still", [goto("scene.after")]);
      const runtime = film({
        assets: [still],
        capabilities: ["core.video.still"],
        nodes: [
          {
            ...shot,
            renderers: [
              {
                ...videoRenderer("video.scene.still", "asset.still"),
                config: {
                  fit: "cover",
                  autoplay: true,
                  sequence: [
                    {
                      clipId: "clip.still",
                      assetId: "asset.still",
                      endBehavior: { behavior: "hold-last-frame", durationMs: 3_000 },
                    },
                  ],
                },
              },
            ],
          } as unknown as Node,
          textScene("scene.after", "after"),
        ],
      });
      await startFilm(runtime, []);
      await elapse(1_000);

      await keySpace(document.body);
      await elapse(20_000);
      expect(container.textContent).not.toContain("after");

      await press(pausedFrame());
      await elapse(1_990);
      expect(container.textContent).not.toContain("after");
      await elapse(20);
      expect(container.textContent).toContain("after");
    });

    it("freezes a charge's idle timeout, and unlocks its clip in the tap without starting it", async () => {
      await startFilm(gestureFilm("charge"), ["/a.mp4"]);
      // The window is open and the charge holds the clip until it is pressed —
      // here past the branch frame, so a timeout routes the moment it lands.
      await playedTo("/a.mp4", 0.6);
      const hotspot = container.querySelector('button[aria-label="Charge"]');
      await elapse(1_000);

      await keySpace(document.body);
      await elapse(10_000);
      expect(container.textContent).not.toContain("failed");

      const calls: string[] = [];
      play.mockImplementation(() => {
        calls.push("play");
        return Promise.resolve();
      });
      vi.mocked(HTMLMediaElement.prototype.pause).mockImplementation(() => {
        calls.push("pause");
      });
      await act(async () => {
        pausedFrame()!.click();
      });
      // Played inside the tap, so the device grants it — and held again at once.
      expect(calls.slice(0, 2)).toEqual(["play", "pause"]);
      await settle();
      // The layer, and the gestures it holds, came through the pause as they were.
      expect(container.querySelector('button[aria-label="Charge"]')).toBe(hotspot);

      await elapse(1_900);
      expect(container.textContent).not.toContain("failed");
      await elapse(200);
      expect(container.textContent).toContain("failed");
    });

    it("drops a press in progress without a verdict", async () => {
      await startFilm(gestureFilm("hold"), ["/a.mp4"]);
      await playedTo("/a.mp4", 0.6);
      const hotspot = container.querySelector<HTMLButtonElement>('button[aria-label="Hold"]')!;
      await act(async () => {
        hotspot.dispatchEvent(pointer("pointerdown"));
      });
      await elapse(200);

      // The app is left mid-press.
      await setPageVisibility("hidden");
      expect(pausedFor()).toBe("hidden");
      await act(async () => {
        hotspot.dispatchEvent(pointer("pointerup"));
        hotspot.dispatchEvent(pointer("lostpointercapture"));
      });
      await elapse(5_000);

      expect(container.textContent).not.toContain("cleared");
      expect(container.textContent).not.toContain("failed");
    });

    describe("an access flow", () => {
      const paidFilm = () =>
        film({
          assets: [videoAsset("asset.b", "/b.mp4")],
          capabilities: ["commerce.community-points"],
          nodes: [
            textScene("scene.beat", "beat", {
              clock: { kind: "fixed", durationMs: 1_000 },
              eventBindings: [on("scene.clock-ended", undefined, [goto("scene.paid")])],
            }),
            {
              ...videoScene("scene.paid", "asset.b", [finish]),
              access: { key: "node:scene.paid", communityPointPrice: 20, title: localized("Paid") },
            } as unknown as Node,
          ],
        });

      it("offers no pause controls over the flow or its retry", async () => {
        let decide!: (allowed: boolean) => void;
        await startFilm(paidFilm(), [], {
          access: {
            canAccess: () => false,
            requestAccess: () =>
              new Promise<boolean>((resolve) => {
                decide = resolve;
              }),
            formatPrice: (amount) => `${amount} points`,
          },
        });
        expect(frameControls()).not.toBeNull();

        await elapse(1_100);
        expect(frameControls()).toBeNull();

        await act(async () => {
          decide(false);
        });
        await settle();
        // Declined: the viewer is asked to Continue, and the controls stay away.
        expect(button(copy.continue)).toBeDefined();
        expect(frameControls()).toBeNull();
      });

      it("keeps a film paused through a flow it finished while put away", async () => {
        let owned = false;
        let decide!: (allowed: boolean) => void;
        await startFilm(paidFilm(), [], {
          access: {
            canAccess: () => owned,
            requestAccess: () =>
              new Promise<boolean>((resolve) => {
                decide = resolve;
              }),
            formatPrice: (amount) => `${amount} points`,
          },
        });
        await elapse(1_100);

        await setPageVisibility("hidden");
        expect(pausedFor()).toBe("hidden");
        play.mockClear();
        owned = true;
        await act(async () => {
          decide(true);
        });
        await settle();
        await fire("/b.mp4", "onCanPlay");

        expect(container.querySelector('[data-video-source="/b.mp4"]')).not.toBeNull();
        expect(play).not.toHaveBeenCalled();
        expect(pausedFrame()?.getAttribute("aria-label")).toBe(copy.playback.resume);
      });
    });
  });

  // ── A tap on the picture ──────────────────────────────────────────────────

  describe("a tap on the picture", () => {
    /** A click with a place, as a finger's tap carries: the pause reads where it landed. */
    const tapAt = async (target: Element, x: number, y: number) => {
      await act(async () => {
        target.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true, clientX: x, clientY: y })
        );
      });
      await settle();
    };

    it("pauses a playing film, and the paused frame's tap resumes it", async () => {
      await startFilm(twoClipFilm(), ["/a.mp4"]);
      expect(pausedFor()).toBeNull();

      await tapAt(element("/a.mp4"), 640, 360);

      expect(pausedFor()).toBe("user");
      expect(storyLayer().hasAttribute("inert")).toBe(true);
      expect(pausedFrame()).not.toBeNull();

      await press(pausedFrame());
      expect(pausedFor()).toBeNull();
    });

    it("keeps a choice's tap for the choice", async () => {
      await startFilm(choiceFilm(), ["/a.mp4"]);
      const option = [...container.querySelectorAll("button span")]
        .find((item) => item.textContent === "Next scene")
        ?.closest("button");
      if (!option) throw new Error("The choice is not open.");

      await press(option);

      expect(pausedFor()).toBeNull();
      expect(container.querySelector("[data-experience-paused-frame]")).toBeNull();
      expect(container.textContent).toContain("Done");
    });

    it("keeps a hotspot's tap for the hotspot", async () => {
      await startFilm(gestureFilm("tap"), ["/a.mp4"]);
      vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (
        this: HTMLElement
      ) {
        if (this.hasAttribute("data-experience-gesture-available")) return box(512, 216, 256, 288);
        return box(0, 0, 1280, 720);
      });
      await playedTo("/a.mp4", 0.2);

      await press(container.querySelector<HTMLButtonElement>('button[aria-label="Go on"]'));

      expect(pausedFor()).toBeNull();
      expect(container.textContent).toContain("cleared");
    });

    it("pauses nothing for a graze of a hotspot's edge, and pauses for a clear miss", async () => {
      await startFilm(gestureFilm("tap"), ["/a.mp4"]);
      vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (
        this: HTMLElement
      ) {
        if (this.hasAttribute("data-experience-gesture-available")) return box(512, 216, 256, 288);
        return box(0, 0, 1280, 720);
      });
      await playedTo("/a.mp4", 0.2);

      // 8px beyond the hotspot's right edge: aimed at it, missed it — no pause.
      await tapAt(element("/a.mp4"), 776, 360);
      expect(pausedFor()).toBeNull();

      // Far from it: the picture takes the tap.
      await tapAt(element("/a.mp4"), 120, 620);
      expect(pausedFor()).toBe("user");
    });

    it("leaves a silent reading beat as it is: there is nothing to pause", async () => {
      await startFilm(silentFilm(), []);

      await tapAt(container.querySelector("[data-experience-renderer='core.text']")!, 640, 360);

      expect(pausedFor()).toBeNull();
      expect(container.querySelector("[data-experience-paused-frame]")).toBeNull();
    });

    it("leaves a world stream's taps to the world", async () => {
      const held: boolean[] = [];
      const streamFilm = () =>
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

      await startFilm(streamFilm(), [], {
        renderWorldModel: (props) => <StreamDouble {...props} held={held} />,
      });
      const stream = container.querySelector("[data-world-stream]")!;

      await tapAt(stream, 640, 360);

      expect(pausedFor()).toBeNull();
      expect(container.querySelector("[data-experience-paused-frame]")).toBeNull();
    });
  });
});
