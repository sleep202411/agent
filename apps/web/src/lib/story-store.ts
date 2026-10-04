import { api } from "@/src/lib/api/api-client";
import { z } from "zod";

/**
 * Public introduction captured with the interactive film's release. A null
 * response means no public introduction; catalogue metadata still remains
 * usable. Transport and contract failures stay visible to the caller.
 */

const publicMediaUrl = z.url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "https:" || protocol === "http:";
});

const StoreListingSchema = z.object({
  gameId: z.string().min(1),
  title: z.string().min(1),
  defaultLocale: z.string().min(1),
  description: z.string().trim().max(13_000),
  tags: z.array(z.string()),
  developer: z.string(),
  trailerUrl: publicMediaUrl.nullable(),
  coverUrl: publicMediaUrl.nullable(),
  screenshots: z.array(z.object({ url: publicMediaUrl })),
});

export type StoreListing = z.infer<typeof StoreListingSchema>;

export async function fetchStoreListing(
  gameId: string,
  signal?: AbortSignal
): Promise<StoreListing | null> {
  const value = await api.get<unknown>(`/aurora/story-store/${encodeURIComponent(gameId)}`, {
    cache: "no-store",
    signal,
  });
  if (value === null) return null;
  const listing = StoreListingSchema.safeParse(value);
  if (!listing.success || listing.data.gameId !== gameId) {
    throw new Error(
      "The public film introduction does not match this work or has an invalid format."
    );
  }
  return listing.data;
}
