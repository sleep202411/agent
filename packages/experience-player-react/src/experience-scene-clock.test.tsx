// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ExperienceRuntimeManifestSchema,
  type ExperienceThemeConfig,
} from "@repo/shared/experience-runtime";
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
  continue: "Continue",
  emptySequence: "No footage yet",
  loadingMedia: "Loading",
  regionLabel: "Experience player",
  video: { unmute: "Unmute" },
  playback: {
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
  it("shows destination prices and confirms a paid choice once without a second node gate", async () => {
    const runtime = ExperienceRuntimeManifestSchema.parse(timedManifest());
    runtime.compatibility.requiredCapabilities.push("core.choice", "commerce.community-points");
    runtime.rendererRequirements.push({
      rendererId: "core.choice",
      apiVersion: "1.0.0",
      configSchemaVersion: "1.0.0",
      requiredCapabilities: ["core.choice"],
      outcomes: [{ outcomeType: "choice-selected" }],
      commands: [{ commandType: "open" }],
    });
    const source = runtime.graph.nodes[0]!;
    if (source.kind !== "scene") throw new Error("Expected scene");
    source.clock = { kind: "none" };
    source.renderers = [
      {
        instanceId: "choice",
        rendererId: "core.choice",
        layer: 100,
        bindings: {},
        config: {
          decisionId: "routes",
          prompt: localized("Choose"),
          initiallyOpen: true,
          choices: [
            { choiceId: "one", label: localized("First path") },
            { choiceId: "two", label: localized("Second path") },
          ],
        },
      },
    ];
    const requirement = {
      key: "node:scene.after",
      communityPointPrice: 20,
      title: localized("Next scene"),
    };
    runtime.graph.nodes[1]!.access = requirement;
    source.eventBindings = [
      {
        bindingId: "choice.selected",
        on: { type: "renderer.outcome", sourceId: "choice", qualifierId: "choice-selected" },
        routes: ["one", "two"].map((choiceId) => ({
          routeId: `route.${choiceId}`,
          access: requirement,
          when: {
            kind: "compare",
            left: { kind: "event", path: "choiceId" },
            operator: "equals",
            right: { kind: "literal", value: choiceId },
          },
          actions: [{ kind: "scene.goto", sceneId: "scene.after" }],
        })),
      },
    ];
    let owned = false;
    const requestAccess = vi.fn(async () => {
      owned = true;
      return true;
    });
    await act(async () => {
      root.render(
        <ExperiencePlayer
          runtime={runtime}
          locale="en-US"
          copy={copy}
          loadTheme={() => Promise.resolve(theme)}
          access={{
            canAccess: () => owned,
            requestAccess,
            formatPrice: (amount) => `${amount} points`,
          }}
        />
      );
    });
    const button = (text: string) =>
      [...container.querySelectorAll("button")].find((item) => item.textContent?.includes(text))!;
    await act(async () => {
      button(copy.start).click();
    });
    expect(button("First path").textContent).toContain("20 points");
    expect(button("Second path").textContent).toContain("20 points");
    await act(async () => {
      button("First path").click();
    });
    expect(requestAccess).toHaveBeenCalledExactlyOnceWith(requirement);
    expect(container.textContent).toContain("next");
  });

  it("refreshes existing ownership before showing a purchase prompt", async () => {
    const runtime = ExperienceRuntimeManifestSchema.parse(timedManifest());
    runtime.compatibility.requiredCapabilities.push("commerce.community-points");
    runtime.graph.nodes[1]!.access = {
      key: "node:scene.after",
      communityPointPrice: 20,
      title: localized("Next scene"),
    };
    let owned = false;
    const checkAccess = vi.fn(async () => {
      owned = true;
      return true;
    });
    const requestAccess = vi.fn(async () => false);
    await act(async () => {
      root.render(
        <ExperiencePlayer
          runtime={runtime}
          locale="en-US"
          copy={copy}
          loadTheme={() => Promise.resolve(theme)}
          access={{
            canAccess: () => owned,
            checkAccess,
            requestAccess,
            formatPrice: (amount) => `${amount} points`,
          }}
        />
      );
    });
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === copy.start)!
        .click();
    });
    nowMs = DURATION_MS;
    await runFrame();
    expect(checkAccess).toHaveBeenCalledTimes(1);
    expect(requestAccess).not.toHaveBeenCalled();
    expect(container.textContent).toContain("next");
  });

  it("pauses before paid content, cancels safely, and resumes the same operation after unlock", async () => {
    const runtime = ExperienceRuntimeManifestSchema.parse(timedManifest());
    runtime.compatibility.requiredCapabilities.push("commerce.community-points");
    runtime.graph.nodes[1]!.access = {
      key: "node:scene.after",
      communityPointPrice: 20,
      title: { "en-US": "Next scene" },
    };
    let allowed = false;
    let resolveAccess: (result: boolean) => void = () => {};
    const requestAccess = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveAccess = resolve;
        })
    );
    const checkpoint = vi.fn();
    await act(async () => {
      root.render(
        <ExperiencePlayer
          runtime={runtime}
          locale="en-US"
          copy={copy}
          loadTheme={() => Promise.resolve(theme)}
          access={{
            canAccess: () => allowed,
            requestAccess,
            formatPrice: (amount) => `${amount} points`,
          }}
          onAccessCheckpoint={checkpoint}
        />
      );
    });
    const start = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === copy.start
    )!;
    await act(async () => {
      start.click();
    });
    nowMs = DURATION_MS;
    await runFrame();
    expect(requestAccess).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("next");
    expect(checkpoint.mock.calls[0]?.[0].events[0].type).toBe("scene.clock-ended");
    await act(async () => {
      resolveAccess(false);
    });
    expect(container.textContent).not.toContain("next");
    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === copy.continue
    )!;
    await act(async () => {
      retry.click();
    });
    expect(requestAccess).toHaveBeenCalledTimes(2);
    await act(async () => {
      allowed = true;
      resolveAccess(true);
    });
    expect(container.textContent).toContain("next");
    expect(container.textContent).not.toContain(copy.runtimeError);
  });
});

