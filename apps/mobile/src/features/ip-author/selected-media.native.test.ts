import { beforeEach, expect, it, vi } from "vitest";
import { selectedMedia } from "./selected-media.native";
const h = vi.hoisted(() => ({
  fetch: vi.fn(),
  file: { exists: true, size: 1024 * 1024 * 1024, open: vi.fn() },
}));
vi.mock("expo-file-system", () => ({
  FileMode: { ReadOnly: "r" },
  File: class {
    constructor() {
      return h.file;
    }
  },
}));
vi.mock("expo/fetch", () => ({ fetch: h.fetch }));
beforeEach(() => {
  vi.clearAllMocks();
  h.file.exists = true;
  h.fetch.mockResolvedValue({ ok: true });
});
it("sends the file-backed object directly with no credentials or redirect following", async () => {
  const signal = new AbortController().signal;
  const media = await selectedMedia("file:///trailer.mp4", signal);
  expect(media.size).toBe(1024 * 1024 * 1024);
  await media.put("https://storage.example/file", { "Content-Type": "video/mp4" }, signal);
  expect(h.fetch).toHaveBeenCalledWith("https://storage.example/file", {
    method: "PUT",
    headers: { "Content-Type": "video/mp4" },
    body: h.file,
    signal,
    credentials: "omit",
    redirect: "error",
  });
});
it("rejects an unavailable file or canceled selection", async () => {
  h.file.exists = false;
  await expect(selectedMedia("file:///missing", new AbortController().signal)).rejects.toThrow(
    "no longer available"
  );
  const c = new AbortController();
  c.abort();
  await expect(selectedMedia("file:///missing", c.signal)).rejects.toThrow();
  expect(h.fetch).not.toHaveBeenCalled();
});

it("reads only a bounded header and closes the handle on success and failure", async () => {
  const close = vi.fn();
  const readBytes = vi.fn().mockReturnValue(new Uint8Array([255, 216, 255]));
  h.file.open.mockReturnValue({ readBytes, close });
  const media = await selectedMedia("file:///image.jpg", new AbortController().signal);
  expect(media.readHeader()).toEqual(new Uint8Array([255, 216, 255]));
  expect(h.file.open).toHaveBeenCalledWith("r");
  expect(readBytes).toHaveBeenCalledWith(12);
  expect(close).toHaveBeenCalledTimes(1);
  readBytes.mockImplementation(() => {
    throw Error("unreadable");
  });
  expect(() => media.readHeader()).toThrow("unreadable");
  expect(close).toHaveBeenCalledTimes(2);
});
