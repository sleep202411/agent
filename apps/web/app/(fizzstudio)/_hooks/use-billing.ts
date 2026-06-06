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
  wallet: () => [...computeBillingKeys.all, "wallet"] as const,
};

export function useComputeTopupCatalog() {
  return useQuery({
    queryKey: computeBillingKeys.catalog(),
    queryFn: listComputeTopupPackages,
    staleTime: 60_000,
  });
}

export function useComputeWalletLedger() {
  return useQuery({
    queryKey: computeBillingKeys.wallet(),
    queryFn: getComputeWalletLedger,
    staleTime: 20_000,
  });
}

export function useCreateComputeTopup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createComputeTopup,
    onSuccess: (result) => {
      if (result.order.status === "fulfilled") {
        void qc.invalidateQueries({ queryKey: computeBillingKeys.wallet() });
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
