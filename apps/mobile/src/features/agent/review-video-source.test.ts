import { beforeEach, expect, it, vi } from "vitest";
import { reviewVideoSource } from "./review-video-source.native";
const h = vi.hoisted(() => ({
  size: 100,
  read: vi.fn(),
  close: vi.fn(),
  open: vi.fn(),
  offset: 0,
}));
vi.mock("expo-file-system", () => ({
  FileMode: { ReadOnly: 1 },
  File: class {
    get size() {
      return h.size;
    }
    open = h.open;
  },
}));
beforeEach(() => {
  vi.resetAllMocks();
  h.size = 100;
  h.open.mockImplementation(() => ({
    get offset() {
      return h.offset;
    },
    set offset(value) {
      h.offset = value;
    },
    readBytes: h.read,
    close: h.close,
  }));
});
it("opens read-only, reads only the requested range and always closes the native handle", async () => {
  const source = reviewVideoSource({ uri: "file:///clip.mp4", name: "clip.mp4" });
  h.read.mockReturnValue(new Uint8Array([1, 2]));
  expect(await source.read(10, 2)).toEqual(new Uint8Array([1, 2]));
  expect(h.open).toHaveBeenCalledWith(1);
  expect(h.offset).toBe(10);
  expect(h.read).toHaveBeenCalledWith(2);
  expect(h.close).toHaveBeenCalledOnce();
  h.read.mockImplementation(() => {
    throw new Error("File unavailable");
  });
  await expect(source.read(10, 2)).rejects.toThrow("File unavailable");
  expect(h.close).toHaveBeenCalledTimes(2);
});
it("detects file size changes and rejects remote URIs", async () => {
  const source = reviewVideoSource({ uri: "file:///clip.mov", name: "clip.mov" });
  expect(source.contentType).toBe("video/quicktime");
  h.size = 90;
  await expect(source.read(0, 2)).rejects.toThrow("changed");
  expect(h.open).not.toHaveBeenCalled();
  expect(() => reviewVideoSource({ uri: "https://media.test/video", name: "clip.mov" })).toThrow(
    "Copy"
  );
});
