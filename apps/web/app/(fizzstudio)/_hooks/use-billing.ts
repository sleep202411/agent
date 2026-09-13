"use client";

import { useMutation, useQuery, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import {
  createComputeTopup,
  getComputeWalletLedger,
  listComputeTopupPackages,
  type ComputeWalletLedgerData,
} from "../_lib/billing-api";

import { useCurrentUser } from "@/src/hooks/use-user";

export const computeBillingKeys = {
  all: ["fizzstudio", "compute-billing"] as const,
  catalog: () => [...computeBillingKeys.all, "catalog"] as const,
  wallet: (limit = 12) => [...computeBillingKeys.all, "wallet", limit] as const,
};

export function useComputeTopupCatalog() {
  return useQuery({
    queryKey: computeBillingKeys.catalog(),
    queryFn: listComputeTopupPackages,
    staleTime: 60_000,
  });
}

export function useComputeWalletLedger(limit = 12) {
  return useQuery({
    queryKey: computeBillingKeys.wallet(limit),
    queryFn: () => getComputeWalletLedger(limit),
    staleTime: 20_000,
  });
}

export function useCreateComputeTopup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createComputeTopup,
    onSuccess: (result) => {
      if (result.order.status === "fulfilled") {
        void qc.invalidateQueries({ queryKey: computeBillingKeys.all });
      }
    },
  });
}

export function availableComputeBalance(data: ComputeWalletLedgerData | undefined): bigint {
  return (data?.accounts ?? []).reduce((sum, account) => {
    if (account.status !== "active") return sum;
    return sum + BigInt(account.availableBalance);
  }, 0n);
}

export function useProjectComputeLedger(workspaceId: string, projectId?: string) {
  const { user } = useCurrentUser();
  return useInfiniteQuery({
    queryKey: [...computeBillingKeys.all, "project-ledger", user?.id, workspaceId, projectId],
    enabled: !!user && !!workspaceId,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      getComputeWalletLedger(50, { workspaceId, projectId, cursor: pageParam, signal }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
}
