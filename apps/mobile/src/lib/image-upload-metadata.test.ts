import { expect, it, vi } from "vitest";
import { imageUploadMetadata, readBlobImageHeader } from "./image-upload-metadata";

it.each([
  [[137, 80, 78, 71, 13, 10, 26, 10], "image/png", "png"],
  [[255, 216, 255], "image/jpeg", "jpg"],
  [[82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80], "image/webp", "webp"],
] as const)("corrects mislabeled raster metadata from bytes %j", async (bytes, type, ext) => {
  expect(await imageUploadMetadata("scene.gif", "image/gif", () => new Uint8Array(bytes))).toEqual({
    fileName: `scene.${ext}`,
    contentType: type,
  });
});
it("preserves matching extensions and unknown signatures", async () => {
  expect(
    await imageUploadMetadata("scene.JPEG", "image/png", () => new Uint8Array([255, 216, 255]))
  ).toEqual({ fileName: "scene.JPEG", contentType: "image/jpeg" });
  for (const bytes of [[], [255, 216], [82, 73, 70, 70]]) {
    expect(
      await imageUploadMetadata("scene.png", "image/png", () => new Uint8Array(bytes))
    ).toEqual({ fileName: "scene.png", contentType: "image/png" });
  }
});
it("does not read video headers and propagates image read errors", async () => {
  const read = vi.fn(() => {
    throw Error("unreadable");
  });
  await imageUploadMetadata("clip.mp4", "video/mp4", read);
  expect(read).not.toHaveBeenCalled();
  await expect(imageUploadMetadata("scene.png", "image/png", read)).rejects.toThrow("unreadable");
});
it("reads only twelve bytes from a browser blob", async () => {
  const blob = new Blob([new Uint8Array(100)]);
  const slice = vi.spyOn(blob, "slice");
  expect(await readBlobImageHeader(blob)).toHaveLength(12);
  expect(slice).toHaveBeenCalledWith(0, 12);
});
