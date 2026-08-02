"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryKey,
} from "@tanstack/react-query";

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
  return useQuery({
    queryKey: crewKeys.earning(earningId ?? ""),
    enabled: Boolean(earningId),
    queryFn: () =>
      crewApi.get<CrewEarningDetailDTO>(`/crew-earnings/${encodeURIComponent(earningId!)}`),
  });
}

export function useCrewEarnings(
  crewId: string,
  input: {
    scope: "mine" | "crew";
    status?: CrewEarningStatus;
    sourceType?: CrewEarningSourceType;
  },
  enabled = true
) {
  const result = useInfiniteQuery({
    queryKey: [
      ...crewKeys.earnings(crewId, input.scope),
      input.status ?? "all",
      input.sourceType ?? "all",
    ],
    enabled: enabled && Boolean(crewId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      crewApi.get<CrewEarningPageDTO>(`/crews/${encodeURIComponent(crewId)}/earnings`, {
        query: {
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
  return useMutation({
    mutationFn: (input: {
      crewMemberId: string;
      sourceType: Exclude<CrewEarningSourceType, "task_reward">;
      agreementId?: string;
      title: string;
      description?: string;
      pointsAmount: string;
      idempotencyKey: string;
    }) =>
      crewApi.post<CrewEarningEntryDTO>(`/crews/${encodeURIComponent(crewId)}/earnings`, {
        body: input,
      }),
    onSuccess: () => invalidateEarnings(queryClient, crewId),
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
  return useMutation({
    mutationFn: (input: { earningId: string; expectedVersion: number; reason?: string }) =>
      crewApi.post<CrewEarningEntryDTO>(
        `/crew-earnings/${encodeURIComponent(input.earningId)}/${action}`,
        { body: { expectedVersion: input.expectedVersion, reason: input.reason } }
      ),
    onMutate: async (input) => {
      const prefix = ["crew", "earnings", crewId] as const;
      await queryClient.cancelQueries({ queryKey: prefix });
      const snapshots = queryClient.getQueriesData<InfiniteData<CrewEarningPageDTO>>({
        queryKey: prefix,
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
      return { snapshots };
    },
    onError: (_error, _input, context) => {
      for (const [key, value] of context?.snapshots ?? []) {
        queryClient.setQueryData(key as QueryKey, value);
      }
    },
    onSuccess: (earning) => {
      queryClient.setQueryData(crewKeys.earning(earning.id), (current: unknown) =>
        current && typeof current === "object" ? { ...current, ...earning } : current
      );
      const prefix = ["crew", "earnings", crewId] as const;
      queryClient.setQueriesData<InfiniteData<CrewEarningPageDTO>>(
        { queryKey: prefix },
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
    onSettled: () => invalidateEarnings(queryClient, crewId),
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
  const amount = BigInt(earning.pointsAmount);
  const byStatus = Object.fromEntries(
    Object.entries(summary.byStatus).map(([status, value]) => [status, { ...value }])
  ) as CrewEarningPageDTO["summary"]["byStatus"];
  byStatus[earning.status].count -= 1;
  byStatus[earning.status].pointsAmount = (
    BigInt(byStatus[earning.status].pointsAmount) - amount
  ).toString();
  byStatus[nextStatus].count += 1;
  byStatus[nextStatus].pointsAmount = (
    BigInt(byStatus[nextStatus].pointsAmount) + amount
  ).toString();

  let postedThisMonth = BigInt(summary.postedThisMonthPoints);
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
        group.pointsAmount = (BigInt(group.pointsAmount) + amount).toString();
      }
    } else {
      postedBySource.push({
        sourceType: earning.sourceType,
        count: 1,
        pointsAmount: amount.toString(),
      });
    }
  } else if (earning.status === "posted" && nextStatus === "reversed" && sourceIndex >= 0) {
    const group = postedBySource[sourceIndex];
    if (group) {
      group.count -= 1;
      group.pointsAmount = (BigInt(group.pointsAmount) - amount).toString();
      if (group.count === 0) postedBySource.splice(sourceIndex, 1);
    }
  }

  return {
    ...summary,
    byStatus,
    postedThisMonthPoints: postedThisMonth.toString(),
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

function invalidateEarnings(queryClient: ReturnType<typeof useQueryClient>, crewId: string) {
  return queryClient.invalidateQueries({ queryKey: ["crew", "earnings", crewId] });
}
