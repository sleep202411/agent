import { beforeEach, expect, it, vi } from "vitest";
import {
  pickReferenceImage,
  confirmReferenceUpload,
  acceptsReferenceImage,
} from "./reference-image";
const h = vi.hoisted(() => ({
  post: vi.fn(),
  pick: vi.fn(),
  selected: vi.fn(),
  put: vi.fn(),
  generation: 1,
}));
vi.mock("@/lib/api-client", () => ({
  api: { post: h.post },
  ApiRequestError: class extends Error {},
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/durable-record", () => ({ durableRecord: vi.fn() }));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: h.pick }));
vi.mock("@/features/ip-author/selected-media", () => ({ selectedMedia: h.selected }));
const field = "references",
  asset = "22222222-2222-4222-8222-222222222222",
  signal = () => new AbortController().signal;
const checkpoint = {
  field,
  multiple: true,
  fileName: "logo.png",
  kind: "ai_reference_image" as const,
  contentType: "image/png" as const,
  storageKey: "users/alice/ai-reference-image-staging/logo",
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.pick.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///logo.png", name: "logo.png", mimeType: "image/png" }],
  });
  h.selected.mockResolvedValue({ size: 100, put: h.put });
  h.put.mockResolvedValue({ ok: true });
  h.post.mockImplementation(async (path) =>
    path.endsWith("upload-url")
      ? {
          uploadUrl: "https://storage.test/logo",
          method: "PUT",
          headers: { "x-ms-blob-type": "BlockBlob" },
          storageKey: checkpoint.storageKey,
        }
      : {
          mediaAssetId: asset,
          storageKey: "users/alice/ai-reference-image-final/logo",
          url: "https://storage.test/final.png",
        }
  );
});
it("uses a supported reference-image kind and checkpoints only after the bytes land", async () => {
  const save = vi.fn();
  h.put.mockImplementation(async () => {
    expect(save).not.toHaveBeenCalled();
    return { ok: true };
  });
  expect(await pickReferenceImage(field, true, 1, signal(), save)).toEqual(checkpoint);
  expect(save).toHaveBeenCalledWith(checkpoint);
  expect(h.post.mock.calls[0][1].data).toEqual({
    kind: "ai_reference_image",
    contentType: "image/png",
    fileName: "logo.png",
    sizeBytes: 100,
  });
  expect(h.put.mock.calls[0][1]).toEqual({
    "Content-Type": "image/png",
    "x-ms-blob-type": "BlockBlob",
  });
  expect(await confirmReferenceUpload(checkpoint, 1, signal())).toMatchObject({
    mediaAssetId: asset,
    url: "https://storage.test/final.png",
  });
});
it("retries confirmation from a stored checkpoint without another upload", async () => {
  h.post.mockRejectedValueOnce(Error("Offline"));
  await expect(confirmReferenceUpload(checkpoint, 1, signal())).rejects.toThrow();
  expect(await confirmReferenceUpload(checkpoint, 1, signal())).toMatchObject({
    mediaAssetId: asset,
    url: "https://storage.test/final.png",
  });
  expect(h.pick).not.toHaveBeenCalled();
  expect(h.put).not.toHaveBeenCalled();
});
it("handles picker cancellation and rejects oversized or unsupported files before signing", async () => {
  h.pick.mockResolvedValueOnce({ canceled: true });
  expect(await pickReferenceImage(field, true, 1, signal(), vi.fn())).toBeNull();
  h.selected.mockResolvedValueOnce({ size: 31 * 1024 ** 2, put: h.put });
  await expect(pickReferenceImage(field, true, 1, signal(), vi.fn())).rejects.toThrow("30 MiB");
  h.pick.mockResolvedValueOnce({
    canceled: false,
    assets: [{ uri: "file:///x", name: "x.svg", mimeType: "image/svg+xml" }],
  });
  await expect(pickReferenceImage(field, true, 1, signal(), vi.fn())).rejects.toThrow();
  expect(h.post).not.toHaveBeenCalled();
});
it("rejects credentials, unsafe URLs, failed uploads and unsafe confirmation receipts", async () => {
  for (const override of [
    { headers: { Authorization: "Bearer secret" } },
    { uploadUrl: "http://storage.test/logo" },
  ]) {
    h.post.mockResolvedValueOnce({
      uploadUrl: "https://storage.test/logo",
      method: "PUT",
      headers: {},
      storageKey: "k",
      ...override,
    });
    await expect(pickReferenceImage(field, true, 1, signal(), vi.fn())).rejects.toThrow();
  }
  const save = vi.fn();
  h.put.mockResolvedValueOnce({ ok: false, status: 503 });
  await expect(pickReferenceImage(field, true, 1, signal(), save)).rejects.toThrow("503");
  expect(save).not.toHaveBeenCalled();
  h.post.mockResolvedValueOnce({
    mediaAssetId: asset,
    storageKey: "final",
    url: "http://storage.test/final.png",
  });
  await expect(confirmReferenceUpload(checkpoint, 1, signal())).rejects.toThrow();
});
it("does not checkpoint a late upload after auth changes", async () => {
  const save = vi.fn();
  h.put.mockImplementationOnce(async () => {
    h.generation = 2;
    return { ok: true };
  });
  await expect(pickReferenceImage(field, true, 1, signal(), save)).rejects.toThrow("expired");
  expect(save).not.toHaveBeenCalled();
});

it("offers native image selection only for image-compatible fields", () => {
  const descriptor = (control: string, type: string = "string", accept?: string) =>
    ({ field: { type, items: { type: "string" } }, ui: { control, accept } }) as Parameters<
      typeof acceptsReferenceImage
    >[0];
  expect(acceptsReferenceImage(descriptor("image_upload"))).toBe(true);
  expect(acceptsReferenceImage(descriptor("media_upload", "array", "image/png,image/jpeg"))).toBe(
    true
  );
  expect(acceptsReferenceImage(descriptor("media_upload", "string", "video/mp4"))).toBe(false);
  expect(acceptsReferenceImage(descriptor("url"))).toBe(false);
  expect(acceptsReferenceImage(descriptor("image_upload", "object"))).toBe(false);
});
