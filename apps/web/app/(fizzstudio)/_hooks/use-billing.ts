"use client";

import { useCurrentUser } from "@/src/hooks/use-user";
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
  wallets: (accountId: string | null) => [...computeBillingKeys.all, "wallet", accountId] as const,
  wallet: (accountId: string | null, limit = 12) =>
    [...computeBillingKeys.wallets(accountId), limit] as const,
};

export function useComputeTopupCatalog() {
  return useQuery({
    queryKey: computeBillingKeys.catalog(),
    queryFn: listComputeTopupPackages,
    staleTime: 60_000,
  });
}

export function useComputeWalletLedger(limit = 12) {
  const { user } = useCurrentUser();
  return useQuery({
    queryKey: computeBillingKeys.wallet(user?.id ?? null, limit),
    enabled: !!user?.id,
    queryFn: () => getComputeWalletLedger(limit),
    staleTime: 20_000,
  });
}

export function useCreateComputeTopup() {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  return useMutation({
    mutationFn: createComputeTopup,
    onMutate: () => ({ accountId: user?.id ?? null }),
    onSuccess: (result, _input, context) => {
      if (result.order.status === "fulfilled" && context?.accountId) {
        void qc.invalidateQueries({ queryKey: computeBillingKeys.wallets(context.accountId) });
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
