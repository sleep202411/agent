import { z } from "zod";
import * as DocumentPicker from "expo-document-picker";
import { uuid } from "expo-modules-core";
import { api, ApiRequestError } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord } from "@/lib/durable-record";
import { selectedMedia } from "./selected-media";
export const mediaSlot = z.enum(["cover", "trailer"]);
export type MediaSlot = z.infer<typeof mediaSlot>;
const uuidSchema = z.string().uuid();
const secureUrl = z
  .string()
  .url()
  .refine((value) => {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password;
  }, "Media requires an HTTPS URL.");
const asset = z.object({
  id: uuidSchema,
  kind: z.enum(["image", "video"]),
  url: secureUrl.nullable(),
});
const mediaSnapshot = z.object({
  id: uuidSchema,
  version: z.number().int().nonnegative(),
  coverAsset: asset.nullable(),
  trailerAsset: asset.nullable(),
});
export type MediaSnapshot = z.infer<typeof mediaSnapshot>;
const policies = {
  cover: {
    kind: "ip_banner",
    mediaKind: "image",
    maxBytes: 20 * 1024 * 1024,
    types: ["image/jpeg", "image/png", "image/webp"],
  },
  trailer: {
    kind: "episode_video",
    mediaKind: "video",
    maxBytes: 2 * 1024 * 1024 * 1024,
    types: ["video/mp4", "video/quicktime", "video/webm"],
  },
};
export const mediaCheckpoint = z
  .object({
    clientKey: uuidSchema,
    ipId: uuidSchema,
    episodeId: uuidSchema.optional(),
    slot: mediaSlot,
    fileName: z.string().min(1),
    expectedVersion: z.number().int().nonnegative(),
    confirmation: z.object({
      storageKey: z.string().min(1),
      kind: z.enum(["ip_banner", "episode_video", "episode_cover"]),
      contentType: z.string(),
    }),
    mediaAssetId: uuidSchema.optional(),
  })
  .refine(
    (value) =>
      value.confirmation.kind ===
        (value.episodeId && value.slot === "cover" ? "episode_cover" : policies[value.slot].kind) &&
      policies[value.slot].types.includes(value.confirmation.contentType),
    "Upload checkpoint does not match its media slot."
  );
