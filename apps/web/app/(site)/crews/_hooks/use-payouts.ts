"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useCurrentUser } from "@/src/hooks/use-user";
import { type CrewLedgerCurrency } from "@/src/lib/crew-money";
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
    currency: CrewLedgerCurrency;
    scope: "mine" | "crew";
    status?: CrewPayoutStatus;
  },
  enabled = true
) {
  const { user } = useCurrentUser();
  const result = useInfiniteQuery({
    queryKey: [
      ...crewKeys.payouts(crewId, input.scope),
      input.status ?? "all",
      input.currency,
      user?.id ?? null,
    ],
    enabled: enabled && Boolean(crewId) && Boolean(user),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      crewApi.get<CrewPayoutPageDTO>(`/crews/${encodeURIComponent(crewId)}/payouts`, {
        query: {
          currency: input.currency,
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
  const { user } = useCurrentUser();
  return useQuery({
    queryKey: [...crewKeys.payout(payoutId ?? ""), user?.id ?? null],
    enabled: Boolean(payoutId) && Boolean(user),
    queryFn: () =>
      crewApi.get<CrewPayoutDetailDTO>(`/crew-payouts/${encodeURIComponent(payoutId!)}`),
  });
}

export function useCreateCrewPayout(crewId: string) {
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();
  return useMutation({
    onMutate: () => ({ accountUserId: user?.id ?? null }),
    mutationFn: (input: {
      currency: CrewLedgerCurrency;
      crewMemberId: string;
      amountMinor: string;
      withholdingAmountMinor?: string;
      note?: string;
      idempotencyKey: string;
    }) =>
      crewApi.post<CrewPayoutDTO>(`/crews/${encodeURIComponent(crewId)}/payouts`, {
        body: input,
      }),
    onSuccess: (_payout, _input, context) =>
      invalidatePayouts(queryClient, crewId, context?.accountUserId),
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
  const { user } = useCurrentUser();
  return useMutation({
    onMutate: () => ({ accountUserId: user?.id ?? null }),
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
    onSuccess: (payout, _input, context) => {
      if (!context?.accountUserId) return;
      queryClient.setQueryData(
        [...crewKeys.payout(payout.id), context.accountUserId],
        (current: unknown) =>
          current && typeof current === "object" ? { ...current, ...payout } : current
      );
    },
    onSettled: (_data, _error, input, context) =>
      Promise.all([
        invalidatePayouts(queryClient, crewId, context?.accountUserId),
        queryClient.invalidateQueries({
          queryKey: [...crewKeys.payout(input.payoutId), context?.accountUserId ?? null],
          exact: true,
        }),
      ]),
  });
}

function invalidatePayouts(
  queryClient: ReturnType<typeof useQueryClient>,
  crewId: string,
  accountUserId?: string | null
) {
  return queryClient.invalidateQueries({
    queryKey: ["crew", "payouts", crewId],
    predicate: (query) => Boolean(accountUserId) && query.queryKey.at(-1) === accountUserId,
  });
}
