"use client";
import { useInfiniteQuery } from "@tanstack/react-query";
import { crewApi } from "./api";
import type { ApplicationTerms } from "./use-application-terms";
export type AmendmentProposal = Omit<ApplicationTerms, "version" | "confirmedAt"> & {
  id: string;
  expectedVersion: number;
  expectedTaskVersion: number;
  reason: string;
};
export type ApplicationAmendment = {
  id: string;
  applicationId: string;
  taskId: string;
  proposedByUserId: string;
  applicantId: string;
  proposal: AmendmentProposal;
  status:
    | "pending"
    | "effective"
    | "awaiting_settlement"
    | "settlement_requested"
    | "rejected"
    | "withdrawn";
  confirmedAt: string | null;
  settledByUserId: string | null;
  settledAt: string | null;
};
export function useApplicationAmendments(applicationId: string, userId: string) {
  return useInfiniteQuery({
    queryKey: ["crew-application-amendments", applicationId, userId],
    retry: false,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      crewApi.get<{ items: ApplicationAmendment[]; nextCursor: string | null }>(
        `/applications/${encodeURIComponent(applicationId)}/amendments`,
        { signal, cache: "no-store", query: { limit: 20, cursor: pageParam } }
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}
