// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExperienceThemeConfig } from "@repo/shared/experience-runtime";
import { ExperiencePlayer, timelineReportDrivesScene } from "./experience-player";
import type { ExperiencePlayerCopy } from "./experience-player-copy";
import { journeyMapTestCopy } from "./experience-journey-test-copy";

/**
 * Branch-frame parking and timeline-control charging are the two runtime
 * behaviors the interactive-film player adds on top of gesture judging:
 * a resolved interaction must not cut the scene mid-pose, and a
 * timeline-control charge must read its progress off the scene clock rather
 * than wall time. Both are driven by hand here — the real
 * `requestAnimationFrame` would put the assertions on wall-clock and go
 * flaky, and it is the exact tick at which the parked event flushes that is
 * under test.
 */

const HASH = "a".repeat(64);

export const copy = {
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

export const theme: ExperienceThemeConfig = {
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

const CLOCK_MS = 10_000;

export function gestureManifest(input: {
  gesture: Record<string, unknown>;
  targets: Record<"success" | "failure" | "timeout", string>;
}) {
  const scene = (sceneId: string, body: string) => ({
    kind: "scene" as const,
    sceneId,
    clock: { kind: "none" as const },
    renderers: [textRenderer(`text.${sceneId}`, body)],
    anchors: [],
    gestures: [],
    timeline: { cues: [] },
    eventBindings: [
      {
        bindingId: `${sceneId}.complete`,
        on: { type: "scene.entered" },
        routes: [
          {
            routeId: "complete",
            actions: [{ kind: "ending.complete" as const, endingId: "ending.done" }],
          },
        ],
      },
    ],
  });
  return {
    manifestType: "fizzdragon.experience" as const,
    schemaVersion: 2 as const,
    channel: "preview" as const,
    gameId: "experience.branch-gate",
    buildId: "build.branch-gate.001",
    contentVersion: "build.branch-gate.001",
    completionPolicy: "finite" as const,
    metadata: { title: localized("Branch gate") },
    compatibility: {
      engineApiVersion: "2.0.0",
      experienceApiVersion: "1.0.0",
      semanticRulesVersion: 1 as const,
      requiredCapabilities: ["core.text", "input.tap", "input.press-hold", "spatial.anchor"],
    },
    localization: { defaultLocale: "en-US", locales: ["en-US"] },
    stateDefinitions: [],
    inputActions: [{ actionId: "input.dodge", label: localized("Dodge"), required: true }],
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
    endings: [{ endingId: "ending.done", title: localized("Done"), kind: "success" as const }],
    graph: {
      entrySceneId: "scene.fight",
      nodes: [
        {
          kind: "scene" as const,
          sceneId: "scene.fight",
          clock: { kind: "fixed" as const, durationMs: CLOCK_MS },
          renderers: [textRenderer("text.fight", "fight")],
          anchors: [
            {
              anchorId: "anchor.dodge",
              space: { kind: "viewport" as const },
              geometry: {
                default: {
                  kind: "rect" as const,
                  rect: { x: 0.3, y: 0.3, width: 0.4, height: 0.4 },
                },
              },
              motion: { kind: "fixed" as const },
            },
          ],
          gestures: [
            {
              gestureId: "gesture.dodge",
              anchorId: "anchor.dodge",
              inputActionId: "input.dodge",
              ...input.gesture,
            },
          ],
          timeline: { cues: [] },
          eventBindings: [
            {
              bindingId: "dodge.success",
              on: { type: "gesture.completed", sourceId: "gesture.dodge" },
              routes: [
                {
                  routeId: "go",
                  actions: [{ kind: "scene.goto" as const, sceneId: input.targets.success }],
                },
              ],
            },
            {
              bindingId: "dodge.failure",
              on: { type: "gesture.cancelled", sourceId: "gesture.dodge" },
              routes: [
                {
                  routeId: "go",
                  actions: [{ kind: "scene.goto" as const, sceneId: input.targets.failure }],
                },
              ],
            },
            {
              bindingId: "dodge.timeout",
              on: { type: "gesture.timed-out", sourceId: "gesture.dodge" },
              routes: [
                {
                  routeId: "go",
                  actions: [{ kind: "scene.goto" as const, sceneId: input.targets.timeout }],
                },
              ],
            },
          ],
        },
        scene(input.targets.success, "cleared"),
        ...[...new Set([input.targets.failure, input.targets.timeout])]
          .filter((sceneId) => sceneId !== input.targets.success)
          .map((sceneId) => scene(sceneId, "failed")),
      ],
    },
  };
}

describe("ExperiencePlayer branch frames and timeline-control charge", () => {
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

  const mount = async (runtime: ReturnType<typeof gestureManifest>) => {
    await act(async () => {
      root.render(
        <ExperiencePlayer
          runtime={runtime}
          locale="en-US"
          copy={copy}
          loadTheme={() => Promise.resolve(theme)}
        />
      );
    });
    const start = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes(copy.start)
    );
    if (!start) throw new Error("The player never offered a start control.");
    await act(async () => {
      start.click();
    });
    await act(async () => {});
  };

  const hotspotButton = (): HTMLButtonElement => {
    const button = container.querySelector<HTMLButtonElement>('button[aria-label="Dodge"]');
    if (!button) throw new Error("The hotspot control never mounted.");
    return button;
  };

  const press = (button: HTMLButtonElement) => {
    const event = new MouseEvent("pointerdown", { bubbles: true, button: 0 });
    (event as MouseEvent & { pointerId?: number }).pointerId = 1;
    act(() => {
      button.dispatchEvent(event);
    });
  };

  const release = (button: HTMLButtonElement) => {
    const event = new MouseEvent("pointerup", { bubbles: true, button: 0 });
    (event as MouseEvent & { pointerId?: number }).pointerId = 1;
    act(() => {
      button.dispatchEvent(event);
    });
  };

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    frames = [];
    nowMs = 0;
    // jsdom ships neither matchMedia nor ResizeObserver nor pointer capture,
    // and the spatial layer asks for all three. The layer must also measure a
    // real box before it renders any control, so getBoundingClientRect gets a
    // viewport-sized answer.
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
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        width: 1280,
        height: 720,
        right: 1280,
        bottom: 720,
        toJSON: () => ({}),
      }) as DOMRect;
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

  it("ignores a replaced custom theme loader that finishes late", async () => {
    const runtime = gestureManifest({
      gesture: { kind: "tap", maxDurationMs: 500 },
      targets: { success: "scene.clear", failure: "scene.clear", timeout: "scene.clear" },
    });
    let finish!: (value: ExperienceThemeConfig) => void;
    const oldLoader = () =>
      new Promise<ExperienceThemeConfig>((resolve) => {
        finish = resolve;
      });
    await act(async () => {
      root.render(
        <ExperiencePlayer
          runtime={runtime}
          randomSeed="stable"
          locale="en-US"
          copy={copy}
          loadTheme={oldLoader}
        />
      );
    });
    const newTheme = { ...theme, tokens: { "color.background": "#123456" } };
    await act(async () => {
      root.render(
        <ExperiencePlayer
          runtime={runtime}
          randomSeed="stable"
          locale="en-US"
          copy={copy}
          loadTheme={() => Promise.resolve(newTheme)}
        />
      );
    });
    const currentMarkup = container.innerHTML;
    await act(async () => {
      finish({ ...theme, tokens: { "color.background": "#abcdef" } });
    });
    expect(container.innerHTML).toBe(currentMarkup);
  });

  it("shows synchronous custom theme loader failures through the normal error state", async () => {
    const runtime = gestureManifest({
      gesture: { kind: "tap", maxDurationMs: 500 },
      targets: { success: "scene.clear", failure: "scene.clear", timeout: "scene.clear" },
    });
    await act(async () => {
      root.render(
        <ExperiencePlayer
          runtime={runtime}
          randomSeed="stable"
          locale="en-US"
          copy={copy}
          loadTheme={() => {
            throw new Error("Theme unavailable");
          }}
        />
      );
    });
    expect(container.textContent).toContain("Theme unavailable");
  });

  it("parks a resolved tap until the scene clock reaches the safe branch frame", async () => {
    await mount(
      gestureManifest({
        gesture: {
          kind: "tap",
          maxDurationMs: 500,
          activeWindow: { startMs: 1_000, endMs: 2_000 },
          branchAtMs: 2_500,
        },
        targets: { success: "scene.clear", failure: "scene.clear", timeout: "scene.clear" },
      })
    );

    nowMs = 1_500;
    await runFrame();
    act(() => {
      hotspotButton().click();
    });

    // The tap resolved at 1.5s but the safe frame is 2.5s: the cut waits.
    nowMs = 2_400;
    await runFrame();
    expect(container.textContent).toContain("fight");

    nowMs = 2_600;
    await runFrame();
    expect(container.textContent).toContain("cleared");
  });

  it("falls back to the window end as the safe frame when none is authored", async () => {
    await mount(
      gestureManifest({
        gesture: {
          kind: "tap",
          maxDurationMs: 500,
          activeWindow: { startMs: 1_000, endMs: 2_000 },
        },
        targets: { success: "scene.clear", failure: "scene.clear", timeout: "scene.clear" },
      })
    );

    nowMs = 1_500;
    await runFrame();
    act(() => {
      hotspotButton().click();
    });

    // No explicit branch frame: the input window end is the safe frame, so an
    // early success still plays its resolve beat inside the window.
    nowMs = 1_900;
    await runFrame();
    expect(container.textContent).toContain("fight");

    nowMs = 2_100;
    await runFrame();
    expect(container.textContent).toContain("cleared");
  });

  it("charges a timeline-control hold from the scene clock and completes at the threshold", async () => {
    await mount(
      gestureManifest({
        gesture: {
          kind: "press-hold",
          durationMs: 1_000,
          releaseBehavior: "reset",
          cancelOnPointerExit: true,
          timelineControl: true,
          activeWindow: { startMs: 1_000, endMs: 3_000 },
          branchAtMs: 3_200,
        },
        targets: { success: "scene.clear", failure: "scene.fail", timeout: "scene.fail" },
      })
    );

    nowMs = 1_500;
    await runFrame();
    const button = hotspotButton();
    press(button);

    // Holding across the threshold (window start 1.0s + duration 1.0s).
    nowMs = 2_100;
    await runFrame();
    release(button);

    // Completed resolves at 2.1s; the cut still waits for the 3.2s frame.
    nowMs = 3_000;
    await runFrame();
    expect(container.textContent).toContain("fight");

    nowMs = 3_300;
    await runFrame();
    expect(container.textContent).toContain("cleared");
  });

  it("latches failure when a timeline-control hold releases below the threshold", async () => {
    await mount(
      gestureManifest({
        gesture: {
          kind: "press-hold" as const,
          durationMs: 1_000,
          releaseBehavior: "reset" as const,
          cancelOnPointerExit: true,
          timelineControl: true,
          activeWindow: { startMs: 1_000, endMs: 3_000 },
          branchAtMs: 3_200,
        },
        targets: { success: "scene.clear", failure: "scene.fail", timeout: "scene.fail" },
      })
    );

    nowMs = 1_500;
    await runFrame();
    const button = hotspotButton();
    press(button);

    nowMs = 1_800;
    await runFrame();
    release(button);

    nowMs = 3_300;
    await runFrame();
    expect(container.textContent).toContain("failed");
  });

  it("rejects media time reports from a renderer the scene clock does not own", () => {
    // The dying-video race: after a scene change, the outgoing video element
    // fires one last timeupdate with the old scene's final position. That
    // report must not drive the incoming scene's clock, or its interaction
    // windows resolve the instant the scene mounts.
    expect(
      timelineReportDrivesScene({ kind: "renderer", rendererInstanceId: "video.new" }, "video.new")
    ).toBe(true);
    expect(
      timelineReportDrivesScene({ kind: "renderer", rendererInstanceId: "video.new" }, "video.old")
    ).toBe(false);
    expect(
      timelineReportDrivesScene({ kind: "renderer", rendererInstanceId: "video.new" }, null)
    ).toBe(false);
    // Host-owned reports (fixed/none clocks) are always accepted.
    expect(timelineReportDrivesScene({ kind: "fixed", durationMs: 1_000 }, null)).toBe(true);
    expect(timelineReportDrivesScene({ kind: "none" }, null)).toBe(true);
  });
});
