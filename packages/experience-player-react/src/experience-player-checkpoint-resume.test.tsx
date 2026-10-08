// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXPERIENCE_CORE_RENDERER_ADAPTERS } from "@repo/experience-engine";
import {
  ExperienceRuntimeManifestSchema,
  type ExperienceRuntimeManifest,
  type ExperienceScene,
  type ExperienceThemeConfig,
} from "@repo/shared/experience-runtime";
import { ExperiencePlayer, type ExperienceAccessCheckpoint } from "./experience-player";
import type { ExperiencePlayerCopy } from "./experience-player-copy";
import { journeyMapTestCopy } from "./experience-journey-test-copy";
import { createExperienceRuntime } from "./experience-runtime-host";
import {
  mediaPlaybackSignature,
  scenePlaybackSignature,
  type ExperienceMediaCheckpoint,
} from "./experience-playback-checkpoint";

const mediaEvents = vi.hoisted(
  () =>
    new Map<
      string,
      { time: (seconds: number) => void; end: () => void; seek: ReturnType<typeof vi.fn> }
    >()
);

// The Core renderer, engine, checkpoint assembly and story clock are real.
// The media boundary supplies deterministic positions instead of decoding video.
vi.mock("./experience-media-player", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./experience-media-player")>();
  const { createElement, useEffect, useRef } = await import("react");
  return {
    ...actual,
    ExperienceMediaPlayer: (props: Parameters<typeof actual.ExperienceMediaPlayer>[0]) => {
      const latest = useRef(props);
      latest.current = props;
      const uri = typeof props.source === "string" ? props.source : props.source.src;
      const { onPlaybackHandle, playbackIdentity } = props;
      useEffect(() => {
        const seek = vi.fn((seconds: number) => latest.current.onTimeUpdate?.(seconds));
        const entry = {
          time: (seconds: number) => latest.current.onTimeUpdate?.(seconds),
          end: () => latest.current.onEnd?.(),
          seek,
        };
        mediaEvents.set(uri, entry);
        onPlaybackHandle?.({
          playbackIdentity: playbackIdentity ?? uri,
          playInGesture: () => null,
          play: async () => undefined,
          pause: () => undefined,
          seek,
          ended: () => false,
          element: () => null,
          setMuted: () => undefined,
          setPlaybackRate: () => undefined,
        });
        return () => {
          if (mediaEvents.get(uri) === entry) mediaEvents.delete(uri);
          onPlaybackHandle?.(null);
        };
      }, [onPlaybackHandle, playbackIdentity, uri]);
      return createElement("div", {
        "data-test-media": uri,
        "data-initial-time": props.initialTimeSeconds ?? 0,
      });
    },
  };
});
vi.mock("./experience-media-warm", () => ({
  warmExperienceMedia: vi.fn().mockResolvedValue(undefined),
}));

const text = (value: string) => ({ "en-US": value });
const theme: ExperienceThemeConfig = {
  schemaVersion: 1,
  colorScheme: "dark",
  tokens: {},
  rendererStyles: {},
  motion: { reducedMotionBehavior: "preserve" },
};
const loadTheme = async () => theme;
const copy: ExperiencePlayerCopy = {
  journeyMap: journeyMapTestCopy,
  invalidManifest: "Invalid",
  manifestRoot: "Manifest",
  interactiveFilm: "Film",
  starting: "Starting",
  start: "Start",
  mainMenu: "Main menu",
  returnToMenu: "Return to main menu",
  continueGame: "Continue game",
  codeMenu: { failed: "Custom menu failed", retry: "Retry", restore: "Use default menu" },
  endingEyebrow: "Ending",
  unknownEnding: (id) => id,
  playAgain: "Play again",
  runtimeError: "Error",
  restart: "Restart",
  mediaError: (id) => id,
  videoLabel: (id) => id,
  noVisibleChoices: "No choices",
  continue: "Continue",
  emptySequence: "No footage",
  loadingMedia: "Loading",
  regionLabel: "Player",
  video: { unmute: "Unmute" },
  playback: {
    pause: "Pause",
    resume: "Resume",
    paused: "Paused",
    continuePlaying: "Continue playing",
    interrupted: "Interrupted",
    transport: {
      controlsLabel: "Playback controls",
      rewind10: "Back 10",
      forward10: "Forward 10",
      progressLabel: "Progress",
      speedLabel: "Speed",
      watchedOnlyHint: "Watched only",
      interactionBlocked: "Interaction",
    },
  },
};

