import { z } from "zod";

const TvEntrySchema = z
  .object({
    ip: z.uuid().optional(),
    episode: z.uuid().optional(),
  })
  .refine((value) => !value.episode || Boolean(value.ip), "An episode requires its IP");

export function parseTvEntry(params: Record<string, string | string[] | undefined>) {
  return TvEntrySchema.safeParse({ ip: params.ip, episode: params.episode });
}

export function tvEntryPath(ipId: string, episodeId?: string | null): string {
  const entry = TvEntrySchema.parse({ ip: ipId, episode: episodeId ?? undefined });
  const params = new URLSearchParams({ ip: entry.ip! });
  if (entry.episode) params.set("episode", entry.episode);
  return `/tv?${params}`;
}
