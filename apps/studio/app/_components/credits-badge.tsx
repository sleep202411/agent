"use client";

import { useQuery } from "@tanstack/react-query";
import { IconBolt } from "@tabler/icons-react";
import { api } from "@/lib/api";

interface WalletLedgerData {
  accounts?: Array<{ status: string; availableBalance: string }>;
}

async function getComputeWalletBalance(): Promise<bigint> {
  const data = await api.get<WalletLedgerData>("/aurora/billing/wallet-ledger", {
    params: { currency: "compute_point", balanceKind: "consumable", limit: 1 },
  });
  return (data.accounts ?? []).reduce(
    (sum, account) => (account.status === "active" ? sum + BigInt(account.availableBalance) : sum),
    BigInt(0)
  );
}

/** Compute-credits balance pill for the studio header. */
export function CreditsBadge() {
  const { data } = useQuery({
    queryKey: ["fizzstudio", "compute-billing", "balance"],
    queryFn: getComputeWalletBalance,
    staleTime: 20_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  return (
    <span
      title="Compute credits"
      className="flex h-9 items-center gap-1.5 rounded-full bg-white/[0.06] px-3.5 text-sm font-medium tabular-nums"
    >
      <IconBolt className="size-4 text-white/85" stroke={1.8} />
      {data != null ? data.toLocaleString() : "—"}
    </span>
  );
}