function fixture(still = false, holdMs?: number): ExperienceRuntimeManifest {
  const assets = ["a", "b"].map((name) => ({
    assetId: `asset.${name}`,
    kind: "video",
    orientationPolicy: "single-master",
    variants: [
      {
        variantId: `variant.${name}`,
        sourceAssetId: `source.${name}`,
        sha256: "a".repeat(64),
        uri: `/${name}.${still ? "png" : "mp4"}`,
        mediaType: still ? "image/png" : "video/mp4",
        orientation: "landscape",
        width: 1920,
        height: 1080,
        ...(still ? {} : { durationMs: 10000 }),
      },
    ],
  }));
  return ExperienceRuntimeManifestSchema.parse({
    manifestType: "fizzdragon.experience",
    schemaVersion: 2,
    channel: "preview",
    gameId: "experience.resume",
    buildId: "build.resume",
    contentVersion: "build.resume",
    completionPolicy: "finite",
    metadata: { title: text("Resume") },
    compatibility: {
      engineApiVersion: "2.0.0",
      experienceApiVersion: "1.0.0",
      semanticRulesVersion: 1,
      requiredCapabilities: still ? ["core.video", "core.video.still"] : ["core.video"],
    },
    localization: { defaultLocale: "en-US", locales: ["en-US"] },
    stateDefinitions: [],
    inputActions: [],
    telemetryDefinitions: [],
    rendererRequirements: [
      {
        rendererId: "core.video",
        apiVersion: "1.0.0",
        configSchemaVersion: "1.0.0",
        requiredCapabilities: ["core.video"],
        outcomes: [{ outcomeType: "media-ended" }],
        commands: [],
      },
    ],
    assets: [
      ...assets,
      {
        assetId: "theme",
        kind: "data",
        sourceAssetId: "source.theme",
        sha256: "b".repeat(64),
        uri: "/theme.json",
        mediaType: "application/json",
        format: "json",
      },
    ],
    theme: { themeId: "theme", apiVersion: "1.0.0", configAssetId: "theme" },
    endings: [{ endingId: "ending.done", title: text("Done"), kind: "success" }],
    graph: {
      entrySceneId: "scene.one",
      nodes: [
        {
          kind: "scene",
          sceneId: "scene.one",
          clock: { kind: "renderer", rendererInstanceId: "video.one" },
          renderers: [
            {
              instanceId: "video.one",
              rendererId: "core.video",
              layer: 0,
              bindings: {},
              config: {
                fit: "cover",
                autoplay: true,
                sequence: (still || holdMs !== undefined ? ["a"] : ["a", "b"]).map((name) => ({
                  clipId: `clip.${name}`,
                  assetId: `asset.${name}`,
                  endBehavior:
                    still || holdMs !== undefined
                      ? { behavior: "hold-last-frame", durationMs: holdMs ?? 5000 }
                      : { behavior: "advance" },
                })),
              },
            },
          ],
          anchors: [],
          gestures: [],
          timeline: { cues: [] },
          eventBindings: [
            {
              bindingId: "ended",
              on: { type: "renderer.outcome", sourceId: "video.one", qualifierId: "media-ended" },
              routes: [
                {
                  routeId: "done",
                  actions: [{ kind: "ending.complete", endingId: "ending.done" }],
                },
              ],
            },
          ],
        },
      ],
    },
  });
}

