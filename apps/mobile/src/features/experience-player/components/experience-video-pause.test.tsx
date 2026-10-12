vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  ExperienceRuntimeManifest,
  ExperienceRendererInstance,
} from "@repo/shared/experience-runtime";
import { ExperienceVideoRenderer } from "./experience-video-renderer";
import type { ExperiencePlayerCopy } from "../lib/experience-player-copy";
import type { ExperienceMediaCheckpoint } from "../lib/experience-playback-checkpoint";
const h = vi.hoisted(() => ({
  active: true,
  mounts: vi.fn(),
  stillProps: null as null | {
    onTimelineTimeMs: (timeMs: number) => void;
    playbackRate: number;
    onSeekHandle: (seek: ((positionMs: number) => boolean) | null) => void;
  },
  player: {
    playing: false,
    playbackRate: 1,
    status: "readyToPlay",
    duration: 20,
    currentTime: 5,
    replaceAsync: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    play: vi.fn(),
    addListener: vi.fn(() => ({ remove: vi.fn() })),
  },
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Text: "span",
  StyleSheet: { create: (s: unknown) => s },
}));
vi.mock("./experience-video-platform", async () => {
  const { useState } = await import("react");
  return {
    useVideoPlayer: () => {
      useState(() => {
        h.mounts();
        return null;
      });
      return h.player;
    },
    VideoView: () => null,
  };
});
vi.mock("@/hooks/use-app-active", () => ({ useGatedScreenActive: () => h.active }));
vi.mock("../lib/experience-playback-delivery", () => ({
  resolveExperienceVideoSource: vi.fn().mockResolvedValue({ uri: "file:///clip.mp4" }),
}));
vi.mock("./experience-still-segment", () => ({
  ExperienceStillSegment: (props: NonNullable<typeof h.stillProps>) => {
    h.stillProps = props;
    return null;
  },
}));
vi.mock("@/config", () => ({ resolveExperienceAssetUrl: (s: string) => s }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const manifest = {
  assets: [],
  localization: { defaultLocale: "en-US" },
} as unknown as ExperienceRuntimeManifest;
const completed = vi.fn();
const noop = () => {};
const refused = vi.fn();
const interrupted = vi.fn();
const progress = vi.fn();
let handle: {
  pause: () => void;
  play: (options?: { userGesture?: boolean }) => Promise<void>;
  seek: (seconds: number) => void;
} | null;
let root: Root;
let playbackRate = 1;
let checkpoint: ExperienceMediaCheckpoint | undefined;
const testCopy = { emptySequence: "No footage" } as ExperiencePlayerCopy;
const render = (id = "empty", endBehavior?: Record<string, unknown>, mediaType = "video/mp4") =>
  act(async () =>
    root.render(
      <ExperienceVideoRenderer
        manifest={
          endBehavior
            ? ({
                ...manifest,
                assets: [
                  {
                    kind: "video",
                    assetId: "clip",
                    variants: [
                      {
                        orientation: "landscape",
                        uri: "file:///clip.mp4",
                        mediaType,
                        durationMs: 20000,
                      },
                    ],
                  },
                ],
              } as unknown as ExperienceRuntimeManifest)
            : manifest
        }
        renderer={
          {
            instanceId: id,
            config: {
              sequence: endBehavior ? [{ clipId: "shot", assetId: "clip", endBehavior }] : [],
              fit: "contain",
              autoplay: true,
            },
          } as unknown as ExperienceRendererInstance
        }
        copy={testCopy}
        checkpoint={checkpoint}
        playbackRate={playbackRate}
        onPlaybackProgress={progress}
        onPlaybackRefused={refused}
        onPlaybackInterrupted={interrupted}
        onPlaybackHandle={(_id, value) => {
          handle = value;
        }}
        onCompleted={completed}
        onRuntimeError={noop}
        onTimelineTimeMs={noop}
      />
    )
  );
const advance = (ms: number) =>
  act(async () => {
    vi.advanceTimersByTime(ms);
  });
beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"],
  });
  h.active = true;
  h.mounts.mockClear();
  checkpoint = undefined;
  playbackRate = 1;
  h.player.playbackRate = 1;
  h.stillProps = null;
  completed.mockClear();
  refused.mockClear();
  interrupted.mockClear();
  progress.mockClear();
  h.player.status = "readyToPlay";
  h.player.currentTime = 5;
  h.player.playing = false;
  h.player.pause.mockClear();
  h.player.play.mockClear();
  h.player.replaceAsync.mockClear();
  h.player.addListener.mockClear();
  root = createRoot(document.createElement("div"));
});
it("captures independent media snapshots and clamps seeks to watched footage", async () => {
  await render("saved", { behavior: "advance" });
  const update = (
    h.player.addListener.mock.calls as unknown as [string, (event: unknown) => void][]
  ).find(([name]) => name === "timeUpdate")![1];
  await act(async () => {
    update({ currentTime: 0.25 });
  });
  const first = progress.mock.calls.at(-1)![0] as ExperienceMediaCheckpoint;
  expect(first).toMatchObject({
    rendererInstanceId: "saved",
    assetId: "clip",
    positionMs: 250,
    watchedUntilMs: 250,
    completed: false,
  });
  await act(async () => {
    update({ currentTime: 0.5 });
  });
  expect(first.positionMs).toBe(250);
  await act(async () => {
    handle!.seek(15);
  });
  expect(h.player.currentTime).toBe(0.5);
  expect(progress.mock.calls.at(-1)![0].watchedUntilMs).toBe(500);
  await act(async () => {
    update({ currentTime: 10 });
  });
  expect(progress.mock.calls.at(-1)![0]).toMatchObject({ positionMs: 10000, watchedUntilMs: 500 });
});
it("captures a decreasing held-frame timer and marks its terminal completion", async () => {
  checkpoint = {
    rendererInstanceId: "saved",
    sequenceIndex: 0,
    assetId: "clip",
    terminalMode: { kind: "held" },
    positionMs: 20000,
    watchedUntilMs: 20000,
    remainingHoldMs: 500,
    completed: false,
  } as ExperienceMediaCheckpoint;
  await render("saved", { behavior: "hold-last-frame", durationMs: 3000 });
  expect(progress.mock.calls.at(-1)![0].remainingHoldMs).toBe(500);
  await advance(250);
  expect(progress.mock.calls.at(-1)![0].remainingHoldMs).toBe(250);
  await advance(250);
  expect(progress.mock.calls.at(-1)![0]).toMatchObject({ completed: true, remainingHoldMs: 0 });
});
it("captures a still's elapsed position on its authored hold duration", async () => {
  await render("still", { behavior: "hold-last-frame", durationMs: 3000 }, "image/png");
  await act(async () => {
    h.stillProps!.onTimelineTimeMs(250);
  });
  expect(progress.mock.calls.at(-1)![0]).toMatchObject({
    rendererInstanceId: "still",
    isStill: true,
    positionMs: 250,
    watchedUntilMs: 250,
    durationMs: 3000,
  });
});
it("loads a saved video position without restarting from zero", async () => {
  checkpoint = {
    rendererInstanceId: "saved",
    sequenceIndex: 0,
    terminalMode: null,
    positionMs: 12000,
    completed: false,
  } as ExperienceMediaCheckpoint;
  await render("saved", { behavior: "advance" });
  expect(h.player.currentTime).toBe(12);
  expect(h.player.play).toHaveBeenCalled();
  expect(completed).not.toHaveBeenCalled();
});
it("restores a held video frame without playing and uses only the remaining hold", async () => {
  checkpoint = {
    rendererInstanceId: "saved",
    sequenceIndex: 0,
    terminalMode: { kind: "held" },
    positionMs: 20000,
    remainingHoldMs: 500,
    completed: false,
  } as ExperienceMediaCheckpoint;
  await render("saved", { behavior: "hold-last-frame", durationMs: 3000 });
  expect(h.player.replaceAsync).toHaveBeenCalledOnce();
  expect(h.player.currentTime).toBe(20);
  expect(h.player.play).not.toHaveBeenCalled();
  await advance(499);
  expect(completed).not.toHaveBeenCalled();
  await advance(1);
  expect(completed).toHaveBeenCalledOnce();
});
it("waits for a restored held frame to load before counting its remaining duration", async () => {
  let loaded!: () => void;
  h.player.replaceAsync.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        loaded = resolve;
      })
  );
  checkpoint = {
    rendererInstanceId: "saved",
    sequenceIndex: 0,
    terminalMode: { kind: "held" },
    positionMs: 20000,
    remainingHoldMs: 500,
    completed: false,
  } as ExperienceMediaCheckpoint;
  await render("saved", { behavior: "hold-last-frame", durationMs: 3000 });
  await advance(10000);
  expect(completed).not.toHaveBeenCalled();
  await act(async () => {
    loaded();
  });
  await advance(499);
  expect(completed).not.toHaveBeenCalled();
  await advance(1);
  expect(completed).toHaveBeenCalledOnce();
});
it("does not replay or complete a saved finished video", async () => {
  checkpoint = {
    rendererInstanceId: "saved",
    sequenceIndex: 0,
    terminalMode: { kind: "held" },
    positionMs: 20000,
    remainingHoldMs: 0,
    completed: true,
  } as ExperienceMediaCheckpoint;
  await render("saved", { behavior: "hold-last-frame", durationMs: 3000 });
  await advance(10000);
  expect(h.player.play).not.toHaveBeenCalled();
  expect(completed).not.toHaveBeenCalled();
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
});
it("does not skip an empty scene during a long pause", async () => {
  await render();
  await advance(2000);
  h.active = false;
  await render();
  await advance(20000);
  expect(completed).not.toHaveBeenCalled();
  h.active = true;
  await render();
  await advance(3999);
  expect(completed).not.toHaveBeenCalled();
  await advance(1);
  expect(completed).toHaveBeenCalledTimes(1);
});
it("starts a fresh placeholder duration for a different renderer", async () => {
  await render();
  await advance(5000);
  await render("new");
  await advance(1000);
  expect(completed).not.toHaveBeenCalled();
  await advance(5000);
  expect(completed).toHaveBeenCalledTimes(1);
});

