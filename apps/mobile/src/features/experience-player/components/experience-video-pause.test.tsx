import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  ExperienceRuntimeManifest,
  ExperienceRendererInstance,
} from "@repo/shared/experience-runtime";
import { ExperienceVideoRenderer } from "./experience-video-renderer";
import type { ExperiencePlayerCopy } from "../lib/experience-player-copy";
const h = vi.hoisted(() => ({
  active: true,
  player: {
    playing: false,
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
vi.mock("./experience-video-platform", () => ({
  useVideoPlayer: () => h.player,
  VideoView: () => null,
}));
vi.mock("@/hooks/use-app-active", () => ({ useGatedScreenActive: () => h.active }));
vi.mock("../lib/experience-playback-delivery", () => ({
  resolveExperienceVideoSource: vi.fn().mockResolvedValue({ uri: "file:///clip.mp4" }),
}));
vi.mock("./experience-still-segment", () => ({ ExperienceStillSegment: () => null }));
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
let handle: {
  pause: () => void;
  play: (options?: { userGesture?: boolean }) => Promise<void>;
} | null;
let root: Root;
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
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  h.active = true;
  completed.mockClear();
  refused.mockClear();
  interrupted.mockClear();
  h.player.status = "readyToPlay";
  h.player.currentTime = 5;
  h.player.playing = false;
  h.player.pause.mockClear();
  h.player.play.mockClear();
  h.player.replaceAsync.mockClear();
  h.player.addListener.mockClear();
  root = createRoot(document.createElement("div"));
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
