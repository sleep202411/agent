import { z } from "zod";
import { api, ApiRequestError } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord } from "@/lib/durable-record";
import { durableRecordKey } from "@/lib/durable-record-key";
import { episodeUploadCheckpointSchema } from "./episode-upload";
import {
  episodeFields,
  episodeMatches,
  episodeSnapshotSchema,
  fetchAuthorEpisodes,
} from "./episodes-api";
const uuid = z.string().uuid();
export const episodeCreateCommand = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    sourceLocale: z.enum(["en-US", "zh-CN", "zh-HK"]),
    data: episodeFields.omit({ status: true }).extend({ mediaAssetId: uuid }).strict(),
  })
  .strict();
export type EpisodeCreateCommand = z.infer<typeof episodeCreateCommand>;
const media = z.object({ mediaAssetId: uuid, storageKey: z.string().min(1) }).strict();
const draftSchema = z
  .object({
    version: z.literal(1),
    scope: z.string(),
    clientKey: uuid,
    title: z.string().max(80),
    summary: z.string().max(800),
    duration: z.string().max(5),
    isFreePreview: z.boolean(),
    checkpoint: episodeUploadCheckpointSchema.optional(),
    media: media.optional(),
    command: episodeCreateCommand.optional(),
  })
  .strict();
export type EpisodeCreationDraft = z.infer<typeof draftSchema>;
export function episodeCreationStorage(ipId: string, userId: string, generation: number) {
  uuid.parse(ipId);
  z.string().min(1).parse(userId);
  const scope = durableRecordKey("ip-episode-upload", userId, ipId),
    record = durableRecord("ip-episode-create", userId, ipId);
  const current = () => {
    if (generation !== getAuthGeneration()) throw new Error("Episode creation session expired.");
  };
  const validate = (input: unknown) => {
    const draft = draftSchema.parse(input);
    if (
      draft.scope !== scope ||
      (draft.checkpoint &&
        (draft.checkpoint.scope !== scope || draft.checkpoint.id !== draft.clientKey)) ||
      (draft.media && !draft.checkpoint) ||
      (draft.command && draft.command.data.mediaAssetId !== draft.media?.mediaAssetId)
    )
      throw new Error("Saved episode draft identity mismatch.");
    return draft;
  };
  const read = () => {
    current();
    const text = record.read();
    return !text || text === "null" ? null : validate(JSON.parse(text));
  };
  return {
    empty: (clientKey: string): EpisodeCreationDraft =>
      validate({
        version: 1,
        scope,
        clientKey,
        title: "",
        summary: "",
        duration: "",
        isFreePreview: false,
      }),
    read,
    save: (input: EpisodeCreationDraft) => {
      current();
      const value = validate(input),
        old = read();
      if (
        old &&
        (old.clientKey !== value.clientKey ||
          (old.command && JSON.stringify(old) !== JSON.stringify(value)))
      )
        throw new Error("Resolve the pending episode before changing this draft.");
      record.write(JSON.stringify(value));
      return value;
    },
    clear: (clientKey: string) => {
      current();
      const old = read();
      if (old && old.clientKey !== clientKey) throw new Error("Episode draft changed.");
      record.write("null");
    },
  };
}
function current(generation: number, signal: AbortSignal) {
  signal.throwIfAborted();
  if (generation !== getAuthGeneration()) throw new Error("Episode creation session expired.");
}
export async function associateEpisodeVideo(
  ipId: string,
  generation: number,
  input: z.infer<typeof media>,
  signal: AbortSignal
) {
  uuid.parse(ipId);
  const value = media.parse(input);
  current(generation, signal);
  const result = z.object({ asset: z.object({ id: uuid, kind: z.literal("video") }) }).parse(
    await api.post(`/ip-commerce/me/ips/${ipId}/media`, {
      service: "aurora",
      signal,
      retry: false,
      timeout: 120000,
      params: { kind: "video", purpose: "episode_media" },
      data: { mediaAssetId: value.mediaAssetId },
    })
  );
  current(generation, signal);
  if (result.asset.id !== value.mediaAssetId) throw new Error("Episode video receipt mismatch.");
}
/** The server has a version fence, but no creation idempotency key. Never infer ownership of a newly appearing episode after a lost response. */
export async function createAuthorEpisode(
  ipId: string,
  generation: number,
  input: EpisodeCreateCommand,
  signal: AbortSignal
) {
  const command = episodeCreateCommand.parse(input),
    latest = await fetchAuthorEpisodes(ipId, generation, signal);
  if (latest.version !== command.expectedVersion || latest.sourceLocale !== command.sourceLocale)
    throw new ApiRequestError(
      "IP_VERSION_CONFLICT",
      "The IP changed. Check the episode list before resolving this pending creation; the original request may already have succeeded.",
      409
    );
  current(generation, signal);
  const { durationSeconds, ...fields } = command.data;
  const saved = z.object({ ip: episodeSnapshotSchema }).parse(
    await api.post(`/ip-commerce/me/ips/${ipId}/episodes`, {
      service: "aurora",
      signal,
      retry: false,
      timeout: 120000,
      data: {
        ...fields,
        ...(durationSeconds !== null ? { durationSeconds } : {}),
        expectedVersion: command.expectedVersion,
      },
    })
  ).ip;
  current(generation, signal);
  const added = saved.episodes.filter((item) => !latest.episodes.some((old) => old.id === item.id));
  if (
    saved.id !== ipId ||
    saved.sourceLocale !== command.sourceLocale ||
    saved.version <= command.expectedVersion ||
    added.length !== 1 ||
    !episodeMatches(added[0], command.data) ||
    added[0].mediaAsset?.id !== command.data.mediaAssetId
  )
    throw new Error("Episode creation receipt mismatch. Check the episode list before retrying.");
  return saved;
}
export async function cancelEpisodeVideo(
  ipId: string,
  generation: number,
  draft: EpisodeCreationDraft,
  signal: AbortSignal
) {
  if (draft.command) throw new Error("Resolve the pending episode before discarding its video.");
  await fetchAuthorEpisodes(ipId, generation, signal);
  if (draft.checkpoint) {
    await api.delete(`/media/episode-uploads/${uuid.parse(draft.checkpoint.id)}`, {
      service: "aurora",
      signal,
      retry: false,
      timeout: 180000,
    });
    current(generation, signal);
  }
}
