import { beforeEach, expect, it, vi } from "vitest";
import { episodeVideoSource } from "./episode-video-source.native";
const h = vi.hoisted(() => ({
  file: { exists: true, size: 3 * 1024 ** 3, open: vi.fn() },
  handle: { offset: 0, readBytes: vi.fn(), close: vi.fn() },
}));
vi.mock("expo-file-system", () => ({
  File: class {
    constructor() {
      return h.file;
    }
  },
  FileMode: { ReadOnly: 1 },
}));
beforeEach(() => {
  vi.resetAllMocks();
  h.file.exists = true;
  h.file.size = 3 * 1024 ** 3;
  h.file.open.mockReturnValue(h.handle);
  h.handle.readBytes.mockReturnValue(new Uint8Array([1, 2]));
});
it("reads only the requested range from a large local file and closes its handle", async () => {
  const source = episodeVideoSource({
    uri: "file:///episode.webm",
    name: "episode.webm",
    mimeType: "video/webm",
  });
  expect(source.size).toBe(3 * 1024 ** 3);
  await source.read(2 * 1024 ** 3, 2);
  expect(h.handle.offset).toBe(2 * 1024 ** 3);
  expect(h.handle.readBytes).toHaveBeenCalledWith(2);
  expect(h.handle.close).toHaveBeenCalledOnce();
});
it("closes the handle even on failure and refuses changed files", async () => {
  const source = episodeVideoSource({ uri: "file:///episode.mp4", name: "episode.mp4" });
  h.handle.readBytes.mockImplementation(() => {
    throw Error("Read failed");
  });
  await expect(source.read(0, 2)).rejects.toThrow("Read failed");
  expect(h.handle.close).toHaveBeenCalledOnce();
  h.file.size = 9;
  await expect(source.read(0, 2)).rejects.toThrow("changed");
  expect(h.file.open).toHaveBeenCalledOnce();
});
it("rejects non-local files, misleading MIME types, missing files and oversized files", () => {
  expect(() => episodeVideoSource({ uri: "https://example.com/video", name: "x.mp4" })).toThrow(
    "Copy"
  );
  expect(() =>
    episodeVideoSource({ uri: "file:///x.mp4", name: "x.mp4", mimeType: "text/plain" })
  ).toThrow("Select");
  h.file.exists = false;
  expect(() => episodeVideoSource({ uri: "file:///x.mp4", name: "x.mp4" })).toThrow("exists");
  h.file.exists = true;
  h.file.size = 35 * 1024 ** 3 + 1;
  expect(() => episodeVideoSource({ uri: "file:///x.mp4", name: "x.mp4" })).toThrow("35 GiB");
});
