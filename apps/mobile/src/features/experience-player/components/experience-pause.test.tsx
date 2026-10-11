vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  EXPERIENCE_CORE_VIDEO_RENDERER_ID,
  EXPERIENCE_CORE_WORLD_MODEL_RENDERER_ID,
  type ExperienceRuntimeManifest,
  type ExperienceThemeConfig,
} from "@repo/shared/experience-runtime";
import { initializeExperienceRuntime, type ExperienceRuntimeState } from "@repo/experience-engine";
import { ExperiencePlayer, type ExperiencePlayerAccess } from "./experience-player";
import {
  createExperienceJourneyMapCopy,
  type ExperiencePlayerCopy,
} from "../lib/experience-player-copy";
import type { ExperienceSaveCheckpoint } from "../lib/experience-save-checkpoint";
import {
  mediaPlaybackSignature,
  type ExperienceMediaCheckpoint,
} from "../lib/experience-playback-checkpoint";
const h = vi.hoisted(() => ({
  active: true,
  stage: {} as Record<string, (event: any) => any>,
  tapGuard: null as ((guard: ((x: number, y: number) => boolean) | null) => void) | null,
  state: { currentSceneId: "scene" } as ExperienceRuntimeState,
  unlock: vi.fn().mockResolvedValue(undefined),
  suspend: vi.fn().mockResolvedValue(undefined),
  effects: vi.fn(),
  restoreAudio: vi.fn(),
  start: vi.fn(),
  restore: vi.fn(),
  map: {} as {
    onReplay: (sceneId: string) => void;
    onClose: () => void;
    replayPending: boolean;
    error?: string;
  },
  restored: undefined as unknown,
  initialGestures: undefined as readonly string[] | undefined,
  checkpointAudio: vi.fn(() => ({ playbacks: [], busGains: {} })),
  settled: null as null | ((ids: string[]) => void),
  dispatch: vi.fn(),
  outcome: vi.fn(),
  mediaPresenting: true,
  spatialPresenting: true,
  hold: (_hold: boolean) => {},
  video: {} as {
    playbackRate: number;
    checkpoint?: ExperienceMediaCheckpoint;
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
    restore: h.restoreAudio,
  }),
}));
vi.mock("../hooks/use-experience-preload", () => ({
  useExperiencePreload: () => ({ done: true }),
}));
vi.mock("../lib/experience-runtime-host", () => ({
  createExperienceRuntime: (_manifest: unknown, options: { restore?: unknown }) => {
    h.restored = options.restore;
    return {
      state: () => h.state,
      restore: h.restore,
      start: h.start,
      dispatch: h.dispatch,
      emitRendererOutcome: h.outcome,
    };
  },
}));
vi.mock("../lib/experience-save-checkpoint", () => ({
  validateExperienceSaveCheckpoint: (_manifest: unknown, checkpoint: unknown) =>
    structuredClone(checkpoint),
}));
vi.mock("./experience-journey-map", () => ({
  ExperienceJourneyMap: (props: typeof h.map) => {
    h.map = props;
    return (
      <div>
        <button onClick={props.onClose}>Close map</button>
        <button onClick={() => props.onReplay("scene")}>Replay scene</button>
        {props.error}
      </div>
    );
  },
}));
vi.mock("./experience-spatial-layer", async () => {
  const { useContext } = await import("react");
  const { ScreenActiveGateContext } = await import("@/hooks/use-app-active");
  return {
    ExperienceSpatialLayer: ({
      onTimelineHoldGateChange,
      onGestureTapGuardChange,
      onSettledGestureIdsChange,
      initialSettledGestureIds,
    }: {
      onTimelineHoldGateChange: (hold: boolean) => void;
      onGestureTapGuardChange: typeof h.tapGuard;
      onSettledGestureIdsChange: typeof h.settled;
      initialSettledGestureIds?: readonly string[];
    }) => {
      h.initialGestures = initialSettledGestureIds;
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
    entrySceneId: "scene",
    nodes: [
      {
        kind: "scene",
        sceneId: "scene",
        gestures: [],
        anchors: [],
        eventBindings: [
          {
            bindingId: "loop",
            on: { type: "renderer.video.completed" },
            routes: [{ routeId: "again", actions: [{ kind: "scene.goto", sceneId: "scene" }] }],
          },
        ],
        renderers: [
          {
            instanceId: "video",
            rendererId: EXPERIENCE_CORE_VIDEO_RENDERER_ID,
            layer: 0,
            config: {
              fit: "cover",
              autoplay: true,
              sequence: [{ clipId: "clip", assetId: "clip", endBehavior: { behavior: "advance" } }],
            },
          },
        ],
        clock: { kind: "fixed", durationMs: 10000 },
        timeline: { cues: [] },
      },
    ],
  },
  metadata: { title: { "en-US": "Fixture" } },
  stateDefinitions: [],
  endings: [],
  assets: [
    { assetId: "clip", kind: "video", variants: [{ uri: "/clip.mp4", sha256: "a".repeat(64) }] },
  ],
  localization: { locales: ["en-US"], defaultLocale: "en-US" },
} as unknown as ExperienceRuntimeManifest;
function progress(positionMs: number): ExperienceMediaCheckpoint {
  return {
    rendererInstanceId: "video",
    sequenceIndex: 0,
    assetId: "clip",
    mediaSignature: mediaPlaybackSignature(runtime, "clip"),
    positionMs,
    watchedUntilMs: positionMs,
    durationMs: 10000,
    isStill: false,
    terminalMode: null,
    remainingHoldMs: null,
    completed: false,
  };
}
const copy = {
  seek: {
    back: "Back 10 seconds",
    forward: "Forward 10 seconds",
    progress: "Playback progress",
    watchedOnly: "Watched footage only",
  },
  speed: {
    label: "Playback speed",
    interactionBlocked: "Finish the current interaction before changing speed.",
  },
  journeyMap: createExperienceJourneyMapCopy((key) => key),
  pause: "Pause",
  resume: "Resume",
  paused: "Paused",
} as ExperiencePlayerCopy;
const loader = () => Promise.resolve({ tokens: {} } as ExperienceThemeConfig);
let root: Root;
let container: HTMLDivElement;
const captured = vi.fn();
const render = (
  active = true,
  manifest = runtime,
  capture = false,
  entryCheckpoint?: ExperienceSaveCheckpoint,
  access?: ExperiencePlayerAccess
) =>
  act(async () =>
    root.render(
      <ExperiencePlayer
        runtime={manifest}
        access={access}
        locale="en-US"
        copy={copy}
        randomSeed="fixed"
        loadTheme={loader}
        active={active}
        onCheckpoint={capture ? captured : undefined}
        entryCheckpoint={entryCheckpoint}
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
  h.state = initializeExperienceRuntime(runtime, { randomSeed: "fixed" });
  h.stage = {};
  h.tapGuard = null;
  vi.clearAllMocks();
  h.restore.mockImplementation((state) => {
    h.state = structuredClone(state);
    return h.state;
  });
  h.start.mockImplementation(() => ({ state: h.state, effects: [] }));
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
  const media = progress(500);
  await act(async () => {
    h.video.onPlaybackProgress(media);
    h.settled!(["gesture.one"]);
  });
  const snapshot = captured.mock.calls.at(-1)![0];
  expect(snapshot.journey.anchors).toHaveLength(1);
  expect(snapshot.journey.anchors[0]).toMatchObject({
    sceneId: "scene",
    state: h.state,
    events: [],
    playback: { sceneTimeMs: 0, media: [], settledGestureIds: [], playbackEnabled: true },
  });
  expect(snapshot.journey.visitedNodeIds).toEqual(["scene"]);
  expect(snapshot.journey.watchedMedia[0].watchedUntilMs).toBe(500);
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
    oldMedia(progress(500));
    oldGestures(["old-gesture"]);
  });
  h.outcome.mockImplementationOnce(() => ({
    state: { ...h.state },
    effects: [
      {
        kind: "scene.changed",
        fromSceneId: "scene",
        toSceneId: "scene",
        bindingId: "loop",
        routeId: "again",
      },
    ],
  }));
  await act(async () => h.video.onCompleted());
  expect(captured.mock.calls.at(-1)![1]).toBe("transition");
  expect(captured.mock.calls.at(-1)![0].journey.traversedEdges).toEqual([
    { fromSceneId: "scene", bindingId: "loop", routeId: "again", toSceneId: "scene" },
  ]);
  expect(captured.mock.calls.at(-1)![0].playback).toMatchObject({
    media: [],
    settledGestureIds: [],
    sceneTimeMs: 0,
  });
  await act(async () => {
    oldMedia(progress(900));
    oldGestures(["late-gesture"]);
  });
  await pausePicture();
  expect(captured.mock.calls.at(-1)![0].playback).toMatchObject({
    media: [],
    settledGestureIds: [],
  });
  await act(async () => {
    h.video.onPlaybackProgress(progress(100));
  });
  expect(captured.mock.calls.at(-1)![0].playback.media[0].positionMs).toBe(100);
  // Replaying resets the player position, but preserves legitimate viewing credit.
  // The stale callback above must not increase it to 900.
  expect(captured.mock.calls.at(-1)![0].journey.watchedMedia[0].watchedUntilMs).toBe(500);
});
const savedCheckpoint = (ended = false): ExperienceSaveCheckpoint =>
  ({
    state: h.state,
    events: [{ type: "saved.pending" }],
    playback: {
      version: 1,
      sceneId: "scene",
      sceneSignature: "fixture",
      sceneTimeMs: ended ? 10000 : 8000,
      fixedClockEnded: ended,
      cursor: { sceneId: "scene", positionMs: ended ? 10000 : 8000, firedOnceCueIds: [] },
      openRendererIds: ["video"],
      settledGestureIds: ["settled"],
      parkedEvents: [],
      media: [{ rendererInstanceId: "video", positionMs: 8000 }],
      playbackEnabled: true,
      rate: 1,
      audio: { playbacks: [], busGains: {} },
    },
  }) as unknown as ExperienceSaveCheckpoint;
