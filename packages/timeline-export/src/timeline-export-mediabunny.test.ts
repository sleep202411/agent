// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  audio: false,
  audioTimestamp: 0,
  audioFrames: 480,
  imageSample: vi.fn(),
  imageClose: vi.fn(),
  frames: 1,
  timestamp: vi.fn(),
  duration: vi.fn(),
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
vi.mock("mediabunny", async (importOriginal) => {
  const { AudioSample } = await importOriginal<typeof import("mediabunny")>();
  return {
    AudioSample,
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
    VideoSample: class {
      constructor(image: unknown, init: unknown) {
        fixture.imageSample(image, init);
      }
      close = fixture.close;
    },
    VideoSampleSource: class {
      add = fixture.add;
    },
    AudioSampleSource: class {
      add = fixture.audioAdd;
    },
    AudioSampleSink: class {
      async *samples() {
        const sample = new AudioSample({
          data: Float32Array.from({ length: fixture.audioFrames * 2 }, (_, i) =>
            i % 2 === 0 ? 0.25 : -0.5
          ),
          format: "f32",
          numberOfChannels: 2,
          sampleRate: 48000,
          timestamp: fixture.audioTimestamp,
        });
        const close = sample.close.bind(sample);
        sample.close = () => {
          fixture.audioClose();
          close();
        };
        yield sample;
      }
    },
    VideoSampleSink: class {
      constructor(private track: { label?: string }) {}
      async *samples() {
        for (let n = 0; n < fixture.frames; n++)
          yield {
            timestamp: n / 10,
            label: this.track.label,
            clone() {
              return {
                clone: this.clone,
                setTimestamp: fixture.timestamp,
                setDuration: fixture.duration,
                close: fixture.close,
              };
            },
            setTimestamp: fixture.timestamp,
            close: fixture.close,
          };
      }
    },
  };
});
import { exportTimelineToMp4, triggerBlobDownload } from "./timeline-export-mediabunny";
beforeEach(() => {
  vi.resetAllMocks();
  fixture.audio = false;
  fixture.audioTimestamp = 0;
  fixture.audioFrames = 480;
  fixture.frames = 1;
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
  vi.useRealTimers();
  document.querySelectorAll("a[download]").forEach((el) => el.remove());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const shots = [{ id: "one", videoUrl: "https://media.invalid/one.mp4" }];
it("finishes every shot when a progress observer throws", async () => {
  const onProgress = vi.fn(() => {
    throw new Error("progress view detached");
  });
  const onReport = vi.fn();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await expect(
    exportTimelineToMp4([...shots, { ...shots[0]!, id: "two" }], {
      onProgress,
      onReport,
    })
  ).resolves.toBeInstanceOf(Blob);
  expect(onProgress.mock.calls).toHaveLength(2);
  expect(fixture.add).toHaveBeenCalledTimes(2);
  expect(fixture.finalize).toHaveBeenCalledTimes(1);
  expect(fixture.cancel).not.toHaveBeenCalled();
  expect(fixture.dispose).toHaveBeenCalledTimes(2);
  expect(onReport).toHaveBeenCalledWith({
    requestedShots: 2,
    completedShots: 2,
    partial: false,
    issues: [],
  });
});
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

it.each(["create", "click"])("releases a timeline download URL after %s failure", async (phase) => {
  vi.useFakeTimers();
  const revoke = vi.fn();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = () => "blob:timeline";
      static revokeObjectURL = revoke;
    }
  );
  if (phase === "create")
    vi.spyOn(document, "createElement").mockImplementation(() => {
      throw new Error("blocked");
    });
  else
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
      throw new Error("blocked");
    });
  expect(() => triggerBlobDownload(new Blob(["video"]), "movie.mp4")).toThrow("blocked");
  await vi.runAllTimersAsync();
  expect(revoke).toHaveBeenCalledWith("blob:timeline");
  expect(document.querySelector("a[download]")).toBeNull();
});
it("defers successful timeline URL revocation and preserves the filename", async () => {
  vi.useFakeTimers();
  const revoke = vi.fn();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = () => "blob:timeline";
      static revokeObjectURL = revoke;
    }
  );
  let filename = "";
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement
  ) {
    filename = this.download;
  });
  triggerBlobDownload(new Blob(["video"]), "movie.mp4");
  expect(filename).toBe("movie.mp4");
  expect(revoke).not.toHaveBeenCalled();
  await vi.runAllTimersAsync();
  expect(revoke).toHaveBeenCalledOnce();
});

