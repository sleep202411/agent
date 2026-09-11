"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryKey,
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

export function useCrewEarningDetail(earningId: string | null) {
  const { user } = useCurrentUser();
  return useQuery({
    queryKey: [...crewKeys.earning(earningId ?? ""), user?.id ?? null],
    enabled: Boolean(earningId) && Boolean(user),
    queryFn: () =>
      crewApi.get<CrewEarningDetailDTO>(`/crew-earnings/${encodeURIComponent(earningId!)}`),
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
    queryFn: ({ pageParam }) =>
      crewApi.get<CrewEarningPageDTO>(`/crews/${encodeURIComponent(crewId)}/earnings`, {
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
  return useEarningDecision(crewId, "approve", "posted");
}

export function useRejectCrewEarning(crewId: string) {
  return useEarningDecision(crewId, "reject", "rejected");
}

export function useReverseCrewEarning(crewId: string) {
  return useEarningDecision(crewId, "reverse", "reversed");
}

function useEarningDecision(
  crewId: string,
  action: "approve" | "reject" | "reverse",
  optimisticStatus: CrewEarningStatus
) {
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();
  return useMutation({
    mutationFn: (input: { earningId: string; expectedVersion: number; reason?: string }) =>
      crewApi.post<CrewEarningEntryDTO>(
        `/crew-earnings/${encodeURIComponent(input.earningId)}/${action}`,
        { body: { expectedVersion: input.expectedVersion, reason: input.reason } }
      ),
    onMutate: async (input) => {
      const accountUserId = user?.id ?? null;
      const filter = earningQueries(crewId, accountUserId);
      await queryClient.cancelQueries(filter);
      const snapshots = queryClient.getQueriesData<InfiniteData<CrewEarningPageDTO>>({
        ...filter,
      });
      const now = new Date().toISOString();
      for (const [key, current] of snapshots) {
        if (!current) continue;
        const statusFilter = earningStatusFilter(key[4]);
        queryClient.setQueryData(
          key,
          optimisticDecision(
            current,
            input.earningId,
            optimisticStatus,
            input.reason,
            now,
            statusFilter
          )
        );
      }
      return { snapshots, accountUserId };
    },
    onError: (_error, _input, context) => {
      for (const [key, value] of context?.snapshots ?? []) {
        queryClient.setQueryData(key as QueryKey, value);
      }
    },
    onSuccess: (earning, _input, context) => {
      if (!context?.accountUserId) return;
      queryClient.setQueryData(
        [...crewKeys.earning(earning.id), context.accountUserId],
        (current: unknown) =>
          current && typeof current === "object" ? { ...current, ...earning } : current
      );
      queryClient.setQueriesData<InfiniteData<CrewEarningPageDTO>>(
        earningQueries(crewId, context.accountUserId),
        (current) =>
          current
            ? {
                ...current,
                pages: current.pages.map((page) => ({
                  ...page,
                  items: page.items.map((item) => (item.id === earning.id ? earning : item)),
                })),
              }
            : current
      );
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

function optimisticDecision(
  current: InfiniteData<CrewEarningPageDTO>,
  earningId: string,
  status: CrewEarningStatus,
  reason: string | undefined,
  now: string,
  statusFilter: CrewEarningStatus | undefined
): InfiniteData<CrewEarningPageDTO> {
  const before = current.pages.flatMap((page) => page.items).find((item) => item.id === earningId);
  if (!before || before.status === status) return current;
  const summary = optimisticSummary(current.pages[0]?.summary, before, status, now);
  return {
    ...current,
    pages: current.pages.map((page) => ({
      ...page,
      summary: summary ?? page.summary,
      items: page.items.flatMap((item) => {
        if (item.id !== earningId) return [item];
        if (statusFilter && statusFilter !== status) return [];
        return [optimisticEarning(item, status, reason, now)];
      }),
    })),
  };
}

function earningStatusFilter(value: unknown): CrewEarningStatus | undefined {
  return value === "pending" || value === "posted" || value === "rejected" || value === "reversed"
    ? value
    : undefined;
}

function optimisticSummary(
  summary: CrewEarningPageDTO["summary"] | undefined,
  earning: CrewEarningEntryDTO,
  nextStatus: CrewEarningStatus,
  now: string
): CrewEarningPageDTO["summary"] | undefined {
  if (!summary) return undefined;
  const amount = BigInt(earning.amountMinor);
  const byStatus = Object.fromEntries(
    Object.entries(summary.byStatus).map(([status, value]) => [status, { ...value }])
  ) as CrewEarningPageDTO["summary"]["byStatus"];
  byStatus[earning.status].count -= 1;
  byStatus[earning.status].amountMinor = (
    BigInt(byStatus[earning.status].amountMinor) - amount
  ).toString();
  byStatus[nextStatus].count += 1;
  byStatus[nextStatus].amountMinor = (BigInt(byStatus[nextStatus].amountMinor) + amount).toString();

  let postedThisMonth = BigInt(summary.postedThisMonthAmountMinor);
  if (earning.status === "pending" && nextStatus === "posted") {
    postedThisMonth += amount;
  } else if (
    earning.status === "posted" &&
    nextStatus === "reversed" &&
    earning.postedAt &&
    isSameUtcMonth(earning.postedAt, now)
  ) {
    postedThisMonth -= amount;
  }

  const postedBySource = summary.postedBySource.map((group) => ({ ...group }));
  const sourceIndex = postedBySource.findIndex((group) => group.sourceType === earning.sourceType);
  if (earning.status === "pending" && nextStatus === "posted") {
    if (sourceIndex >= 0) {
      const group = postedBySource[sourceIndex];
      if (group) {
        group.count += 1;
        group.amountMinor = (BigInt(group.amountMinor) + amount).toString();
      }
    } else {
      postedBySource.push({
        sourceType: earning.sourceType,
        count: 1,
        amountMinor: amount.toString(),
      });
    }
  } else if (earning.status === "posted" && nextStatus === "reversed" && sourceIndex >= 0) {
    const group = postedBySource[sourceIndex];
    if (group) {
      group.count -= 1;
      group.amountMinor = (BigInt(group.amountMinor) - amount).toString();
      if (group.count === 0) postedBySource.splice(sourceIndex, 1);
    }
  }

  return {
    ...summary,
    byStatus,
    postedThisMonthAmountMinor: postedThisMonth.toString(),
    postedBySource,
  };
}

function isSameUtcMonth(left: string, right: string) {
  const a = new Date(left);
  const b = new Date(right);
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth();
}

function optimisticEarning(
  item: CrewEarningEntryDTO,
  status: CrewEarningStatus,
  reason: string | undefined,
  now: string
): CrewEarningEntryDTO {
  return {
    ...item,
    status,
    version: item.version + 1,
    postedAt: status === "posted" ? now : item.postedAt,
    rejectedAt: status === "rejected" ? now : item.rejectedAt,
    reversedAt: status === "reversed" ? now : item.reversedAt,
    rejectionReason: status === "rejected" ? (reason ?? null) : item.rejectionReason,
    reversalReason: status === "reversed" ? (reason ?? null) : item.reversalReason,
    updatedAt: now,
  };
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
