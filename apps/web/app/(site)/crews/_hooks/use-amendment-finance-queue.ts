"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { crewApi } from "./api";
import type { ApplicationAmendment } from "./use-application-amendments";

export type AmendmentQueueStatus = "awaiting_settlement" | "settlement_requested";
export const amendmentFinanceKey = (crewId: string, status: AmendmentQueueStatus, userId: string) =>
  ["crew-amendment-finance", crewId, status, userId] as const;

export function useAmendmentFinanceQueue(
  crewId: string,
  status: AmendmentQueueStatus,
  userId: string,
  enabled: boolean
) {
  return useInfiniteQuery({
    queryKey: amendmentFinanceKey(crewId, status, userId),
    enabled,
    retry: false,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      crewApi.get<{ items: ApplicationAmendment[]; nextCursor: string | null }>(
        `/crews/${encodeURIComponent(crewId)}/application-amendments`,
        { signal, cache: "no-store", query: { status, limit: 20, cursor: pageParam } }
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}