it("reports omitted and unopenable shots in original timeline order", async () => {
  fixture.probe.mockRejectedValueOnce(new Error("private URL error"));
  const report = vi.fn();
  await exportTimelineToMp4(
    [
      { id: "same", videoUrl: "https://media.invalid/bad" },
      { id: "still" },
      { id: "same", videoUrl: "https://media.invalid/good" },
    ],
    { onReport: report }
  );
  expect(report).toHaveBeenCalledOnce();
  expect(report).toHaveBeenCalledWith({
    requestedShots: 3,
    completedShots: 1,
    partial: true,
    issues: [
      { index: 0, shotId: "same", reason: "probe_failed" },
      { index: 1, shotId: "still", reason: "missing_video" },
    ],
  });
});
it("reports a missing video track without discarding another valid shot", async () => {
  fixture.probe.mockResolvedValueOnce(null);
  const report = vi.fn();
  await exportTimelineToMp4([...shots, { ...shots[0]!, id: "two" }], { onReport: report });
  expect(report.mock.calls[0]![0]).toMatchObject({
    completedShots: 1,
    partial: true,
    issues: [{ index: 0, shotId: "one", reason: "no_video_track" }],
  });
});
it("reports encoding failures even when another shot allows finalization", async () => {
  fixture.add.mockRejectedValueOnce(new Error("encoding failed"));
  const report = vi.fn();
  await exportTimelineToMp4([...shots, { ...shots[0]!, id: "two" }], { onReport: report });
  expect(report.mock.calls[0]![0]).toMatchObject({
    completedShots: 1,
    partial: true,
    issues: [{ index: 0, shotId: "one", reason: "encoding_failed" }],
  });
});
it("reports complete output only after finalization and isolates observer failure", async () => {
  const report = vi.fn(() => {
    expect(fixture.finalize).toHaveBeenCalledOnce();
    throw Error("observer");
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await expect(exportTimelineToMp4(shots, { onReport: report })).resolves.toBeInstanceOf(Blob);
  expect(report).toHaveBeenCalledWith({
    requestedShots: 1,
    completedShots: 1,
    partial: false,
    issues: [],
  });
});
it("does not issue a completion report for failed finalization", async () => {
  fixture.finalize.mockRejectedValue(new Error("mux failure"));
  const report = vi.fn();
  await expect(exportTimelineToMp4(shots, { onReport: report })).rejects.toThrow("mux failure");
  expect(report).not.toHaveBeenCalled();
});
it("identifies unprocessed shots in finalized cancellation output", async () => {
  const signal = new AbortController();
  const report = vi.fn();
  await exportTimelineToMp4([...shots, { ...shots[0]!, id: "two" }], {
    signal: signal.signal,
    onProgress: () => signal.abort(),
    onReport: report,
  });
  expect(report).toHaveBeenCalledWith({
    requestedShots: 2,
    completedShots: 1,
    partial: true,
    issues: [{ index: 1, shotId: "two", reason: "cancelled" }],
  });
});

it("retains frames accepted before a later encoder failure and reserves their timeline slot", async () => {
  fixture.frames = 2;
  fixture.add
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("second frame failed"));
  const report = vi.fn();
  await exportTimelineToMp4([...shots, { ...shots[0]!, id: "two" }], { onReport: report });
  expect(fixture.timestamp.mock.calls.map((c) => c[0])).toEqual([0, 0.1, 1, 1.1]);
  expect(report.mock.calls[0]![0]).toMatchObject({ completedShots: 1, partial: true });
});
it("salvages a single partially encoded shot without calling it complete", async () => {
  fixture.frames = 2;
  fixture.add
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("second frame failed"));
  const report = vi.fn();
  await expect(exportTimelineToMp4(shots, { onReport: report })).resolves.toBeInstanceOf(Blob);
  expect(report).toHaveBeenCalledWith({
    requestedShots: 1,
    completedShots: 0,
    partial: true,
    issues: [{ index: 0, shotId: "one", reason: "encoding_failed" }],
  });
});
it("reports a zero-frame source when other shots produce usable output", async () => {
  const report = vi.fn();
  fixture.frames = 0;
  await exportTimelineToMp4([...shots, { ...shots[0]!, id: "two" }], {
    onProgress: () => {
      fixture.frames = 1;
    },
    onReport: report,
  });
  expect(report.mock.calls[0]![0]).toMatchObject({
    completedShots: 1,
    partial: true,
    issues: [{ index: 0, shotId: "one", reason: "no_frames" }],
  });
});

