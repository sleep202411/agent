"use client";
import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "@/src/lib/api";
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
export function useCreatorReviews(creatorId: string) {
  return useInfiniteQuery({
    queryKey: ["creator-profile-reviews", creatorId],
    initialPageParam: undefined as string | undefined,
    retry: false,
    queryFn: ({ pageParam, signal }) =>
      api.get<CreatorReviewPage>(
        `/aurora/creator-profiles/${encodeURIComponent(creatorId)}/reviews`,
        {
          signal,
          credentials: "omit",
          params: { limit: 20, cursor: pageParam },
        }
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}
