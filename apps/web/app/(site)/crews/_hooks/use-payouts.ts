"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { crewApi } from "./api";
import { crewKeys } from "./shared";
import type {
  CrewPayoutDetailDTO,
  CrewPayoutDTO,
  CrewPayoutMethod,
  CrewPayoutPageDTO,
  CrewPayoutStatus,
} from "./types";

export function useCrewPayouts(
  crewId: string,
  input: {
    scope: "mine" | "crew";
    status?: CrewPayoutStatus;
  },
  enabled = true
) {
  const result = useInfiniteQuery({
    queryKey: [...crewKeys.payouts(crewId, input.scope), input.status ?? "all"],
    enabled: enabled && Boolean(crewId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      crewApi.get<CrewPayoutPageDTO>(`/crews/${encodeURIComponent(crewId)}/payouts`, {
        query: {
          scope: input.scope,
          status: input.status,
          cursor: pageParam,
          limit: 50,
        },
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  return {
    ...result,
    data: result.data?.pages.flatMap((page) => page.items) ?? [],
    summary: result.data?.pages[0]?.summary,
  };
}

export function useCrewPayoutDetail(payoutId: string | null) {
  return useQuery({
    queryKey: crewKeys.payout(payoutId ?? ""),
    enabled: Boolean(payoutId),
    queryFn: () =>
      crewApi.get<CrewPayoutDetailDTO>(`/crew-payouts/${encodeURIComponent(payoutId!)}`),
  });
}

export function useCreateCrewPayout(crewId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      crewMemberId: string;
      pointsAmount: string;
      withholdingAmountMinor?: string;
      note?: string;
      idempotencyKey: string;
    }) =>
      crewApi.post<CrewPayoutDTO>(`/crews/${encodeURIComponent(crewId)}/payouts`, {
        body: input,
      }),
    onSuccess: () => invalidatePayouts(queryClient, crewId),
  });
}

export function usePayCrewPayout(crewId: string) {
  return usePayoutTransition(crewId, "pay");
}

export function useVoidCrewPayout(crewId: string) {
  return usePayoutTransition(crewId, "void");
}

function usePayoutTransition(crewId: string, action: "pay" | "void") {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      payoutId: string;
      expectedVersion: number;
      paymentMethod?: CrewPayoutMethod;
      paymentReference?: string;
      paymentProofUrl?: string;
      reason?: string;
    }) =>
      crewApi.post<CrewPayoutDTO>(`/crew-payouts/${encodeURIComponent(input.payoutId)}/${action}`, {
        body: {
          expectedVersion: input.expectedVersion,
          paymentMethod: input.paymentMethod,
          paymentReference: input.paymentReference,
          paymentProofUrl: input.paymentProofUrl,
          reason: input.reason,
        },
      }),
    onSuccess: (payout) => {
      queryClient.setQueryData(crewKeys.payout(payout.id), (current: unknown) =>
        current && typeof current === "object" ? { ...current, ...payout } : current
      );
    },
    onSettled: () => invalidatePayouts(queryClient, crewId),
  });
}

function invalidatePayouts(queryClient: ReturnType<typeof useQueryClient>, crewId: string) {
  return queryClient.invalidateQueries({ queryKey: ["crew", "payouts", crewId] });
}