it("preserves input order for repeated IDs after concurrent probes finish out of order", async () => {
  let finish!: (value: object) => void;
  fixture.probe
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    )
    .mockResolvedValueOnce({ label: "second" });
  const pending = exportTimelineToMp4([shots[0]!, shots[0]!]);
  await vi.waitFor(() => expect(fixture.probe).toHaveBeenCalledTimes(2));
  finish({ label: "first" });
  await pending;
  expect(fixture.add.mock.calls.map((c) => c[0].label)).toEqual(["first", "second"]);
});
it("marks audio failure as partial even when video frames were accepted", async () => {
  fixture.audio = true;
  fixture.audioAdd.mockRejectedValueOnce(new Error("audio codec"));
  const report = vi.fn();
  await expect(exportTimelineToMp4(shots, { onReport: report })).resolves.toBeInstanceOf(Blob);
  expect(report.mock.calls[0]![0]).toMatchObject({
    completedShots: 0,
    partial: true,
    issues: [{ index: 0, shotId: "one", reason: "encoding_failed" }],
  });
});

it("renders still images for the requested duration without opening a video decoder", async () => {
  const bitmap = { close: fixture.imageClose };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Blob(["image"])))
  );
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => bitmap)
  );
  const report = vi.fn();
  await exportTimelineToMp4(
    [{ id: "still", imageUrl: "https://media.invalid/still.png", duration: 1.25 }],
    { onReport: report }
  );
  expect(fixture.probe).not.toHaveBeenCalled();
  expect(fixture.imageSample).toHaveBeenCalledTimes(38);
  const frames = fixture.imageSample.mock.calls.map((call) => call[1]);
  expect(frames[0].timestamp).toBe(0);
  expect(frames.at(-1).timestamp + frames.at(-1).duration).toBeCloseTo(1.25);
  expect(fixture.imageClose).toHaveBeenCalledOnce();
  expect(report).toHaveBeenCalledWith(
    expect.objectContaining({ completedShots: 1, partial: false })
  );
});
it("preserves mixed shot ordering and releases image resources on encoder failure", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Blob(["image"])))
  );
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ close: fixture.imageClose }))
  );
  fixture.add.mockRejectedValueOnce(new Error("Encoder unavailable"));
  const report = vi.fn();
  await exportTimelineToMp4(
    [{ id: "still", imageUrl: "https://media.invalid/still.png", duration: 1 }, ...shots],
    { onReport: report }
  );
  expect(fixture.imageClose).toHaveBeenCalledOnce();
  expect(report).toHaveBeenCalledWith(
    expect.objectContaining({ completedShots: 1, partial: true })
  );
});
it("rejects a still without a timeline duration before requesting media", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(
    exportTimelineToMp4([{ id: "still", imageUrl: "https://media.invalid/still.png" }])
  ).rejects.toThrow("positive timeline duration");
  expect(fetcher).not.toHaveBeenCalled();
});

it("holds the last video frame when the timeline exceeds the source duration", async () => {
  await exportTimelineToMp4([{ ...shots[0]!, duration: 1.25 }]);
  expect(fixture.add).toHaveBeenCalledTimes(9);
  expect(fixture.timestamp).toHaveBeenLastCalledWith(1 + 7 / 30);
  expect(fixture.duration.mock.calls.at(-1)![0]).toBeCloseTo(1.25 - (1 + 7 / 30));
  expect(fixture.close).toHaveBeenCalledTimes(10);
});

