import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ExperienceRuntimeManifest } from "@repo/shared/experience-runtime";
import { useExperienceAudioHost } from "./use-experience-audio-host";
const native = vi.hoisted(() => ({
  createAudioPlayer: vi.fn(),
  setAudioModeAsync: vi.fn(),
  setIsAudioActiveAsync: vi.fn(),
  ensureAudioCached: vi.fn(),
  maintainExperienceAudioCache: vi.fn(),
}));
vi.mock("expo-audio", () => native);
vi.mock("../lib/experience-audio-cache", () => native);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const manifest = {
  audio: {
    buses: [{ busId: "music", defaultGain: 1 }],
    snapshots: [],
    duckingRules: [],
    cues: [
      {
        cueId: "cue",
        assetIds: ["asset"],
        busId: "music",
        gain: 1,
        loop: false,
        fadeInMs: 0,
        fadeOutMs: 0,
      },
    ],
  },
  assets: [
    { kind: "audio", assetId: "asset", variants: [{ locale: "en-US", uri: "fixture.mp3" }] },
  ],
  localization: { defaultLocale: "en-US" },
} as unknown as ExperienceRuntimeManifest;
let root: Root;
let latest: ReturnType<typeof useExperienceAudioHost>;
const onError = vi.fn();
function Harness({ definition = manifest }: { definition?: ExperienceRuntimeManifest }) {
  const value = useExperienceAudioHost(definition, "en-US", onError);
  useLayoutEffect(() => {
    latest = value;
  });
  return null;
}
beforeEach(async () => {
  vi.clearAllMocks();
  native.setAudioModeAsync.mockResolvedValue(undefined);
  native.setIsAudioActiveAsync.mockResolvedValue(undefined);
  native.maintainExperienceAudioCache.mockResolvedValue(undefined);
  native.ensureAudioCached.mockReset();
  root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(<Harness />);
  });
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
});
function play(playbackOrdinal = 1) {
  latest.applyEffects([
    { kind: "audio.play", cueId: "cue", assetId: "asset", playbackOrdinal, playbackRate: 1 },
  ]);
}
it("suppresses delayed cache errors after leaving the player", async () => {
  let reject!: (reason: Error) => void;
  native.ensureAudioCached.mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      })
  );
  await act(async () => {
    play();
  });
  expect(native.ensureAudioCached).toHaveBeenCalledTimes(1);
  await act(async () => {
    root.unmount();
  });
  await act(async () => {
    reject(new Error("old chapter unavailable"));
  });
  expect(onError).not.toHaveBeenCalled();
  expect(native.createAudioPlayer).not.toHaveBeenCalled();
});
it("reports active failures and accepts another request afterwards", async () => {
  native.ensureAudioCached.mockRejectedValue(new Error("media unavailable"));
  await act(async () => {
    play();
  });
  expect(onError).toHaveBeenCalledWith("media unavailable");
  await act(async () => {
    play();
  });
  expect(native.ensureAudioCached).toHaveBeenCalledTimes(2);
});
it("releases a native activation that finishes after unmount", async () => {
  let release!: () => void;
  native.setIsAudioActiveAsync.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      })
  );
  let unlocked!: Promise<void>;
  await act(async () => {
    unlocked = latest.unlock();
  });
  expect(native.setIsAudioActiveAsync).toHaveBeenCalledWith(true);
  await act(async () => {
    root.unmount();
  });
  await act(async () => {
    release();
    await unlocked;
  });
  expect(native.setIsAudioActiveAsync.mock.calls.map(([active]) => active)).toEqual([true, false]);
  expect(native.setAudioModeAsync).toHaveBeenLastCalledWith(
    expect.objectContaining({ playsInSilentMode: false })
  );
});

it("keeps the replacement host active when the outgoing host unmounts", async () => {
  await act(async () => {
    await latest.unlock();
  });
  const replacement = createRoot(document.createElement("div"));
  try {
    await act(async () => {
      replacement.render(<Harness />);
    });
    await act(async () => {
      await latest.unlock();
    });
    native.setIsAudioActiveAsync.mockClear();
    await act(async () => {
      root.unmount();
    });
    expect(native.setIsAudioActiveAsync).not.toHaveBeenCalled();
  } finally {
    await act(async () => {
      replacement.unmount();
    });
  }
  expect(native.setIsAudioActiveAsync).toHaveBeenCalledWith(false);
});

