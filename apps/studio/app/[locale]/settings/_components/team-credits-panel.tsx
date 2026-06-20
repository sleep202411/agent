"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconBolt, IconLoader2 } from "@tabler/icons-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ApiRequestError } from "@/lib/api";
import {
  computeWalletBalanceQueryKey,
  useComputeWalletBalance,
} from "@/app/_components/credits-badge";
import { type WorkspaceRef } from "@/lib/collab/projects-api";
import {
  createComputeCustomRecharge,
  createComputeTopup,
  listComputeTopupPackages,
  redirectToComputePayment,
  type ComputeTopupPrice,
} from "@/lib/billing";
import { FIELD_CONTROL } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { FrostedPanel } from "@/components/ui/frosted-panel";
import { Panel } from "./settings-ui";

const errMsg = (e: unknown, fallback: string) =>
  e instanceof ApiRequestError ? e.message : e instanceof Error ? e.message : fallback;

const usd = (amountMinor: string) => {
  const cents = Number(amountMinor);
  return Number.isFinite(cents) ? `$${(cents / 100).toLocaleString()}` : "—";
};
const points = (value: string | null) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n.toLocaleString() : "0";
};

const CAN_MANAGE_BILLING = new Set(["owner", "admin", "billing"]);

/**
 * Compute-credit panel for the active workspace. Every workspace — personal or
 * team — is its own credit pot: the balance shown and the wallet recharged are
 * always this workspace's pot. Personal: the owner funds their own; team:
 * billing-role members fund the shared pot. Recharge via fixed packs or a custom
 * USD amount. Brand-red is used only on the hero recharge CTA.
 */
export function TeamCreditsPanel({ ws }: { ws: WorkspaceRef }) {
  const t = useTranslations("settings");
  const isTeam = ws.type === "team";
  const canManageBilling = Boolean(ws.role && CAN_MANAGE_BILLING.has(ws.role));
  // A personal workspace is funded by its owner; a team requires the billing role.
  const canRecharge = !isTeam || canManageBilling;

  const { data: balance } = useComputeWalletBalance();

  return (
    <Panel
      title={isTeam ? t("teamCredits") : t("credits")}
      icon={<IconBolt className="size-4 text-muted-foreground" />}
    >
      <div className="flex flex-col gap-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="text-sm text-muted-foreground">
              {isTeam ? t("sharedTeamBalance") : t("availableBalance")}
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-3xl font-semibold tabular-nums">
              <IconBolt className="size-6 text-white/85" stroke={1.8} />
              {balance ? balance.available.toLocaleString() : "—"}
            </div>
            {balance && balance.held > BigInt(0) && (
              <div className="mt-0.5 text-xs text-muted-foreground">
                {t("reservedByRunningJobs", { amount: balance.held.toLocaleString() })}
              </div>
            )}
            {balance?.nextExpiry && (
              <div className="mt-0.5 text-xs text-amber-300/80">
                {t("creditsExpireOn", {
                  amount: balance.nextExpiry.amount.toLocaleString(),
                  date: new Date(balance.nextExpiry.expiresAt).toLocaleDateString(),
                })}
              </div>
            )}
          </div>
        </div>

        {canRecharge ? (
          <RechargeControls workspaceId={ws.id} />
        ) : (
          <p className="text-sm text-muted-foreground">{t("onlyBillingAdminsCanTopUp")}</p>
        )}
      </div>
    </Panel>
  );
}