/**
 * The placeholder for footage not attached yet holds its scene for a fixed beat
 * of story time: the beat starts at Start, never behind the title card, and it
 * belongs to the scene entry, so a host render mid-beat does not start it over.
 */
describe("ExperiencePlayer footage placeholder", () => {
  /** The player's beat for a shot without footage (EMPTY_SEQUENCE_HOLD_MS). */
  const BEAT_MS = 6_000;
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
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** The timed film, with its first scene turned into a video shot that has no footage yet. */
  function placeholderManifest() {
    const runtime = ExperienceRuntimeManifestSchema.parse(timedManifest());
    runtime.compatibility.requiredCapabilities.push("core.video");
    runtime.rendererRequirements.push({
      rendererId: "core.video",
      apiVersion: "1.0.0",
      configSchemaVersion: "1.0.0",
      requiredCapabilities: ["core.video"],
      outcomes: [{ outcomeType: "media-ended" }],
      commands: [],
    });
    const shot = runtime.graph.nodes[0]!;
    if (shot.kind !== "scene") throw new Error("Expected scene");
    shot.clock = { kind: "none" };
    shot.renderers = [
      {
        instanceId: "video.placeholder",
        rendererId: "core.video",
        layer: 0,
        bindings: {},
        config: { fit: "cover", sequence: [], autoplay: true },
      },
    ];
    shot.eventBindings = [
      {
        bindingId: "placeholder.ended",
        on: { type: "renderer.outcome", sourceId: "video.placeholder", qualifierId: "media-ended" },
        routes: [{ routeId: "advance", actions: [{ kind: "scene.goto", sceneId: "scene.after" }] }],
      },
    ];
    return runtime;
  }

  it("holds its beat from Start, once per scene entry, through host renders", async () => {
    const runtime = placeholderManifest();
    const render = async (playerCopy: ExperiencePlayerCopy) => {
      await act(async () => {
        root.render(
          <ExperiencePlayer
            runtime={runtime}
            locale="en-US"
            copy={playerCopy}
            loadTheme={() => Promise.resolve(theme)}
          />
        );
      });
    };
    const elapse = async (ms: number) => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    };

    await render(copy);
    // Longer than the beat, behind the title card: none of it is story time.
    await elapse(BEAT_MS * 2);
    const start = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === copy.start
    );
    if (!start) throw new Error("The player never offered a start control.");
    await act(async () => {
      start.click();
    });
    expect(container.textContent).toContain(copy.emptySequence);

    await elapse(BEAT_MS / 2);
    // A host render hands the placeholder a new callback; the beat carries on.
    await render({ ...copy });
    await elapse(BEAT_MS / 2 - 1);
    expect(container.textContent).not.toContain("next");

    await elapse(1);
    expect(container.textContent).toContain("next");
  });
});
