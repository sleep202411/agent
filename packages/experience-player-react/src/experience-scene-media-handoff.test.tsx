// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ExperienceRuntimeManifest,
  ExperienceThemeConfig,
} from "@repo/shared/experience-runtime";
import { warmExperienceMedia } from "./experience-media-warm";
import { ExperiencePlayer } from "./experience-player";
import type { ExperiencePlayerCopy } from "./experience-player-copy";
import { journeyMapTestCopy, subtitleTestCopy } from "./experience-journey-test-copy";

/**
 * Only Vidstack is stubbed — it needs a media pipeline jsdom does not have — so
 * the real ExperienceMediaPlayer runs, and with it the commit timing the
 * look-ahead depends on. The stub shows which clip the element holds, attaches
 * its provider once mounted, as Vidstack does, and lets a test report the clip
 * ready or ended.
 */
vi.mock("@vidstack/react", async () => {
  const { createElement, useEffect, useImperativeHandle, useRef } = await import("react");
  const actual = await vi.importActual<typeof import("@vidstack/react")>("@vidstack/react");

  function StubMediaPlayer({
    ref,
    src,
    children,
    onCanPlay,
    onEnd,
    onProviderChange,
  }: {
    ref?: React.Ref<unknown>;
    src: string | { src: string };
    children?: React.ReactNode;
    onCanPlay?: () => void;
    onEnd?: () => void;
    onProviderChange?: (provider: unknown) => void;
  }) {
    const videoRef = useRef<HTMLVideoElement>(null);
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
    const uri = typeof src === "string" ? src : src.src;
    return createElement(
      "div",
      { "data-video-source": uri },
      createElement("video", { ref: videoRef }),
      createElement("button", { type: "button", "data-ready": uri, onClick: onCanPlay }),
      createElement("button", { type: "button", "data-end": uri, onClick: onEnd }),
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

vi.mock("./experience-media-warm", () => ({ warmExperienceMedia: vi.fn() }));

const HASH = "a".repeat(64);
const STILL_MS = 100;

const copy = {
  journeyMap: journeyMapTestCopy,
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
    unmute: "Unmute",
    subtitles: subtitleTestCopy,
  },
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

function visualAsset(assetId: string, uri: string, mediaType: string, durationMs?: number) {
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
        mediaType,
        orientation: "landscape" as const,
        width: 1920,
        height: 1080,
        ...(durationMs === undefined ? {} : { durationMs }),
      },
    ],
  };
}

type Clip = {
  clipId: string;
  assetId: string;
  endBehavior: { behavior: "advance" } | { behavior: "hold-last-frame"; durationMs: number };
};

const videoRenderer = (sceneId: string, sequence: Clip[]) => ({
  instanceId: `video.${sceneId}`,
  rendererId: "core.video" as const,
  layer: 0,
  config: { fit: "cover" as const, sequence, autoplay: true },
  bindings: {},
});

function manifestShell() {
  return {
    manifestType: "fizzdragon.experience" as const,
    schemaVersion: 2 as const,
    channel: "preview" as const,
    gameId: "experience.scene-media-handoff",
    buildId: "build.scene-media-handoff.001",
    contentVersion: "build.scene-media-handoff.001",
    completionPolicy: "finite" as const,
    metadata: { title: localized("Scene media handoff") },
    compatibility: {
      engineApiVersion: "2.0.0",
      experienceApiVersion: "1.0.0",
      semanticRulesVersion: 1 as const,
      requiredCapabilities: ["core.video", "core.video.still"],
    },
    localization: { defaultLocale: "en-US", locales: ["en-US"] },
    stateDefinitions: [],
    inputActions: [],
    rendererRequirements: [
      {
        rendererId: "core.video" as const,
        apiVersion: "1.0.0",
        configSchemaVersion: "1.0.0",
        requiredCapabilities: ["core.video"],
        outcomes: [{ outcomeType: "media-ended" }],
        commands: [],
      },
    ],
    theme: {
      themeId: "theme.default",
      apiVersion: "1.0.0",
      configAssetId: "theme.default.config",
    },
    telemetryDefinitions: [],
    endings: [{ endingId: "ending.done", title: localized("Done"), kind: "success" as const }],
  };
}

const themeAsset = {
  assetId: "theme.default.config",
  kind: "data" as const,
  sourceAssetId: "source.theme.default.config",
  sha256: HASH,
  uri: "/runtime-assets/theme.default.json",
  mediaType: "application/json",
  format: "json" as const,
};

function scene(
  sceneId: string,
  renderer: ReturnType<typeof videoRenderer>,
  eventBindings: ExperienceRuntimeManifest["graph"]["nodes"][number]["eventBindings"]
) {
  return {
    kind: "scene" as const,
    sceneId,
    clock: { kind: "renderer" as const, rendererInstanceId: renderer.instanceId },
    renderers: [renderer],
    anchors: [],
    gestures: [],
    timeline: { cues: [] },
    eventBindings,
  };
}

const onMediaEnded = (renderer: { instanceId: string }) => ({
  type: "renderer.outcome" as const,
  sourceId: renderer.instanceId,
  qualifierId: "media-ended",
});

function sceneHandoffManifest(): ExperienceRuntimeManifest {
  const firstRenderer = videoRenderer("first", [
    {
      clipId: "clip.first.still",
      assetId: "asset.first.still",
      endBehavior: { behavior: "hold-last-frame", durationMs: STILL_MS },
    },
  ]);
  const secondRenderer = videoRenderer("second", [
    {
      clipId: "clip.second.still",
      assetId: "asset.second.still",
      endBehavior: { behavior: "hold-last-frame", durationMs: STILL_MS },
    },
    {
      clipId: "clip.second.video",
      assetId: "asset.second.video",
      endBehavior: { behavior: "advance" },
    },
  ]);
  return {
    ...manifestShell(),
    assets: [
      themeAsset,
      visualAsset("asset.first.still", "/first.png", "image/png"),
      visualAsset("asset.second.still", "/second.png", "image/png"),
      visualAsset("asset.second.video", "/second.mp4", "video/mp4", 1_000),
    ],
    graph: {
      entrySceneId: "scene.first",
      nodes: [
        scene("scene.first", firstRenderer, [
          {
            bindingId: "first.next",
            on: onMediaEnded(firstRenderer),
            routes: [
              {
                routeId: "next",
                actions: [{ kind: "scene.goto" as const, sceneId: "scene.second" }],
              },
            ],
          },
        ]),
        scene("scene.second", secondRenderer, [
          {
            bindingId: "second.done",
            on: onMediaEnded(secondRenderer),
            routes: [
              {
                routeId: "done",
                actions: [{ kind: "ending.complete" as const, endingId: "ending.done" }],
              },
            ],
          },
        ]),
      ],
    },
  } as ExperienceRuntimeManifest;
}

/**
 * The handoff film with a decision on its first scene: the opening still ends,
 * a choice opens, and choosing it cuts to the second scene. With `price`, the
 * route is paid and choosing it asks the host for access first.
 */
function choiceManifest(
  orientation: "landscape" | "portrait",
  price?: number
): ExperienceRuntimeManifest {
  const manifest = sceneHandoffManifest();
  for (const asset of manifest.assets) {
    if (asset.kind !== "video") continue;
    for (const variant of asset.variants) {
      variant.orientation = orientation;
      variant.width = orientation === "portrait" ? 1080 : 1920;
      variant.height = orientation === "portrait" ? 1920 : 1080;
    }
  }
  manifest.compatibility.requiredCapabilities.push("core.choice");
  if (price !== undefined) {
    manifest.compatibility.requiredCapabilities.push("commerce.community-points");
  }
  manifest.rendererRequirements.push({
    rendererId: "core.choice",
    apiVersion: "1.0.0",
    configSchemaVersion: "1.0.0",
    requiredCapabilities: ["core.choice"],
    outcomes: [{ outcomeType: "choice-selected" }],
    commands: [{ commandType: "open" }],
  });
  const first = manifest.graph.nodes[0];
  if (!first || first.kind !== "scene") throw new Error("First scene missing");
  first.renderers.push({
    instanceId: "choice.first",
    rendererId: "core.choice",
    layer: 100,
    bindings: {},
    config: {
      decisionId: "decision.first",
      prompt: localized("Choose"),
      initiallyOpen: false,
      choices: [{ choiceId: "next", label: localized("Next scene") }],
    },
  });
  first.eventBindings[0]!.routes[0]!.actions = [
    {
      kind: "renderer.command",
      instanceId: "choice.first",
      commandType: "open",
      payload: {},
    },
  ];
  first.eventBindings.push({
    bindingId: "choice.next",
    on: { type: "renderer.outcome", sourceId: "choice.first", qualifierId: "choice-selected" },
    routes: [
      {
        routeId: "next",
        ...(price === undefined
          ? {}
          : {
              access: {
                key: "route:next",
                communityPointPrice: price,
                title: localized("Next scene"),
              },
            }),
        actions: [{ kind: "scene.goto", sceneId: "scene.second" }],
      },
    ],
  });
  return manifest;
}

/**
 * A branching film for the look-ahead: the first scene plays two clips, then
 * offers two next scenes, each opening on its own clip; the third scene leads
 * on to a fourth, two hops from the start.
 */
function lookAheadManifest(): ExperienceRuntimeManifest {
  const clip = (assetId: string): Clip => ({
    clipId: `clip.${assetId}`,
    assetId,
    endBehavior: { behavior: "advance" },
  });
  const first = videoRenderer("first", [clip("first.a"), clip("first.b")]);
  const second = videoRenderer("second", [clip("second")]);
  const third = videoRenderer("third", [clip("third")]);
  const fourth = videoRenderer("fourth", [clip("fourth")]);
  const choice = {
    instanceId: "choice.first",
    rendererId: "core.choice",
    layer: 100,
    bindings: {},
    config: {
      decisionId: "decision.first",
      initiallyOpen: false,
      choices: [
        { choiceId: "second", label: localized("Second") },
        { choiceId: "third", label: localized("Third") },
      ],
    },
  };
  const chosen = (choiceId: string) => ({
    kind: "compare" as const,
    left: { kind: "event" as const, path: "choiceId" },
    operator: "equals" as const,
    right: { kind: "literal" as const, value: choiceId },
  });
  const ending = (renderer: { instanceId: string }) => [
    {
      bindingId: `${renderer.instanceId}.done`,
      on: onMediaEnded(renderer),
      routes: [
        {
          routeId: "done",
          actions: [{ kind: "ending.complete" as const, endingId: "ending.done" }],
        },
      ],
    },
  ];
  const shell = manifestShell();
  return {
    ...shell,
    compatibility: {
      ...shell.compatibility,
      requiredCapabilities: ["core.video", "core.choice"],
    },
    rendererRequirements: [
      ...shell.rendererRequirements,
      {
        rendererId: "core.choice",
        apiVersion: "1.0.0",
        configSchemaVersion: "1.0.0",
        requiredCapabilities: ["core.choice"],
        outcomes: [{ outcomeType: "choice-selected" }],
        commands: [{ commandType: "open" }],
      },
    ],
    assets: [
      themeAsset,
      visualAsset("first.a", "/first-a.mp4", "video/mp4", 1_000),
      visualAsset("first.b", "/first-b.mp4", "video/mp4", 1_000),
      visualAsset("second", "/second.mp4", "video/mp4", 1_000),
      visualAsset("third", "/third.mp4", "video/mp4", 1_000),
      visualAsset("fourth", "/fourth.mp4", "video/mp4", 1_000),
    ],
    graph: {
      entrySceneId: "scene.first",
      nodes: [
        {
          ...scene("scene.first", first, [
            {
              bindingId: "first.ended",
              on: onMediaEnded(first),
              routes: [
                {
                  routeId: "open",
                  actions: [
                    {
                      kind: "renderer.command",
                      instanceId: "choice.first",
                      commandType: "open",
                      payload: {},
                    },
                  ],
                },
              ],
            },
            {
              bindingId: "first.chosen",
              on: {
                type: "renderer.outcome",
                sourceId: "choice.first",
                qualifierId: "choice-selected",
              },
              routes: [
                {
                  routeId: "to.second",
                  when: chosen("second"),
                  actions: [{ kind: "scene.goto", sceneId: "scene.second" }],
                },
                {
                  routeId: "to.third",
                  actions: [{ kind: "scene.goto", sceneId: "scene.third" }],
                },
              ],
            },
          ]),
          renderers: [first, choice],
        },
        scene("scene.second", second, ending(second)),
        scene("scene.third", third, [
          {
            bindingId: "third.next",
            on: onMediaEnded(third),
            routes: [
              { routeId: "next", actions: [{ kind: "scene.goto", sceneId: "scene.fourth" }] },
            ],
          },
        ]),
        scene("scene.fourth", fourth, ending(fourth)),
      ],
    },
  } as ExperienceRuntimeManifest;
}

/**
 * The browser the player is judging: whether it is a phone (a hover-less
 * touchscreen with a phone-sized short side), whether that phone is upright,
 * and, where offered, the fullscreen and orientation-lock APIs.
 */
function emulateDevice(input: { phone: boolean; portrait: boolean; screen?: [number, number] }) {
  const [width, height] = input.screen ?? (input.phone ? [390, 844] : [1512, 982]);
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches:
        query === "(pointer: coarse) and (hover: none)"
          ? input.phone
          : query === "(orientation: portrait)"
            ? input.portrait
            : false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  Object.defineProperty(window.screen, "width", { configurable: true, value: width });
  Object.defineProperty(window.screen, "height", { configurable: true, value: height });
}

/** A browser that lets the player take the screen: fullscreen plus a landscape lock. */
function grantLandscapeLock() {
  let fullscreenElement: Element | null = null;
  const enterFullscreen = (element: Element) => {
    fullscreenElement = element;
    return Promise.resolve();
  };
  const requestFullscreen = vi.fn(function (this: Element) {
    return enterFullscreen(this);
  });
  const exitFullscreen = vi.fn(() => {
    fullscreenElement = null;
    return Promise.resolve();
  });
  const orientation = {
    lock: vi.fn<(orientation: string) => Promise<void>>(() => Promise.resolve()),
    unlock: vi.fn(),
  };
  Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
    configurable: true,
    value: requestFullscreen,
  });
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => fullscreenElement,
  });
  Object.defineProperty(document, "exitFullscreen", { configurable: true, value: exitFullscreen });
  Object.defineProperty(window.screen, "orientation", { configurable: true, value: orientation });
  return { requestFullscreen, exitFullscreen, orientation };
}

