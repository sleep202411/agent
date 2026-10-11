import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createEpisodeUploadCheckpoint,
  uploadEpisodeVideo,
  type EpisodeUploadCheckpoint,
} from "./episode-upload";
const h = vi.hoisted(() => ({ post: vi.fn(), author: vi.fn(), fetch: vi.fn(), generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { post: h.post } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("./episodes-api", () => ({ fetchAuthorEpisodes: h.author }));
vi.mock("@/config", () => ({
  appEnv: { siteRegion: "global", api: { auroraBaseUrl: "https://api.test" } },
}));
const ipId = "11111111-1111-4111-8111-111111111111",
  id = "22222222-2222-4222-8222-222222222222",
  mediaAssetId = "33333333-3333-4333-8333-333333333333";
const bytes = new Uint8Array([1, 2, 3, 4, 5]);
const source = () => ({
  name: "clip.mp4",
  size: 5,
  contentType: "video/mp4" as const,
  read: vi.fn(async (offset: number, length: number) => bytes.slice(offset, offset + length)),
});
const session = () => ({
  id,
  partSize: 3,
  sizeBytes: 5,
  expiresAt: "2027-01-01T00:00:00Z",
  uploaded: false,
  parts: [] as { number: number; sizeBytes: number }[],
});
const result = { mediaAssetId, storageKey: "key", url: "https://storage.test/complete" };
let checkpoint: EpisodeUploadCheckpoint;
let persist = vi.fn<(checkpoint: EpisodeUploadCheckpoint) => Promise<void>>();
const run = (file = source()) =>
  uploadEpisodeVideo(file, {
    ipId,
    userId: "user",
    generation: 1,
    checkpoint,
    signal: new AbortController().signal,
    persist,
  });
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  vi.stubGlobal("fetch", h.fetch);
  checkpoint = createEpisodeUploadCheckpoint(id, ipId, "user", source());
  persist = vi.fn(async (next: EpisodeUploadCheckpoint) => {
    checkpoint = JSON.parse(JSON.stringify(next));
  });
  h.author.mockResolvedValue({
    id: ipId,
    status: "active",
    accessScope: "workspace",
    role: "editor",
  });
  h.post.mockImplementation(async (path: string) =>
    path.endsWith("/complete")
      ? result
      : path.includes("/parts/")
        ? { url: "https://storage.test/part", headers: { "content-type": "video/mp4" } }
        : session()
  );
  h.fetch.mockResolvedValue({ ok: true });
});
it("persists hashes before bounded chunk PUTs and completes using the official source-video contract", async () => {
  const file = source();
  h.fetch.mockImplementation(async (_url, config) => {
    const number = h.fetch.mock.calls.length;
    expect(checkpoint.hashes[number]).toMatch(/^[a-f0-9]{64}$/);
    expect(config.credentials).toBe("omit");
    expect(config.headers).toEqual({ "content-type": "video/mp4" });
    return { ok: true };
  });
  expect(await run(file)).toEqual(result);
  expect(file.read.mock.calls).toEqual([
    [0, 3],
    [3, 2],
  ]);
  expect([...new Uint8Array(h.fetch.mock.calls[0][1].body)]).toEqual([1, 2, 3]);
  expect([...new Uint8Array(h.fetch.mock.calls[1][1].body)]).toEqual([4, 5]);
  expect(h.post.mock.calls[0][1]).toMatchObject({
    retry: false,
    data: { id, kind: "episode_source_video", sizeBytes: 5 },
  });
  expect(h.post.mock.calls[0][1]).not.toHaveProperty("headers");
});
it("does not reserve storage if the initial checkpoint cannot be persisted", async () => {
  persist.mockRejectedValue(new Error("Disk full"));
  await expect(run()).rejects.toThrow("Disk full");
  expect(h.post).not.toHaveBeenCalled();
});
it("resumes a lost PUT response from the stored part and original persisted hash", async () => {
  h.fetch.mockRejectedValueOnce(new Error("Response lost"));
  await expect(run()).rejects.toThrow("Response lost");
  expect(checkpoint.hashes[1]).toBeDefined();
  h.post.mockImplementation(async (path) =>
    path.endsWith("/complete")
      ? result
      : path.includes("/parts/")
        ? { url: "https://storage.test/part", headers: {} }
        : { ...session(), parts: [{ number: 1, sizeBytes: 3 }] }
  );
  h.fetch.mockClear();
  await run();
  expect(h.fetch).toHaveBeenCalledOnce();
  expect([...new Uint8Array(h.fetch.mock.calls[0][1].body)]).toEqual([4, 5]);
});
it("recovers a completed multipart object without reuploading after a lost complete response", async () => {
  await run();
  h.fetch.mockClear();
  h.post.mockImplementation(async (path) =>
    path.endsWith("/complete") ? result : { ...session(), uploaded: true }
  );
  await expect(run()).resolves.toEqual(result);
  expect(h.fetch).not.toHaveBeenCalled();
});
it("refuses completed objects without all original hashes", async () => {
  h.post.mockResolvedValue({ ...session(), uploaded: true });
  await expect(run()).rejects.toThrow("original video");
  expect(h.fetch).not.toHaveBeenCalled();
});
it("rejects changed bytes without overwriting confirmed parts", async () => {
  await run();
  const file = source();
  file.read.mockImplementation(async (_offset, length) => new Uint8Array(length).fill(9));
  h.fetch.mockClear();
  await expect(run(file)).rejects.toThrow("original video");
  expect(h.fetch).not.toHaveBeenCalled();
});
it.each(["scope", "size", "mime"])(
  "rejects %s checkpoint mismatches before requests",
  async (kind) => {
    if (kind === "scope") checkpoint.scope = "other-account";
    if (kind === "size") checkpoint.sizeBytes = 6;
    if (kind === "mime") checkpoint.contentType = "video/quicktime";
    await expect(run()).rejects.toThrow("original");
    expect(h.post).not.toHaveBeenCalled();
  }
);
it.each(["part-size", "duplicate", "outside", "size", "id"])(
  "rejects corrupt %s session data",
  async (kind) => {
    const data = session();
    if (kind === "part-size") data.partSize = 0;
    if (kind === "duplicate")
      data.parts = [
        { number: 1, sizeBytes: 3 },
        { number: 1, sizeBytes: 3 },
      ];
    if (kind === "outside") data.parts = [{ number: 3, sizeBytes: 3 }];
    if (kind === "size") data.sizeBytes = 6;
    if (kind === "id") data.id = mediaAssetId;
    h.post.mockResolvedValue(data);
    await expect(run()).rejects.toThrow();
    expect(h.fetch).not.toHaveBeenCalled();
  }
);
it("stops after account changes during persistence", async () => {
  persist.mockImplementation(async () => {
    h.generation = 2;
  });
  await expect(run()).rejects.toThrow("session");
  expect(h.post).not.toHaveBeenCalled();
});
it("does not mint a new upload ID automatically on expiry", async () => {
  const error = Object.assign(new Error("Upload expired"), { status: 410 });
  h.post.mockRejectedValue(error);
  await expect(run()).rejects.toBe(error);
  expect(h.post).toHaveBeenCalledOnce();
  expect(checkpoint.id).toBe(id);
});
it("does not send app credentials or bytes to invalid signed destinations", async () => {
  h.post.mockImplementation(async (path) =>
    path.includes("/parts/") ? { url: "http://storage.test/part", headers: {} } : session()
  );
  await expect(run()).rejects.toThrow();
  expect(h.fetch).not.toHaveBeenCalled();
  h.post.mockImplementation(async (path) =>
    path.includes("/parts/")
      ? { url: "https://storage.test/part", headers: { Authorization: "app-token" } }
      : session()
  );
  await expect(run()).rejects.toThrow("Unsafe");
  expect(h.fetch).not.toHaveBeenCalled();
});

afterEach(() => vi.unstubAllGlobals());

it("accepts WebM over 2 GiB but refuses files over the official 35 GiB ceiling", () => {
  const large = {
    ...source(),
    name: "episode.webm",
    contentType: "video/webm" as const,
    size: 3 * 1024 ** 3,
  };
  expect(createEpisodeUploadCheckpoint(id, ipId, "user", large).sizeBytes).toBe(large.size);
  expect(() =>
    createEpisodeUploadCheckpoint(id, ipId, "user", { ...large, size: 35 * 1024 ** 3 + 1 })
  ).toThrow();
});
it("allows moderation-gated results without a public playback URL", async () => {
  h.post.mockImplementation(async (path) =>
    path.endsWith("/complete")
      ? { ...result, url: null }
      : path.includes("/parts/")
        ? { url: "https://storage.test/part", headers: {} }
        : session()
  );
  expect((await run()).url).toBeNull();
});
it("stops immediately when IP access is denied", async () => {
  h.author.mockRejectedValue(Error("Access removed"));
  await expect(run()).rejects.toThrow("Access removed");
  expect(h.post).not.toHaveBeenCalled();
});
