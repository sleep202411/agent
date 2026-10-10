import { z } from "zod";
import { api } from "@/lib/api-client";

const average = z.number().min(1).max(5).nullable();
const group = z.object({ count: z.number().int().nonnegative(), average });
const pageSchema = z.object({
  summary: z.object({
    creator: group,
    manager: group,
    total: z.number().int().nonnegative(),
    average,
    histogram: z.array(z.number().int().nonnegative()).length(5),
  }),
  items: z.array(
    z.object({
      id: z.string().uuid(),
      authorUserId: z.string().min(1),
      direction: z.enum(["creator", "manager"]),
      comment: z.string(),
      scoreMilli: z.number().int().min(1000).max(5000),
      timelinessScore: z.number().min(1).max(5).nullable(),
      createdAt: z.string().datetime({ offset: true }),
    })
  ),
  nextCursor: z.string().min(1).nullable(),
});
export type CreatorReviewPage = z.infer<typeof pageSchema>;
export async function fetchCreatorReviews(
  creatorId: string,
  cursor: string | null,
  signal: AbortSignal
): Promise<CreatorReviewPage> {
  if (!creatorId.trim()) throw new Error("Creator is required");
  return pageSchema.parse(
    await api.get(`/creator-profiles/${encodeURIComponent(creatorId)}/reviews`, {
      service: "aurora",
      credentials: "omit",
      retry: false,
      signal,
      params: { limit: 20, ...(cursor ? { cursor } : {}) },
    })
  );
}
