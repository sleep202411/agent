// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ExperienceRuntimeManifestSchema,
  type ExperienceRuntimeManifest,
  type ExperienceThemeConfig,
} from "@repo/shared/experience-runtime";
import type { ExperienceRuntimeState } from "@repo/experience-engine";
import {
  ExperiencePlayer,
  type ExperienceAccessCheckpoint,
  type ExperiencePlayerAccess,
} from "./experience-player";
import { journeyMapTestCopy } from "./experience-journey-test-copy";
import type { ExperiencePlayerCopy } from "./experience-player-copy";

const text = (value: string) => ({ "en-US": value });
const requirement = { key: "node:scene.a", communityPointPrice: 20, title: text("Courtyard") };
const theme: ExperienceThemeConfig = {
  schemaVersion: 1,
  colorScheme: "dark",
  tokens: {},
  rendererStyles: {},
  motion: { reducedMotionBehavior: "minimize" },
};
const copy: ExperiencePlayerCopy = {
  invalidManifest: "Invalid",
  manifestRoot: "Root",
  interactiveFilm: "Film",
  starting: "Loading",
  start: "Start",
  endingEyebrow: "Ending",
  unknownEnding: () => "Finished",
  playAgain: "Play again",
  runtimeError: "Error",
  restart: "Restart",
  mediaError: () => "Media error",
  videoLabel: () => "Video",
  emptySequence: "Empty",
  loadingMedia: "Loading media",
  noVisibleChoices: "No choices",
  continue: "Continue",
  regionLabel: "Region",
  video: { unmute: "Sound" },
  journeyMap: journeyMapTestCopy,
  playback: {
    pause: "Pause",
    resume: "Resume",
    paused: "Paused",
    continuePlaying: "Continue playing",
    interrupted: "Interrupted",
    transport: {
      controlsLabel: "Playback",
      rewind10: "Back",
      forward10: "Forward",
      progressLabel: "Progress",
      speedLabel: "Speed",
      watchedOnlyHint: "Watched only",
      interactionBlocked: "Interaction",
    },
  },
};
function manifest(paid = false): ExperienceRuntimeManifest {
  const enter = (sceneId: string) => ({
    bindingId: `${sceneId}.enter`,
    on: { type: "scene.entered", sourceId: sceneId },
    routes: [
      {
        routeId: "count",
        actions: [
          { kind: "state.increment", path: "entries", amount: { kind: "literal", value: 1 } },
        ],
      },
    ],
  });
  return ExperienceRuntimeManifestSchema.parse({
    manifestType: "fizzdragon.experience",
    schemaVersion: 2,
    channel: "production",
    gameId: "game.map",
    buildId: "build.map",
    contentVersion: "map.1",
    completionPolicy: "finite",
    metadata: { title: text("Branch fixture"), experienceProfile: "narrative" },
    compatibility: {
      engineApiVersion: "2.0.0",
      experienceApiVersion: "1.0.0",
      semanticRulesVersion: 1,
      requiredCapabilities: [
        "core.text",
        "core.choice",
        ...(paid ? ["commerce.community-points"] : []),
      ],
    },
    localization: { defaultLocale: "en-US", locales: ["en-US"] },
    stateDefinitions: [
      { key: "entries", valueType: "number", scope: "session", initialValue: 0 },
      { key: "choice", valueType: "string", scope: "session", initialValue: "none" },
    ],
    rendererRequirements: [
      {
        rendererId: "core.text",
        apiVersion: "1.0.0",
        configSchemaVersion: "1.0.0",
        requiredCapabilities: ["core.text"],
        outcomes: [{ outcomeType: "text-completed" }],
        commands: [],
      },
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
      {
        assetId: "theme",
        sourceAssetId: "theme.source",
        kind: "data",
        uri: "/theme.json",
        sha256: "a".repeat(64),
        mediaType: "application/json",
        format: "json",
      },
    ],
    theme: { themeId: "theme.map", apiVersion: "1.0.0", configAssetId: "theme" },
    endings: [{ endingId: "done", title: text("Done"), kind: "success" }],
    graph: {
      entrySceneId: "scene.entry",
      nodes: [
        {
          kind: "scene",
          sceneId: "scene.entry",
          renderers: [
            {
              instanceId: "choice",
              rendererId: "core.choice",
              layer: 10,
              config: {
                decisionId: "decision",
                prompt: text("Choose a route"),
                initiallyOpen: true,
                choices: [
                  { choiceId: "a", label: text("Courtyard") },
                  { choiceId: "b", label: text("City gate") },
                ],
              },
            },
          ],
          eventBindings: [
            enter("scene.entry"),
            {
              bindingId: "choose",
              on: { type: "renderer.outcome", sourceId: "choice", qualifierId: "choice-selected" },
              routes: ["a", "b"].map((id) => ({
                routeId: id,
                when: {
                  kind: "compare",
                  left: { kind: "event", path: "choiceId" },
                  operator: "equals",
                  right: { kind: "literal", value: id },
                },
                actions: [
                  { kind: "state.set", path: "choice", value: { kind: "literal", value: id } },
                  { kind: "scene.goto", sceneId: `scene.${id}` },
                ],
              })),
            },
          ],
        },
        ...["a", "b"].map((id) => ({
          kind: "scene",
          sceneId: `scene.${id}`,
          ...(paid && id === "a" ? { access: requirement } : {}),
          renderers: [
            {
              instanceId: `text.${id}`,
              rendererId: "core.text",
              layer: 0,
              config: {
                title: text(id === "a" ? "Inside the courtyard" : "At the city gate"),
                body: text("The chosen path."),
                completion: "continue",
              },
            },
          ],
          eventBindings: [
            enter(`scene.${id}`),
            {
              bindingId: `finish.${id}`,
              on: {
                type: "renderer.outcome",
                sourceId: `text.${id}`,
                qualifierId: "text-completed",
              },
              routes: [
                { routeId: "finish", actions: [{ kind: "ending.complete", endingId: "done" }] },
              ],
            },
          ],
        })),
      ],
    },
  });
}
function routePaidManifest(): ExperienceRuntimeManifest {
  const runtime = manifest(true);
  const courtyard = runtime.graph.nodes.find((scene) => scene.sceneId === "scene.a")!;
  delete courtyard.access;
  runtime.graph.nodes[0]!.eventBindings.find(
    (binding) => binding.bindingId === "choose"
  )!.routes[0]!.access = requirement;
  return ExperienceRuntimeManifestSchema.parse(runtime);
}
let root: Root;
let container: HTMLDivElement;
let latest: ExperienceAccessCheckpoint | undefined;
let state: ExperienceRuntimeState | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  latest = undefined;
  state = undefined;
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render(
  runtime = manifest(),
  checkpoint?: ExperienceAccessCheckpoint,
  access?: ExperiencePlayerAccess
) {
  await act(async () => {
    root.render(
      <ExperiencePlayer
        runtime={runtime}
        locale="en-US"
        copy={copy}
        randomSeed="map.fixture"
        loadTheme={async () => theme}
        accessCheckpoint={checkpoint}
        access={access}
        onCheckpoint={(value) => {
          latest = value;
        }}
        onStateChange={(value) => {
          state = value;
        }}
      />
    );
  });
}
function button(label: string) {
  const buttons = [...document.body.querySelectorAll<HTMLButtonElement>("button")];
  const found = buttons.find(
    (value) =>
      value.textContent?.trim() === label ||
      value.getAttribute("aria-label") === label ||
      value.textContent?.trim().includes(label)
  );
  if (!found) throw new Error(`Missing ${label}: ${container.textContent}`);
  return found;
}
async function click(label: string) {
  await act(async () => {
    button(label).click();
  });
}
function node(sceneId: string) {
  return document.body.querySelector<HTMLElement>(`[data-journey-node="${sceneId}"]`)!;
}
async function replay(sceneId: string) {
  await act(async () => {
    node(sceneId).querySelector<HTMLButtonElement>("button")!.click();
  });
}

