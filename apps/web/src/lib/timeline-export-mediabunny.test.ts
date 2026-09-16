import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  audio: false,
  probe: vi.fn(),
  audioAdd: vi.fn(),
  audioClose: vi.fn(),
  dispose: vi.fn(),
  close: vi.fn(),
  add: vi.fn(),
  start: vi.fn(),
  cancel: vi.fn(),
  finalize: vi.fn(),
}));
vi.mock("mediabunny", () => ({
  ALL_FORMATS: [],
  QUALITY_MEDIUM: 1,
  UrlSource: class {},
  Mp4OutputFormat: class {},
  BufferTarget: class {
    buffer = new ArrayBuffer(1);
  },
  Input: class {
    getPrimaryVideoTrack() {
      return fixture.probe();
    }
    getPrimaryAudioTrack() {
      return Promise.resolve(fixture.audio ? {} : null);
    }
    computeDuration() {
      return Promise.resolve(1);
    }
    dispose = fixture.dispose;
  },
  Output: class {
    target: unknown;
    constructor({ target }: { target: unknown }) {
      this.target = target;
    }
    addVideoTrack() {}
    addAudioTrack() {}
    start = fixture.start;
    cancel = fixture.cancel;
    finalize = fixture.finalize;
  },
  VideoSampleSource: class {
    add = fixture.add;
  },
  AudioSampleSource: class {
    add = fixture.audioAdd;
  },
  AudioSampleSink: class {
    async *samples() {
      yield { timestamp: 0, setTimestamp: vi.fn(), close: fixture.audioClose };
    }
  },
  VideoSampleSink: class {
    async *samples() {
      yield { timestamp: 0, setTimestamp: vi.fn(), close: fixture.close };
    }
  },
}));
import { exportTimelineToMp4 } from "./timeline-export-mediabunny";
beforeEach(() => {
  vi.resetAllMocks();
  fixture.audio = false;
  fixture.probe.mockResolvedValue({});
  vi.stubGlobal("VideoEncoder", class {});
  vi.stubGlobal("AudioEncoder", class {});
  fixture.start.mockResolvedValue(undefined);
  fixture.add.mockResolvedValue(undefined);
  fixture.cancel.mockResolvedValue(undefined);
  fixture.finalize.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const shots = [{ id: "one", videoUrl: "https://media.invalid/one.mp4" }];
it("releases opened inputs after output setup fails", async () => {
  const failure = new Error("encoder unavailable");
  fixture.start.mockRejectedValue(failure);
  await expect(exportTimelineToMp4(shots)).rejects.toBe(failure);
  expect(fixture.dispose).toHaveBeenCalledTimes(1);
  expect(fixture.cancel).toHaveBeenCalledTimes(1);
});
it("closes samples after the encoder rejects them and cancels empty output", async () => {
  fixture.add.mockRejectedValue(new Error("encoding failed"));
  await expect(exportTimelineToMp4(shots)).rejects.toThrow("no frames");
  expect(fixture.close).toHaveBeenCalledTimes(1);
  expect(fixture.dispose).toHaveBeenCalledTimes(1);
  expect(fixture.cancel).toHaveBeenCalledTimes(1);
});
it("releases inputs not reached after cancellation while preserving partial output", async () => {
  const abort = new AbortController();
  await expect(
    exportTimelineToMp4([...shots, { ...shots[0]!, id: "two" }], {
      signal: abort.signal,
      onProgress: () => abort.abort(),
    })
  ).resolves.toBeInstanceOf(Blob);
  expect(fixture.dispose).toHaveBeenCalledTimes(2);
  expect(fixture.finalize).toHaveBeenCalledTimes(1);
});

it("waits for both encoders before disposing a failed shot", async () => {
  fixture.audio = true;
  let finish!: () => void;
  fixture.audioAdd.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  fixture.add.mockRejectedValue(new Error("video failure"));
  const exported = exportTimelineToMp4(shots);
  const rejected = expect(exported).rejects.toThrow("no frames");
  await vi.waitFor(() => expect(fixture.audioAdd).toHaveBeenCalledTimes(1));
  expect(fixture.dispose).not.toHaveBeenCalled();
  finish();
  await rejected;
  expect(fixture.audioClose).toHaveBeenCalledTimes(1);
  expect(fixture.dispose).toHaveBeenCalledTimes(1);
});
it("finalizes successful output without cancelling it", async () => {
  await expect(exportTimelineToMp4(shots)).resolves.toBeInstanceOf(Blob);
  expect(fixture.close).toHaveBeenCalledTimes(1);
  expect(fixture.dispose).toHaveBeenCalledTimes(1);
  expect(fixture.cancel).not.toHaveBeenCalled();
});
it("continues releasing inputs and preserves the original setup failure", async () => {
  const failure = new Error("setup failed");
  fixture.start.mockRejectedValue(failure);
  fixture.dispose.mockImplementationOnce(() => {
    throw new Error("detached");
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await expect(exportTimelineToMp4([...shots, { ...shots[0]!, id: "two" }])).rejects.toBe(failure);
  expect(fixture.dispose).toHaveBeenCalledTimes(2);
  expect(fixture.cancel).toHaveBeenCalledTimes(1);
});

it("does not open inputs for an already cancelled export", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(exportTimelineToMp4(shots, { signal: controller.signal })).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(fixture.probe).not.toHaveBeenCalled();
  expect(fixture.start).not.toHaveBeenCalled();
});
it("disposes an input immediately when a pending probe is abandoned", async () => {
  let finish!: (value: object) => void;
  fixture.probe.mockImplementation(
    () =>
      new Promise<object>((resolve) => {
        finish = resolve;
      })
  );
  const controller = new AbortController();
  const exported = exportTimelineToMp4(shots, { signal: controller.signal });
  const rejected = expect(exported).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  const released = fixture.dispose.mock.calls.length;
  finish({});
  await rejected;
  expect(released).toBe(1);
  expect(fixture.start).not.toHaveBeenCalled();
});
