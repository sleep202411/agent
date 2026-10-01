import { beforeEach, expect, it, vi } from "vitest";
import {
  fetchIpMedia,
  pickIpMedia,
  finishIpMedia,
  mediaUploadRecord,
  type MediaCheckpoint,
} from "./media-api";
const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  pick: vi.fn(),
  selected: vi.fn(),
  storagePut: vi.fn(),
  generation: 1,
  records: new Map<string, string>(),
}));
vi.mock("@/lib/api-client", () => ({
  api: { get: h.get, post: h.post, put: h.put },
  ApiRequestError: class extends Error {
    status: number;
    constructor(_code: string, message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: h.pick }));
vi.mock("expo-modules-core", () => ({
  uuid: { v4: () => "33333333-3333-4333-8333-333333333333" },
}));
vi.mock("./selected-media", () => ({ selectedMedia: h.selected }));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (n: string, u: string, id: string) => ({
    read: () => h.records.get(`${n}:${u}:${id}`) ?? null,
    write: (s: string) => h.records.set(`${n}:${u}:${id}`, s),
  }),
}));
const ipId = "11111111-1111-4111-8111-111111111111",
  assetId = "22222222-2222-4222-8222-222222222222";
const asset = { id: assetId, kind: "image", url: "https://cdn.example/cover.png" };
const snapshot = { id: ipId, version: 1, coverAsset: null, trailerAsset: null };
const checkpoint: MediaCheckpoint = {
  clientKey: "33333333-3333-4333-8333-333333333333",
  ipId,
  slot: "cover",
  fileName: "cover.png",
  expectedVersion: 1,
  confirmation: { storageKey: "key", kind: "ip_banner", contentType: "image/png" },
};
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.records.clear();
  h.pick.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///cover.png", name: "cover.png", mimeType: "image/png" }],
  });
  h.selected.mockResolvedValue({ size: 100, put: h.storagePut });
  h.storagePut.mockResolvedValue({ ok: true });
  h.get.mockResolvedValue({ ip: snapshot });
  h.post.mockImplementation(async (path: string) =>
    path === "/media/upload-url"
      ? {
          uploadUrl: "https://storage.example/file?sig=1",
          method: "PUT",
          headers: {},
          storageKey: "key",
        }
      : path === "/media/confirm"
        ? { mediaAssetId: assetId, storageKey: "key" }
        : { asset }
  );
  h.put.mockResolvedValue({ ip: { ...snapshot, version: 2, coverAsset: asset } });
});
it("persists accepted bytes before confirmation and assigns the confirmed cover with a version", async () => {
  const record = mediaUploadRecord(ipId, "alice", 1),
    save = vi.fn(record.save);
  const picked = await pickIpMedia(ipId, "cover", 1, 1, signal(), save);
  expect(picked).toEqual(checkpoint);
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(record.read()).toEqual(checkpoint);
  expect(await finishIpMedia(picked!, 1, signal(), save)).toMatchObject({
    version: 2,
    coverAsset: asset,
  });
  expect(h.put.mock.calls[0][1].data).toEqual({ coverAssetId: assetId, expectedVersion: 1 });
  expect(record.read()?.mediaAssetId).toBe(assetId);
  expect(h.post.mock.calls[2][1]).toMatchObject({
    params: { kind: "image", purpose: "cover" },
    data: { mediaAssetId: assetId },
  });
});
it("retries confirmation without reuploading and resumes attachment without reconfirming", async () => {
  const record = mediaUploadRecord(ipId, "alice", 1);
  record.save(checkpoint);
  h.post.mockRejectedValueOnce(Error("Confirmation response lost"));
  await expect(finishIpMedia(record.read()!, 1, signal(), record.save)).rejects.toThrow("lost");
  await finishIpMedia(record.read()!, 1, signal(), record.save);
  expect(h.storagePut).not.toHaveBeenCalled();
  h.post.mockClear();
  h.get.mockResolvedValue({ ip: { ...snapshot, version: 2, coverAsset: asset } });
  h.put.mockClear();
  await finishIpMedia(record.read()!, 1, signal(), record.save);
  expect(h.post.mock.calls.map((call) => call[0])).not.toContain("/media/confirm");
  expect(h.put).not.toHaveBeenCalled();
});
it("does not overwrite a concurrent change, and only applies after an explicit new version", async () => {
  const saved = { ...checkpoint, mediaAssetId: assetId };
  h.get.mockResolvedValue({ ip: { ...snapshot, version: 4 } });
  await expect(finishIpMedia(saved, 1, signal(), vi.fn())).rejects.toMatchObject({ status: 409 });
  expect(h.put).not.toHaveBeenCalled();
  h.put.mockResolvedValue({ ip: { ...snapshot, version: 5, coverAsset: asset } });
  await finishIpMedia({ ...saved, expectedVersion: 4 }, 1, signal(), vi.fn());
  expect(h.put.mock.calls[0][1].data.expectedVersion).toBe(4);
});
it("rejects wrong receipts and never clears or replaces another saved upload", async () => {
  const record = mediaUploadRecord(ipId, "alice", 1);
  record.save(checkpoint);
  expect(mediaUploadRecord(ipId, "bob", 1).read()).toBeNull();
  expect(() => record.save({ ...checkpoint, clientKey: assetId })).toThrow("pending");
  expect(() => record.clear(assetId)).toThrow("pending");
  h.post.mockResolvedValue({ mediaAssetId: assetId, storageKey: "other" });
  await expect(finishIpMedia(checkpoint, 1, signal(), record.save)).rejects.toThrow(
    "identity mismatch"
  );
  expect(h.put).not.toHaveBeenCalled();
});
it.each([
  { uploadUrl: "http://storage.example/file", headers: {} },
  { uploadUrl: "https://user:pass@storage.example/file", headers: {} },
  { uploadUrl: "https://storage.example/file", headers: { Authorization: "secret" } },
])("rejects unsafe storage destinations or headers", async (patch) => {
  h.post.mockResolvedValue({ method: "PUT", storageKey: "key", ...patch });
  await expect(pickIpMedia(ipId, "cover", 1, 1, signal(), vi.fn())).rejects.toThrow();
  expect(h.storagePut).not.toHaveBeenCalled();
});
it("validates actual file size and kind before allocating storage", async () => {
  h.selected.mockResolvedValue({ size: 20 * 1024 * 1024 + 1, put: h.storagePut });
  await expect(pickIpMedia(ipId, "cover", 1, 1, signal(), vi.fn())).rejects.toThrow("20 MiB");
  expect(h.post).not.toHaveBeenCalled();
  h.pick.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///a.exe", name: "a.exe", mimeType: "application/octet-stream" }],
  });
  await expect(pickIpMedia(ipId, "trailer", 1, 1, signal(), vi.fn())).rejects.toThrow("file type");
});
it("isolates changed accounts and cancels a picker without uploading", async () => {
  h.pick.mockResolvedValue({ canceled: true });
  expect(await pickIpMedia(ipId, "cover", 1, 1, signal(), vi.fn())).toBeNull();
  expect(h.post).not.toHaveBeenCalled();
  h.generation = 2;
  await expect(fetchIpMedia(ipId, 1, signal())).rejects.toThrow("expired");
  expect(h.get).not.toHaveBeenCalled();
});
it("uses the video policy and trailer slot rather than the cover slot", async () => {
  h.pick.mockResolvedValue({ canceled: false, assets: [{ uri: "file:///a.mov", name: "a.mov" }] });
  const saved = await pickIpMedia(ipId, "trailer", 1, 1, signal(), vi.fn());
  expect(saved?.confirmation).toMatchObject({
    kind: "episode_video",
    contentType: "video/quicktime",
  });
  const video = { ...asset, kind: "video" };
  h.post.mockImplementation(async (path: string) =>
    path === "/media/confirm" ? { mediaAssetId: assetId, storageKey: "key" } : { asset: video }
  );
  h.put.mockResolvedValue({ ip: { ...snapshot, version: 2, trailerAsset: video } });
  await finishIpMedia(saved!, 1, signal(), vi.fn());
  expect(h.put.mock.calls[0][1].data).toEqual({ trailerAssetId: assetId, expectedVersion: 1 });
});
