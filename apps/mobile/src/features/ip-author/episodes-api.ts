import { z } from "zod";
import { api, ApiRequestError } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { getLocale } from "@/i18n/locale-store";
import { durableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
const id = z.string().uuid();
const locale = z.enum(["en-US", "zh-CN", "zh-HK"]);
const asset = z.object({
  id,
  url: z
    .string()
    .url()
    .refine((value) => {
      const u = new URL(value);
      return u.protocol === "https:" && !u.username && !u.password;
    })
    .nullable(),
});
const episode = z.object({
  id,
  episodeNo: z.number().int().positive(),
  sortOrder: z.number().int(),
  status: z.string(),
  title: z.string(),
  summary: z.string().nullable(),
  durationSeconds: z.number().int().positive().nullable(),
  isFreePreview: z.boolean(),
  coverAsset: asset.nullable(),
  mediaAsset: asset.nullable(),
  trailerAsset: asset.nullable(),
});
export type AuthorEpisode = z.infer<typeof episode>;
export const episodeSnapshotSchema = z
  .object({
    id,
    version: z.number().int().nonnegative(),
    sourceLocale: locale,
    episodes: z.array(episode),
  })
  .refine(
    (value) => new Set(value.episodes.map((item) => item.id)).size === value.episodes.length,
    "Duplicate episode identities."
  );
export type EpisodeSnapshot = z.infer<typeof episodeSnapshotSchema>;
export const episodeFields = z.object({
  title: z.string().trim().min(1).max(80),
  summary: z.string().trim().min(1).max(800),
  durationSeconds: z.number().int().positive().max(86400).nullable(),
  isFreePreview: z.boolean(),
  status: z.enum(["draft", "hidden"]).optional(),
});
const base = z.object({
  clientKey: id,
  episodeId: id,
  expectedVersion: z.number().int().nonnegative(),
  sourceLocale: locale,
});
export const episodeCommand = z.discriminatedUnion("action", [
  base.extend({ action: z.literal("edit"), data: episodeFields }),
  base.extend({ action: z.literal("delete") }),
]);
export type EpisodeCommand = z.infer<typeof episodeCommand>;
function current(generation: number, signal: AbortSignal) {
  signal.throwIfAborted();
  if (getAuthGeneration() !== generation) throw new Error("Episode editing session expired.");
}
export function episodeOutbox(ipId: string, userId: string, generation: number) {
  return pendingRequest(
    episodeCommand,
    generation,
    durableRecord("ip-episode-mutation", userId, id.parse(ipId))
  );
}
export async function fetchAuthorEpisodes(ipId: string, generation: number, signal: AbortSignal) {
  id.parse(ipId);
  current(generation, signal);
  const read = async (language: string) => {
    const value = z.object({ ip: episodeSnapshotSchema }).parse(
      await api.get(`/ip-commerce/me/ips/${ipId}`, {
        service: "aurora",
        signal,
        retry: false,
        params: { locale: language },
      })
    ).ip;
    current(generation, signal);
    if (value.id !== ipId) throw new Error("Episode list identity mismatch.");
    return value;
  };
  const language = getLocale(),
    first = await read(language);
  if (first.sourceLocale === language) return first;
  const source = await read(first.sourceLocale);
  if (source.sourceLocale !== first.sourceLocale)
    throw new Error("IP source language changed. Refresh before editing episodes.");
  return source;
}
export function episodeMatches(value: AuthorEpisode, fields: z.infer<typeof episodeFields>) {
  return (
    value.title === fields.title &&
    (value.summary ?? "") === fields.summary &&
    value.durationSeconds === fields.durationSeconds &&
    value.isFreePreview === fields.isFreePreview &&
    (!fields.status || value.status === fields.status)
  );
}
export async function mutateAuthorEpisode(
  ipId: string,
  generation: number,
  input: EpisodeCommand,
  signal: AbortSignal
) {
  const command = episodeCommand.parse(input),
    latest = await fetchAuthorEpisodes(ipId, generation, signal);
  if (latest.sourceLocale !== command.sourceLocale)
    throw new ApiRequestError(
      "IP_VERSION_CONFLICT",
      "IP source language changed. Refresh before editing episodes.",
      409
    );
  const target = latest.episodes.find((item) => item.id === command.episodeId);
  if (command.action === "delete" && !target) return latest;
  if (
    command.action === "edit" &&
    target &&
    latest.version > command.expectedVersion &&
    episodeMatches(target, command.data)
  )
    return latest;
  if (latest.version !== command.expectedVersion)
    throw new ApiRequestError(
      "IP_VERSION_CONFLICT",
      "This IP changed. Refresh the episode list and review your change.",
      409
    );
  if (!target) throw new ApiRequestError("IP_EPISODE_NOT_FOUND", "Episode no longer exists.", 404);
  current(generation, signal);
  const path = `/ip-commerce/me/ips/${ipId}/episodes/${command.episodeId}`;
  const options = { service: "aurora" as const, signal, retry: false, timeout: 120000 };
  const response =
    command.action === "delete"
      ? await api.delete(path, options)
      : await api.put(path, {
          ...options,
          data: { ...command.data, expectedVersion: command.expectedVersion },
        });
  current(generation, signal);
  const saved = z.object({ ip: episodeSnapshotSchema }).parse(response).ip;
  const updated = saved.episodes.find((item) => item.id === command.episodeId);
  if (
    saved.id !== ipId ||
    saved.sourceLocale !== command.sourceLocale ||
    saved.version <= command.expectedVersion ||
    (command.action === "delete" ? !!updated : !updated || !episodeMatches(updated, command.data))
  )
    throw new Error("Episode save receipt mismatch. Retry to check the saved result.");
  return saved;
}
