import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { loadPublishedInteractiveFilm } from "@/data/interactive-film-api";
import { fetchLatestSave } from "@/features/experience-player/lib/story-save-channel";
import { clearStorySaveSlots } from "@/features/experience-player/lib/story-save-resolution";
const mediaUrl = z
  .string()
  .url()
  .refine((v) => ["https:", "http:"].includes(new URL(v).protocol));
const listingSchema = z.object({
  gameId: z.string().min(1),
  title: z.string().min(1),
  defaultLocale: z.string().min(1),
  description: z.string().trim().max(13000),
  tags: z.array(z.string()),
  developer: z.string(),
  trailerUrl: mediaUrl.nullable(),
  coverUrl: mediaUrl.nullable(),
  screenshots: z.array(z.object({ url: mediaUrl })),
});
export type FilmStoreListing = z.infer<typeof listingSchema>;
export async function fetchFilmStoreListing(
  gameId: string,
  signal: AbortSignal
): Promise<FilmStoreListing | null> {
  const value = await api.get<unknown>(`/story-store/${encodeURIComponent(gameId)}`, {
    service: "aurora",
    signal,
    retry: false,
    credentials: "omit",
    cache: "no-store",
  });
  signal.throwIfAborted();
  if (value === null) return null;
  const parsed = listingSchema.safeParse(value);
  if (!parsed.success || parsed.data.gameId !== gameId)
    throw Error("The public film introduction does not match this work or has an invalid format.");
  return parsed.data;
}
/** Clear the first and most recently played slots before navigating to a fresh run. */
export async function restartPublishedFilm(
  accountId: string,
  generation: number,
  gameId: string,
  signal: AbortSignal
) {
  const current = () => {
    signal.throwIfAborted();
    if (getAuthGeneration() !== generation)
      throw new DOMException("Save session changed", "AbortError");
  };
  current();
  const release = await loadPublishedInteractiveFilm(gameId, { signal });
  current();
  const latest = await fetchLatestSave(accountId, gameId, signal);
  current();
  await clearStorySaveSlots({
    accountId,
    gameId,
    chapterIds: [release.activeChapterId ?? "", ...(latest ? [latest.chapterId] : [])],
    signal,
  });
  current();
  return release.activeChapterId ?? undefined;
}
