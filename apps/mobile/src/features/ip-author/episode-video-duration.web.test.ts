import { afterEach, expect, it, vi } from "vitest";
import { readDuration, probeEpisodeVideoDuration } from "./episode-video-duration";
afterEach(() => vi.restoreAllMocks());
it("loads only local metadata and detaches the source on success", async () => {
  const video = document.createElement("video");
  vi.spyOn(document, "createElement").mockReturnValue(video);
  vi.spyOn(video, "load").mockImplementation(() => {});
  Object.defineProperty(video, "duration", { value: 60.1 });
  const pending = readDuration("blob:video", new AbortController().signal);
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
  const pending = readDuration("blob:video", controller.signal);
  const assertion = expect(pending).rejects.toThrow("cancelled");
  controller.abort(new Error("cancelled"));
  await assertion;
  expect(video.getAttribute("src")).toBeNull();
  expect(video.onerror).toBeNull();
});

it("revokes the selected file URL after a metadata failure", async () => {
  const video = document.createElement("video");
  vi.spyOn(document, "createElement").mockReturnValue(video);
  vi.spyOn(video, "load").mockImplementation(() => {});
  const create = vi.fn(() => "blob:selected"),
    revoke = vi.fn();
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
  const result = probeEpisodeVideoDuration(
    { uri: "blob:selected", file: new File(["bytes"], "clip.mp4") },
    new AbortController().signal
  );
  video.dispatchEvent(new Event("error"));
  expect(await result).toBeNull();
  expect(revoke).toHaveBeenCalledWith("blob:selected");
  vi.unstubAllGlobals();
});