it("routes browser autoplay refusal to pause without completing the scene", async () => {
  await render();
  const listener = (
    h.player.addListener.mock.calls as unknown as [string, (event: unknown) => void][]
  ).find(([event]) => event === "statusChange")![1];
  await act(async () =>
    listener({ status: "error", error: { name: "NotAllowedError", message: "Tap to play" } })
  );
  expect(refused).toHaveBeenCalledOnce();
  expect(completed).not.toHaveBeenCalled();
});

const playingEvent = async (isPlaying: boolean, oldIsPlaying: boolean) => {
  const listener = (
    h.player.addListener.mock.calls as unknown as [string, (event: unknown) => void][]
  )
    .filter(([event]) => event === "playingChange")
    .at(-1)![1];
  h.player.playing = isPlaying;
  await act(async () => listener({ isPlaying, oldIsPlaying }));
  await advance(1);
};
it("requests a story pause for an external stop without completing or seeking", async () => {
  await render();
  await playingEvent(true, false);
  await playingEvent(false, true);
  expect(interrupted).toHaveBeenCalledOnce();
  expect(completed).not.toHaveBeenCalled();
  expect(h.player.currentTime).toBe(5);
});
it.each(["intentional", "ended", "error", "loading"])(
  "does not mistake %s playback stops for interruptions",
  async (kind) => {
    await render();
    await playingEvent(true, false);
    if (kind === "intentional") handle!.pause();
    if (kind === "ended") h.player.currentTime = 20;
    if (kind === "error" || kind === "loading") h.player.status = kind;
    await playingEvent(false, true);
    expect(interrupted).not.toHaveBeenCalled();
  }
);
it("stops an unsolicited system resume while the story is paused", async () => {
  await render();
  h.active = false;
  await render();
  await playingEvent(true, false);
  expect(h.player.pause).toHaveBeenCalled();
  expect(interrupted).not.toHaveBeenCalled();
});