it("restores presentation and pending events without replaying scene entry", async () => {
  const saved = savedCheckpoint();
  await render(true, runtime, true, saved);
  expect(h.restored).toEqual(saved.state);
  expect(h.start).not.toHaveBeenCalled();
  expect(h.restoreAudio).not.toHaveBeenCalled();
  await click("Start");
  expect(h.start).not.toHaveBeenCalled();
  expect(h.dispatch).toHaveBeenCalledWith(saved.events);
  expect(h.restoreAudio).toHaveBeenCalledExactlyOnceWith(saved.playback!.audio);
  expect(h.video.checkpoint).toEqual(saved.playback!.media[0]);
  expect(h.initialGestures).toEqual(["settled"]);
  expect(captured.mock.calls.at(-1)![0].playback).toMatchObject({
    sceneTimeMs: 8000,
    openRendererIds: ["video"],
    settledGestureIds: ["settled"],
  });
  await act(async () => vi.advanceTimersByTime(1000));
  expect(captured.mock.calls.at(-1)![0].playback.sceneTimeMs).toBeGreaterThanOrEqual(8900);
  expect(h.dispatch).not.toHaveBeenCalledWith(
    expect.arrayContaining([expect.objectContaining({ type: "scene.clock-ended" })])
  );
  await act(async () => vi.advanceTimersByTime(1100));
  expect(h.dispatch).toHaveBeenCalledWith(
    expect.arrayContaining([expect.objectContaining({ type: "scene.clock-ended" })])
  );
});
it("does not dispatch an already completed saved fixed clock again", async () => {
  await render(true, runtime, true, savedCheckpoint(true));
  await click("Start");
  await act(async () => vi.advanceTimersByTime(20000));
  expect(h.dispatch).toHaveBeenCalledTimes(1);
  expect(captured.mock.calls.at(-1)![0].playback.fixedClockEnded).toBe(true);
});
it("does not restore saved audio or dispatch events without access to the saved scene", async () => {
  const locked = structuredClone(runtime);
  Object.assign(locked.graph.nodes[0]!, {
    access: { key: "paid-scene", kind: "community-points", amount: 5 },
  });
  await render(true, locked, true, savedCheckpoint());
  await click("Start");
  expect(h.restoreAudio).not.toHaveBeenCalled();
  expect(h.dispatch).not.toHaveBeenCalled();
  expect(h.start).not.toHaveBeenCalled();
  expect(captured).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain("Film");
});
it("keeps saved renderer playback disabled while leaving interactions available", async () => {
  const saved = savedCheckpoint();
  saved.playback!.playbackEnabled = false;
  await render(true, runtime, true, saved);
  await click("Start");
  expect(h.mediaPresenting).toBe(false);
  expect(h.spatialPresenting).toBe(true);
  expect(captured.mock.calls.at(-1)![0].playback.playbackEnabled).toBe(false);
});
it("does not record a rejected renderer route as explored", async () => {
  await render(true, runtime, true);
  await click("Start");
  h.outcome.mockImplementationOnce(() => {
    throw new Error("Route refused");
  });
  await act(async () => h.video.onCompleted());
  expect(captured.mock.calls.at(-1)![0].journey.traversedEdges).toEqual([]);
  expect(captured.mock.calls.at(-1)![0].journey.visitedNodeIds).toEqual(["scene"]);
});
it("captures entry commands before renderer mount and does not overwrite entries on progress", async () => {
  h.start.mockImplementationOnce(() => ({
    state: h.state,
    effects: [
      { kind: "renderer.command", instanceId: "video", commandType: "open", payload: {} },
      { kind: "renderer.command", instanceId: "video", commandType: "close", payload: {} },
      { kind: "renderer.command", instanceId: "video", commandType: "pause", payload: {} },
    ],
  }));
  await render(true, runtime, true);
  await click("Start");
  const entry = structuredClone(captured.mock.calls.at(-1)![0].journey.anchors[0]);
  expect(entry.playback).toMatchObject({ playbackEnabled: false, openRendererIds: [] });
  expect(h.mediaPresenting).toBe(false);
  await act(async () => h.video.onPlaybackProgress(progress(500)));
  expect(captured.mock.calls.at(-1)![0].journey.anchors[0]).toEqual(entry);
});

