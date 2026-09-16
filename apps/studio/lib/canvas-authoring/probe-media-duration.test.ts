// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { probeMediaDurationSeconds } from "./probe-media-duration";
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function media() {
  const el = document.createElement("video");
  vi.spyOn(document, "createElement").mockReturnValue(el);
  vi.spyOn(el, "load").mockImplementation(() => {});
  vi.stubGlobal(
    "URL",
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:probe"), revokeObjectURL: vi.fn() })
  );
  return el;
}
it("cancels an active probe and releases its media and object URL immediately", async () => {
  const el = media();
  const controller = new AbortController();
  const result = probeMediaDurationSeconds(new File(["x"], "x.mp4"), "video", controller.signal);
  controller.abort();
  expect(await result).toBeNull();
  expect(el.getAttribute("src")).toBeNull();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:probe");
  expect(el.onloadedmetadata).toBeNull();
});
it("does not create media for a cancelled request", async () => {
  const create = vi.spyOn(document, "createElement");
  const controller = new AbortController();
  controller.abort();
  expect(await probeMediaDurationSeconds("url", "audio", controller.signal)).toBeNull();
  expect(create).not.toHaveBeenCalled();
});
it("preserves successful metadata and bounds stalled probes", async () => {
  vi.useFakeTimers();
  const el = media();
  Object.defineProperty(el, "duration", { value: 14.5 });
  const result = probeMediaDurationSeconds("url", "video");
  el.dispatchEvent(new Event("loadedmetadata"));
  expect(await result).toBe(14.5);
  const timeout = probeMediaDurationSeconds("url", "video");
  await vi.advanceTimersByTimeAsync(12000);
  expect(await timeout).toBeNull();
});
