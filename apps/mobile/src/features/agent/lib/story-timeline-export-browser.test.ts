import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createBrowserTimelineEncoder } from "./story-timeline-export-browser";
import type { TimelineExportOptions } from "@repo/timeline-export";
const h = vi.hoisted(() => ({
  supported: vi.fn(),
  encode: vi.fn(),
  url: vi.fn(),
  revoke: vi.fn(),
}));
vi.mock("@repo/timeline-export", () => ({
  isExportSupported: h.supported,
  exportTimelineToMp4: h.encode,
  TimelineExportUnsupportedError: class extends Error {},
}));
const shots = [
  { id: "one", kind: "video" as const, url: "https://example.test/one.mp4", durationMs: 1250 },
  { id: "two", kind: "video" as const, url: "https://example.test/two.mp4", durationMs: 2000 },
];
const signal = new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.supported.mockReturnValue(true);
  h.url.mockReturnValue("blob:export");
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = h.url;
      static revokeObjectURL = h.revoke;
    }
  );
  h.encode.mockImplementation(async (_shots: unknown, options: TimelineExportOptions) => {
    options.onReport?.({ requestedShots: 2, completedShots: 2, partial: false, issues: [] });
    return new Blob(["mp4"], { type: "video/mp4" });
  });
});
afterEach(() => vi.unstubAllGlobals());
it("uses the official encoder with exact ordering, seconds, signal and progress", async () => {
  const encoder = createBrowserTimelineEncoder(),
    progress = vi.fn();
  const result = await encoder.render(shots, signal, progress);
  expect(h.encode).toHaveBeenCalledWith(
    [
      { id: "one", videoUrl: shots[0].url, duration: 1.25 },
      { id: "two", videoUrl: shots[1].url, duration: 2 },
    ],
    expect.objectContaining({ signal, onProgress: progress })
  );
  expect(result.completedClipIds).toEqual(["one", "two"]);
  expect(encoder.file(result.artifact, "film.mp4").size).toBe(3);
  encoder.release(result.artifact);
  encoder.release(result.artifact);
  expect(h.revoke).toHaveBeenCalledTimes(1);
  expect(() => encoder.file(result.artifact, "film.mp4")).toThrow("no longer available");
});
it("reports only completed clips for partial exports", async () => {
  h.encode.mockImplementation(async (_s: unknown, o: TimelineExportOptions) => {
    o.onReport?.({
      requestedShots: 2,
      completedShots: 1,
      partial: true,
      issues: [{ index: 0, shotId: "one", reason: "probe_failed" }],
    });
    return new Blob(["mp4"], { type: "video/mp4" });
  });
  expect(
    (await createBrowserTimelineEncoder().render(shots, signal, vi.fn())).completedClipIds
  ).toEqual(["two"]);
});
it("rejects unsupported encoders without starting composition", async () => {
  h.supported.mockReturnValue(false);
  await expect(createBrowserTimelineEncoder().render(shots, signal, vi.fn())).rejects.toThrow(
    "does not support"
  );
  expect(h.encode).not.toHaveBeenCalled();
});
it("rejects inconsistent reports even when the encoder swallows observer errors", async () => {
  h.encode.mockImplementation(async (_s: unknown, o: TimelineExportOptions) => {
    try {
      o.onReport?.({ requestedShots: 2, completedShots: 1, partial: false, issues: [] });
    } catch {}
    return new Blob(["mp4"], { type: "video/mp4" });
  });
  await expect(createBrowserTimelineEncoder().render(shots, signal, vi.fn())).rejects.toThrow(
    "verified MP4"
  );
  expect(h.url).not.toHaveBeenCalled();
});
it("never exposes output that finishes after cancellation", async () => {
  const controller = new AbortController();
  h.encode.mockImplementation(async (_s: unknown, o: TimelineExportOptions) => {
    o.onReport?.({ requestedShots: 2, completedShots: 2, partial: false, issues: [] });
    controller.abort();
    return new Blob(["mp4"], { type: "video/mp4" });
  });
  await expect(
    createBrowserTimelineEncoder().render(shots, controller.signal, vi.fn())
  ).rejects.toThrow();
  expect(h.url).not.toHaveBeenCalled();
});
it("disposes all owned URLs and refuses reuse", async () => {
  const encoder = createBrowserTimelineEncoder();
  await encoder.render(shots, signal, vi.fn());
  encoder.dispose();
  expect(h.revoke).toHaveBeenCalledWith("blob:export");
  await expect(encoder.render(shots, signal, vi.fn())).rejects.toThrow("closed");
});
it("passes mixed still-image and video clips in timeline order with their full durations", async () => {
  const mixed = [
    {
      id: "still",
      kind: "image" as const,
      url: "https://example.test/still.png",
      durationMs: 3250,
    },
    { ...shots[0]!, durationMs: 8000 },
  ];
  const result = await createBrowserTimelineEncoder().render(mixed, signal, vi.fn());
  expect(h.encode.mock.calls[0][0]).toEqual([
    { id: "still", imageUrl: mixed[0]!.url, duration: 3.25 },
    { id: "one", videoUrl: shots[0]!.url, duration: 8 },
  ]);
  expect(result.completedClipIds).toEqual(["still", "one"]);
});
it("reports a failed image against its original mixed-timeline position", async () => {
  h.encode.mockImplementation(async (_s: unknown, o: TimelineExportOptions) => {
    o.onReport?.({
      requestedShots: 2,
      completedShots: 1,
      partial: true,
      issues: [{ index: 1, shotId: "still", reason: "probe_failed" }],
    });
    return new Blob(["mp4"], { type: "video/mp4" });
  });
  const result = await createBrowserTimelineEncoder().render(
    [
      shots[0]!,
      { id: "still", kind: "image", url: "https://example.test/still.png", durationMs: 1000 },
    ],
    signal,
    vi.fn()
  );
  expect(result.completedClipIds).toEqual(["one"]);
});