describe("plot map and historical branch replay", () => {
  it("opens from the corner during choices and endings, then returns focus without changing the story", async () => {
    const corner = () =>
      container.querySelector<HTMLButtonElement>('[data-experience-journey-map-trigger="corner"]');
    await render();
    expect(corner()).toBeNull();
    await click("Start");
    await act(async () => {
      corner()!.focus();
      corner()!.click();
    });
    expect(node("scene.entry").getAttribute("data-current")).toBe("true");
    expect(state?.values.session).toEqual({ entries: 1, choice: "none" });
    await click(copy.journeyMap.close);
    expect(document.activeElement).toBe(corner());
    await click("Courtyard");
    await click("Continue");
    expect(state?.status).toBe("completed");
    expect(corner()).not.toBeNull();
    await act(async () => corner()!.click());
    expect(node("@ending:done").getAttribute("data-current")).toBe("true");
    await click(copy.journeyMap.close);
    expect(document.activeElement).toBe(corner());
    expect(state?.status).toBe("completed");
    expect(state?.completedEndingId).toBe("done");
  });

  it("records successful entry and actual routes, then restores branch variables without repeating entry actions", async () => {
    await render();
    await click("Start");
    expect(state?.values.session.entries).toBe(1);
    await click("Courtyard");
    expect(state?.values.session).toEqual({ entries: 2, choice: "a" });
    await click(copy.journeyMap.open);
    expect(node("scene.b").textContent).toContain("???");
    const unexplored = node("scene.b").querySelector<HTMLButtonElement>("button")!;
    expect(unexplored.getAttribute("aria-label")).toBe(copy.journeyMap.unexplored);
    expect(node("scene.b").textContent).not.toContain("city gate");
    await act(async () => unexplored.click());
    const explanation = document.body.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(explanation.hidden).toBe(false);
    expect(explanation.textContent).toContain(copy.journeyMap.unexploredHint);
    expect(state?.currentSceneId).toBe("scene.a");
    expect(state?.values.session).toEqual({ entries: 2, choice: "a" });
    await replay("scene.entry");
    expect(state?.currentSceneId).toBe("scene.entry");
    expect(state?.values.session).toEqual({ entries: 1, choice: "none" });
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    await click("City gate");
    expect(state?.values.session).toEqual({ entries: 2, choice: "b" });
    expect(latest?.journey?.visitedNodeIds).toEqual(["scene.entry", "scene.a", "scene.b"]);
    expect(latest?.journey?.traversedEdges.map((edge) => edge.routeId)).toEqual(["a", "b"]);
    expect(
      latest?.journey?.anchors.every(
        (anchor) => !("journey" in anchor) && !("journey" in anchor.state)
      )
    ).toBe(true);
  });
  it("preserves explored branches and their historical anchors across save and reload", async () => {
    const runtime = manifest();
    await render(runtime);
    await click("Start");
    await click("Courtyard");
    const saved = structuredClone(latest!);
    act(() => root.unmount());
    root = createRoot(container);
    await render(runtime, saved);
    await click("Start");
    await click(copy.journeyMap.open);
    expect(node("scene.a").textContent).toContain(copy.journeyMap.current);
    await replay("scene.entry");
    expect(state?.values.session.entries).toBe(1);
    await click("City gate");
    expect(latest?.journey?.anchors.map((anchor) => anchor.sceneId)).toEqual([
      "scene.entry",
      "scene.a",
      "scene.b",
    ]);
  });
  it("rechecks current access and leaves the current branch intact after a declined replay unlock", async () => {
    let allowed = true;
    const checkAccess = vi.fn(async () => allowed);
    const requestAccess = vi.fn(async () => false);
    const access = { canAccess: () => allowed, checkAccess, requestAccess, formatPrice: String };
    await render(manifest(true), undefined, access);
    await click("Start");
    await click("Courtyard");
    await click(copy.journeyMap.open);
    await replay("scene.entry");
    await click("City gate");
    allowed = false;
    await click(copy.journeyMap.open);
    await replay("scene.a");
    expect(checkAccess).toHaveBeenCalledWith(requirement);
    expect(requestAccess).toHaveBeenCalledWith(requirement);
    expect(state?.currentSceneId).toBe("scene.b");
    expect(state?.values.session.choice).toBe("b");
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  });
  it("can revisit a completed story without replaying its completion on restore", async () => {
    await render();
    await click("Start");
    await click("Courtyard");
    await click("Continue");
    expect(state?.status).toBe("completed");
    await click(copy.journeyMap.open);
    await replay("scene.entry");
    expect(state?.status).toBe("active");
    expect(state?.completedEndingId).toBeUndefined();
    expect(state?.values.session.entries).toBe(1);
  });
  it("checks route gates on replay and releases map focus while the host handles an unlock", async () => {
    let allowed = true;
    let settle!: (value: boolean) => void;
    const requestAccess = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          settle = resolve;
        })
    );
    const access = {
      canAccess: () => allowed,
      checkAccess: vi.fn(async () => allowed),
      requestAccess,
      formatPrice: String,
    };
    await render(routePaidManifest(), undefined, access);
    await click("Start");
    await click("Courtyard");
    expect(latest?.journey?.activeAccessRefs).toContainEqual({
      kind: "route",
      sceneId: "scene.entry",
      bindingId: "choose",
      routeId: "a",
    });
    await click(copy.journeyMap.open);
    await replay("scene.entry");
    expect(latest?.journey?.activeAccessRefs).toEqual([]);
    await click("City gate");
    allowed = false;
    await click(copy.journeyMap.open);
    await replay("scene.a");
    expect(requestAccess).toHaveBeenCalledWith(requirement);
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    const hostButton = document.createElement("button");
    document.body.append(hostButton);
    hostButton.focus();
    expect(document.activeElement).toBe(hostButton);
    await act(async () => settle(false));
    hostButton.remove();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(state?.values.session).toEqual({ entries: 2, choice: "b" });
    requestAccess.mockRejectedValueOnce(new Error("Unlock service unavailable"));
    await replay("scene.a");
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
      "Unlock service unavailable"
    );
    expect(state?.currentSceneId).toBe("scene.b");
  });
  it("requires earlier branch access when resuming a save in an otherwise public scene", async () => {
    const runtime = routePaidManifest();
    let allowed = true;
    const requestAccess = vi.fn(async () => false);
    const access = {
      canAccess: () => allowed,
      checkAccess: vi.fn(async () => allowed),
      requestAccess,
      formatPrice: String,
    };
    await render(runtime, undefined, access);
    await click("Start");
    await click("Courtyard");
    const saved = structuredClone(latest!);
    act(() => root.unmount());
    root = createRoot(container);
    allowed = false;
    await render(runtime, saved, access);
    expect(container.textContent).not.toContain("Inside the courtyard");
    await click("Start");
    expect(requestAccess).toHaveBeenCalledWith(requirement);
    expect(container.textContent).not.toContain("Inside the courtyard");
    expect(container.querySelector('[aria-label="Open plot map"]')).toBeNull();
  });
  it("still offers an unlock for a legacy paid-scene save with no journey or queued events", async () => {
    const runtime = manifest(true);
    let allowed = true;
    const requestAccess = vi.fn(async () => false);
    const access = {
      canAccess: () => allowed,
      checkAccess: vi.fn(async () => allowed),
      requestAccess,
      formatPrice: String,
    };
    await render(runtime, undefined, access);
    await click("Start");
    await click("Courtyard");
    const saved = structuredClone(latest!);
    delete saved.journey;
    expect(saved.events).toEqual([]);
    act(() => root.unmount());
    root = createRoot(container);
    allowed = false;
    await render(runtime, saved, access);
    await click("Start");
    expect(requestAccess).toHaveBeenCalledWith(requirement);
    expect(container.textContent).not.toContain("Inside the courtyard");
    expect(container.querySelector('[aria-label="Open plot map"]')).toBeNull();
  });
});