it("resuming an ended clip completes it once instead of replaying it", async () => {
  await render("video", { behavior: "advance" });
  h.active = false;
  await render("video", { behavior: "advance" });
  h.player.currentTime = 19.95;
  h.player.play.mockClear();
  await act(async () => handle!.play({ userGesture: true }));
  await act(async () => handle!.play({ userGesture: true }));
  expect(completed).toHaveBeenCalledOnce();
  expect(h.player.play).not.toHaveBeenCalled();
  expect(h.player.currentTime).toBe(19.95);
});
it("resuming an ended hold-last-frame clip keeps its frame and hold duration", async () => {
  const ending = { behavior: "hold-last-frame", durationMs: 2000 };
  await render("video", ending);
  h.active = false;
  await render("video", ending);
  h.player.currentTime = 20;
  h.player.play.mockClear();
  await act(async () => handle!.play({ userGesture: true }));
  h.active = true;
  await render("video", ending);
  expect(h.player.play).not.toHaveBeenCalled();
  expect(h.player.replaceAsync).toHaveBeenCalledOnce();
  await advance(1999);
  expect(completed).not.toHaveBeenCalled();
  await advance(1);
  expect(completed).toHaveBeenCalledOnce();
});
it("ordinary mid-clip resume still plays without advancing the story", async () => {
  await render("video", { behavior: "advance" });
  h.player.play.mockClear();
  await act(async () => handle!.play({ userGesture: true }));
  expect(h.player.play).toHaveBeenCalledOnce();
  expect(completed).not.toHaveBeenCalled();
});