function checkpoint(
  manifest: ExperienceRuntimeManifest,
  patch: Partial<ExperienceMediaCheckpoint> = {}
): ExperienceAccessCheckpoint {
  const state = createExperienceRuntime(manifest, {
    rendererAdapters: EXPERIENCE_CORE_RENDERER_ADAPTERS,
    randomSeed: "resume",
    previewAccess: true,
  }).start().state;
  const scene = manifest.graph.nodes[0] as ExperienceScene;
  const isStill =
    manifest.assets[0]!.kind === "video" &&
    manifest.assets[0]!.variants[0]!.mediaType.startsWith("image/");
  const media: ExperienceMediaCheckpoint = {
    rendererInstanceId: "video.one",
    sequenceIndex: 0,
    assetId: "asset.a",
    mediaSignature: mediaPlaybackSignature(manifest, "asset.a"),
    positionMs: 0,
    watchedUntilMs: 0,
    durationMs: isStill ? 5000 : 10000,
    isStill,
    terminalMode: null,
    remainingHoldMs: null,
    completed: false,
    ...patch,
  };
  return {
    state,
    events: [],
    playback: {
      version: 1,
      sceneId: scene.sceneId,
      sceneSignature: scenePlaybackSignature(scene),
      sceneTimeMs: media.sequenceIndex * 10000 + media.positionMs,
      fixedClockEnded: false,
      cursor: {
        sceneId: scene.sceneId,
        positionMs: media.sequenceIndex * 10000 + media.positionMs,
        firedOnceCueIds: [],
      },
      openRendererIds: [],
      settledGestureIds: [],
      parkedEvents: [],
      media: [media],
      playbackEnabled: true,
      rate: 1,
    },
  };
}