/** jsdom's media elements neither load nor play; these answer as a browser would. */
function stubMediaElements() {
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
}

function shellBox(width: number, height: number) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON: () => ({}),
  });
}

describe("ExperiencePlayer scene media handoff", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    emulateDevice({ phone: false, portrait: false });
    stubMediaElements();
    vi.mocked(warmExperienceMedia).mockReset();
    vi.mocked(warmExperienceMedia).mockResolvedValue(undefined);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    for (const [target, key] of [
      [HTMLElement.prototype, "requestFullscreen"],
      [document, "fullscreenElement"],
      [document, "exitFullscreen"],
      [window.screen, "orientation"],
      [window.screen, "width"],
      [window.screen, "height"],
    ] as const) {
      Reflect.deleteProperty(target, key);
    }
  });

  const render = async (
    runtime: ExperienceRuntimeManifest,
    extra: Partial<Parameters<typeof ExperiencePlayer>[0]> = {}
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

  const button = (label: string) =>
    [...container.querySelectorAll("button")].find((item) => item.textContent === label);

  const start = async () => {
    const control = button(copy.start);
    if (!control) {
      throw new Error(`The player never offered Start. Rendered: ${container.textContent ?? ""}`);
    }
    expect(control.closest("[data-experience-media-stage]")).toBeNull();
    expect(control.closest("[data-experience-viewport-overlay]")).not.toBeNull();
    await act(async () => {
      control.click();
    });
  };

  /** Plays the opening still to its end, which opens the decision. */
  const reachChoice = async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STILL_MS);
    });
    // The label span, not the button: a paid choice also carries its price.
    const label = [...container.querySelectorAll("button span")].find(
      (item) => item.textContent === "Next scene"
    );
    const option = label?.closest("button");
    if (!option) throw new Error("Choice missing after media ended");
    return option;
  };

  const landscapeViewport = () =>
    container.querySelector<HTMLElement>("[data-experience-landscape-viewport]")!;
  const mediaStage = () => container.querySelector<HTMLElement>("[data-experience-media-stage]")!;

  it.each([
    { orientation: "portrait" as const, width: 1162, height: 981, stage: [552, 981] },
    // A desktop window dragged narrow letterboxes; only a phone turns the frame.
    { orientation: "landscape" as const, width: 390, height: 844, stage: [390, 219] },
  ])(
    "keeps $orientation choices inside the fitted film frame on a desktop",
    async ({ orientation, width, height, stage }) => {
      shellBox(width, height);
      await render(choiceManifest(orientation), { frameProfile: orientation });
      await start();
      expect(container.textContent).not.toContain("Next scene");

      const option = await reachChoice();

      expect(landscapeViewport().style.transform).toBe("translate(-50%, -50%)");
      expect(landscapeViewport().hasAttribute("data-experience-frame-rotated")).toBe(false);
      // The whole authored frame fits the shell.
      expect(Number.parseFloat(mediaStage().style.width)).toBe(stage[0]);
      expect(Number.parseFloat(mediaStage().style.height)).toBe(stage[1]);
      // Choices belong to the picture: sized and placed by the film frame,
      // which is the size container their `cq*` units resolve against.
      expect(option.textContent).toBe("1Next scene");
      expect(option.closest("[data-experience-media-stage]")).toBe(mediaStage());
      expect(option.closest("[data-experience-viewport-overlay]")).toBeNull();
      expect(mediaStage().style.containerType).toBe("size");
      expect(mediaStage().style.containerName).toBe("experience-frame");
      await act(async () => {
        option.click();
      });
      expect(container.querySelector('img[src="/second.png"]')).not.toBeNull();
      expect(container.textContent).not.toContain("Next scene");
    }
  );

  it("turns the whole frame, choices included, on an upright phone that cannot lock", async () => {
    emulateDevice({ phone: true, portrait: true });
    shellBox(390, 844);
    await render(choiceManifest("landscape"), { frameProfile: "landscape" });
    await start();

    const option = await reachChoice();

    const viewport = landscapeViewport();
    expect(viewport.hasAttribute("data-experience-frame-rotated")).toBe(true);
    expect(viewport.style.transform).toBe("translate(-50%, -50%) rotate(90deg)");
    expect(Number.parseFloat(viewport.style.width)).toBe(844);
    expect(Number.parseFloat(viewport.style.height)).toBe(390);
    expect(Number.parseFloat(mediaStage().style.width)).toBe(693);
    expect(Number.parseFloat(mediaStage().style.height)).toBe(390);
    // One unit: the phone held sideways sees the picture and the decision the
    // same way up.
    expect(option.closest("[data-experience-landscape-viewport]")).toBe(viewport);
    expect(option.closest("[data-experience-media-stage]")).toBe(mediaStage());
  });

  it("does not turn the frame on a phone already held sideways", async () => {
    emulateDevice({ phone: true, portrait: false });
    shellBox(844, 390);
    await render(choiceManifest("landscape"), { frameProfile: "landscape" });
    await start();
    await reachChoice();

    expect(landscapeViewport().hasAttribute("data-experience-frame-rotated")).toBe(false);
    expect(Number.parseFloat(mediaStage().style.width)).toBe(693);
    expect(Number.parseFloat(mediaStage().style.height)).toBe(390);
  });

  it("does not turn a portrait film on an upright phone", async () => {
    emulateDevice({ phone: true, portrait: true });
    shellBox(390, 844);
    await render(choiceManifest("portrait"), { frameProfile: "portrait" });
    await start();
    await reachChoice();

    expect(landscapeViewport().hasAttribute("data-experience-frame-rotated")).toBe(false);
  });

  it("lets the screen turn instead where the browser grants fullscreen and the lock", async () => {
    emulateDevice({ phone: true, portrait: true });
    shellBox(390, 844);
    const lock = grantLandscapeLock();
    await render(choiceManifest("landscape"), { frameProfile: "landscape" });
    // Drawn sideways while the phone is upright and nothing has been granted.
    expect(landscapeViewport().hasAttribute("data-experience-frame-rotated")).toBe(true);

    await start();
    await reachChoice();

    const shell = container.querySelector('[role="region"]');
    expect(lock.requestFullscreen).toHaveBeenCalledOnce();
    expect(lock.requestFullscreen.mock.contexts[0]).toBe(shell);
    expect(lock.requestFullscreen).toHaveBeenCalledWith({ navigationUI: "hide" });
    expect(lock.orientation.lock).toHaveBeenCalledWith("landscape");
    // The screen itself is landscape now, whatever the media query still says.
    expect(landscapeViewport().hasAttribute("data-experience-frame-rotated")).toBe(false);
  });

  it("gives the screen back at the ending", async () => {
    emulateDevice({ phone: true, portrait: true });
    shellBox(390, 844);
    const lock = grantLandscapeLock();
    await render(sceneHandoffManifest(), { frameProfile: "landscape" });
    await start();
    // One act per scene: each still's timer is armed by the render the last cut
    // produced.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STILL_MS);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STILL_MS);
    });
    expect(lock.exitFullscreen).not.toHaveBeenCalled();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-end="/second.mp4"]')!.click();
    });

    expect(container.textContent).toContain(copy.endingEyebrow);
    expect(lock.orientation.unlock).toHaveBeenCalledOnce();
    expect(lock.exitFullscreen).toHaveBeenCalledOnce();
  });

  it("leaves fullscreen before the host asks for access, so its dialog is visible", async () => {
    emulateDevice({ phone: true, portrait: true });
    shellBox(390, 844);
    const lock = grantLandscapeLock();
    const fullscreenWhenAsked: boolean[] = [];
    const requestAccess = vi.fn(async () => {
      fullscreenWhenAsked.push(document.fullscreenElement !== null);
      return false;
    });
    await render(choiceManifest("landscape", 20), {
      frameProfile: "landscape",
      access: {
        canAccess: () => false,
        requestAccess,
        formatPrice: (amount) => `${amount} points`,
      },
    });
    await start();
    expect(document.fullscreenElement).not.toBeNull();
    const option = await reachChoice();

    await act(async () => {
      option.click();
    });

    expect(requestAccess).toHaveBeenCalledOnce();
    expect(fullscreenWhenAsked).toEqual([false]);
    expect(lock.orientation.unlock).toHaveBeenCalledOnce();
  });

  it("keeps the opening still timer alive when the video slot moves to a new scene", async () => {
    await render(sceneHandoffManifest());
    await start();
    expect(container.querySelector('img[src="/first.png"]')).not.toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(STILL_MS);
    });
    expect(container.querySelector('img[src="/second.png"]')).not.toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(STILL_MS - 1);
    });
    expect(container.querySelector('[data-video-source="/second.mp4"]')).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(container.querySelector('[data-video-source="/second.mp4"]')).not.toBeNull();
  });
});

