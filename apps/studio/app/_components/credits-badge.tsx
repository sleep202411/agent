"use client";

import { useQuery } from "@tanstack/react-query";
import { IconBolt } from "@tabler/icons-react";
import { api } from "@/lib/api";
import { useActiveWorkspaceId } from "@/app/_components/workspace-context";

interface WalletLedgerData {
  accounts?: Array<{
    status: string;
    availableBalance: string;
    heldBalance?: string;
  }>;
}

export interface ComputeWalletBalance {
  available: bigint;
  held: bigint;
  total: bigint;
}

export const computeWalletBalanceQueryKey = ["fizzstudio", "compute-billing", "balance"] as const;

/**
 * Query key scoped to the active workspace. The base prefix is preserved so a
 * plain `invalidateQueries({ queryKey: computeWalletBalanceQueryKey })` (used
 * after a generation or a recharge) still invalidates every workspace's balance.
 */
export function computeWalletBalanceKey(workspaceId: string | null | undefined) {
  return [...computeWalletBalanceQueryKey, workspaceId ?? "personal"] as const;
}

function bigintFromString(value: string | undefined): bigint {
  if (!value || !/^-?\d+$/.test(value)) return BigInt(0);
  return BigInt(value);
}

async function getComputeWalletBalance(
  workspaceId: string | null | undefined
): Promise<ComputeWalletBalance> {
  const data = await api.get<WalletLedgerData>("/aurora/billing/wallet-ledger", {
    params: { currency: "compute_point", balanceKind: "consumable", limit: 1 },
    // Scope the read to the active workspace's compute pot (every workspace owns
    // its own); with no active workspace the server reads the personal pot.
    headers: workspaceId ? { "x-fizz-workspace-id": workspaceId } : undefined,
  });
  const active = (data.accounts ?? []).filter((account) => account.status === "active");
  const available = active.reduce(
    (sum, account) => sum + bigintFromString(account.availableBalance),
    BigInt(0)
  );
  const held = active.reduce(
    (sum, account) => sum + bigintFromString(account.heldBalance),
    BigInt(0)
  );
  return { available, held, total: available + held };
}

export function useComputeWalletBalance(enabled = true) {
  // Scopes to the active workspace's compute pot (workspace-owned); null only on
  // first paint before the app-wide provider resolves, where it reads personal.
  const workspaceId = useActiveWorkspaceId();
  return useQuery({
    queryKey: computeWalletBalanceKey(workspaceId),
    queryFn: () => getComputeWalletBalance(workspaceId),
    staleTime: 20_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    enabled,
  });
}

/** Compute-credits balance pill (header + canvas chrome). */
export function CreditsBadge({ className }: { className?: string }) {
  const { data } = useComputeWalletBalance();
  const title =
    data != null
      ? `Compute credits · available ${data.available.toLocaleString()} · held ${data.held.toLocaleString()} · total ${data.total.toLocaleString()}`
      : "Compute credits";

  return (
    <span
      title={title}
      className={
        className ??
        "flex h-9 items-center gap-1.5 rounded-full bg-white/[0.06] px-3.5 text-sm font-medium tabular-nums"
      }
    >
      <IconBolt className="size-4 text-white/85" stroke={1.8} />
      {data != null ? data.available.toLocaleString() : "—"}
    </span>
  );
}