it("preserves the original entry anchor when continuing a mid-scene save", async () => {
  await render(true, runtime, true);
  await click("Start");
  await act(async () => h.video.onPlaybackProgress(progress(500)));
  const saved = structuredClone(captured.mock.calls.at(-1)![0]) as ExperienceSaveCheckpoint;
  await act(async () => root.unmount());
  root = createRoot(container);
  await render(true, runtime, true, saved);
  await click("Start");
  expect(captured.mock.calls.at(-1)![0].journey.anchors).toEqual(saved.journey!.anchors);
  expect(captured.mock.calls.at(-1)![0].playback.media[0].positionMs).toBe(500);
});

it("holds playback while the map is open and restores entry state without firing Start twice", async () => {
  await render(true, runtime, true);
  await click("Start");
  await act(async () => h.video.onPlaybackProgress(progress(500)));
  const oldProgress = h.video.onPlaybackProgress;
  await click("play.journeyMap.open");
  expect(h.mediaPresenting).toBe(false);
  await click("Replay scene");
  expect(h.restore).toHaveBeenCalledOnce();
  expect(h.start).toHaveBeenCalledTimes(1);
  expect(h.mediaPresenting).toBe(true);
  const saved = captured.mock.calls.at(-1)![0];
  expect(saved.playback).toMatchObject({ sceneTimeMs: 0, media: [], settledGestureIds: [] });
  expect(saved.journey.watchedMedia[0].watchedUntilMs).toBe(500);
  await act(async () => oldProgress(progress(900)));
  expect(captured.mock.calls.at(-1)![0].journey.watchedMedia[0].watchedUntilMs).toBe(500);
});
it("closing the map resumes a playing scene but retains a viewer pause", async () => {
  await render();
  await click("Start");
  await click("play.journeyMap.open");
  await click("Close map");
  expect(h.mediaPresenting).toBe(true);
  await pausePicture();
  await click("play.journeyMap.open");
  await click("Close map");
  expect(h.mediaPresenting).toBe(false);
});
it("keeps the current story and map when replay access is declined", async () => {
  const paid = structuredClone(runtime);
  paid.graph.nodes[0]!.access = {
    key: "scene:paid",
    communityPointPrice: 5,
    title: { "en-US": "Paid" },
  };
  const access = {
    canAccess: vi.fn(() => true),
    checkAccess: vi.fn(async () => false),
    requestAccess: vi.fn(async () => false),
    formatPrice: String,
  };
  await render(true, paid, true, undefined, access);
  await click("Start");
  await act(async () => h.video.onPlaybackProgress(progress(500)));
  await click("play.journeyMap.open");
  await click("Replay scene");
  expect(access.requestAccess).toHaveBeenCalledOnce();
  expect(h.restore).not.toHaveBeenCalled();
  expect(h.mediaPresenting).toBe(false);
  expect(container.textContent).toContain("Close map");
  expect(captured.mock.calls.some((call) => call[1] === "access")).toBe(true);
  await click("Close map");
  expect(h.mediaPresenting).toBe(true);
  expect(captured.mock.calls.at(-1)![0].playback.media[0].positionMs).toBe(500);
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

it("restores the saved playback rate for media, fixed time and subsequent saves", async () => {
  const saved = savedCheckpoint();
  saved.playback!.rate = 2;
  await render(true, runtime, true, saved);
  await click("Start");
  expect(h.video.playbackRate).toBe(2);
  expect(captured.mock.calls.at(-1)![0].playback.rate).toBe(2);
  await act(async () => vi.advanceTimersByTime(512));
  expect(captured.mock.calls.at(-1)![0].playback.sceneTimeMs).toBeGreaterThanOrEqual(9000);
  await pausePicture();
  const paused = captured.mock.calls.at(-1)![0].playback.sceneTimeMs;
  await act(async () => vi.advanceTimersByTime(10000));
  expect(captured.mock.calls.at(-1)![0].playback.sceneTimeMs).toBe(paused);
});
it("temporarily clamps media to normal speed for an interaction hold without losing saved preference", async () => {
  const saved = savedCheckpoint();
  saved.playback!.rate = 2;
  await render(true, runtime, true, saved);
  await click("Start");
  await act(async () => h.hold(true));
  expect(h.video.playbackRate).toBe(1);
  expect(captured.mock.calls.at(-1)![0].playback.rate).toBe(2);
  await act(async () => h.hold(false));
  expect(h.video.playbackRate).toBe(2);
});

it("cycles speed while paused, saves it immediately and retains it on resume", async () => {
  await render(true, runtime, true);
  await click("Start");
  expect(container.textContent).not.toContain("Playback speed");
  await pausePicture();
  for (const [before, after] of [
    [1, 1.25],
    [1.25, 1.5],
    [1.5, 2],
    [2, 1],
  ]) {
    await click(`Playback speed: ${before}×`);
    expect(captured.mock.calls.at(-1)![0].playback.rate).toBe(after);
    expect(h.video.playbackRate).toBe(after);
    expect(container.textContent).toContain("Paused");
  }
  await click("Playback speed: 1×");
  await click("Resume");
  expect(h.video.playbackRate).toBe(1.25);
  expect(container.textContent).not.toContain("Playback speed");
});
it("keeps an interaction-blocked speed unchanged even if its callback is invoked", async () => {
  await render(true, runtime, true);
  await click("Start");
  await pausePicture();
  await act(async () => h.hold(true));
  await click("Playback speed: 1×");
  expect(captured.mock.calls.at(-1)![0].playback.rate).toBe(1);
  expect(container.textContent).toContain(copy.speed!.interactionBlocked);
});

it("seeks within watched footage while paused and preserves viewing credit", async () => {
  await render(true, runtime, true);
  await click("Start");
  const seek = vi.fn(() => true);
  await act(async () => {
    h.video.onPlaybackHandle("video", {
      playbackIdentity: "clip",
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      seek,
    });
    h.video.onPlaybackProgress({ ...progress(5000), watchedUntilMs: 8000 });
  });
  await pausePicture();
  await click("Back 10 seconds");
  expect(seek).toHaveBeenLastCalledWith(0);
  expect(captured.mock.calls.at(-1)![0].playback.media[0]).toMatchObject({
    positionMs: 0,
    watchedUntilMs: 8000,
  });
  await click("Forward 10 seconds");
  expect(seek).toHaveBeenLastCalledWith(8);
  expect(captured.mock.calls.at(-1)![0].playback.media[0]).toMatchObject({
    positionMs: 8000,
    watchedUntilMs: 8000,
  });
  expect(container.textContent).toContain("Paused");
});
it("does not publish a seek rejected by unloaded media or an interaction hold", async () => {
  await render(true, runtime, true);
  await click("Start");
  const seek = vi.fn(() => false);
  await act(async () => {
    h.video.onPlaybackHandle("video", {
      playbackIdentity: "clip",
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      seek,
    });
    h.video.onPlaybackProgress(progress(5000));
  });
  await pausePicture();
  await click("Back 10 seconds");
  expect(captured.mock.calls.at(-1)![0].playback.media[0].positionMs).toBe(5000);
  seek.mockClear();
  await act(async () => h.hold(true));
  await click("Back 10 seconds");
  expect(seek).not.toHaveBeenCalled();
});
it("rejects forward seeking over an unresolved interaction and allows it once settled", async () => {
  const manifest = structuredClone(runtime);
  const scene = manifest.graph.nodes[0]!;
  if (scene.kind !== "scene") throw Error("Expected scene");
  scene.gestures = [
    { gestureId: "future", activeWindow: { startMs: 5000, endMs: 6000 } },
  ] as typeof scene.gestures;
  await render(true, manifest, true);
  await click("Start");
  const seek = vi.fn(() => true);
  await act(async () => {
    h.video.onPlaybackHandle("video", {
      playbackIdentity: "clip",
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      seek,
    });
    h.video.onPlaybackProgress({ ...progress(0), watchedUntilMs: 8000 });
  });
  await pausePicture();
  await click("Forward 10 seconds");
  expect(seek).not.toHaveBeenCalled();
  expect(captured.mock.calls.at(-1)![0].playback.media[0].positionMs).toBe(0);
  await act(async () => h.settled!(["future"]));
  await click("Forward 10 seconds");
  expect(seek).toHaveBeenLastCalledWith(8);
});
it("rewinds a renderer-driven scene while paused without replaying timeline cues", async () => {
  const manifest = structuredClone(runtime);
  const scene = manifest.graph.nodes[0]!;
  if (scene.kind !== "scene") throw Error("Expected scene");
  scene.clock = { kind: "renderer", rendererInstanceId: "video" };
  await render(true, manifest, true, savedCheckpoint());
  await click("Start");
  const seek = vi.fn(() => true);
  await act(async () => {
    h.video.onPlaybackHandle("video", {
      playbackIdentity: "clip",
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      seek,
    });
    h.video.onPlaybackProgress(progress(8000));
  });
  await pausePicture();
  h.dispatch.mockClear();
  await click("Back 10 seconds");
  expect(captured.mock.calls.at(-1)![0].playback).toMatchObject({
    sceneTimeMs: 0,
    cursor: { positionMs: 8000 },
  });
  expect(h.dispatch).not.toHaveBeenCalled();
});
