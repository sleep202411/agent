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
    cues: [{ cueId: "cue", busId: "music", gain: 1, loop: false, fadeInMs: 0, fadeOutMs: 0 }],
  },
  assets: [
    { kind: "audio", assetId: "asset", variants: [{ locale: "en-US", uri: "fixture.mp3" }] },
  ],
  localization: { defaultLocale: "en-US" },
} as unknown as ExperienceRuntimeManifest;
let root: Root;
let latest: ReturnType<typeof useExperienceAudioHost>;
const onError = vi.fn();
function Harness() {
  const value = useExperienceAudioHost(manifest, "en-US", onError);
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
function play() {
  latest.applyEffects([
    { kind: "audio.play", cueId: "cue", assetId: "asset", playbackOrdinal: 1, playbackRate: 1 },
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
