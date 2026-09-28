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
    queryFn: ({ pageParam, signal }) =>
      crewApi.get<CrewAgreementsResponse>(`/crews/${encodeURIComponent(crewId)}/agreements`, {
        signal,
        cache: "no-store",
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

function useMutationRefresh(crewId: string) {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  const context = { crewId, accountUserId: user?.id ?? null };
  return {
    onMutate: () => context,
    onSuccess: (_data: unknown, _variables: unknown, origin: typeof context | undefined) => {
      if (!origin?.accountUserId) return;
      return qc.invalidateQueries({
        queryKey: crewKeys.agreements(origin.crewId),
        predicate: (query) => query.queryKey.at(-1) === origin.accountUserId,
      });
    },
  };
}

export function useCreateCrewAgreement(crewId: string) {
  const refresh = useMutationRefresh(crewId);
  return useMutation({
    ...refresh,
    mutationFn: (input: CreateCrewAgreementInput) =>
      crewApi.post<CrewAgreementDTO>(`/crews/${encodeURIComponent(crewId)}/agreements`, {
        body: input,
      }),
  });
}

export function useSyncCrewAgreement(crewId: string) {
  const refresh = useMutationRefresh(crewId);
  return useMutation({
    ...refresh,
    mutationFn: (agreementId: string) =>
      crewApi.post<CrewAgreementDTO>(`/crew-agreements/${encodeURIComponent(agreementId)}/sync`),
  });
}

export function useRetryCrewAgreementArchive(crewId: string) {
  const refresh = useMutationRefresh(crewId);
  return useMutation({
    ...refresh,
    mutationFn: (agreementId: string) =>
      crewApi.post<CrewAgreementDTO>(
        `/crew-agreements/${encodeURIComponent(agreementId)}/archive/retry`
      ),
  });
}

export function useRetryCrewAgreementSend(crewId: string) {
  const refresh = useMutationRefresh(crewId);
  return useMutation({
    ...refresh,
    mutationFn: (agreementId: string) =>
      crewApi.post<CrewAgreementDTO>(
        `/crew-agreements/${encodeURIComponent(agreementId)}/send/retry`
      ),
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
