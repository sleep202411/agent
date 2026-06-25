"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { IconBolt } from "@tabler/icons-react";
import { api } from "@/lib/api";
import { useActiveWorkspaceId } from "@/app/_components/workspace-context";
import { getAssetsRealtimeKernel } from "@/app/[locale]/canvas/_lib/assets-realtime-kernel";
import { openSettings } from "@/lib/settings-hash";
import { cn } from "@/lib/utils";
import { GlassRim } from "@/components/ui/glass-rim";
import { useAuth } from "./auth-provider";

interface WalletLedgerData {
  accounts?: Array<{
    status: string;
    availableBalance: string;
    heldBalance?: string;
  }>;
  nextExpiry?: { amount: string; expiresAt: string } | null;
}

export interface ComputeWalletBalance {
  available: bigint;
  held: bigint;
  total: bigint;
  /** The next credit grant to expire, for surfacing "X credits expire on DATE". */
  nextExpiry: { amount: bigint; expiresAt: string } | null;
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
  const nextExpiry =
    data.nextExpiry && /^\d+$/.test(data.nextExpiry.amount)
      ? {
          amount: BigInt(data.nextExpiry.amount),
          expiresAt: data.nextExpiry.expiresAt,
        }
      : null;
  return { available, held, total: available + held, nextExpiry };
}

export function useComputeWalletBalance(enabled = true) {
  const { user } = useAuth();
  // Scopes to the active workspace's compute pot (workspace-owned); null only on
  // first paint before the app-wide provider resolves, where it reads personal.
  const workspaceId = useActiveWorkspaceId();
  return useQuery({
    queryKey: computeWalletBalanceKey(workspaceId),
    queryFn: () => getComputeWalletBalance(workspaceId),
    staleTime: 20_000,
    // No interval poll: wallet_changed realtime pushes drive updates (see
    // useWalletRealtime). refetchOnWindowFocus stays as a cheap missed-push backstop.
    refetchOnWindowFocus: true,
    enabled: enabled && Boolean(user),
  });
}

/**
 * Subscribe to the shared realtime socket and refresh the active workspace's
 * compute balance when the server pushes a `wallet_changed` — replaces the 60s
 * poll. The balance updates on real change (including a teammate spending the
 * shared pot), not on a timer.
 */
function useWalletRealtime() {
  const { user } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!user) return;
    const sub = getAssetsRealtimeKernel({
      workspaceId: workspaceId ?? undefined,
    }).subscribe({
      onEvent: (event) => {
        if (event.kind !== "wallet_changed") return;
        void queryClient.invalidateQueries({
          queryKey: computeWalletBalanceKey(event.workspaceId),
        });
      },
    });
    return () => sub.close();
  }, [user, workspaceId, queryClient]);
}

/** Compute-credits balance pill (header + canvas chrome). */
export function CreditsBadge({ className }: { className?: string }) {
  const t = useTranslations("shell");
  // A team workspace spends the shared workspace pot; personal spends the
  // personal pot. Tag only the team case so users know which wallet this is.
  const workspaceId = useActiveWorkspaceId();
  useWalletRealtime();
  const { data } = useComputeWalletBalance();
  const title =
    data != null
      ? t("credits.tooltipDetailed", {
          available: data.available.toLocaleString(),
          held: data.held.toLocaleString(),
          total: data.total.toLocaleString(),
        })
      : t("credits.tooltip");

  return (
    <button
      type="button"
      onClick={() => openSettings("billing")}
      aria-label={t("credits.manage")}
      title={title}
      className={cn(
        className ??
          "flex h-9 items-center gap-1.5 rounded-full bg-white/[0.06] px-3.5 text-sm font-medium tabular-nums",
        "relative backdrop-blur-md backdrop-saturate-150 transition-colors hover:bg-white/[0.1] focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      )}
    >
      <GlassRim />
      {workspaceId && (
        <span className="rounded-full bg-white/10 px-1.5 py-px text-[10px] font-medium leading-tight text-white/70">
          {t("credits.teamTag")}
        </span>
      )}
      <IconBolt className="size-4 text-white/85" stroke={1.8} />
      {data != null ? data.available.toLocaleString() : "—"}
    </button>
  );
}
