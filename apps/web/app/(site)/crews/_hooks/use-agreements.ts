"use client";

import { useMemo } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "@/src/hooks/use-user";
import { crewApi } from "./api";
import { crewKeys } from "./shared";
import type {
  CreateCrewAgreementInput,
  CrewAgreementDTO,
  CrewAgreementSigningSession,
  CrewAgreementsResponse,
  CrewAgreementView,
} from "./types";

export function useCrewAgreements(
  crewId: string,
  enabled = true,
  view: CrewAgreementView = "all",
  pageSize = 30
) {
  const { user } = useCurrentUser();
  const query = useInfiniteQuery({
    queryKey: [...crewKeys.agreements(crewId), view, pageSize, user?.id ?? null] as const,
    enabled: enabled && !!crewId && Boolean(user),
    queryFn: ({ pageParam }) =>
      crewApi.get<CrewAgreementsResponse>(`/crews/${encodeURIComponent(crewId)}/agreements`, {
        query: { limit: pageSize, cursor: pageParam, view },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    refetchInterval: (result) =>
      result.state.data?.pages.some((page) =>
        page.items.some(
          (agreement) =>
            agreement.delivery.status === "pending" ||
            agreement.delivery.status === "processing" ||
            agreement.archive.status === "pending" ||
            agreement.archive.status === "processing"
        )
      )
        ? 3_000
        : false,
  });
  const items = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data]);
  const firstPage = query.data?.pages[0];
  const data = firstPage ? { ...firstPage, items } : undefined;
  return { ...query, data };
}

export function useCreateCrewAgreement(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCrewAgreementInput) =>
      crewApi.post<CrewAgreementDTO>(`/crews/${encodeURIComponent(crewId)}/agreements`, {
        body: input,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: crewKeys.agreements(crewId) }),
  });
}

export function useSyncCrewAgreement(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agreementId: string) =>
      crewApi.post<CrewAgreementDTO>(`/crew-agreements/${encodeURIComponent(agreementId)}/sync`),
    onSuccess: () => qc.invalidateQueries({ queryKey: crewKeys.agreements(crewId) }),
  });
}

export function useRetryCrewAgreementArchive(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agreementId: string) =>
      crewApi.post<CrewAgreementDTO>(
        `/crew-agreements/${encodeURIComponent(agreementId)}/archive/retry`
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: crewKeys.agreements(crewId) }),
  });
}

export function useRetryCrewAgreementSend(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agreementId: string) =>
      crewApi.post<CrewAgreementDTO>(
        `/crew-agreements/${encodeURIComponent(agreementId)}/send/retry`
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: crewKeys.agreements(crewId) }),
  });
}

export function useCreateCrewAgreementSigningSession() {
  return useMutation({
    mutationFn: (agreementId: string) =>
      crewApi.post<CrewAgreementSigningSession>(
        `/crew-agreements/${encodeURIComponent(agreementId)}/signing-session`
      ),
  });
}
