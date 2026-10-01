import { z } from "zod";
import { api, ApiRequestError } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord } from "@/lib/durable-record";
import { durableRecordKey } from "@/lib/durable-record-key";
import { mediaCheckpoint, confirmIpMedia } from "./media-api";
import { episodeUploadCheckpointSchema } from "./episode-upload";
import { associateEpisodeVideo } from "./episode-create-api";
import { episodeSnapshotSchema, fetchAuthorEpisodes, type EpisodeSnapshot } from "./episodes-api";
const uuid = z.string().uuid();
export const pendingEpisodeMedia = z.discriminatedUnion("slot", [
  z
    .object({
      slot: z.literal("removeCover"),
      ipId: uuid,
      episodeId: uuid,
      clientKey: uuid,
      expectedVersion: z.number().int().nonnegative(),
    })
    .strict(),
  z.object({ slot: z.literal("cover"), upload: mediaCheckpoint }).strict(),
  z
    .object({
      slot: z.literal("source"),
      ipId: uuid,
      episodeId: uuid,
      expectedVersion: z.number().int().nonnegative(),
      checkpoint: episodeUploadCheckpointSchema,
      durationSeconds: z.number().int().positive().max(86400).nullable(),
      media: z
        .object({ mediaAssetId: uuid, storageKey: z.string().min(1) })
        .strict()
        .optional(),
    })
    .strict(),
]);
export type PendingEpisodeMedia = z.infer<typeof pendingEpisodeMedia>;
export const episodeMediaKey = (value: PendingEpisodeMedia) =>
  value.slot === "cover"
    ? value.upload.clientKey
    : value.slot === "source"
      ? value.checkpoint.id
      : value.clientKey;
export const episodeMediaVersion = (value: PendingEpisodeMedia) =>
  value.slot === "cover" ? value.upload.expectedVersion : value.expectedVersion;
export function rebaseEpisodeMedia(
  value: PendingEpisodeMedia,
  version: number
): PendingEpisodeMedia {
  return value.slot === "cover"
    ? { ...value, upload: { ...value.upload, expectedVersion: version } }
    : { ...value, expectedVersion: version };
}
function current(generation: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (generation !== getAuthGeneration()) throw new Error("Episode media session expired.");
}
export function episodeMediaRecord(
  ipId: string,
  episodeId: string,
  userId: string,
  generation: number
) {
  uuid.parse(ipId);
  uuid.parse(episodeId);
  z.string().min(1).parse(userId);
  const record = durableRecord("ip-episode-media", userId, JSON.stringify([ipId, episodeId]));
  const validate = (input: unknown) => {
    const value = pendingEpisodeMedia.parse(input),
      target = value.slot === "cover" ? value.upload : value;
    if (
      target.ipId !== ipId ||
      target.episodeId !== episodeId ||
      (value.slot === "cover" && value.upload.slot !== "cover") ||
      (value.slot === "source" &&
        value.checkpoint.scope !== durableRecordKey("ip-episode-upload", userId, ipId))
    )
      throw new Error("Episode upload identity mismatch.");
    return value;
  };
  const read = () => {
    current(generation);
    const text = record.read();
    return !text || text === "null" ? null : validate(JSON.parse(text));
  };
  return {
    read,
    save(input: PendingEpisodeMedia) {
      current(generation);
      const value = validate(input),
        old = read();
      if (old && (episodeMediaKey(old) !== episodeMediaKey(value) || old.slot !== value.slot))
        throw new Error("Another episode upload is pending.");
      record.write(JSON.stringify(value));
    },
    clear(key: string) {
      const old = read();
      if (old && episodeMediaKey(old) !== key) throw new Error("Episode upload changed.");
      record.write("null");
    },
  };
}
export function requireEpisode(value: EpisodeSnapshot, episodeId: string) {
  const target = value.episodes.find((item) => item.id === episodeId);
  if (!target) throw new ApiRequestError("IP_EPISODE_NOT_FOUND", "Episode no longer exists.", 404);
  return target;
}
export async function fetchEpisodeMedia(
  ipId: string,
  episodeId: string,
  generation: number,
  signal: AbortSignal
) {
  uuid.parse(episodeId);
  const value = await fetchAuthorEpisodes(ipId, generation, signal);
  requireEpisode(value, episodeId);
  return value;
}
export async function finishEpisodeMedia(
  input: PendingEpisodeMedia,
  generation: number,
  signal: AbortSignal,
  save: (value: PendingEpisodeMedia) => void
) {
  let value = pendingEpisodeMedia.parse(input);
  const identity = value.slot === "cover" ? value.upload : value;
  const { ipId, episodeId } = identity;
  if (!episodeId || (value.slot === "cover" && value.upload.slot !== "cover"))
    throw new Error("Episode upload identity mismatch.");
  // Verify the target still exists before promoting/attaching the uploaded asset.
  await fetchEpisodeMedia(ipId, episodeId, generation, signal);
  let mediaAssetId: string | null;
  if (value.slot === "cover") {
    const upload = await confirmIpMedia(value.upload, generation, signal, (next) =>
      save({ slot: "cover", upload: next })
    );
    value = { slot: "cover", upload };
    mediaAssetId = upload.mediaAssetId!;
  } else if (value.slot === "source") {
    if (!value.media) throw new Error("Resume the source-video upload before applying it.");
    await associateEpisodeVideo(ipId, generation, value.media, signal);
    mediaAssetId = value.media.mediaAssetId;
  } else {
    mediaAssetId = null;
  }
  const latest = await fetchEpisodeMedia(ipId, episodeId, generation, signal),
    target = requireEpisode(latest, episodeId),
    field = value.slot === "source" ? "mediaAsset" : "coverAsset";
  if (
    (target[field]?.id ?? null) === mediaAssetId &&
    (value.slot !== "source" || target.durationSeconds === value.durationSeconds)
  )
    return latest;
  if (latest.version !== episodeMediaVersion(value))
    throw new ApiRequestError(
      "IP_VERSION_CONFLICT",
      "This IP changed during upload. Refresh and review the episode before applying its uploaded media.",
      409
    );
  current(generation, signal);
  const saved = z.object({ ip: episodeSnapshotSchema }).parse(
    await api.put(`/ip-commerce/me/ips/${ipId}/episodes/${episodeId}`, {
      service: "aurora",
      signal,
      retry: false,
      timeout: 120000,
      data: {
        [`${field}Id`]: mediaAssetId,
        expectedVersion: episodeMediaVersion(value),
        ...(value.slot === "source" ? { durationSeconds: value.durationSeconds } : {}),
      },
    })
  ).ip;
  current(generation, signal);
  if (
    saved.id !== ipId ||
    saved.sourceLocale !== latest.sourceLocale ||
    saved.version <= latest.version ||
    (requireEpisode(saved, episodeId)[field]?.id ?? null) !== mediaAssetId ||
    (value.slot === "source" &&
      requireEpisode(saved, episodeId).durationSeconds !== value.durationSeconds)
  )
    throw new Error("Episode media receipt mismatch. Retry to check the saved result.");
  return saved;
}
