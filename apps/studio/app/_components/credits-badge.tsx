"use client";

import { useWorkspace } from "./workspace-context";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { IconBolt, IconInfoCircle } from "@tabler/icons-react";
import { api } from "@/lib/api";
import { useProjectPayerWorkspace } from "@/app/[locale]/project/_components/project-context";
import { getAssetsRealtimeKernel } from "@/lib/canvas-authoring/assets-realtime-kernel";
import { openSettings } from "@/lib/settings-hash";
import { cn } from "@/lib/utils";
import { GlassRim } from "@/components/ui/glass-rim";
import { Button } from "@/components/ui/button";
import { useAuth } from "./auth-provider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface ComputeBalanceData {
  available: string;
  held: string;
  total: string;
  nextExpiry: { amount: string; expiresAt: string } | null;
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
  return [...computeWalletBalanceQueryKey, workspaceId ?? null] as const;
}

async function getComputeWalletBalance(
  workspaceId: string | null | undefined,
  signal?: AbortSignal
): Promise<ComputeWalletBalance> {
  const data = await api.get<ComputeBalanceData>("/aurora/billing/compute-balance", {
    // Never inherit another tab's active workspace while the payer resolves.
    requestScope: "user",
    signal,
    headers: workspaceId ? { "x-fizz-workspace-id": workspaceId } : undefined,
  });
  return {
    available: BigInt(data.available),
    held: BigInt(data.held),
    total: BigInt(data.total),
    nextExpiry: data.nextExpiry
      ? { amount: BigInt(data.nextExpiry.amount), expiresAt: data.nextExpiry.expiresAt }
      : null,
  };
}

export function useComputeWalletBalance(enabled = true, explicitWorkspaceId?: string) {
  const { user } = useAuth();
  // A project spends from its owning workspace; other surfaces use the active workspace.
  const payerWorkspaceId = useProjectPayerWorkspace()?.id ?? null;
  const workspaceId = explicitWorkspaceId ?? payerWorkspaceId;
  return useQuery({
    queryKey: [...computeWalletBalanceKey(workspaceId), user?.id == null ? null : String(user.id)],
    queryFn: ({ signal }) => getComputeWalletBalance(workspaceId, signal),
    staleTime: 20_000,
    // No interval poll: wallet_changed realtime pushes drive updates (see
    // useWalletRealtime). refetchOnWindowFocus stays as a cheap missed-push backstop.
    refetchOnWindowFocus: true,
    enabled: enabled && Boolean(user) && Boolean(workspaceId),
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
  // Subscribe to the same pot the badge shows (the open project's payer pot),
  // so a wallet_changed on it refreshes this balance.
  const workspaceId = useProjectPayerWorkspace()?.id ?? null;
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
export function CreditsBadge({
  className,
  onClick,
  variant = "ghost",
}: {
  className?: string;
  onClick?: () => void;
  variant?: "ghost" | "secondary";
}) {
  const t = useTranslations("shell");
  const locale = useLocale();
  const billingWorkspace = useProjectPayerWorkspace();
  const { setActiveWorkspaceId } = useWorkspace();
  useWalletRealtime();
  const { data, error } = useComputeWalletBalance(Boolean(billingWorkspace));
  const description = t("credits.workspaceHint");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={variant}
          type="button"
          onClick={
            onClick ??
            (() => {
              if (billingWorkspace) setActiveWorkspaceId(billingWorkspace.id);
              openSettings("billing");
            })
          }
          disabled={!billingWorkspace}
          aria-label={t("credits.manage")}
          className={cn(
            "relative h-9 gap-1.5 rounded-full text-sm tabular-nums backdrop-blur-md backdrop-saturate-150",
            variant === "ghost" && "bg-white/[0.06] hover:bg-white/[0.1]",
            className
          )}
        >
          {variant === "ghost" && <GlassRim />}
          <IconBolt className="size-4 shrink-0" stroke={1.8} aria-hidden />
          {data != null ? (
            data.available.toLocaleString(locale)
          ) : error ? (
            t("credits.unavailable")
          ) : (
            <span className="h-3 w-8 animate-pulse rounded bg-white/10" />
          )}
          <IconInfoCircle className="size-3.5 shrink-0 opacity-70" stroke={1.8} aria-hidden />
        </Button>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        sideOffset={8}
        className="block max-w-64 space-y-1 leading-relaxed"
      >
        <p>{description}</p>
        {error ? (
          <p>{error.message}</p>
        ) : (
          data != null && (
            <p className="text-muted-foreground">
              {t("credits.tooltipDetailed", {
                available: data.available.toLocaleString(locale),
                held: data.held.toLocaleString(locale),
                total: data.total.toLocaleString(locale),
              })}
            </p>
          )
        )}
      </TooltipContent>
    </Tooltip>
  );
}