it("resumes a terminal loop rather than declaring it finished", async () => {
  const ending = { behavior: "loop", assetId: "clip" };
  await render("video", ending);
  h.player.currentTime = 20;
  await act(async () => handle!.play());
  h.player.play.mockClear();
  await act(async () => handle!.play({ userGesture: true }));
  expect(h.player.play).toHaveBeenCalledOnce();
  expect(completed).not.toHaveBeenCalled();
});

it("rejects a system resume during a held final frame without resetting its timer", async () => {
  const ending = { behavior: "hold-last-frame", durationMs: 2000 };
  await render("video", ending);
  h.player.currentTime = 20;
  await act(async () => handle!.play());
  await advance(1000);
  // Native/browser media controls may rewind an ended clip before emitting Play.
  h.player.currentTime = 0;
  h.player.pause.mockClear();
  await playingEvent(true, false);
  expect(h.player.pause).toHaveBeenCalledOnce();
  expect(interrupted).not.toHaveBeenCalled();
  expect(h.player.currentTime).toBe(20);
  await advance(998);
  expect(completed).not.toHaveBeenCalled();
  await advance(1);
  expect(completed).toHaveBeenCalledOnce();
  expect(h.player.replaceAsync).toHaveBeenCalledOnce();
});

it("allows a terminal loop to keep playing while the screen is active", async () => {
  await render("video", { behavior: "loop", assetId: "clip" });
  h.player.currentTime = 20;
  await act(async () => handle!.play());
  h.player.pause.mockClear();
  await playingEvent(true, false);
  expect(h.player.pause).not.toHaveBeenCalled();
  expect(completed).not.toHaveBeenCalled();
});

it("keeps stale video playback stopped while a still image owns the scene", async () => {
  await render("still", { behavior: "hold-last-frame", durationMs: 2000 }, "image/png");
  h.player.pause.mockClear();
  await playingEvent(true, false);
  expect(h.player.pause).toHaveBeenCalledOnce();
  expect(interrupted).not.toHaveBeenCalled();
  expect(h.player.replaceAsync).not.toHaveBeenCalled();
});

it("changes video rate without reloading and forwards rate to stills", async () => {
  const ending = { behavior: "advance" };
  await render("rate", ending);
  const loads = h.player.replaceAsync.mock.calls.length;
  playbackRate = 2;
  await render("rate", ending);
  expect(h.player.playbackRate).toBe(2);
  expect(h.player.replaceAsync).toHaveBeenCalledTimes(loads);
  await render("still-rate", ending, "image/png");
  expect(h.stillProps?.playbackRate).toBe(2);
});
it("uses the latest rate when an asynchronous source load completes", async () => {
  let finish!: () => void;
  h.player.replaceAsync.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  const ending = { behavior: "advance" };
  await render("loading-rate", ending);
  playbackRate = 1.5;
  await render("loading-rate", ending);
  h.player.playbackRate = 1;
  await act(async () => finish());
  expect(h.player.playbackRate).toBe(1.5);
  expect(h.player.play).toHaveBeenCalled();
});

it("scales restored held-frame time at double speed", async () => {
  playbackRate = 2;
  checkpoint = {
    rendererInstanceId: "saved",
    sequenceIndex: 0,
    assetId: "clip",
    terminalMode: { kind: "held" },
    positionMs: 20000,
    watchedUntilMs: 20000,
    remainingHoldMs: 1000,
    completed: false,
  } as ExperienceMediaCheckpoint;
  await render("saved", { behavior: "hold-last-frame", durationMs: 3000 });
  expect(progress.mock.calls.at(-1)![0].remainingHoldMs).toBe(1000);
  await advance(250);
  expect(progress.mock.calls.at(-1)![0].remainingHoldMs).toBe(500);
  await advance(250);
  expect(progress.mock.calls.at(-1)![0]).toMatchObject({ completed: true, remainingHoldMs: 0 });
});

