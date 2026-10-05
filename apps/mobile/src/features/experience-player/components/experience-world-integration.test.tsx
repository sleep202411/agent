import React, { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ExperiencePlayer } from "./experience-player";
import { worldManifestFixture } from "../world/__fixtures__/world-manifest";
import type { ExperiencePlayerCopy } from "../lib/experience-player-copy";
const h = vi.hoisted(() => ({ world: null as any, end: vi.fn(), active: true }));
vi.mock("react-native", () => ({
  View: ({ children }: any) => <div>{children}</div>,
  Text: "span",
  ScrollView: "div",
  Pressable: ({ children, onPress, accessibilityLabel }: any) => (
    <button onClick={onPress} aria-label={accessibilityLabel}>
      {children}
    </button>
  ),
  StyleSheet: { create: (v: any) => v },
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: any) => <span>{children}</span>,
}));
vi.mock("@/config", () => ({ resolveExperienceAssetUrl: (u: string) => u }));
vi.mock("@/constants/theme", () => ({ Spacing: {} }));
vi.mock("@/hooks/use-app-active", async () => {
  const { createContext } = await import("react");
  return { useScreenActive: () => h.active, ScreenActiveGateContext: createContext(true) };
});
vi.mock("../hooks/use-experience-audio-host", () => ({
  useExperienceAudioHost: () => ({
    unlock: async () => {},
    suspend: async () => {},
    applyEffects: () => {},
    checkpoint: () => ({ playbacks: [], busGains: {} }),
  }),
}));
vi.mock("../hooks/use-experience-preload", () => ({
  useExperiencePreload: () => ({ done: true }),
}));
vi.mock("./experience-spatial-layer", () => ({ ExperienceSpatialLayer: () => null }));
vi.mock("./experience-video-renderer", () => ({ ExperienceVideoRenderer: () => null }));
vi.mock("./experience-start-shell", () => ({
  EXPERIENCE_START_ACCENT: "red",
  ExperienceStartShell: ({ onPressCta }: any) => <button onClick={onPressCta}>Start</button>,
}));
vi.mock("../world/experience-world-renderer", () => ({
  ExperienceWorldRenderer: function World(props: any) {
    h.world = props;
    const { onEndHandle, onCompleted } = props;
    useEffect(() => {
      onEndHandle(async () => {
        h.end();
        onCompleted();
      });
      return () => onEndHandle(null);
    }, [onEndHandle, onCompleted]);
    return <button onClick={props.onCompleted}>Finish world</button>;
  },
}));
const scope = {
  projectId: "21111111-1111-4111-8111-111111111111",
  workspaceId: "11111111-1111-4111-8111-111111111111",
  generation: 1,
};
const copy = {
  unsupportedRuntime: "Unsupported",
  invalidManifest: "Invalid",
  pause: "Pause",
  resume: "Resume",
  paused: "Paused",
  endingEyebrow: "Finished",
  playAgain: "Again",
} as ExperiencePlayerCopy;
const loadTheme = async () => ({ tokens: {} }) as any;
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  h.world = null;
  h.active = true;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function start(runtime = worldManifestFixture()) {
  await act(async () =>
    root.render(
      <ExperiencePlayer
        runtime={runtime}
        locale="en-US"
        copy={copy}
        worldScope={scope}
        loadTheme={loadTheme}
      />
    )
  );
  await act(async () => host.querySelector("button")!.click());
  // React's lazy boundary may defer its commit after resolving the import.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 320));
  });
}
it("mounts a scoped world scene and routes completion through the real engine", async () => {
  await start();
  expect(h.world.scope).toEqual({ ...scope, worldId: "31111111-1111-4111-8111-111111111111" });
  await act(async () =>
    Array.from(host.querySelectorAll("button"))
      .find((b) => b.textContent === "Finish world")!
      .click()
  );
  expect(host.textContent).toContain("Finished");
  expect(host.textContent).toContain("Done");
});
it("delivers an end command emitted on scene entry after the renderer mounts", async () => {
  const runtime = worldManifestFixture();
  const node = runtime.graph.nodes[0];
  if (node.kind !== "scene") throw new Error("fixture");
  node.eventBindings.unshift({
    bindingId: "end.on.enter",
    on: { type: "scene.entered", sourceId: node.sceneId },
    routes: [
      {
        routeId: "end.world",
        actions: [
          { kind: "renderer.command", instanceId: "text.primary", commandType: "end", payload: {} },
        ],
      },
    ],
  });
  await start(runtime);
  expect(h.end).toHaveBeenCalledOnce();
  expect(host.textContent).toContain("Finished");
});
it("keeps the public capability guard and rejects cross-project private input", async () => {
  const runtime = worldManifestFixture();
  await act(async () =>
    root.render(
      <ExperiencePlayer runtime={runtime} locale="en-US" copy={copy} loadTheme={loadTheme} />
    )
  );
  expect(host.textContent).toContain("Unsupported");
  expect(h.world).toBeNull();
  await act(async () =>
    root.render(
      <ExperiencePlayer
        runtime={runtime}
        locale="en-US"
        copy={copy}
        worldScope={{ ...scope, projectId: scope.workspaceId }}
        loadTheme={loadTheme}
      />
    )
  );
  expect(host.textContent).toContain("scope mismatch");
  expect(h.world).toBeNull();
});
it("delivers the destination scene's queued end after a graph transition", async () => {
  const runtime = worldManifestFixture();
  const source = runtime.graph.nodes[0];
  if (source.kind !== "scene") throw new Error("fixture");
  const destination = structuredClone(source);
  destination.sceneId = "scene.destination";
  destination.renderers[0].instanceId = "world.destination";
  destination.eventBindings[0].bindingId = "destination.complete";
  destination.eventBindings[0].on.sourceId = "world.destination";
  destination.eventBindings.unshift({
    bindingId: "destination.enter",
    on: { type: "scene.entered", sourceId: destination.sceneId },
    routes: [
      {
        routeId: "destination.end",
        actions: [
          {
            kind: "renderer.command",
            instanceId: "world.destination",
            commandType: "end",
            payload: {},
          },
        ],
      },
    ],
  });
  source.eventBindings = [
    {
      bindingId: "source.enter",
      on: { type: "scene.entered", sourceId: source.sceneId },
      routes: [
        { routeId: "source.next", actions: [{ kind: "scene.goto", sceneId: destination.sceneId }] },
      ],
    },
  ];
  runtime.graph.nodes.push(destination);
  await start(runtime);
  expect(h.end).toHaveBeenCalledOnce();
  expect(host.textContent).toContain("Finished");
});