describe("ExperiencePlayer look-ahead", () => {
  let container: HTMLDivElement;
  let root: Root;
  let warms: Array<{
    src: string;
    signal: AbortSignal;
    finish: () => void;
  }>;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    emulateDevice({ phone: false, portrait: false });
    stubMediaElements();
    warms = [];
    vi.mocked(warmExperienceMedia).mockReset();
    vi.mocked(warmExperienceMedia).mockImplementation(
      (media, _delivery, signal) =>
        new Promise<void>((resolve, reject) => {
          warms.push({ src: media.src, signal, finish: resolve });
          signal.addEventListener("abort", () => reject(signal.reason));
        })
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    Reflect.deleteProperty(window.screen, "width");
    Reflect.deleteProperty(window.screen, "height");
  });

  const settle = async () => {
    await act(async () => {
      await Promise.resolve();
    });
  };

  const end = async (src: string) => {
    await act(async () => {
      container.querySelector<HTMLButtonElement>(`[data-end="${src}"]`)!.click();
    });
  };

  /** Mounts the film with its entry clip buffered, and presses Start. */
  const startLookAheadFilm = async () => {
    await act(async () => {
      root.render(
        <ExperiencePlayer
          runtime={lookAheadManifest()}
          locale="en-US"
          copy={copy}
          loadTheme={() => Promise.resolve(theme)}
        />
      );
    });
    expect(warmExperienceMedia).not.toHaveBeenCalled();
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-ready="/first-a.mp4"]')!.click();
    });
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((item) => item.textContent === copy.start)!
        .click();
    });
    await settle();
  };

  it("warms nothing behind the title card, then one opening at a time in plan order", async () => {
    await startLookAheadFilm();

    // The clip on stage is skipped; the rest of the scene comes first.
    expect(warms.map((warm) => warm.src)).toEqual(["/first-b.mp4"]);
    warms[0]!.finish();
    await settle();
    expect(warms.map((warm) => warm.src)).toEqual(["/first-b.mp4", "/second.mp4"]);
    warms[1]!.finish();
    await settle();
    expect(warms.map((warm) => warm.src)).toEqual(["/first-b.mp4", "/second.mp4", "/third.mp4"]);
  });

  it("aborts the plan on a scene change and plans again from the new scene", async () => {
    await startLookAheadFilm();
    warms[0]!.finish();
    await settle();
    const inFlight = warms[1]!;
    expect(inFlight.src).toBe("/second.mp4");

    await end("/first-a.mp4");
    await end("/first-b.mp4");
    const third = [...container.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("Third")
    )!;
    await act(async () => {
      third.click();
    });
    await settle();

    expect(container.querySelector('[data-video-source="/third.mp4"]')).not.toBeNull();
    expect(inFlight.signal.aborted).toBe(true);
    // A fresh plan from the new scene: its own clip is on stage, so the first
    // opening it warms is the scene after it, under a new signal.
    expect(warms.map((warm) => warm.src)).toEqual(["/first-b.mp4", "/second.mp4", "/fourth.mp4"]);
    expect(warms[2]!.signal.aborted).toBe(false);
  });
});
