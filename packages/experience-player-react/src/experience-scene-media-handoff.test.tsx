// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExperienceThemeConfig } from "@repo/shared/experience-runtime";
import { ExperiencePlayer } from "./experience-player";
import type { ExperiencePlayerCopy } from "./experience-player-copy";

vi.mock("./experience-media-player", async () => {
  const { createElement, useEffect } = await import("react");

  function StubExperienceMediaPlayer({
    source,
    playbackIdentity,
    onPlaybackHandle,
  }: {
    source: { src: string };
    playbackIdentity: string;
    onPlaybackHandle?: (
      handle: {
        playbackIdentity: string;
        play: () => Promise<void>;
        pause: () => void;
        seek: () => void;
        setMuted: () => void;
      } | null
    ) => void;
  }) {
    useEffect(() => {
      onPlaybackHandle?.({
        playbackIdentity,
        play: async () => undefined,
        pause: () => undefined,
        seek: () => undefined,
        setMuted: () => undefined,
      });
      return () => onPlaybackHandle?.(null);
    }, [onPlaybackHandle, playbackIdentity]);
    return createElement("div", { "data-video-source": source.src });
  }

  return { ExperienceMediaPlayer: StubExperienceMediaPlayer };
});

const HASH = "a".repeat(64);
const STILL_MS = 100;

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

function sceneHandoffManifest() {
  const renderer = (
    sceneId: string,
    sequence: Array<{
      clipId: string;
      assetId: string;
      endBehavior: { behavior: "advance" } | { behavior: "hold-last-frame"; durationMs: number };
    }>
  ) => ({
    instanceId: `video.${sceneId}`,
    rendererId: "core.video" as const,
    layer: 0,
    config: { fit: "cover" as const, sequence, autoplay: true },
    bindings: {},
  });
  const firstRenderer = renderer("first", [
    {
      clipId: "clip.first.still",
      assetId: "asset.first.still",
      endBehavior: { behavior: "hold-last-frame", durationMs: STILL_MS },
    },
  ]);
  const secondRenderer = renderer("second", [
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
    assets: [
      {
        assetId: "theme.default.config",
        kind: "data" as const,
        sourceAssetId: "source.theme.default.config",
        sha256: HASH,
        uri: "/runtime-assets/theme.default.json",
        mediaType: "application/json",
        format: "json" as const,
      },
      visualAsset("asset.first.still", "/first.png", "image/png"),
      visualAsset("asset.second.still", "/second.png", "image/png"),
      visualAsset("asset.second.video", "/second.mp4", "video/mp4", 1_000),
    ],
    theme: {
      themeId: "theme.default",
      apiVersion: "1.0.0",
      configAssetId: "theme.default.config",
    },
    telemetryDefinitions: [],
    endings: [{ endingId: "ending.done", title: localized("Done"), kind: "success" as const }],
    graph: {
      entrySceneId: "scene.first",
      nodes: [
        {
          kind: "scene" as const,
          sceneId: "scene.first",
          clock: { kind: "renderer" as const, rendererInstanceId: firstRenderer.instanceId },
          renderers: [firstRenderer],
          anchors: [],
          gestures: [],
          timeline: { cues: [] },
          eventBindings: [
            {
              bindingId: "first.next",
              on: {
                type: "renderer.outcome" as const,
                sourceId: firstRenderer.instanceId,
                qualifierId: "media-ended",
              },
              routes: [
                {
                  routeId: "next",
                  actions: [{ kind: "scene.goto" as const, sceneId: "scene.second" }],
                },
              ],
            },
          ],
        },
        {
          kind: "scene" as const,
          sceneId: "scene.second",
          clock: { kind: "renderer" as const, rendererInstanceId: secondRenderer.instanceId },
          renderers: [secondRenderer],
          anchors: [],
          gestures: [],
          timeline: { cues: [] },
          eventBindings: [
            {
              bindingId: "second.done",
              on: {
                type: "renderer.outcome" as const,
                sourceId: secondRenderer.instanceId,
                qualifierId: "media-ended",
              },
              routes: [
                {
                  routeId: "done",
                  actions: [{ kind: "ending.complete" as const, endingId: "ending.done" }],
                },
              ],
            },
          ],
        },
      ],
    },
  };
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
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: () => ({
        matches: false,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
    });
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keeps the opening still timer alive when the video slot moves to a new scene", async () => {
    await act(async () => {
      root.render(
        <ExperiencePlayer
          runtime={sceneHandoffManifest()}
          locale="en-US"
          copy={copy}
          loadTheme={() => Promise.resolve(theme)}
        />
      );
    });
    const start = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes(copy.start)
    );
    if (!start) {
      throw new Error(
        `The player never offered a start control. Rendered: ${container.textContent ?? ""}`
      );
    }
    await act(async () => {
      start.click();
    });
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
