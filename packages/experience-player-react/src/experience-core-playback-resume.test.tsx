// @vitest-environment jsdom

import { act, StrictMode, useState } from "react";
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
      fixedClockEnded: false,
      rate: 1,
    },
  };
}

describe("Core media seconds resume", () => {
  let container: HTMLDivElement;
  let root: Root;
  const observed = vi.fn<(value: ExperienceAccessCheckpoint) => void>();
  const media = () => observed.mock.calls.at(-1)?.[0].playback?.media[0];
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
    saved?: ExperienceAccessCheckpoint,
    feedback = false,
    strict = false
  ) => {
    function Host() {
      const [, update] = useState(0);
      return (
        <ExperiencePlayer
          runtime={manifest}
          copy={copy}
          locale="en-US"
          loadTheme={loadTheme}
          accessCheckpoint={saved}
          onCheckpoint={(value) => {
            observed(value);
            if (observed.mock.calls.length > 40) throw new Error("Checkpoint render loop");
            if (feedback) update((count) => count + 1);
          }}
        />
      );
    }
    await act(async () =>
      root.render(
        strict ? (
          <StrictMode>
            <Host />
          </StrictMode>
        ) : (
          <Host />
        )
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

  it("starts ready native media and records running playback under StrictMode", async () => {
    await render(fixture(), undefined, false, true);
    expect(mediaEvents.has("/a.mp4")).toBe(true);
    const start = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === copy.start
    );
    expect(start, container.textContent ?? "").toBeDefined();
    expect(start?.disabled).toBe(false);
    await click(copy.start);
    await tick(500);
    await act(async () => mediaEvents.get("/a.mp4")!.time(0.5));
    expect(media()).toMatchObject({
      assetId: "asset.a",
      positionMs: 500,
      watchedUntilMs: 500,
      completed: false,
    });
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(observed.mock.lastCall?.[0].state.status).toBe("active");
  });

  it("resumes the second sequence at its saved second without replaying the first", async () => {
    const manifest = fixture();
    await render(
      manifest,
      checkpoint(manifest, {
        sequenceIndex: 1,
        assetId: "asset.b",
        mediaSignature: mediaPlaybackSignature(manifest, "asset.b"),
        positionMs: 4250,
        watchedUntilMs: 7000,
      })
    );
    expect(container.querySelector("[data-test-media]")?.getAttribute("data-test-media")).toBe(
      "/b.mp4"
    );
    expect(container.querySelector("[data-test-media]")?.getAttribute("data-initial-time")).toBe(
      "4.25"
    );
    await click("Start");
    expect(media()).toMatchObject({ sequenceIndex: 1, positionMs: 4250, watchedUntilMs: 7000 });
  });

  it("restores only the remaining terminal video hold without another end event", async () => {
    const manifest = fixture(false, 5000);
    await render(
      manifest,
      checkpoint(manifest, {
        positionMs: 10000,
        watchedUntilMs: 10000,
        terminalMode: { kind: "held" },
        remainingHoldMs: 1000,
      })
    );
    await click("Start");
    await tick(750);
    expect(media()).toMatchObject({ remainingHoldMs: 250, completed: false });
    await act(async () => mediaEvents.get("/a.mp4")!.end());
    await tick(249);
    expect(container.textContent).not.toContain("Done");
    await tick(1);
    expect(container.textContent).toContain("Done");
  });

  it("keeps callback feedback finite and preserves still remaining time through pause", async () => {
    const manifest = fixture(true);
    await render(
      manifest,
      checkpoint(manifest, {
        positionMs: 3000,
        watchedUntilMs: 3000,
        terminalMode: { kind: "held" },
        remainingHoldMs: 2000,
      }),
      true
    );
    await click("Start");
    await tick(1000);
    expect(media()).toMatchObject({ positionMs: 4000, remainingHoldMs: 1000 });
    await act(async () =>
      container.querySelector<HTMLElement>("[data-experience-media-stage]")!.click()
    );
    await tick(4000);
    expect(media()).toMatchObject({ positionMs: 4000, remainingHoldMs: 1000 });
    await act(async () =>
      container.querySelector<HTMLElement>("[data-experience-paused-frame]")!.click()
    );
    await tick(999);
    expect(container.textContent).not.toContain("Done");
    await tick(1);
    expect(container.textContent).toContain("Done");
    expect(observed.mock.calls.length).toBeLessThan(30);
  });

  it("rewinds a held still within watched footage and extends its remaining story time", async () => {
    const manifest = fixture(true);
    await render(
      manifest,
      checkpoint(manifest, {
        positionMs: 3000,
        watchedUntilMs: 4000,
        terminalMode: { kind: "held" },
        remainingHoldMs: 2000,
      })
    );
    await click("Start");
    await click("Back 10");
    expect(media()).toMatchObject({ positionMs: 0, watchedUntilMs: 4000, remainingHoldMs: 5000 });
    await tick(4999);
    expect(container.textContent).not.toContain("Done");
    await tick(1);
    expect(container.textContent).toContain("Done");
  });

  it("credits contiguous natural playback but does not credit time skipped on restore", async () => {
    const manifest = fixture();
    await render(manifest, checkpoint(manifest, { positionMs: 3000, watchedUntilMs: 1000 }));
    await click("Start");
    await tick(500);
    await act(async () => mediaEvents.get("/a.mp4")!.time(3.5));
    expect(media()).toMatchObject({ positionMs: 3500, watchedUntilMs: 1000 });
  });

  it("records natural watched progress and retains it when seeking backward", async () => {
    const manifest = fixture();
    await render(manifest, checkpoint(manifest));
    await click("Start");
    await tick(1250);
    await act(async () => mediaEvents.get("/a.mp4")!.time(1.25));
    expect(media()).toMatchObject({ positionMs: 1250, watchedUntilMs: 1250 });
    await click("Back 10");
    expect(media()).toMatchObject({ positionMs: 0, watchedUntilMs: 1250 });
    expect(mediaEvents.get("/a.mp4")!.seek).toHaveBeenLastCalledWith(0);
    await tick(1500);
    await act(async () => mediaEvents.get("/a.mp4")!.time(1.5));
    expect(media()).toMatchObject({ positionMs: 1500, watchedUntilMs: 1500 });
  });

  it("keeps the current second when orientation selects another source variant", async () => {
    const listeners = new Set<() => void>();
    let portrait = false;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        get matches() {
          return query === "(max-width: 767px) and (orientation: portrait)" && portrait;
        },
        addEventListener: (_: string, callback: () => void) => listeners.add(callback),
        removeEventListener: (_: string, callback: () => void) => listeners.delete(callback),
      }),
    });
    const manifest = fixture();
    const asset = manifest.assets[0]!;
    if (asset.kind !== "video") throw new Error("Video asset missing");
    asset.orientationPolicy = "responsive";
    asset.variants.push({
      ...asset.variants[0]!,
      variantId: "a.portrait",
      uri: "/a-portrait.mp4",
      orientation: "portrait",
      width: 1080,
      height: 1920,
    });
    await render(manifest, checkpoint(manifest, { positionMs: 3000, watchedUntilMs: 5000 }));
    await click("Start");
    await tick(1500);
    await act(async () => mediaEvents.get("/a.mp4")!.time(4.5));
    await act(async () => {
      portrait = true;
      listeners.forEach((listener) => listener());
    });
    const element = container.querySelector("[data-test-media]");
    expect(element?.getAttribute("data-test-media")).toBe("/a-portrait.mp4");
    expect(element?.getAttribute("data-initial-time")).toBe("4.5");
  });

  it("allows a fully watched asset to be skipped when replayed in a new sequence entry", async () => {
    const manifest = fixture();
    const saved = checkpoint(manifest);
    saved.state.watchedAssetIds = ["asset.a"];
    await render(manifest, saved);
    await click("Start");
    expect(media()).toMatchObject({ watchedUntilMs: 10000 });
    await click("Forward 10");
    expect(media()).toMatchObject({ positionMs: 10000, watchedUntilMs: 10000 });
  });
});