function RechargeControls({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations("settings");
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("50");
  const [pendingId, setPendingId] = useState<string | null>(null);

  const { data: catalog } = useQuery({
    queryKey: ["compute-topup-packages"] as const,
    queryFn: listComputeTopupPackages,
    staleTime: 5 * 60_000,
  });

  const urls = () => {
    const base = typeof window !== "undefined" ? `${window.location.origin}/settings/billing` : "";
    return { successUrl: base, backUrl: base };
  };

  const afterStart = async (
    result: Awaited<ReturnType<typeof createComputeTopup>>,
    successMessage: string
  ) => {
    const outcome = await redirectToComputePayment(result, urls());
    if (outcome === "fulfilled") {
      void queryClient.invalidateQueries({ queryKey: computeWalletBalanceQueryKey });
      toast.success(successMessage);
    }
    // "redirecting" → the browser is navigating to the provider; nothing to do.
  };

  const packMut = useMutation({
    mutationFn: (price: ComputeTopupPrice) =>
      createComputeTopup({
        priceId: price.id,
        workspaceId,
        idempotencyKey: crypto.randomUUID(),
        ...urls(),
      }),
    onSuccess: (result, price) =>
      afterStart(result, t("creditsAdded", { amount: points(price.grantsWalletAmount) })),
    onError: (e) => toast.error(errMsg(e, t("couldntStartTopUp"))),
    onSettled: () => setPendingId(null),
  });

  const customMut = useMutation({
    mutationFn: () =>
      createComputeCustomRecharge({
        amountDollars: Number(amount),
        workspaceId,
        idempotencyKey: crypto.randomUUID(),
        ...urls(),
      }),
    onSuccess: (result) => afterStart(result, t("creditsAddedGeneric")),
    onError: (e) => toast.error(errMsg(e, t("couldntStartRecharge"))),
  });

  const amountNum = Number(amount);
  const amountValid = Number.isInteger(amountNum) && amountNum >= 10 && amountNum <= 5000;
  const estimatedCredits = amountValid ? amountNum * 100 : null;
  const busy = packMut.isPending || customMut.isPending;
  const packs = catalog?.prices ?? [];

  return (
    <div className="flex flex-col gap-4">
      {packs.length > 0 && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {packs.map((price) => {
            const pending = packMut.isPending && pendingId === price.id;
            return (
              <button
                key={price.id}
                type="button"
                disabled={busy}
                onClick={() => {
                  setPendingId(price.id);
                  packMut.mutate(price);
                }}
                className="flex flex-col items-start gap-1 rounded-xl bg-secondary px-4 py-3 text-left transition-colors hover:bg-accent disabled:opacity-50"
              >
                <span className="flex items-center gap-1 text-base font-semibold tabular-nums">
                  <IconBolt className="size-4 text-white/85" stroke={1.8} />
                  {points(price.grantsWalletAmount)}
                  {pending && <IconLoader2 className="size-3.5 animate-spin" />}
                </span>
                <span className="text-xs text-muted-foreground">{usd(price.amountMinor)}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {[10, 50, 100, 500].map((v) => (
          <button
            key={v}
            type="button"
            disabled={busy}
            onClick={() => setAmount(String(v))}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm tabular-nums transition-colors disabled:opacity-50",
              amountNum === v ? "bg-white text-background" : "bg-secondary hover:bg-accent"
            )}
          >
            ${v}
          </button>
        ))}
      </div>

      <div className="flex items-end gap-2">
        <label className="flex flex-1 flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">{t("amountUsdRange")}</span>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted-foreground">
              $
            </span>
            <input
              type="number"
              inputMode="numeric"
              min={10}
              max={5000}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="50"
              className={cn(FIELD_CONTROL, "w-full pl-7 tabular-nums")}
            />
          </div>
        </label>
        <FrostedPanel className="hidden min-w-44 px-4 py-2.5 sm:block">
          <span className="block text-xs text-muted-foreground">{t("estimatedCredits")}</span>
          <span className="mt-1 flex items-center gap-1 text-base font-semibold tabular-nums">
            <IconBolt className="size-4 text-white/85" stroke={1.8} />
            {estimatedCredits != null ? estimatedCredits.toLocaleString() : "—"}
            {estimatedCredits != null && (
              <span className="text-xs font-medium text-muted-foreground tabular-nums">
                {t("credits")}
              </span>
            )}
          </span>
        </FrostedPanel>
        {/* Brand-red hero CTA via the sanctioned primary-cta Button variant
            (DESIGN.md rule 3) — kept at hero size with the red glow shadow. */}
        <Button
          type="button"
          variant="primary-cta"
          disabled={!amountValid || busy}
          onClick={() => customMut.mutate()}
          className="h-11 gap-1.5 rounded-xl px-5 text-sm font-semibold shadow-lg shadow-[#E52227]/25 disabled:opacity-40"
        >
          {customMut.isPending ? (
            <IconLoader2 className="size-4 animate-spin" />
          ) : (
            <IconBolt className="size-4" stroke={1.9} />
          )}
          {t("recharge")}
        </Button>
      </div>
      <FrostedPanel className="px-4 py-2.5 sm:hidden">
        <span className="text-xs text-muted-foreground">{t("estimatedCredits")}</span>
        <span className="mt-1 flex items-center gap-1 text-base font-semibold tabular-nums">
          <IconBolt className="size-4 text-white/85" stroke={1.8} />
          {estimatedCredits != null ? estimatedCredits.toLocaleString() : "—"}
          {estimatedCredits != null && (
            <span className="text-xs font-medium text-muted-foreground tabular-nums">
              {t("credits")}
            </span>
          )}
        </span>
      </FrostedPanel>
      <p className="text-xs text-muted-foreground">{t("secureCheckoutNote")}</p>
    </div>
  );
}