export type MediaCheckpoint = z.infer<typeof mediaCheckpoint>;
function current(generation: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (getAuthGeneration() !== generation) throw new Error("IP media session expired.");
}
export function mediaUploadRecord(ipId: string, userId: string, generation: number) {
  uuidSchema.parse(ipId);
  const storage = durableRecord("ip-media", userId, ipId);
  const read = () => {
    current(generation);
    const raw = storage.read();
    if (!raw || raw === "null") return null;
    const value = mediaCheckpoint.parse(JSON.parse(raw));
    if (value.ipId !== ipId || value.episodeId) throw new Error("IP upload identity mismatch.");
    return value;
  };
  return {
    read,
    save(input: MediaCheckpoint) {
      current(generation);
      const next = mediaCheckpoint.parse(input),
        previous = read();
      if (
        next.episodeId ||
        next.ipId !== ipId ||
        (previous && previous.clientKey !== next.clientKey)
      )
        throw new Error("Another IP upload is pending.");
      storage.write(JSON.stringify(next));
    },
    clear(clientKey: string) {
      const previous = read();
      if (previous && previous.clientKey !== clientKey)
        throw new Error("Another IP upload is pending.");
      storage.write("null");
    },
  };
}
export async function fetchIpMedia(ipId: string, generation: number, signal: AbortSignal) {
  uuidSchema.parse(ipId);
  current(generation, signal);
  const result = z
    .object({ ip: mediaSnapshot })
    .parse(
      await api.get(`/ip-commerce/me/ips/${ipId}`, { service: "aurora", signal, retry: false })
    ).ip;
  current(generation, signal);
  if (result.id !== ipId) throw new Error("IP media identity mismatch.");
  return result;
}
export async function pickIpMedia(
  ipId: string,
  slot: MediaSlot,
  expectedVersion: number,
  generation: number,
  signal: AbortSignal,
  save: (value: MediaCheckpoint) => void,
  episodeId?: string
) {
  uuidSchema.parse(ipId);
  if (episodeId) uuidSchema.parse(episodeId);
  mediaSlot.parse(slot);
  current(generation, signal);
  const policy =
    episodeId && slot === "cover"
      ? { ...policies.cover, kind: "episode_cover", maxBytes: 10 * 1024 ** 2 }
      : policies[slot];
  const picked = await DocumentPicker.getDocumentAsync({
    type: policy.types,
    multiple: false,
    copyToCacheDirectory: true,
    base64: false,
  });
  current(generation, signal);
  if (picked.canceled) return null;
  const file = picked.assets[0];
  if (picked.assets.length !== 1 || !file?.uri || !file.name.trim())
    throw new Error("Select one media file.");
  const extensions: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    mp4: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
  };
  const reported = file.file?.type || file.mimeType;
  const type =
    reported && reported !== "application/octet-stream"
      ? reported
      : extensions[file.name.split(".").pop()?.toLowerCase() ?? ""];
  if (!policy.types.includes(type ?? ""))
    throw new Error("The selected file type is not supported for this slot.");
  const selected = await selectedMedia(file.uri, signal);
  current(generation, signal);
  if (!Number.isSafeInteger(selected.size) || selected.size <= 0 || selected.size > policy.maxBytes)
    throw new Error(`Select non-empty media no larger than ${policy.maxBytes / 1024 / 1024} MiB.`);
  const signed = z
    .object({
      uploadUrl: secureUrl,
      method: z.literal("PUT"),
      headers: z.record(z.string(), z.string()),
      storageKey: z.string().min(1),
    })
    .parse(
      await api.post("/media/upload-url", {
        service: "aurora",
        signal,
        retry: false,
        data: {
          kind: policy.kind,
          contentType: type,
          fileName: file.name,
          sizeBytes: selected.size,
        },
      })
    );
  current(generation, signal);
  if (
    Object.keys(signed.headers).some((key) =>
      /^(authorization|cookie|proxy-authorization)$/i.test(key)
    )
  )
    throw new Error("Storage upload must not include login credentials.");
  const response = await selected.put(
    signed.uploadUrl,
    { "Content-Type": type!, ...signed.headers },
    signal
  );
  current(generation, signal);
  if (!response.ok) throw new Error(`Media upload failed: HTTP ${response.status}`);
  const checkpoint = mediaCheckpoint.parse({
    clientKey: uuid.v4(),
    ipId,
    ...(episodeId ? { episodeId } : {}),
    slot,
    fileName: file.name,
    expectedVersion,
    confirmation: { storageKey: signed.storageKey, kind: policy.kind, contentType: type },
  });
  save(checkpoint);
  return checkpoint;
}
export async function confirmIpMedia(
  input: MediaCheckpoint,
  generation: number,
  signal: AbortSignal,
  save: (value: MediaCheckpoint) => void
) {
  let checkpoint = mediaCheckpoint.parse(input);
  current(generation, signal);
  if (!checkpoint.mediaAssetId) {
    const receipt = z.object({ mediaAssetId: uuidSchema, storageKey: z.string() }).parse(
      await api.post("/media/confirm", {
        service: "aurora",
        signal,
        retry: false,
        data: checkpoint.confirmation,
      })
    );
    current(generation, signal);
    if (receipt.storageKey !== checkpoint.confirmation.storageKey)
      throw new Error("Media confirmation identity mismatch.");
    checkpoint = { ...checkpoint, mediaAssetId: receipt.mediaAssetId };
    save(checkpoint);
  }
  const policy = policies[checkpoint.slot];
  const associated = z.object({ asset }).parse(
    await api.post(`/ip-commerce/me/ips/${checkpoint.ipId}/media`, {
      service: "aurora",
      signal,
      retry: false,
      params: {
        kind: policy.mediaKind,
        purpose: checkpoint.episodeId ? `episode_${checkpoint.slot}` : checkpoint.slot,
      },
      data: { mediaAssetId: checkpoint.mediaAssetId },
    })
  ).asset;
  current(generation, signal);
  if (associated.id !== checkpoint.mediaAssetId || associated.kind !== policy.mediaKind)
    throw new Error("Associated media receipt mismatch.");
  return checkpoint;
}
export async function finishIpMedia(
  input: MediaCheckpoint,
  generation: number,
  signal: AbortSignal,
  save: (value: MediaCheckpoint) => void
) {
  if (input.episodeId) throw new Error("Episode media must be attached to its original episode.");
  const checkpoint = await confirmIpMedia(input, generation, signal, save);
  const latest = await fetchIpMedia(checkpoint.ipId, generation, signal);
  const field = checkpoint.slot === "cover" ? "coverAsset" : "trailerAsset";
  if (latest[field]?.id === checkpoint.mediaAssetId) return latest;
  if (latest.version !== checkpoint.expectedVersion)
    throw new ApiRequestError(
      "IP_VERSION_CONFLICT",
      "This IP changed during upload. Refresh to review it before applying the uploaded media.",
      409
    );
  const saved = z.object({ ip: mediaSnapshot }).parse(
    await api.put(`/ip-commerce/me/ips/${checkpoint.ipId}/assets`, {
      service: "aurora",
      signal,
      retry: false,
      data: {
        [`${field}Id`]: checkpoint.mediaAssetId,
        expectedVersion: checkpoint.expectedVersion,
      },
    })
  ).ip;
  current(generation, signal);
  if (
    saved.id !== checkpoint.ipId ||
    saved.version <= checkpoint.expectedVersion ||
    saved[field]?.id !== checkpoint.mediaAssetId
  )
    throw new Error("IP media save receipt mismatch. Retry to check its result.");
  return saved;
}