it("releases a still decoded after cancellation without encoding it", async () => {
  let decoded!: (bitmap: { close: () => void }) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Blob(["image"])))
  );
  const decode = vi.fn(
    () =>
      new Promise((resolve) => {
        decoded = resolve;
      })
  );
  vi.stubGlobal("createImageBitmap", decode);
  const controller = new AbortController();
  const rejected = expect(
    exportTimelineToMp4(
      [{ id: "still", imageUrl: "https://media.invalid/still.png", duration: 1 }],
      { signal: controller.signal }
    )
  ).rejects.toMatchObject({ name: "AbortError" });
  await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce());
  controller.abort();
  decoded({ close: fixture.imageClose });
  await rejected;
  expect(fixture.imageClose).toHaveBeenCalledOnce();
  expect(fixture.add).not.toHaveBeenCalled();
});

it("trims audio frames crossing a clip boundary before concatenating the next clip", async () => {
  fixture.audio = true;
  fixture.audioTimestamp = 0.99;
  fixture.audioFrames = 960;
  const encoded: { timestamp: number; duration: number; frames: number }[] = [];
  fixture.audioAdd.mockImplementation(async (sample) => {
    encoded.push({
      timestamp: sample.timestamp,
      duration: sample.duration,
      frames: sample.numberOfFrames,
    });
  });
  await exportTimelineToMp4([...shots, { ...shots[0]!, id: "two" }]);
  expect(encoded).toHaveLength(2);
  expect(encoded[0]!.frames).toBe(480);
  expect(encoded[0]!.timestamp + encoded[0]!.duration).toBeCloseTo(1, 8);
  expect(encoded[1]!.timestamp + encoded[1]!.duration).toBeCloseTo(2, 8);
  expect(fixture.audioClose).toHaveBeenCalledTimes(2);
});

it.each([
  { timestamp: -0.01, frames: 960, expectedFrames: 480, expectedTimestamp: 0 },
  { timestamp: 0.1, frames: 480, expectedFrames: 480, expectedTimestamp: 0.1 },
])(
  "preserves stereo samples while bounding audio starting at $timestamp",
  async ({ timestamp, frames, expectedFrames, expectedTimestamp }) => {
    fixture.audio = true;
    fixture.audioTimestamp = timestamp;
    fixture.audioFrames = frames;
    fixture.audioAdd.mockImplementation(async (sample) => {
      expect(sample.timestamp).toBeCloseTo(expectedTimestamp, 8);
      expect(sample.numberOfFrames).toBe(expectedFrames);
      const data = new Float32Array(expectedFrames * 2);
      sample.copyTo(data, { format: "f32", planeIndex: 0 });
      expect([...data]).toEqual(
        Array.from({ length: expectedFrames * 2 }, (_, i) => (i % 2 === 0 ? 0.25 : -0.5))
      );
    });
    await exportTimelineToMp4(shots);
    expect(fixture.audioAdd).toHaveBeenCalledOnce();
    expect(fixture.audioClose).toHaveBeenCalledOnce();
  }
);

it("closes the trimmed PCM and original sample when encoding fails", async () => {
  fixture.audio = true;
  fixture.audioTimestamp = 0.99;
  fixture.audioFrames = 960;
  let close: ReturnType<typeof vi.spyOn> | undefined;
  fixture.audioAdd.mockImplementation(async (sample) => {
    close = vi.spyOn(sample, "close");
    throw new Error("audio encoder failed");
  });
  const onReport = vi.fn();
  await exportTimelineToMp4(shots, { onReport });
  expect(close).toHaveBeenCalledOnce();
  expect(fixture.audioClose).toHaveBeenCalledOnce();
  expect(onReport).toHaveBeenCalledWith(expect.objectContaining({ partial: true }));
});

it("discards audio entirely outside a clip without leaking resources", async () => {
  fixture.audio = true;
  fixture.audioTimestamp = -0.02;
  fixture.audioFrames = 480;
  await exportTimelineToMp4(shots);
  expect(fixture.audioAdd).not.toHaveBeenCalled();
  expect(fixture.audioClose).toHaveBeenCalledOnce();
});
