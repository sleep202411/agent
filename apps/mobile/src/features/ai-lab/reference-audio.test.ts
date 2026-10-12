import { beforeEach, expect, it, vi } from "vitest";
import type { AiObjectSchema } from "@repo/shared";
import { pickReferenceAudio } from "./reference-audio";
import { validateReferenceMedia } from "./reference-validation";
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
vi.mock("./reference-audio-metadata", () => ({ probeReferenceAudio: h.probe }));
const schema = {
  type: "object",
  properties: {
    referenceAudios: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        properties: { url: { type: "string", format: "uri" } },
        additionalProperties: true,
      },
      "x-ui": {
        control: "audio_upload",
        accept: "audio/mpeg,audio/wav",
        mediaKind: "audio",
        maxFileSizeMb: 10,
        maxCombinedFileSizeMb: 15,
        minItemDurationSeconds: 2,
        maxCombinedDurationSeconds: 15,
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
  pickReferenceAudio(schema, values, "referenceAudios", 1, signal(), save);
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.pick.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///clip.wav", name: "clip.wav", mimeType: "audio/wav" }],
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
          storageKey: "audio/clip",
        }
      : {
          mediaAssetId: "11111111-1111-4111-8111-111111111111",
          url: "https://storage.test/clip",
          storageKey: "audio/clip",
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
    kind: "ai_reference_audio",
    durationSeconds: 2.125,
    bytes: 100,
    objectItems: true,
  });
  expect(save).toHaveBeenCalledWith(value);
  expect(h.post.mock.calls[0][1].data).toMatchObject({
    kind: "ai_reference_audio",
    contentType: "audio/wav",
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
])("rejects invalid model duration %j before storage", async (facts) => {
  h.probe.mockResolvedValue(facts);
  await expect(pick()).rejects.toThrow();
  expect(h.post).not.toHaveBeenCalled();
});
it("enforces combined durations, sizes and cross-kind file counts", async () => {
  await expect(
    pick({ referenceAudios: [{ url: "https://cdn.test/a", durationSeconds: 14, bytes: 100 }] })
  ).rejects.toThrow("duration");
  h.selected.mockResolvedValue({ size: 8 * 1024 ** 2, put: h.put });
  await expect(
    pick({
      referenceAudios: [{ url: "https://cdn.test/a", durationSeconds: 3, bytes: 8 * 1024 ** 2 }],
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
      referenceAudios: {
        ...schema.properties.referenceAudios,
        type: "array",
        items: { type: "string" },
      },
    },
  } as AiObjectSchema;
  await expect(
    pickReferenceAudio(
      primitive,
      { referenceAudios: ["https://cdn.test/a"] },
      "referenceAudios",
      1,
      signal(),
      vi.fn(),
      [
        {
          field: "referenceAudios",
          kind: "audio",
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
    assets: [{ uri: "file:///a.ogg", name: "a.ogg", mimeType: "audio/ogg" }],
  });
  await expect(pick()).rejects.toThrow();
  h.generation = 2;
  await expect(pick()).rejects.toThrow();
  expect(h.post).toHaveBeenCalledTimes(1);
});
it("rejects oversized files, unknown existing durations, decoder failures and credential-bearing upload headers", async () => {
  h.selected.mockResolvedValue({ size: 15 * 1024 ** 2 + 1, put: h.put });
  await expect(pick()).rejects.toThrow("15 MiB");
  h.selected.mockResolvedValue({ size: 100, put: h.put });
  await expect(pick({ referenceAudios: [{ url: "https://cdn.test/a" }] })).rejects.toThrow();
  h.probe.mockRejectedValueOnce(Error("codec"));
  await expect(pick()).rejects.toThrow("codec");
  expect(h.post).not.toHaveBeenCalled();
  h.post.mockResolvedValue({
    uploadUrl: "https://storage.test/clip",
    method: "PUT",
    headers: { Authorization: "bad" },
    storageKey: "audio/clip",
  });
  await expect(pick()).rejects.toThrow("credentials");
  expect(h.put).not.toHaveBeenCalled();
});

it("allows upload before visual attachment but blocks paid generation until visual media exists", async () => {
  const withVisual = structuredClone(schema);
  Object.assign(withVisual.properties.referenceAudios!["x-ui"]!, { audioRequiresVisual: true });
  const value = await pickReferenceAudio(withVisual, {}, "referenceAudios", 1, signal(), vi.fn());
  expect(value?.kind).toBe("ai_reference_audio");
  const input = { referenceAudios: [{ url: "https://cdn.test/a", durationSeconds: 3 }] };
  expect(() => validateReferenceMedia(withVisual, input)).toThrow("image or video");
  expect(() =>
    validateReferenceMedia(withVisual, { ...input, referenceImages: ["https://cdn.test/i"] })
  ).not.toThrow();
});

it.each(["audio/x-wav", "audio/wave", "AUDIO/WAV", "audio/mp3"])(
  "normalizes platform MIME alias %s to the official upload contract",
  async (mimeType) => {
    h.pick.mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///clip", name: "clip", mimeType }],
    });
    await pick();
    expect(h.post.mock.calls[0][1].data.contentType).toBe(
      mimeType === "audio/mp3" ? "audio/mpeg" : "audio/wav"
    );
  }
);
