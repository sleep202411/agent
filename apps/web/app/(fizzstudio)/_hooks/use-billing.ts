"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createComputeTopup,
  getComputeWalletLedger,
  listComputeTopupPackages,
  type ComputeWalletLedgerData,
} from "../_lib/billing-api";

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