function playerFixture() {
  return {
    volume: 1,
    playing: true,
    loop: false,
    currentTime: 0,
    seekTo: vi.fn().mockResolvedValue(undefined),
    play: vi.fn(),
    pause: vi.fn(),
    remove: vi.fn(),
    setPlaybackRate: vi.fn(),
    addListener: vi.fn(() => ({ remove: vi.fn() })),
  };
}
it("captures cue identity, current time and bus gain and restores by seeking before play", async () => {
  const first = playerFixture();
  const second = playerFixture();
  native.createAudioPlayer.mockReturnValueOnce(first).mockReturnValueOnce(second);
  native.ensureAudioCached.mockResolvedValue("file://cached.mp3");
  await act(async () => {
    play(3);
  });
  first.currentTime = 12.5;
  latest.applyEffects([{ kind: "audio.fade-bus", busId: "music", gain: 0.4, durationMs: 0 }]);
  await act(async () => {});
  const snapshot = latest.checkpoint()!;
  expect(snapshot).toEqual({
    playbacks: [
      {
        cueId: "cue",
        assetId: "asset",
        playbackRate: 1,
        playbackOrdinal: 3,
        positionSeconds: 12.5,
      },
    ],
    busGains: { music: 0.4 },
  });
  await act(async () => {
    latest.restore(snapshot);
  });
  expect(first.remove).toHaveBeenCalled();
  expect(second.seekTo).toHaveBeenCalledWith(12.5);
  expect(second.play).toHaveBeenCalledOnce();
  expect(second.seekTo.mock.invocationCallOrder[0]).toBeLessThan(
    second.play.mock.invocationCallOrder[0]!
  );
  expect(second.volume).toBe(0.4);
});
it("retains pending offsets while restoring and suppresses an abandoned download", async () => {
  let oldReady!: (uri: string) => void;
  native.ensureAudioCached
    .mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          oldReady = resolve;
        })
    )
    .mockResolvedValue("file://new.mp3");
  const player = playerFixture();
  native.createAudioPlayer.mockReturnValue(player);
  await act(async () => {
    play(1);
  });
  expect(latest.checkpoint()!.playbacks[0]!.playbackOrdinal).toBe(1);
  await act(async () => {
    latest.restore({
      playbacks: [
        {
          cueId: "cue",
          assetId: "asset",
          playbackRate: 1.25,
          playbackOrdinal: 5,
          positionSeconds: 8,
        },
      ],
      busGains: {},
    });
    expect(latest.checkpoint()!.playbacks[0]!.positionSeconds).toBe(8);
  });
  expect(player.seekTo).toHaveBeenCalledWith(8);
  await act(async () => {
    oldReady("file://old.mp3");
  });
  expect(native.createAudioPlayer).toHaveBeenCalledOnce();
  expect(latest.checkpoint()!.playbacks[0]!.playbackOrdinal).toBe(5);
});
it("keeps restored audio paused and resets it without replay when cleared", async () => {
  const player = playerFixture();
  native.createAudioPlayer.mockReturnValue(player);
  native.ensureAudioCached.mockResolvedValue("file://cached.mp3");
  await act(async () => {
    await latest.unlock();
    await latest.suspend();
  });
  await act(async () => {
    latest.restore({
      playbacks: [
        { cueId: "cue", assetId: "asset", playbackRate: 1, playbackOrdinal: 1, positionSeconds: 9 },
      ],
      busGains: { music: 0.2 },
    });
  });
  expect(player.play).not.toHaveBeenCalled();
  expect(player.seekTo).toHaveBeenCalledWith(9);
  await act(async () => {
    latest.restore();
  });
  expect(player.remove).toHaveBeenCalled();
  expect(latest.checkpoint()).toEqual({ playbacks: [], busGains: { music: 1 } });
});
it("rejects invalid restoration before replacing currently playing cues", async () => {
  const player = playerFixture();
  native.createAudioPlayer.mockReturnValue(player);
  native.ensureAudioCached.mockResolvedValue("file://cached.mp3");
  await act(async () => {
    play();
  });
  expect(() => latest.restore({ playbacks: [], busGains: { removed: 1 } })).toThrow();
  expect(player.remove).not.toHaveBeenCalled();
});
it("releases an in-flight seek immediately on unmount and never plays its late result", async () => {
  const player = playerFixture();
  let finish!: () => void;
  player.seekTo.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  native.createAudioPlayer.mockReturnValue(player);
  native.ensureAudioCached.mockResolvedValue("file://cached.mp3");
  await act(async () => {
    latest.restore({
      playbacks: [
        { cueId: "cue", assetId: "asset", playbackRate: 1, playbackOrdinal: 1, positionSeconds: 2 },
      ],
      busGains: {},
    });
  });
  expect(player.seekTo).toHaveBeenCalled();
  await act(async () => {
    root.unmount();
  });
  expect(player.remove).toHaveBeenCalledOnce();
  await act(async () => {
    finish();
  });
  expect(player.play).not.toHaveBeenCalled();
  expect(player.remove).toHaveBeenCalledOnce();
});
it("does not activate a suspended fresh host while preparing restored audio", async () => {
  const player = playerFixture();
  native.createAudioPlayer.mockReturnValue(player);
  native.ensureAudioCached.mockResolvedValue("file://cached.mp3");
  await act(async () => {
    await latest.suspend();
  });
  native.setIsAudioActiveAsync.mockClear();
  await act(async () => {
    latest.restore({
      playbacks: [
        { cueId: "cue", assetId: "asset", playbackRate: 1, playbackOrdinal: 1, positionSeconds: 2 },
      ],
      busGains: {},
    });
  });
  expect(native.setIsAudioActiveAsync).not.toHaveBeenCalled();
  expect(player.play).not.toHaveBeenCalled();
  await act(async () => {
    await latest.unlock();
  });
  expect(player.play).toHaveBeenCalledOnce();
});
it("ignores a removed player's late completion after restoring the same cue ordinal", async () => {
  let oldFinished!: (status: { didJustFinish: boolean }) => void;
  const first = playerFixture();
  const second = playerFixture();
  first.addListener.mockImplementation((...args: unknown[]) => {
    oldFinished = args[1] as typeof oldFinished;
    return { remove: vi.fn() };
  });
  native.createAudioPlayer.mockReturnValueOnce(first).mockReturnValueOnce(second);
  native.ensureAudioCached.mockResolvedValue("file://cached.mp3");
  await act(async () => {
    play();
  });
  const snapshot = latest.checkpoint();
  await act(async () => {
    latest.restore(snapshot);
  });
  await act(async () => {
    oldFinished({ didJustFinish: true });
  });
  expect(second.remove).not.toHaveBeenCalled();
  expect(latest.checkpoint()!.playbacks).toHaveLength(1);
});
async function concurrencyFixture(overflowBehavior: "stop-oldest" | "reject-new" = "stop-oldest") {
  const definition = {
    ...manifest,
    audio: {
      ...manifest.audio!,
      cues: [
        {
          ...manifest.audio!.cues[0]!,
          fadeOutMs: 1000,
          concurrency: { groupId: "one", maxInstances: 1, overflowBehavior },
        },
      ],
    },
  };
  const players: ReturnType<typeof playerFixture>[] = [];
  native.createAudioPlayer.mockImplementation(() => {
    const player = playerFixture();
    players.push(player);
    return player;
  });
  native.ensureAudioCached.mockResolvedValue("file://cached.mp3");
  await act(async () => {
    root.render(<Harness definition={definition} />);
  });
  return players;
}
it("does not repeatedly choose an already stopping cue during rapid replacements", async () => {
  vi.useFakeTimers();
  try {
    const players = await concurrencyFixture();
    await act(async () => {
      play(1);
    });
    await act(async () => {
      play(2);
    });
    await act(async () => {
      play(3);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(players).toHaveLength(3);
    expect(players[0]!.pause).toHaveBeenCalled();
    expect(players[1]!.pause).toHaveBeenCalled();
    expect(players[2]!.pause).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
it("keeps the current cue playing when its replacement cannot be loaded", async () => {
  vi.useFakeTimers();
  try {
    const players = await concurrencyFixture();
    await act(async () => {
      play(1);
    });
    native.ensureAudioCached.mockRejectedValueOnce(new Error("replacement unavailable"));
    await act(async () => {
      play(2);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(players).toHaveLength(1);
    expect(players[0]!.pause).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("replacement unavailable");
  } finally {
    vi.useRealTimers();
  }
});
it("retains reject-new admission without downloading another cue", async () => {
  const players = await concurrencyFixture("reject-new");
  await act(async () => {
    play(1);
  });
  await act(async () => {
    play(2);
  });
  expect(players).toHaveLength(1);
  expect(native.ensureAudioCached).toHaveBeenCalledTimes(1);
});

it("still releases a native player when pausing it during cleanup throws", async () => {
  const players = await concurrencyFixture();
  await act(async () => {
    play(1);
  });
  players[0]!.pause.mockImplementationOnce(() => {
    throw new Error("already detached");
  });
  await act(async () => {
    root.unmount();
  });
  expect(players[0]!.remove).toHaveBeenCalledTimes(1);
  expect(native.setIsAudioActiveAsync).toHaveBeenLastCalledWith(false);
});
it("continues native cleanup after a status subscription is already detached", async () => {
  const players = await concurrencyFixture();
  await act(async () => {
    play(1);
  });
  const subscription = players[0]!.addListener.mock.results[0]!.value;
  subscription.remove.mockImplementationOnce(() => {
    throw new Error("already detached");
  });
  await act(async () => {
    root.unmount();
  });
  expect(players[0]!.pause).toHaveBeenCalledTimes(1);
  expect(players[0]!.remove).toHaveBeenCalledTimes(1);
  expect(native.setIsAudioActiveAsync).toHaveBeenLastCalledWith(false);
});
it("freezes an in-flight fade while paused and resumes the fading cue", async () => {
  vi.useFakeTimers();
  try {
    const players = await concurrencyFixture();
    await act(async () => {
      play(1);
    });
    await act(async () => {
      play(2);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    const fading = players[0]!;
    const volume = fading.volume;
    await act(async () => {
      await latest.suspend();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });
    expect(fading.volume).toBe(volume);
    expect(fading.remove).not.toHaveBeenCalled();
    const plays = fading.play.mock.calls.length;
    await act(async () => {
      await latest.unlock();
    });
    expect(fading.play).toHaveBeenCalledTimes(plays + 1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(fading.remove).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
