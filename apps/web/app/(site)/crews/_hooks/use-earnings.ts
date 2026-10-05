"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";

import { useCurrentUser } from "@/src/hooks/use-user";
import { CREW_CURRENCY, type CrewLedgerCurrency } from "@/src/lib/crew-money";
import { crewApi } from "./api";
import { crewKeys } from "./shared";
import type {
  CrewEarningEntryDTO,
  CrewEarningDetailDTO,
  CrewEarningPageDTO,
  CrewEarningSourceType,
  CrewEarningStatus,
} from "./types";

export type PersonalEarningFilters = {
  status?: CrewEarningStatus;
  sourceType?: CrewEarningSourceType;
  recordedFrom?: string;
  recordedThrough?: string;
};

export function useMyCrewEarnings(
  currency: CrewLedgerCurrency,
  crewId?: string,
  filters: PersonalEarningFilters = {}
) {
  const { user } = useCurrentUser();
  return useInfiniteQuery({
    queryKey: [
      "crew-personal-earnings",
      user?.id ?? null,
      currency,
      ...(crewId ? [crewId] : []),
      ...(Object.keys(filters).length ? [filters] : []),
    ],
    enabled: Boolean(user?.id),
    refetchInterval: 60_000,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      crewApi.get<CrewEarningPageDTO>("/me/crew-earnings", {
        signal,
        cache: "no-store",
        query: {
          currency,
          cursor: pageParam,
          limit: 50,
          ...(crewId ? { crewId } : {}),
          ...filters,
        },
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

export function useCrewEarningDetail(earningId: string | null) {
  const { user } = useCurrentUser();
  return useQuery({
    queryKey: [...crewKeys.earning(earningId ?? ""), user?.id ?? null],
    enabled: Boolean(earningId) && Boolean(user),
    queryFn: ({ signal }) =>
      crewApi.get<CrewEarningDetailDTO>(`/crew-earnings/${encodeURIComponent(earningId!)}`, {
        signal,
        cache: "no-store",
      }),
  });
}

export function useCrewEarnings(
  crewId: string,
  input: {
    currency: CrewLedgerCurrency;
    scope: "mine" | "crew";
    status?: CrewEarningStatus;
    sourceType?: CrewEarningSourceType;
  },
  enabled = true
) {
  const { user } = useCurrentUser();
  const result = useInfiniteQuery({
    queryKey: [
      ...crewKeys.earnings(crewId, input.scope),
      input.status ?? "all",
      input.sourceType ?? "all",
      input.currency,
      user?.id ?? null,
    ],
    enabled: enabled && Boolean(crewId) && Boolean(user),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      crewApi.get<CrewEarningPageDTO>(`/crews/${encodeURIComponent(crewId)}/earnings`, {
        signal,
        cache: "no-store",
        query: {
          currency: input.currency,
          scope: input.scope,
          status: input.status,
          sourceType: input.sourceType,
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

export function useCreateCrewEarning(crewId: string) {
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();
  return useMutation({
    onMutate: () => ({ accountUserId: user?.id ?? null }),
    mutationFn: (input: {
      crewMemberId: string;
      sourceType: Exclude<CrewEarningSourceType, "task_reward">;
      agreementId?: string;
      title: string;
      description?: string;
      amountMinor: string;
      idempotencyKey: string;
    }) =>
      crewApi.post<CrewEarningEntryDTO>(`/crews/${encodeURIComponent(crewId)}/earnings`, {
        body: { ...input, currency: CREW_CURRENCY },
      }),
    onSuccess: (_earning, _input, context) =>
      invalidateEarnings(queryClient, crewId, context?.accountUserId),
  });
}

export function useApproveCrewEarning(crewId: string) {
  return useEarningDecision(crewId, "approve");
}

export function useRejectCrewEarning(crewId: string) {
  return useEarningDecision(crewId, "reject");
}

export function useReverseCrewEarning(crewId: string) {
  return useEarningDecision(crewId, "reverse");
}

function useEarningDecision(crewId: string, action: "approve" | "reject" | "reverse") {
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();
  return useMutation({
    mutationFn: (input: { earningId: string; expectedVersion: number; reason?: string }) =>
      crewApi.post<CrewEarningEntryDTO>(
        `/crew-earnings/${encodeURIComponent(input.earningId)}/${action}`,
        { body: { expectedVersion: input.expectedVersion, reason: input.reason } }
      ),
    onMutate: async () => {
      const accountUserId = user?.id ?? null;
      await queryClient.cancelQueries(earningQueries(crewId, accountUserId));
      return { accountUserId };
    },
    onSuccess: (earning, _input, context) => {
      if (!context?.accountUserId) return;
      queryClient.setQueryData(
        [...crewKeys.earning(earning.id), context.accountUserId],
        (current: unknown) =>
          current && typeof current === "object" ? { ...current, ...earning } : current
      );
      // Apply only confirmed entries: restoring whole optimistic snapshots can
      // erase other decisions that completed while this request was pending.
      for (const [key, current] of queryClient.getQueriesData<InfiniteData<CrewEarningPageDTO>>(
        earningQueries(crewId, context.accountUserId)
      )) {
        if (!current) continue;
        const statusFilter = earningStatusFilter(key[4]);
        queryClient.setQueryData(key, {
          ...current,
          pages: current.pages.map((page) => ({
            ...page,
            items: page.items.flatMap((item) => {
              if (item.id !== earning.id) return [item];
              return statusFilter && statusFilter !== earning.status ? [] : [earning];
            }),
          })),
        });
      }
    },
    onSettled: (_data, _error, input, context) =>
      Promise.all([
        invalidateEarnings(queryClient, crewId, context?.accountUserId),
        queryClient.invalidateQueries({
          queryKey: [...crewKeys.earning(input.earningId), context?.accountUserId ?? null],
          exact: true,
        }),
      ]),
  });
}

function earningStatusFilter(value: unknown): CrewEarningStatus | undefined {
  return value === "pending" || value === "posted" || value === "rejected" || value === "reversed"
    ? value
    : undefined;
}

function earningQueries(crewId: string, accountUserId?: string | null) {
  return {
    queryKey: ["crew", "earnings", crewId],
    predicate: (query: { queryKey: readonly unknown[] }) =>
      Boolean(accountUserId) && query.queryKey.at(-1) === accountUserId,
  };
}

function invalidateEarnings(
  queryClient: ReturnType<typeof useQueryClient>,
  crewId: string,
  accountUserId?: string | null
) {
  return Promise.all([
    queryClient.invalidateQueries(earningQueries(crewId, accountUserId)),
    queryClient.invalidateQueries({
      ...earningQueries(crewId, accountUserId),
      queryKey: ["crew", "payouts", crewId],
    }),
  ]);
}