describe("Player checkpoint event resume", () => {
  let container: HTMLDivElement;
  let root: Root;
  const observed = vi.fn<(value: ExperienceAccessCheckpoint) => void>();
  const latest = () => observed.mock.calls.at(-1)?.[0];
  const click = async (label: string) => {
    const button = [...container.querySelectorAll("button")].find(
      (item) => item.textContent === label || item.getAttribute("aria-label") === label
    );
    if (!button) throw new Error(`Missing ${label}: ${container.textContent}`);
    await act(async () => button.click());
  };
  const tick = async (milliseconds: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(milliseconds);
    });
  };
  const render = async (
    manifest: ExperienceRuntimeManifest,
    saved: ExperienceAccessCheckpoint,
    access?: Parameters<typeof ExperiencePlayer>[0]["access"]
  ) => {
    await act(async () =>
      root.render(
        <ExperiencePlayer
          runtime={manifest}
          copy={copy}
          locale="en-US"
          loadTheme={loadTheme}
          accessCheckpoint={saved}
          access={access}
          onCheckpoint={observed}
        />
      )
    );
  };
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    observed.mockClear();
    mediaEvents.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    });
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function fixedClockManifest(action: "play" | "pause" | "increment") {
    const manifest = fixture();
    manifest.stateDefinitions = [
      {
        key: "clockCount",
        valueType: "number",
        scope: "session",
        initialValue: 0,
        sensitive: false,
      },
    ];
    if (action !== "increment")
      manifest.rendererRequirements[0]!.commands = [{ commandType: action }];
    const scene = manifest.graph.nodes[0] as ExperienceScene;
    scene.clock = { kind: "fixed", durationMs: 10000 };
    scene.eventBindings.push({
      bindingId: "clock-finished",
      on: { type: "scene.clock-ended", sourceId: scene.sceneId },
      routes: [
        {
          routeId: "finished",
          actions:
            action === "increment"
              ? [
                  {
                    kind: "state.increment",
                    path: "clockCount",
                    amount: { kind: "literal", value: 1 },
                  },
                ]
              : [
                  {
                    kind: "renderer.command",
                    instanceId: "video.one",
                    commandType: action,
                    payload: {},
                  },
                ],
        },
      ],
    });
    return ExperienceRuntimeManifestSchema.parse(manifest);
  }

  function nextSceneManifest(paid = false) {
    const manifest = fixedClockManifest("increment");
    const first = manifest.graph.nodes[0] as ExperienceScene;
    first.eventBindings
      .find((binding) => binding.bindingId === "clock-finished")!
      .routes[0]!.actions.push({ kind: "scene.goto", sceneId: "scene.two" });
    const second = structuredClone(first);
    second.sceneId = "scene.two";
    second.clock = { kind: "renderer", rendererInstanceId: "video.two" };
    second.renderers[0]!.instanceId = "video.two";
    second.renderers[0]!.config = {
      fit: "cover",
      autoplay: true,
      sequence: [
        { clipId: "clip.second", assetId: "asset.b", endBehavior: { behavior: "advance" } },
      ],
    };
    second.eventBindings = [
      {
        bindingId: "second-ended",
        on: { type: "renderer.outcome", sourceId: "video.two", qualifierId: "media-ended" },
        routes: [
          {
            routeId: "second-done",
            actions: [{ kind: "ending.complete", endingId: "ending.done" }],
          },
        ],
      },
    ];
    if (paid) {
      manifest.compatibility.requiredCapabilities.push("commerce.community-points");
      second.access = { key: "node:scene.two", communityPointPrice: 20, title: text("Next scene") };
    }
    manifest.graph.nodes.push(second);
    return ExperienceRuntimeManifestSchema.parse(manifest);
  }

  it.each(["play", "pause"] as const)(
    "preserves a replayed pending %s command over the saved playback state",
    async (command) => {
      const manifest = fixedClockManifest(command);
      const saved = checkpoint(manifest);
      saved.playback!.playbackEnabled = command === "pause";
      saved.events = [{ type: "scene.clock-ended", sourceId: "scene.one" }];
      await render(manifest, saved);
      await click("Start");
      expect(latest()?.playback?.playbackEnabled).toBe(command === "play");
      expect(latest()?.events).toEqual([]);
    }
  );

  it("does not repeat an already completed fixed clock action on seconds restore", async () => {
    const manifest = fixedClockManifest("increment");
    const saved = checkpoint(manifest, { positionMs: 10000, watchedUntilMs: 10000 });
    const controller = createExperienceRuntime(manifest, {
      rendererAdapters: EXPERIENCE_CORE_RENDERER_ADAPTERS,
      randomSeed: "resume",
    });
    controller.start();
    saved.state = controller.dispatch([{ type: "scene.clock-ended", sourceId: "scene.one" }]).state;
    expect(saved.state.values.session.clockCount).toBe(1);
    saved.playback!.fixedClockEnded = true;
    await render(manifest, saved);
    await click("Start");
    await tick(32);
    expect(latest()?.state.values.session.clockCount).toBe(1);
  });

  it("starts the new autoplay scene when pending events leave a saved paused scene", async () => {
    const manifest = nextSceneManifest();
    const saved = checkpoint(manifest);
    saved.playback!.playbackEnabled = false;
    saved.events = [{ type: "scene.clock-ended", sourceId: "scene.one" }];
    await render(manifest, saved);
    await click("Start");
    expect(latest()?.state.currentSceneId).toBe("scene.two");
    expect(latest()?.playback?.playbackEnabled).toBe(true);
    expect(latest()?.state.values.session.clockCount).toBe(1);
  });

  it("keeps a pending fixed clock end behind a real access gate and executes it once after unlock", async () => {
    const manifest = nextSceneManifest(true);
    const saved = checkpoint(manifest, { positionMs: 10000, watchedUntilMs: 10000 });
    saved.playback!.fixedClockEnded = true;
    saved.events = [{ type: "scene.clock-ended", sourceId: "scene.one" }];
    let owned = false;
    let unlock!: (allowed: boolean) => void;
    const requestAccess = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          unlock = resolve;
        })
    );
    await render(manifest, saved, {
      canAccess: () => owned,
      requestAccess,
      formatPrice: (amount) => `${amount} points`,
    });
    await click("Start");
    expect(requestAccess).toHaveBeenCalledTimes(1);
    expect(latest()).toBeUndefined();
    await act(async () => {
      owned = true;
      unlock(true);
    });
    expect(latest()?.state.currentSceneId).toBe("scene.two");
    expect(latest()?.state.values.session.clockCount).toBe(1);
    expect(latest()?.events).toEqual([]);
    await tick(32);
    expect(latest()?.state.values.session.clockCount).toBe(1);
  });
});
