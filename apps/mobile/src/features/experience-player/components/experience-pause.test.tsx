import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  EXPERIENCE_CORE_VIDEO_RENDERER_ID,
  EXPERIENCE_CORE_WORLD_MODEL_RENDERER_ID,
  type ExperienceRuntimeManifest,
  type ExperienceThemeConfig,
} from "@repo/shared/experience-runtime";
import { ExperiencePlayer } from "./experience-player";
import type { ExperiencePlayerCopy } from "../lib/experience-player-copy";
import type { ExperienceMediaCheckpoint } from "../lib/experience-playback-checkpoint";
const h = vi.hoisted(() => ({
  active: true,
  stage: {} as Record<string, (event: any) => any>,
  tapGuard: null as ((guard: ((x: number, y: number) => boolean) | null) => void) | null,
  state: { currentSceneId: "scene" },
  unlock: vi.fn().mockResolvedValue(undefined),
  suspend: vi.fn().mockResolvedValue(undefined),
  effects: vi.fn(),
  checkpointAudio: vi.fn(() => ({ playbacks: [], busGains: {} })),
  settled: null as null | ((ids: string[]) => void),
  dispatch: vi.fn(),
  outcome: vi.fn(),
  mediaPresenting: true,
  spatialPresenting: true,
  hold: (_hold: boolean) => {},
  video: {} as {
    onCompleted: () => void;
    onPlaybackRefused: () => void;
    onPlaybackInterrupted: () => void;
    onPlaybackHandle: (id: string, handle: unknown) => void;
    onPlaybackProgress: (value: ExperienceMediaCheckpoint) => void;
  },
}));
vi.mock("react-native", () => ({
  View: ({ children, ...props }: { children?: ReactNode; [key: string]: any }) => {
    if (props.onStartShouldSetResponder) h.stage = props;
    return <div>{children}</div>;
  },
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
  useExperienceAudioHost: () => ({
    unlock: h.unlock,
    suspend: h.suspend,
    applyEffects: h.effects,
    checkpoint: h.checkpointAudio,
  }),
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
      onGestureTapGuardChange,
      onSettledGestureIdsChange,
    }: {
      onTimelineHoldGateChange: (hold: boolean) => void;
      onGestureTapGuardChange: typeof h.tapGuard;
      onSettledGestureIdsChange: typeof h.settled;
    }) => {
      h.hold = onTimelineHoldGateChange;
      h.tapGuard = onGestureTapGuardChange;
      h.settled = onSettledGestureIdsChange;
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
const captured = vi.fn();
const render = (active = true, manifest = runtime, capture = false) =>
  act(async () =>
    root.render(
      <ExperiencePlayer
        runtime={manifest}
        locale="en-US"
        copy={copy}
        randomSeed="fixed"
        loadTheme={loader}
        active={active}
        onCheckpoint={capture ? captured : undefined}
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
  h.state = { currentSceneId: "scene" };
  h.stage = {};
  h.tapGuard = null;
  vi.clearAllMocks();
  h.dispatch.mockImplementation(() => ({ state: h.state, effects: [] }));
  h.outcome.mockImplementation(() => ({ state: h.state, effects: [] }));
  container = document.createElement("div");
  root = createRoot(container);
});
it("captures engine, audio, media and settled gestures only after Start, then records pause", async () => {
  await render(true, runtime, true);
  expect(captured).not.toHaveBeenCalled();
  await click("Start");
  expect(captured.mock.calls.at(-1)![0]).toMatchObject({
    state: h.state,
    events: [],
    playback: {
      sceneId: "scene",
      sceneTimeMs: 0,
      audio: { playbacks: [], busGains: {} },
      media: [],
    },
  });
  const media = {
    rendererInstanceId: "video",
    assetId: "clip",
    positionMs: 500,
  } as ExperienceMediaCheckpoint;
  await act(async () => {
    h.video.onPlaybackProgress(media);
    h.settled!(["gesture.one"]);
  });
  const snapshot = captured.mock.calls.at(-1)![0];
  expect(snapshot.playback).toMatchObject({ media: [media], settledGestureIds: ["gesture.one"] });
  media.positionMs = 1000;
  expect(snapshot.playback.media[0].positionMs).toBe(500);
  await pausePicture();
  expect(captured.mock.calls.at(-1)![1]).toBe("pause");
  expect(captured.mock.calls.at(-1)![0].playback.media[0].positionMs).toBe(500);
});
it("does not include media belonging to a different renderer", async () => {
  await render(true, runtime, true);
  await click("Start");
  await act(async () => {
    h.video.onPlaybackProgress({ rendererInstanceId: "old-scene" } as ExperienceMediaCheckpoint);
  });
  expect(captured.mock.calls.at(-1)![0].playback.media).toEqual([]);
});
it("rejects late media and gesture updates after re-entering the same scene", async () => {
  await render(true, runtime, true);
  await click("Start");
  const oldMedia = h.video.onPlaybackProgress;
  const oldGestures = h.settled!;
  await act(async () => {
    oldMedia({ rendererInstanceId: "video", positionMs: 500 } as ExperienceMediaCheckpoint);
    oldGestures(["old-gesture"]);
  });
  h.outcome.mockImplementationOnce(() => ({
    state: { ...h.state },
    effects: [{ kind: "scene.changed", fromSceneId: "scene", toSceneId: "scene" }],
  }));
  await act(async () => h.video.onCompleted());
  expect(captured.mock.calls.at(-1)![1]).toBe("transition");
  expect(captured.mock.calls.at(-1)![0].playback).toMatchObject({
    media: [],
    settledGestureIds: [],
    sceneTimeMs: 0,
  });
  await act(async () => {
    oldMedia({ rendererInstanceId: "video", positionMs: 900 } as ExperienceMediaCheckpoint);
    oldGestures(["late-gesture"]);
  });
  await pausePicture();
  expect(captured.mock.calls.at(-1)![0].playback).toMatchObject({
    media: [],
    settledGestureIds: [],
  });
  await act(async () => {
    h.video.onPlaybackProgress({
      rendererInstanceId: "video",
      positionMs: 100,
    } as ExperienceMediaCheckpoint);
  });
  expect(captured.mock.calls.at(-1)![0].playback.media[0].positionMs).toBe(100);
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
  await pausePicture();
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
  expect(container.querySelector('[aria-label="Pause"]')).toBeNull();
});

it("holds media without freezing the interaction, then releases a late completion once", async () => {
  await render();
  await click("Start");
  await act(async () => h.hold(true));
  expect(h.mediaPresenting).toBe(false);
  expect(h.spatialPresenting).toBe(true);
  await act(async () => h.video.onCompleted());
  expect(h.outcome).not.toHaveBeenCalled();
  await pausePicture();
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
  await pausePicture();
  play.mockClear();
  await click("Resume");
  expect(play).not.toHaveBeenCalled();
});

it("freezes the story and audio after a system playback interruption", async () => {
  await render();
  await click("Start");
  await act(async () => h.video.onPlaybackInterrupted());
  expect(container.querySelector('[aria-label="Resume"]')).not.toBeNull();
  expect(h.suspend).toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(15000));
  expect(h.dispatch).not.toHaveBeenCalledWith(
    expect.arrayContaining([expect.objectContaining({ type: "scene.clock-ended" })])
  );
  await click("Resume");
  expect(h.mediaPresenting).toBe(true);
});

const stageEvent = (x = 100, y = 100, fingers = 1) => ({
  preventDefault: vi.fn(),
  nativeEvent: { pageX: x, pageY: y, touches: Array.from({ length: fingers }, () => ({})) },
});
it("pauses a short unclaimed picture tap without advancing the film", async () => {
  await render();
  await click("Start");
  const event = stageEvent();
  expect(h.stage.onStartShouldSetResponder!(event)).toBe(true);
  await act(async () => {
    h.stage.onResponderGrant!(event);
    h.stage.onResponderRelease!(event);
  });
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(h.mediaPresenting).toBe(false);
  expect(h.spatialPresenting).toBe(false);
  expect(h.outcome).not.toHaveBeenCalled();
  await click("Resume");
  expect(h.mediaPresenting).toBe(true);
});
it("leaves hotspot edge attempts, multiple fingers and background taps alone", async () => {
  await render();
  await click("Start");
  h.tapGuard!((x, y) => x < 125 && y < 125);
  expect(h.stage.onStartShouldSetResponder!(stageEvent())).toBe(false);
  expect(h.stage.onStartShouldSetResponder!(stageEvent(200, 200, 2))).toBe(false);
  h.active = false;
  await render();
  expect(h.stage.onStartShouldSetResponder!(stageEvent(200, 200))).toBe(false);
});
it("does not pause after a drag or responder cancellation", async () => {
  await render();
  await click("Start");
  await act(async () => {
    h.stage.onResponderGrant!(stageEvent());
    h.stage.onResponderMove!(stageEvent(150));
    h.stage.onResponderRelease!(stageEvent());
  });
  expect(h.mediaPresenting).toBe(true);
  await act(async () => {
    h.stage.onResponderGrant!(stageEvent());
    h.stage.onResponderTerminate!(stageEvent());
    h.stage.onResponderRelease!(stageEvent());
  });
  expect(h.mediaPresenting).toBe(true);
});
it("keeps world-stream picture gestures with the world renderer and offers its Pause button", async () => {
  const manifest = {
    ...runtime,
    graph: {
      ...runtime.graph,
      nodes: [
        {
          ...runtime.graph.nodes[0],
          renderers: [
            { instanceId: "world", rendererId: EXPERIENCE_CORE_WORLD_MODEL_RENDERER_ID, layer: 0 },
          ],
        },
      ],
    },
  } as ExperienceRuntimeManifest;
  await render(true, manifest);
  await click("Start");
  expect(h.stage.onStartShouldSetResponder!(stageEvent())).toBe(false);
  await click("Pause");
  expect(container.querySelector('[aria-label="Resume"]')).not.toBeNull();
});

it("ignores a second finger added during a picture tap", async () => {
  await render();
  await click("Start");
  await act(async () => {
    h.stage.onResponderGrant!(stageEvent());
    h.stage.onResponderStart!(stageEvent(100, 100, 2));
    h.stage.onResponderRelease!(stageEvent());
  });
  expect(h.mediaPresenting).toBe(true);
  expect(container.textContent).not.toContain("Resume");
});

const pausePicture = () =>
  act(async () => {
    const event = stageEvent();
    expect(h.stage.onStartShouldSetResponder!(event)).toBe(true);
    h.stage.onResponderGrant!(event);
    h.stage.onResponderRelease!(event);
  });
