// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ExperienceRuntimeManifest } from "@repo/shared/experience-runtime";
import { useExperienceAudioHost } from "./use-experience-audio-host";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const manifest = {
  audio: {
    buses: [{ busId: "music", defaultGain: 1 }],
    snapshots: [],
    duckingRules: [],
    cues: [
      {
        cueId: "cue",
        busId: "music",
        gain: 1,
        loop: false,
        fadeInMs: 0,
        fadeOutMs: 1000,
        concurrency: { groupId: "one", maxInstances: 1, overflowBehavior: "stop-oldest" },
      },
    ],
  },
  assets: ["asset", "replacement"].map((assetId) => ({
    kind: "audio",
    assetId,
    variants: [{ locale: "en-US", uri: `${assetId}.mp3`, sha256: "0".repeat(64) }],
  })),
  localization: { defaultLocale: "en-US" },
} as unknown as ExperienceRuntimeManifest;
function sourceFixture() {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    playbackRate: { value: 1 },
    onended: null,
    buffer: null,
    loop: false,
  };
}
let root: Root;
let latest: ReturnType<typeof useExperienceAudioHost>;
let sources: ReturnType<typeof sourceFixture>[];
let clock: number;
const fetchMock = vi.fn();
const onError = vi.fn();
const decode = vi.fn();
function Harness({ definition = manifest }: { definition?: ExperienceRuntimeManifest }) {
  const value = useExperienceAudioHost(definition, "en-US", onError);
  useLayoutEffect(() => {
    latest = value;
  });
  return null;
}
beforeEach(async () => {
  vi.clearAllMocks();
  decode.mockReset().mockResolvedValue({});
  sources = [];
  clock = 0;
  fetchMock
    .mockReset()
    .mockResolvedValue({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(1)) });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("crypto", {
    subtle: { digest: vi.fn(() => Promise.resolve(new ArrayBuffer(32))) },
  });
  vi.stubGlobal(
    "AudioContext",
    class {
      state = "running";
      destination = {};
      get currentTime() {
        return clock;
      }
      resume = vi.fn(() => Promise.resolve());
      suspend = vi.fn(() => Promise.resolve());
      close = vi.fn(() => Promise.resolve());
      decodeAudioData = decode;
      createGain() {
        return {
          connect: vi.fn(),
          disconnect: vi.fn(),
          gain: {
            value: 1,
            setValueAtTime: vi.fn(),
            linearRampToValueAtTime: vi.fn(),
            cancelScheduledValues: vi.fn(),
          },
        };
      }
      createBufferSource() {
        const source = sourceFixture();
        sources.push(source);
        return source;
      }
    }
  );
  root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(<Harness />);
  });
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  vi.unstubAllGlobals();
});
async function play(playbackOrdinal: number, assetId = "asset") {
  clock += 1;
  await act(async () => {
    latest.applyEffects([
      { kind: "audio.play", cueId: "cue", assetId, playbackOrdinal, playbackRate: 1 },
    ]);
  });
}
it("selects a live victim for each rapid replacement instead of an already fading cue", async () => {
  await play(1);
  await play(2);
  await play(3);
  expect(sources).toHaveLength(3);
  expect(sources[0]!.stop).toHaveBeenCalledTimes(1);
  expect(sources[1]!.stop).toHaveBeenCalledTimes(1);
  expect(sources[2]!.stop).not.toHaveBeenCalled();
});
it("does not silence the active cue when replacement loading fails and allows retry", async () => {
  await play(1);
  fetchMock.mockRejectedValueOnce(new Error("offline"));
  await play(2, "replacement");
  expect(sources[0]!.stop).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalledWith("offline");
  await play(3, "replacement");
  expect(sources).toHaveLength(2);
  expect(sources[0]!.stop).toHaveBeenCalledTimes(1);
});
it("ignores a late fetch failure after the host is disposed", async () => {
  let reject!: (error: Error) => void;
  fetchMock.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      })
  );
  await play(1);
  await act(async () => {
    root.unmount();
  });
  await act(async () => {
    reject(new Error("abandoned"));
  });
  expect(onError).not.toHaveBeenCalled();
  expect(sources).toHaveLength(0);
});

it("verifies a different digest even when another asset uses the same URI", async () => {
  const definition = {
    ...manifest,
    assets: manifest.assets.map((asset, index) => ({
      ...asset,
      variants: [{ locale: "en-US", uri: "shared.mp3", sha256: String(index).repeat(64) }],
    })),
  } as ExperienceRuntimeManifest;
  await act(async () => {
    root.render(<Harness definition={definition} />);
  });
  await play(1);
  await play(2, "replacement");
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(onError).toHaveBeenCalledWith(expect.stringContaining("integrity validation"));
  expect(sources).toHaveLength(1);
});
it("aborts outstanding audio fetches when leaving the player", async () => {
  fetchMock.mockImplementationOnce(
    (_uri: string, options: RequestInit) =>
      new Promise((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      })
  );
  await play(1);
  const signal = fetchMock.mock.calls[0]![1]?.signal as AbortSignal | undefined;
  await act(async () => {
    root.unmount();
  });
  expect(signal?.aborted).toBe(true);
  expect(onError).not.toHaveBeenCalled();
});
it("does not hash or decode a delayed response body after disposal", async () => {
  let finish!: (bytes: ArrayBuffer) => void;
  fetchMock.mockResolvedValueOnce({
    ok: true,
    arrayBuffer: () =>
      new Promise<ArrayBuffer>((resolve) => {
        finish = resolve;
      }),
  });
  await play(1);
  await act(async () => {
    root.unmount();
  });
  await act(async () => {
    finish(new ArrayBuffer(1));
  });
  expect(crypto.subtle.digest).not.toHaveBeenCalled();
  expect(decode).not.toHaveBeenCalled();
});
it("does not decode after a delayed integrity check outlives the host", async () => {
  let finish!: (bytes: ArrayBuffer) => void;
  vi.mocked(crypto.subtle.digest).mockImplementationOnce(
    () =>
      new Promise<ArrayBuffer>((resolve) => {
        finish = resolve;
      })
  );
  await play(1);
  await act(async () => {
    root.unmount();
  });
  await act(async () => {
    finish(new ArrayBuffer(32));
  });
  expect(decode).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
});
