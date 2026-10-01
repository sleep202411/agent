import { afterEach, expect, it, vi } from "vitest";
import { reviewVideoDuration } from "./review-video-duration";
afterEach(() => vi.restoreAllMocks());
it("loads only local metadata and detaches the source on success", async () => {
  const video = document.createElement("video");
  vi.spyOn(document, "createElement").mockReturnValue(video);
  vi.spyOn(video, "load").mockImplementation(() => {});
  Object.defineProperty(video, "duration", { value: 60.1 });
  const pending = reviewVideoDuration("blob:video", new AbortController().signal);
  expect(video.preload).toBe("metadata");
  video.dispatchEvent(new Event("loadedmetadata"));
  expect(await pending).toBe(61);
  expect(video.getAttribute("src")).toBeNull();
  expect(video.onloadedmetadata).toBeNull();
});
it("releases browser metadata loading when aborted", async () => {
  const video = document.createElement("video");
  vi.spyOn(document, "createElement").mockReturnValue(video);
  vi.spyOn(video, "load").mockImplementation(() => {});
  const controller = new AbortController();
  const pending = reviewVideoDuration("blob:video", controller.signal);
  const assertion = expect(pending).rejects.toThrow("cancelled");
  controller.abort(new Error("cancelled"));
  await assertion;
  expect(video.getAttribute("src")).toBeNull();
  expect(video.onerror).toBeNull();
});
