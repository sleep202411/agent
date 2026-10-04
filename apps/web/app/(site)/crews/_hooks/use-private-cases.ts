"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { crewApi } from "./api";
export type PrivateCase = {
  id: string;
  taskId: string;
  openedByUserId: string;
  respondentUserId: string;
  title: string;
  status: "open" | "in_review" | "resolved" | "appealed";
  ownerAdminId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};
export type PrivateCaseHistory = PrivateCase & {
  events: Array<{
    id: string;
    version: number;
    actorId: string;
    actorKind: string;
    action: string;
    message: string;
    submissionIds: string[];
    attachmentIds: string[];
    createdAt: string;
  }>;
  nextBeforeVersion: number | null;
};
export function isCaseParticipant(item: PrivateCase, userId: string) {
  return item.openedByUserId === userId || item.respondentUserId === userId;
}
export function usePrivateCases(userId: string, view: "all" | "initiated" | "responses" = "all") {
  return useInfiniteQuery({
    queryKey: ["crew-cases", userId, "list", view],
    retry: false,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      crewApi.get<{ items: PrivateCase[]; nextBeforeId: string | null }>("/crew-disputes", {
        signal,
        cache: "no-store",
        query: { limit: 20, beforeId: pageParam, view },
      }),
    getNextPageParam: (page) => page.nextBeforeId ?? undefined,
  });
}
export function usePrivateCaseHistory(userId: string, caseId: string) {
  return useInfiniteQuery({
    queryKey: ["crew-cases", userId, "detail", caseId],
    retry: false,
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam, signal }) =>
      crewApi.get<PrivateCaseHistory>(`/crew-disputes/${encodeURIComponent(caseId)}`, {
        signal,
        cache: "no-store",
        query: { limit: 20, beforeVersion: pageParam },
      }),
    getNextPageParam: (page) => page.nextBeforeVersion ?? undefined,
  });
}
