import { describe, expect, it, vi } from "vitest";
import type { MediaPlayerInstance } from "@vidstack/react";
import { ExperienceMediaReadinessGate, playMediaPlayerWhenReady } from "./experience-media-player";

describe("ExperienceMediaReadinessGate", () => {
  it("keeps an early playback request pending until the same source can play", async () => {
    const gate = new ExperienceMediaReadinessGate("clip-a");
    const settled = vi.fn();

    const pending = gate.wait("clip-a").then(settled);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    gate.markReady("clip-a");
    await pending;
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("lets every caller through once the source is ready", async () => {
    const gate = new ExperienceMediaReadinessGate("clip-a");
    gate.markReady("clip-a");

    await expect(gate.wait("clip-a")).resolves.toBeUndefined();
    await expect(gate.wait("clip-a")).resolves.toBeUndefined();
  });

  it("aborts an old request when the media source changes", async () => {
    const gate = new ExperienceMediaReadinessGate("clip-a");
    const pending = gate.wait("clip-a");

    gate.reset("clip-b");

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await expect(gate.wait("clip-a")).rejects.toMatchObject({ name: "AbortError" });
    gate.markReady("clip-b");
    await expect(gate.wait("clip-b")).resolves.toBeUndefined();
  });

  it("reopens a cancelled source when React replays the same effect setup", async () => {
    const gate = new ExperienceMediaReadinessGate("clip-a");
    const abandoned = gate.wait("clip-a");

    gate.cancel("clip-a");
    await expect(abandoned).rejects.toMatchObject({ name: "AbortError" });

    gate.reset("clip-a");
    const replayed = gate.wait("clip-a");
    gate.markReady("clip-a");

    await expect(replayed).resolves.toBeUndefined();
  });

  it("propagates a real media failure instead of treating it as loading", async () => {
    const gate = new ExperienceMediaReadinessGate("clip-a");
    const pending = gate.wait("clip-a");
    const decodeError = new Error("The media could not be decoded.");
    decodeError.name = "NotSupportedError";

    gate.fail("clip-a", decodeError);

    await expect(pending).rejects.toBe(decodeError);
    await expect(gate.wait("clip-a")).rejects.toBe(decodeError);
  });
});

describe("playMediaPlayerWhenReady", () => {
  it("does not play an existing provider until the incoming source can play", async () => {
    const nativePlay = vi.fn(async () => undefined);
    const player = mediaPlayerWithVideoProvider(nativePlay);
    const gate = new ExperienceMediaReadinessGate("clip-b");

    const pending = playMediaPlayerWhenReady(player, gate, "clip-b");
    await Promise.resolve();
    expect(nativePlay).not.toHaveBeenCalled();

    gate.markReady("clip-b");
    await pending;
    expect(nativePlay).toHaveBeenCalledTimes(1);
  });

  it("plays immediately when this source is already ready", async () => {
    const nativePlay = vi.fn(async () => undefined);
    const player = mediaPlayerWithVideoProvider(nativePlay);
    const gate = new ExperienceMediaReadinessGate("clip-b");
    gate.markReady("clip-b");

    await playMediaPlayerWhenReady(player, gate, "clip-b");

    expect(nativePlay).toHaveBeenCalledTimes(1);
  });
});

function mediaPlayerWithVideoProvider(play: () => Promise<void>): MediaPlayerInstance {
  return {
    provider: {
      type: "video",
      media: { play, paused: true, ended: false },
    },
    state: { currentTime: 0, duration: 5, ended: false, seekableEnd: 5 },
  } as unknown as MediaPlayerInstance;
}
