import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  EXPERIENCE_CORE_VIDEO_RENDERER_ID,
  type ExperienceRuntimeManifest,
  type ExperienceThemeConfig,
} from "@repo/shared/experience-runtime";
import { ExperiencePlayer } from "./experience-player";
import type { ExperiencePlayerCopy } from "../lib/experience-player-copy";
const h = vi.hoisted(() => ({
  active: true,
  state: { currentSceneId: "scene" },
  unlock: vi.fn().mockResolvedValue(undefined),
  suspend: vi.fn().mockResolvedValue(undefined),
  effects: vi.fn(),
  dispatch: vi.fn(),
  outcome: vi.fn(),
  mediaPresenting: true,
  spatialPresenting: true,
  hold: (_hold: boolean) => {},
  video: {} as {
    onCompleted: () => void;
    onPlaybackRefused: () => void;
    onPlaybackHandle: (id: string, handle: unknown) => void;
  },
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Pressable: ({
    children,
    onPress,
    accessibilityLabel,
  }: {
    children?: ReactNode;
    onPress?: () => void;
    accessibilityLabel?: string;
  }) => (
    <button aria-label={accessibilityLabel} onClick={onPress}>
      {children}
    </button>
  ),
  ScrollView: "div",
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock("@/components/themed-text", () => ({ ThemedText: "span" }));
vi.mock("@/config", () => ({ resolveExperienceAssetUrl: (uri: string) => uri }));
vi.mock("@/constants/theme", () => ({ Spacing: {} }));
vi.mock("@/hooks/use-app-active", async () => {
  const { createContext } = await import("react");
  return { useScreenActive: () => h.active, ScreenActiveGateContext: createContext(true) };
});
vi.mock("../hooks/use-experience-audio-host", () => ({
  useExperienceAudioHost: () => ({ unlock: h.unlock, suspend: h.suspend, applyEffects: h.effects }),
}));
vi.mock("../hooks/use-experience-preload", () => ({
  useExperiencePreload: () => ({ done: true }),
}));
vi.mock("../lib/experience-runtime-host", () => ({
  createExperienceRuntime: () => ({
    state: () => h.state,
    start: () => ({ state: h.state, effects: [] }),
    dispatch: h.dispatch,
    emitRendererOutcome: h.outcome,
  }),
}));
vi.mock("./experience-spatial-layer", async () => {
  const { useContext } = await import("react");
  const { ScreenActiveGateContext } = await import("@/hooks/use-app-active");
  return {
    ExperienceSpatialLayer: ({
      onTimelineHoldGateChange,
    }: {
      onTimelineHoldGateChange: (hold: boolean) => void;
    }) => {
      h.hold = onTimelineHoldGateChange;
      h.spatialPresenting = useContext(ScreenActiveGateContext);
      return null;
    },
  };
});
vi.mock("./experience-video-renderer", async () => {
  const { useContext } = await import("react");
  const { ScreenActiveGateContext } = await import("@/hooks/use-app-active");
  return {
    ExperienceVideoRenderer: (props: unknown) => {
      h.video = props as typeof h.video;
      h.mediaPresenting = useContext(ScreenActiveGateContext);
      return <div>Film</div>;
    },
  };
});
vi.mock("./experience-start-shell", () => ({
  EXPERIENCE_START_ACCENT: "red",
  ExperienceStartShell: ({ onPressCta }: { onPressCta: () => void }) => (
    <button onClick={onPressCta}>Start</button>
  ),
}));
vi.mock("@repo/shared/experience-runtime", async (importOriginal) => {
  const original = await importOriginal<typeof import("@repo/shared/experience-runtime")>();
  return {
    ...original,
    ExperienceRuntimeManifestSchema: { safeParse: (data: unknown) => ({ success: true, data }) },
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const runtime = {
  buildId: "fixture",
  graph: {
    nodes: [
      {
        kind: "scene",
        sceneId: "scene",
        renderers: [
          { instanceId: "video", rendererId: EXPERIENCE_CORE_VIDEO_RENDERER_ID, layer: 0 },
        ],
        clock: { kind: "fixed", durationMs: 10000 },
        timeline: { cues: [] },
      },
    ],
  },
  metadata: { title: { "en-US": "Fixture" } },
  assets: [],
  localization: { locales: ["en-US"], defaultLocale: "en-US" },
} as unknown as ExperienceRuntimeManifest;
const copy = { pause: "Pause", resume: "Resume", paused: "Paused" } as ExperiencePlayerCopy;
const loader = () => Promise.resolve({ tokens: {} } as ExperienceThemeConfig);
let root: Root;
let container: HTMLDivElement;
const render = (active = true) =>
  act(async () =>
    root.render(
      <ExperiencePlayer
        runtime={runtime}
        locale="en-US"
        copy={copy}
        randomSeed="fixed"
        loadTheme={loader}
        active={active}
      />
    )
  );
const click = (label: string) =>
  act(async () => {
    const target = [...container.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === label || b.textContent === label
    );
    expect(target).toBeTruthy();
    target!.click();
  });
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
  h.active = true;
  vi.clearAllMocks();
  h.dispatch.mockImplementation(() => ({ state: h.state, effects: [] }));
  h.outcome.mockImplementation(() => ({ state: h.state, effects: [] }));
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
});
it("freezes fixed story time and holds a late media completion until explicit resume", async () => {
  await render();
  await click("Start");
  await act(async () => {
    vi.advanceTimersByTime(1000);
  });
  await click("Pause");
  await act(async () => {
    h.video.onCompleted();
    vi.advanceTimersByTime(20000);
  });
  expect(h.outcome).not.toHaveBeenCalled();
  expect(h.dispatch).not.toHaveBeenCalledWith(
    expect.arrayContaining([expect.objectContaining({ type: "scene.clock-ended" })])
  );
  expect(h.suspend).toHaveBeenCalled();
  await click("Resume");
  expect(h.outcome).toHaveBeenCalledTimes(1);
  await act(async () => {
    vi.advanceTimersByTime(9100);
  });
  expect(h.dispatch).toHaveBeenCalledWith(
    expect.arrayContaining([expect.objectContaining({ type: "scene.clock-ended" })])
  );
});
it("returning from the background stays paused until the viewer resumes", async () => {
  await render();
  await click("Start");
  h.active = false;
  await render();
  h.active = true;
  await render();
  expect(container.querySelector('[aria-label="Resume"]')).not.toBeNull();
  const unlocks = h.unlock.mock.calls.length;
  await act(async () => {
    vi.advanceTimersByTime(15000);
  });
  expect(h.unlock).toHaveBeenCalledTimes(unlocks);
  await click("Resume");
  expect(container.querySelector('[aria-label="Pause"]')).not.toBeNull();
});

it("holds media without freezing the interaction, then releases a late completion once", async () => {
  await render();
  await click("Start");
  await act(async () => h.hold(true));
  expect(h.mediaPresenting).toBe(false);
  expect(h.spatialPresenting).toBe(true);
  await act(async () => h.video.onCompleted());
  expect(h.outcome).not.toHaveBeenCalled();
  await click("Pause");
  expect(h.spatialPresenting).toBe(false);
  await click("Resume");
  expect(h.mediaPresenting).toBe(false);
  expect(h.spatialPresenting).toBe(true);
  expect(h.outcome).not.toHaveBeenCalled();
  await act(async () => h.hold(false));
  expect(h.mediaPresenting).toBe(true);
  expect(h.outcome).toHaveBeenCalledTimes(1);
});

it("pauses on autoplay refusal and retries from the Resume tap", async () => {
  await render();
  await click("Start");
  const play = vi.fn().mockResolvedValue(undefined);
  await act(async () =>
    h.video.onPlaybackHandle("film", {
      play,
      pause: vi.fn(),
      seek: vi.fn(),
      playbackIdentity: "film",
    })
  );
  await act(async () => h.video.onPlaybackRefused());
  expect(container.querySelector('[aria-label="Resume"]')).not.toBeNull();
  await act(async () => vi.advanceTimersByTime(15000));
  expect(h.dispatch).not.toHaveBeenCalledWith(
    expect.arrayContaining([expect.objectContaining({ type: "scene.clock-ended" })])
  );
  play.mockClear();
  await click("Resume");
  expect(play).toHaveBeenCalledWith({ userGesture: true });
  await act(async () => h.hold(true));
  await click("Pause");
  play.mockClear();
  await click("Resume");
  expect(play).not.toHaveBeenCalled();
});