it("credits elapsed double-speed playback but rejects an instantaneous forward jump", async () => {
  playbackRate = 2;
  await render("watch-rate", { behavior: "advance" });
  const update = (
    h.player.addListener.mock.calls as unknown as [string, (event: unknown) => void][]
  ).find(([name]) => name === "timeUpdate")![1];
  await advance(1000);
  await act(async () => update({ currentTime: 2 }));
  expect(progress.mock.calls.at(-1)![0].watchedUntilMs).toBe(2000);
  await act(async () => update({ currentTime: 3 }));
  expect(progress.mock.calls.at(-1)![0]).toMatchObject({ positionMs: 3000, watchedUntilMs: 2000 });
});
it("does not turn background time into viewing credit on resume", async () => {
  const ending = { behavior: "advance" };
  await render("watch-pause", ending);
  const update = (
    h.player.addListener.mock.calls as unknown as [string, (event: unknown) => void][]
  ).find(([name]) => name === "timeUpdate")![1];
  await advance(250);
  await act(async () => update({ currentTime: 0.25 }));
  h.active = false;
  await render("watch-pause", ending);
  await advance(10000);
  h.active = true;
  await render("watch-pause", ending);
  await act(async () => update({ currentTime: 1.25 }));
  expect(progress.mock.calls.at(-1)![0].watchedUntilMs).toBe(250);
});
it("accounts for both rates in an observation interval and preserves credit when seeking backward", async () => {
  const ending = { behavior: "advance" };
  await render("watch-change", ending);
  const update = (
    h.player.addListener.mock.calls as unknown as [string, (event: unknown) => void][]
  ).find(([name]) => name === "timeUpdate")![1];
  await advance(500);
  playbackRate = 2;
  await render("watch-change", ending);
  await advance(500);
  await act(async () => update({ currentTime: 1.5 }));
  expect(progress.mock.calls.at(-1)![0].watchedUntilMs).toBe(1500);
  await act(async () => handle!.seek(0));
  await act(async () => update({ currentTime: 1.6 }));
  expect(progress.mock.calls.at(-1)![0].watchedUntilMs).toBe(1500);
});

it("clamps still seeking to watched time and does not touch the video player", async () => {
  await render("still-seek", { behavior: "hold-last-frame", durationMs: 3000 }, "image/png");
  await advance(1000);
  await act(async () => h.stillProps!.onTimelineTimeMs(1000));
  const seekStill = vi.fn(() => true);
  await act(async () => h.stillProps!.onSeekHandle(seekStill));
  const videoPosition = h.player.currentTime;
  await act(async () => handle!.seek(20));
  expect(seekStill).toHaveBeenLastCalledWith(1000);
  expect(h.player.currentTime).toBe(videoPosition);
  expect(progress.mock.calls.at(-1)![0]).toMatchObject({ positionMs: 1000, watchedUntilMs: 1000 });
  seekStill.mockReturnValue(false);
  await act(async () => handle!.seek(0));
  expect(progress.mock.calls.at(-1)![0].positionMs).toBe(1000);
});

it("creates a fresh player for the next shot even when both shots use the same URI", async () => {
  await act(async () =>
    root.render(
      <ExperienceVideoRenderer
        manifest={
          {
            assets: [
              {
                kind: "video",
                assetId: "clip",
                variants: [
                  {
                    orientation: "landscape",
                    uri: "file:///clip.mp4",
                    mediaType: "video/mp4",
                    durationMs: 20000,
                  },
                ],
              },
            ],
          } as unknown as ExperienceRuntimeManifest
        }
        renderer={
          {
            instanceId: "cuts",
            config: {
              sequence: [
                { clipId: "one", assetId: "clip", endBehavior: { behavior: "advance" } },
                { clipId: "two", assetId: "clip", endBehavior: { behavior: "advance" } },
              ],
              fit: "contain",
              autoplay: true,
            },
          } as unknown as ExperienceRendererInstance
        }
        copy={testCopy}
        onCompleted={completed}
        onRuntimeError={noop}
        onTimelineTimeMs={noop}
      />
    )
  );
  expect(h.mounts).toHaveBeenCalledTimes(1);
  const end = (h.player.addListener.mock.calls as unknown as [string, () => void][]).find(
    ([name]) => name === "playToEnd"
  )![1];
  await act(async () => end());
  expect(h.mounts).toHaveBeenCalledTimes(2);
  expect(completed).not.toHaveBeenCalled();
});
