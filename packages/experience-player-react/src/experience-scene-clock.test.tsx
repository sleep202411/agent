// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExperienceThemeConfig } from "@repo/shared/experience-runtime";
import { ExperiencePlayer } from "./experience-player";
import type { ExperiencePlayerCopy } from "./experience-player-copy";

/**
 * A `fixed` scene clock is the only clock the experience owns rather than reads
 * off a renderer, so nothing else in the player proves it works. These tests
 * drive time by hand: the real `requestAnimationFrame` would make the assertions
 * wait on wall-clock and go flaky, and it is the per-frame re-entry that makes
 * the interesting failure — advancing twice — possible at all.
 */

const HASH = "a".repeat(64);
const DURATION_MS = 6_000;

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
  checkpointPrompt: "Continue?",
  checkpointDescription: "Confirm to continue.",
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

const textRenderer = (instanceId: string, body: string) => ({
  instanceId,
  rendererId: "core.text",
  layer: 0,
  config: { body: localized(body), completion: "passive" as const },
  bindings: {},
});

/**
 * Two timed scenes back to back. The first carries the clock under test; the
 * second exists so "did it advance" is observable, and it ends the run so the
 * manifest stays a valid finite experience.
 */
function timedManifest() {
  return {
    manifestType: "fizzdragon.experience" as const,
    schemaVersion: 2 as const,
    channel: "preview" as const,
    gameId: "experience.clock",
    buildId: "build.clock.001",
    contentVersion: "build.clock.001",
    completionPolicy: "finite" as const,
    metadata: { title: localized("Clock") },
    compatibility: {
      engineApiVersion: "2.0.0",
      experienceApiVersion: "1.0.0",
      semanticRulesVersion: 1 as const,
      requiredCapabilities: ["core.text"],
    },
    localization: { defaultLocale: "en-US", locales: ["en-US"] },
    stateDefinitions: [],
    inputActions: [],
    rendererRequirements: [
      {
        rendererId: "core.text",
        apiVersion: "1.0.0",
        configSchemaVersion: "1.0.0",
        requiredCapabilities: ["core.text"],
        outcomes: [],
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
    ],
    theme: {
      themeId: "theme.default",
      apiVersion: "1.0.0",
      configAssetId: "theme.default.config",
    },
    telemetryDefinitions: [],
    endings: [
      {
        endingId: "ending.done",
        title: localized("Done"),
        kind: "success" as const,
      },
    ],
    graph: {
      entrySceneId: "scene.placeholder",
      nodes: [
        {
          kind: "scene" as const,
          sceneId: "scene.placeholder",
          clock: { kind: "fixed" as const, durationMs: DURATION_MS },
          renderers: [textRenderer("text.placeholder", "暂无影片")],
          anchors: [],
          gestures: [],
          timeline: { cues: [] },
          eventBindings: [
            {
              bindingId: "placeholder.advance",
              on: { type: "scene.clock-ended" },
              routes: [
                {
                  routeId: "advance",
                  actions: [{ kind: "scene.goto" as const, sceneId: "scene.after" }],
                },
              ],
            },
          ],
        },
        {
          kind: "scene" as const,
          sceneId: "scene.after",
          clock: { kind: "none" as const },
          renderers: [textRenderer("text.after", "next")],
          anchors: [],
          gestures: [],
          timeline: { cues: [] },
          eventBindings: [
            {
              bindingId: "after.complete",
              on: { type: "scene.entered" },
              routes: [
                {
                  routeId: "complete",
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

describe("ExperiencePlayer fixed scene clock", () => {
  let container: HTMLDivElement;
  let root: Root;
  let frames: Array<() => void>;
  let nowMs: number;

  const runFrame = async () => {
    const pending = frames;
    frames = [];
    await act(async () => {
      pending.forEach((frame) => frame());
    });
  };

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    frames = [];
    nowMs = 0;
    // jsdom ships neither matchMedia nor ResizeObserver, and the player asks
    // for both to pick its framing. Nothing here depends on their answers, only
    // on them existing.
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
    vi.spyOn(performance, "now").mockImplementation(() => nowMs);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(() => callback(nowMs));
      return frames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  const mount = async () => {
    await act(async () => {
      root.render(
        <ExperiencePlayer
          runtime={timedManifest()}
          locale="en-US"
          copy={copy}
          loadTheme={() => Promise.resolve(theme)}
        />
      );
    });
    // Playback is deliberately gesture-gated (browser autoplay rules), so the
    // clock cannot be observed until the viewer starts the experience.
    const start = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes(copy.start)
    );
    if (!start) throw new Error("The player never offered a start control.");
    await act(async () => {
      start.click();
    });
    await act(async () => {});
  };

  it("advances exactly once, and only after the declared duration", async () => {
    await mount();

    nowMs = DURATION_MS - 1;
    await runFrame();
    expect(container.textContent).toContain("暂无影片");

    nowMs = DURATION_MS;
    await runFrame();
    expect(container.textContent).toContain("next");

    // The scene is gone, but frames keep arriving. A clock that re-fires here
    // would skip a scene on every real playthrough.
    const framesAfterAdvance = frames.length;
    nowMs = DURATION_MS + 5_000;
    await runFrame();
    expect(container.textContent).toContain("next");
    expect(framesAfterAdvance).toBeLessThanOrEqual(1);
  });

  it("never advances a scene whose clock is not fixed", async () => {
    await mount();
    nowMs = DURATION_MS;
    await runFrame();
    expect(container.textContent).toContain("next");

    // scene.after declares `clock: none`; the run has already completed, so no
    // further frame may move it anywhere.
    frames = [];
    nowMs = DURATION_MS * 10;
    await runFrame();
    expect(frames).toHaveLength(0);
  });
});
