import { beforeEach, expect, it, vi } from "vitest";
import { pickIpMedia, finishIpMedia, mediaUploadRecord } from "./media-api";
import {
  episodeMediaRecord,
  finishEpisodeMedia,
  rebaseEpisodeMedia,
  type PendingEpisodeMedia,
} from "./episode-media-api";
import { createEpisodeUploadCheckpoint } from "./episode-upload";
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

vi.mock("@/i18n/locale-store", () => ({ getLocale: () => "en-US" }));
vi.mock("@/config", () => ({
  appEnv: { siteRegion: "global", api: { auroraBaseUrl: "https://api.test" } },
}));
const ipId = "11111111-1111-4111-8111-111111111111",
  episodeId = "22222222-2222-4222-8222-222222222222",
  assetId = "33333333-3333-4333-8333-333333333333",
  key = "44444444-4444-4444-8444-444444444444";
const asset = { id: assetId, kind: "image", url: null };
const episode = {
  id: episodeId,
  episodeNo: 1,
  sortOrder: 1000,
  status: "draft",
  title: "Episode",
  summary: "Summary",
  durationSeconds: null,
  isFreePreview: false,
  coverAsset: null,
  mediaAsset: null,
  trailerAsset: null,
};
const snapshot = { id: ipId, version: 1, sourceLocale: "en-US", episodes: [episode] };
const cover: PendingEpisodeMedia = {
  slot: "cover",
  upload: {
    clientKey: key,
    ipId,
    episodeId,
    slot: "cover",
    fileName: "poster.png",
    expectedVersion: 1,
    confirmation: { storageKey: "key", kind: "episode_cover", contentType: "image/png" },
  },
};
const source: PendingEpisodeMedia = {
  slot: "source",
  durationSeconds: null,
  ipId,
  episodeId,
  expectedVersion: 1,
  checkpoint: createEpisodeUploadCheckpoint(key, ipId, "alice", {
    name: "source.mp4",
    size: 5,
    contentType: "video/mp4",
    read: async () => new Uint8Array(5),
  }),
  media: { mediaAssetId: assetId, storageKey: "source" },
};
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.records.clear();
  h.generation = 1;
  h.get.mockResolvedValue({ ip: snapshot });
  h.pick.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///poster.png", name: "poster.png", mimeType: "image/png" }],
  });
  h.selected.mockResolvedValue({ size: 100, put: h.storagePut });
  h.storagePut.mockResolvedValue({ ok: true });
  h.post.mockImplementation(async (path: string) =>
    path === "/media/upload-url"
      ? { uploadUrl: "https://storage.test/poster", method: "PUT", headers: {}, storageKey: "key" }
      : path === "/media/confirm"
        ? { mediaAssetId: assetId, storageKey: "key" }
        : { asset }
  );
  h.put.mockResolvedValue({
    ip: { ...snapshot, version: 2, episodes: [{ ...episode, coverAsset: asset }] },
  });
});
it("uses the episode cover policy and its dedicated storage identity", async () => {
  const record = episodeMediaRecord(ipId, episodeId, "alice", 1);
  const value = await pickIpMedia(
    ipId,
    "cover",
    1,
    1,
    signal(),
    (upload) => record.save({ slot: "cover", upload }),
    episodeId
  );
  expect(value?.confirmation.kind).toBe("episode_cover");
  expect(value?.episodeId).toBe(episodeId);
  await finishEpisodeMedia(record.read()!, 1, signal(), record.save);
  expect(h.post.mock.calls.find((c) => c[0].endsWith("/media"))?.[1].params).toEqual({
    kind: "image",
    purpose: "episode_cover",
  });
  expect(h.put.mock.calls[0][0]).toBe(`/ip-commerce/me/ips/${ipId}/episodes/${episodeId}`);
  expect(h.put.mock.calls[0][1].data).toEqual({ coverAssetId: assetId, expectedVersion: 1 });
  await expect(finishIpMedia(value!, 1, signal(), vi.fn())).rejects.toThrow("original episode");
  expect(() => mediaUploadRecord(ipId, "alice", 1).save(value!)).toThrow("pending");
});
it("rejects a cover exceeding Web's 10 MiB limit before reserving storage", async () => {
  h.selected.mockResolvedValue({ size: 10 * 1024 ** 2 + 1, put: h.storagePut });
  await expect(pickIpMedia(ipId, "cover", 1, 1, signal(), vi.fn(), episodeId)).rejects.toThrow(
    "10 MiB"
  );
  expect(h.post).not.toHaveBeenCalled();
});
it("attaches a confirmed source with episode_media purpose and the exact version", async () => {
  h.post.mockResolvedValue({ asset: { ...asset, kind: "video" } });
  h.put.mockResolvedValue({
    ip: { ...snapshot, version: 2, episodes: [{ ...episode, mediaAsset: asset }] },
  });
  await finishEpisodeMedia(source, 1, signal(), vi.fn());
  expect(h.post.mock.calls[0][1].params.purpose).toBe("episode_media");
  expect(h.put.mock.calls[0][1].data).toEqual({
    mediaAssetId: assetId,
    expectedVersion: 1,
    durationSeconds: null,
  });
});
it("recovers lost attachment receipts without a second episode PUT", async () => {
  h.post.mockResolvedValue({ asset: { ...asset, kind: "video" } });
  h.get.mockResolvedValue({
    ip: { ...snapshot, version: 2, episodes: [{ ...episode, mediaAsset: asset }] },
  });
  await finishEpisodeMedia(source, 1, signal(), vi.fn());
  expect(h.put).not.toHaveBeenCalled();
});
it("rejects concurrent changes until explicitly rebased and does not recreate deleted episodes", async () => {
  h.post.mockResolvedValue({ asset: { ...asset, kind: "video" } });
  h.get.mockResolvedValue({ ip: { ...snapshot, version: 4 } });
  await expect(finishEpisodeMedia(source, 1, signal(), vi.fn())).rejects.toMatchObject({
    status: 409,
  });
  expect(h.put).not.toHaveBeenCalled();
  h.put.mockResolvedValue({
    ip: { ...snapshot, version: 5, episodes: [{ ...episode, mediaAsset: asset }] },
  });
  await finishEpisodeMedia(rebaseEpisodeMedia(source, 4), 1, signal(), vi.fn());
  expect(h.put.mock.calls[0][1].data.expectedVersion).toBe(4);
  h.get.mockResolvedValue({ ip: { ...snapshot, episodes: [] } });
  h.post.mockClear();
  await expect(finishEpisodeMedia(source, 1, signal(), vi.fn())).rejects.toMatchObject({
    status: 404,
  });
  expect(h.post).not.toHaveBeenCalled();
});
it("removes only the cover and recovers an already-applied removal", async () => {
  const remove: PendingEpisodeMedia = {
    slot: "removeCover",
    ipId,
    episodeId,
    clientKey: key,
    expectedVersion: 1,
  };
  h.get.mockResolvedValue({ ip: { ...snapshot, episodes: [{ ...episode, coverAsset: asset }] } });
  h.put.mockResolvedValue({ ip: { ...snapshot, version: 2 } });
  await finishEpisodeMedia(remove, 1, signal(), vi.fn());
  expect(h.put.mock.calls[0][1].data).toEqual({ coverAssetId: null, expectedVersion: 1 });
  expect(h.post).not.toHaveBeenCalled();
  h.get.mockResolvedValue({ ip: { ...snapshot, version: 2 } });
  h.put.mockClear();
  await finishEpisodeMedia(remove, 1, signal(), vi.fn());
  expect(h.put).not.toHaveBeenCalled();
});
it("isolates saved operations by account and episode and rejects identity changes", () => {
  const record = episodeMediaRecord(ipId, episodeId, "alice", 1);
  record.save(cover);
  expect(episodeMediaRecord(ipId, episodeId, "bob", 1).read()).toBeNull();
  expect(episodeMediaRecord(ipId, key, "alice", 1).read()).toBeNull();
  expect(() => record.save(source)).toThrow("pending");
  expect(() => record.clear(assetId)).toThrow("changed");
  expect(() => episodeMediaRecord(ipId, key, "alice", 1).save(cover)).toThrow("identity");
  h.generation = 2;
  expect(() => record.read()).toThrow("expired");
});
it("rejects a mismatched saved media receipt", async () => {
  h.put.mockResolvedValue({ ip: { ...snapshot, version: 2 } });
  await expect(finishEpisodeMedia(cover, 1, signal(), vi.fn())).rejects.toThrow("receipt");
});

it("clears the old duration when the replacement cannot be probed", async () => {
  h.get.mockResolvedValue({ ip: { ...snapshot, episodes: [{ ...episode, durationSeconds: 99 }] } });
  h.post.mockResolvedValue({ asset: { ...asset, kind: "video" } });
  h.put.mockResolvedValue({
    ip: {
      ...snapshot,
      version: 2,
      episodes: [{ ...episode, mediaAsset: asset, durationSeconds: null }],
    },
  });
  await finishEpisodeMedia(source, 1, signal(), vi.fn());
  expect(h.put.mock.calls[0][1].data.durationSeconds).toBeNull();
});
