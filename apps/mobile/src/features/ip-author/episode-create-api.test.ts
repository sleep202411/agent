import { beforeEach, expect, it, vi } from "vitest";
import {
  associateEpisodeVideo,
  cancelEpisodeVideo,
  createAuthorEpisode,
  episodeCreationStorage,
  type EpisodeCreateCommand,
} from "./episode-create-api";
import { createEpisodeUploadCheckpoint } from "./episode-upload";
const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
  generation: 1,
  records: new Map<string, string>(),
}));
vi.mock("@/lib/api-client", () => ({
  api: { get: h.get, post: h.post, delete: h.del },
  ApiRequestError: class extends Error {
    status: number;
    constructor(_code: string, message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/i18n/locale-store", () => ({ getLocale: () => "en-US" }));
vi.mock("@/config", () => ({
  appEnv: { siteRegion: "global", api: { auroraBaseUrl: "https://api.test" } },
}));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (n: string, u: string, id: string) => ({
    read: () => h.records.get(`${n}:${u}:${id}`) ?? null,
    write: (v: string) => h.records.set(`${n}:${u}:${id}`, v),
  }),
}));
const ipId = "11111111-1111-4111-8111-111111111111",
  clientKey = "22222222-2222-4222-8222-222222222222",
  mediaAssetId = "33333333-3333-4333-8333-333333333333";
const command: EpisodeCreateCommand = {
  expectedVersion: 1,
  sourceLocale: "en-US",
  data: {
    title: "Episode",
    summary: "Summary",
    durationSeconds: null,
    isFreePreview: false,
    mediaAssetId,
  },
};
const episode = {
  id: clientKey,
  episodeNo: 1,
  sortOrder: 1000,
  status: "draft",
  ...command.data,
  coverAsset: null,
  trailerAsset: null,
  mediaAsset: { id: mediaAssetId, url: null },
};
const snapshot = { id: ipId, version: 1, sourceLocale: "en-US", episodes: [] };
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.records.clear();
  h.generation = 1;
  h.get.mockResolvedValue({ ip: snapshot });
  h.post.mockResolvedValue({ ip: { ...snapshot, version: 2, episodes: [episode] } });
});
it("sends the official version-fenced creation command without invented numbering or idempotency fields", async () => {
  await createAuthorEpisode(ipId, 1, command, signal());
  expect(h.post.mock.calls[0]).toEqual([
    `/ip-commerce/me/ips/${ipId}/episodes`,
    expect.objectContaining({
      retry: false,
      data: {
        title: "Episode",
        summary: "Summary",
        isFreePreview: false,
        mediaAssetId,
        expectedVersion: 1,
      },
    }),
  ]);
});
it("does not resend or claim recovery when a matching episode appears after a lost response", async () => {
  h.get.mockResolvedValue({ ip: { ...snapshot, version: 2, episodes: [episode] } });
  await expect(createAuthorEpisode(ipId, 1, command, signal())).rejects.toMatchObject({
    status: 409,
  });
  expect(h.post).not.toHaveBeenCalled();
});
it("retains an immutable account-scoped command across storage reconstruction", () => {
  const record = episodeCreationStorage(ipId, "alice", 1),
    draft = record.empty(clientKey);
  const checkpoint = createEpisodeUploadCheckpoint(clientKey, ipId, "alice", {
    name: "x.mp4",
    size: 5,
    contentType: "video/mp4",
    read: async () => new Uint8Array(5),
  });
  const value = { ...draft, checkpoint, media: { mediaAssetId, storageKey: "key" }, command };
  record.save(value);
  expect(episodeCreationStorage(ipId, "alice", 1).read()).toEqual(value);
  expect(episodeCreationStorage(ipId, "bob", 1).read()).toBeNull();
  expect(() => record.save({ ...value, command: undefined })).toThrow("pending");
  expect(() => record.clear(mediaAssetId)).toThrow("changed");
  h.generation = 2;
  expect(() => record.clear(clientKey)).toThrow("expired");
});
it("validates media association identity and source purpose", async () => {
  h.post.mockResolvedValue({ asset: { id: mediaAssetId, kind: "video" } });
  await associateEpisodeVideo(ipId, 1, { mediaAssetId, storageKey: "key" }, signal());
  expect(h.post.mock.calls[0][1]).toMatchObject({
    params: { kind: "video", purpose: "episode_media" },
    data: { mediaAssetId },
  });
  h.post.mockResolvedValue({ asset: { id: ipId, kind: "video" } });
  await expect(
    associateEpisodeVideo(ipId, 1, { mediaAssetId, storageKey: "key" }, signal())
  ).rejects.toThrow("mismatch");
});
it("rejects receipts without a new matching episode and ignores late responses after logout", async () => {
  h.post.mockResolvedValue({
    ip: { ...snapshot, version: 2, episodes: [{ ...episode, title: "Other" }] },
  });
  await expect(createAuthorEpisode(ipId, 1, command, signal())).rejects.toThrow("receipt");
  h.post.mockImplementation(async () => {
    h.generation = 2;
    return { ip: { ...snapshot, version: 2, episodes: [episode] } };
  });
  await expect(createAuthorEpisode(ipId, 1, command, signal())).rejects.toThrow("expired");
});
it("does not cancel uploads behind an unresolved episode creation", async () => {
  const draft = episodeCreationStorage(ipId, "alice", 1).empty(clientKey);
  await expect(cancelEpisodeVideo(ipId, 1, { ...draft, command }, signal())).rejects.toThrow(
    "pending"
  );
  expect(h.del).not.toHaveBeenCalled();
});
