"use client";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ApiRequestError } from "@/src/lib/api";
export type CreatorReview = {
  id: string;
  authorUserId: string;
  direction: "creator" | "manager";
  ratings: Record<string, string | number>;
  comment: string;
  scoreMilli: number;
  timelinessScore: number | null;
  createdAt: string;
};
export type CreatorReviewPage = {
  summary: {
    creator: { count: number; average: number | null };
    manager: { count: number; average: number | null };
    total: number;
    average: number | null;
    histogram: number[];
  };
  items: CreatorReview[];
  nextCursor: string | null;
};
export async function fetchCreatorReviews(
  creatorId: string,
  cursor: string | undefined,
  signal: AbortSignal
): Promise<CreatorReviewPage> {
  const query = new URLSearchParams({ limit: "20" });
  if (cursor) query.set("cursor", cursor);
  const response = await fetch(
    `/aurora/creator-profiles/${encodeURIComponent(creatorId)}/reviews?${query}`,
    { signal, credentials: "omit", cache: "no-store" }
  );
  if (!response.ok) {
    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* Preserve proxy error text. */
    }
    const message =
      body && typeof body === "object" && "message" in body && typeof body.message === "string"
        ? body.message
        : text.trim() || `HTTP ${response.status}`;
    throw new ApiRequestError(`HTTP_${response.status}`, message, response.status, text);
  }
  // This Nest endpoint returns a page directly, without a Java success envelope.
  return response.json();
}
export function useCreatorReviews(creatorId: string) {
  return useInfiniteQuery({
    queryKey: ["creator-profile-reviews", creatorId],
    initialPageParam: undefined as string | undefined,
    retry: false,
    queryFn: ({ pageParam, signal }) => fetchCreatorReviews(creatorId, pageParam, signal),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}
