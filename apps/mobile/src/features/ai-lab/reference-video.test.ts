import { beforeEach, expect, it, vi } from "vitest";
import type { AiObjectSchema } from "@repo/shared";
import { pickReferenceVideo } from "./reference-video";
import { confirmReferenceUpload } from "./reference-image";
const h = vi.hoisted(() => ({
  post: vi.fn(),
  pick: vi.fn(),
  selected: vi.fn(),
  put: vi.fn(),
  probe: vi.fn(),
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
vi.mock("./reference-video-metadata", () => ({ probeReferenceVideo: h.probe }));
const schema = {
  type: "object",
  properties: {
    referenceVideos: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        properties: { url: { type: "string", format: "uri" } },
        additionalProperties: true,
      },
      "x-ui": {
        control: "video_upload",
        accept: "video/mp4,video/quicktime",
        mediaKind: "video",
        maxFileSizeMb: 10,
        maxCombinedFileSizeMb: 15,
        minItemDurationSeconds: 2,
        maxCombinedDurationSeconds: 15,
        resolutionBand: "480p-720p",
        maxTotalFiles: 4,
      },
    },
    referenceImages: {
      type: "array",
      items: { type: "string" },
      "x-ui": { control: "image_upload" },
    },
  },
} as AiObjectSchema;
const signal = () => new AbortController().signal;
const pick = (values: Record<string, unknown> = {}, save = vi.fn()) =>
  pickReferenceVideo(schema, values, "referenceVideos", 1, signal(), save);
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.pick.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///clip.mov", name: "clip.mov", mimeType: "video/quicktime" }],
  });
  h.selected.mockResolvedValue({ size: 100, put: h.put });
  h.put.mockResolvedValue({ ok: true });
  h.probe.mockResolvedValue({ durationSeconds: 2.125, width: 640, height: 480 });
  h.post.mockImplementation(async (path: string) =>
    path.endsWith("upload-url")
      ? {
          uploadUrl: "https://storage.test/clip",
          method: "PUT",
          headers: {},
          storageKey: "video/clip",
        }
      : {
          mediaAssetId: "11111111-1111-4111-8111-111111111111",
          url: "https://storage.test/clip",
          storageKey: "video/clip",
        }
  );
});
it("uploads file-backed bytes and persists exact metadata only after PUT succeeds", async () => {
  const save = vi.fn();
  h.put.mockImplementation(async () => {
    expect(save).not.toHaveBeenCalled();
    return { ok: true };
  });
  const value = await pick({}, save);
  expect(value).toMatchObject({
    kind: "ai_reference_video",
    durationSeconds: 2.125,
    width: 640,
    height: 480,
    bytes: 100,
    objectItems: true,
  });
  expect(save).toHaveBeenCalledWith(value);
  expect(h.post.mock.calls[0][1].data).toMatchObject({
    kind: "ai_reference_video",
    contentType: "video/quicktime",
    sizeBytes: 100,
  });
  expect(h.pick.mock.calls[0][0]).toMatchObject({
    base64: false,
    multiple: false,
    copyToCacheDirectory: true,
  });
});
it("retries confirmation without another upload and rejects foreign keys", async () => {
  const value = (await pick())!;
  h.post.mockRejectedValueOnce(Error("lost"));
  await expect(confirmReferenceUpload(value, 1, signal())).rejects.toThrow("lost");
  await confirmReferenceUpload(value, 1, signal());
  expect(h.put).toHaveBeenCalledTimes(1);
  h.post.mockResolvedValue({
    mediaAssetId: "11111111-1111-4111-8111-111111111111",
    url: "https://storage.test/other",
    storageKey: "other",
  });
  await expect(confirmReferenceUpload(value, 1, signal())).rejects.toThrow("scope");
});
it.each([
  { durationSeconds: 1, width: 640, height: 480 },
  { durationSeconds: 16, width: 640, height: 480 },
  { durationSeconds: 3, width: 1920, height: 1080 },
])("rejects invalid model duration/resolution %j before storage", async (facts) => {
  h.probe.mockResolvedValue(facts);
  await expect(pick()).rejects.toThrow();
  expect(h.post).not.toHaveBeenCalled();
});
it("enforces combined durations, sizes and cross-kind file counts", async () => {
  await expect(
    pick({ referenceVideos: [{ url: "https://cdn.test/a", durationSeconds: 14, bytes: 100 }] })
  ).rejects.toThrow("duration");
  h.selected.mockResolvedValue({ size: 8 * 1024 ** 2, put: h.put });
  await expect(
    pick({
      referenceVideos: [{ url: "https://cdn.test/a", durationSeconds: 3, bytes: 8 * 1024 ** 2 }],
    })
  ).rejects.toThrow("file size");
  await expect(pick({ referenceImages: ["a", "b", "c", "d"] })).rejects.toThrow("reference file");
  expect(h.post).not.toHaveBeenCalled();
});
it("uses persisted metadata for primitive URL-array models without losing combined limits", async () => {
  const primitive = {
    ...schema,
    properties: {
      ...schema.properties,
      referenceVideos: {
        ...schema.properties.referenceVideos,
        type: "array",
        items: { type: "string" },
      },
    },
  } as AiObjectSchema;
  await expect(
    pickReferenceVideo(
      primitive,
      { referenceVideos: ["https://cdn.test/a"] },
      "referenceVideos",
      1,
      signal(),
      vi.fn(),
      [
        {
          field: "referenceVideos",
          kind: "video",
          url: "https://cdn.test/a",
          durationSeconds: 14,
          bytes: 100,
        },
      ]
    )
  ).rejects.toThrow("duration");
  expect(h.post).not.toHaveBeenCalled();
});
it("does not checkpoint failed uploads, and rejects unsupported media or stale accounts", async () => {
  const save = vi.fn();
  h.put.mockResolvedValue({ ok: false, status: 500 });
  await expect(pick({}, save)).rejects.toThrow("HTTP 500");
  expect(save).not.toHaveBeenCalled();
  h.pick.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///a.webm", name: "a.webm", mimeType: "video/webm" }],
  });
  await expect(pick()).rejects.toThrow();
  h.generation = 2;
  await expect(pick()).rejects.toThrow();
  expect(h.post).toHaveBeenCalledTimes(1);
});
it("rejects oversized files, unknown existing durations, decoder failures and credential-bearing upload headers", async () => {
  h.selected.mockResolvedValue({ size: 2 * 1024 ** 3 + 1, put: h.put });
  await expect(pick()).rejects.toThrow("2 GiB");
  h.selected.mockResolvedValue({ size: 100, put: h.put });
  await expect(pick({ referenceVideos: [{ url: "https://cdn.test/a" }] })).rejects.toThrow();
  h.probe.mockRejectedValueOnce(Error("codec"));
  await expect(pick()).rejects.toThrow("codec");
  expect(h.post).not.toHaveBeenCalled();
  h.post.mockResolvedValue({
    uploadUrl: "https://storage.test/clip",
    method: "PUT",
    headers: { Authorization: "bad" },
    storageKey: "video/clip",
  });
  await expect(pick()).rejects.toThrow("credentials");
  expect(h.put).not.toHaveBeenCalled();
});
