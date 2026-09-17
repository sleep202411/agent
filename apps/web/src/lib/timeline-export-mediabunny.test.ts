import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  audio: false,
  frames: 1,
  timestamp: vi.fn(),
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
    constructor(private track: { label?: string }) {}
    async *samples() {
      for (let n = 0; n < fixture.frames; n++)
        yield {
          timestamp: n / 10,
          label: this.track.label,
          setTimestamp: fixture.timestamp,
          close: fixture.close,
        };
    }
  },
}));
import { exportTimelineToMp4, triggerBlobDownload } from "./timeline-export-mediabunny";
beforeEach(() => {
  vi.resetAllMocks();
  fixture.audio = false;
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
