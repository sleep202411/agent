"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { IconBolt, IconLoader2 } from "@tabler/icons-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ApiRequestError } from "@/lib/api";
import {
  computeWalletBalanceQueryKey,
  useComputeWalletBalance,
} from "@/app/_components/credits-badge";
import { type WorkspaceRef } from "@/lib/collab/projects-api";
import { isWechatScanUrl, redirectToComputePayment } from "@/lib/billing";
import { WechatScanPayDialog } from "@/app/_components/wechat-scan-pay-dialog";
import { useIsCnSite } from "@/app/_components/region-provider";
import { FIELD_CONTROL } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { FrostedPanel } from "@/components/ui/frosted-panel";
import { useAuth } from "@/app/_components/auth-provider";
import { useRechargeAttempt } from "@/lib/use-recharge-attempt";
import { Panel } from "./settings-ui";

const errMsg = (e: unknown, fallback: string) =>
  e instanceof ApiRequestError ? e.message : e instanceof Error ? e.message : fallback;

const CAN_MANAGE_BILLING = new Set(["owner", "admin", "billing"]);

/** Shared compute credits for the selected workspace. */
export function WorkspaceCreditsPanel({ ws }: { ws: WorkspaceRef }) {
  const { user } = useAuth();
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const tw = useTranslations("shell.credits");
  const canManageBilling = Boolean(ws.role && CAN_MANAGE_BILLING.has(ws.role));
  const canRecharge = canManageBilling;

  const { data: balance, error, refetch, isFetching } = useComputeWalletBalance(true, ws.id);

  return (
    <Panel title={t("credits")} icon={<IconBolt className="size-4 text-muted-foreground" />}>
      <div className="flex flex-col gap-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="text-sm text-muted-foreground">{t("sharedTeamBalance")}</div>
            <div className="mt-1 flex items-center gap-1.5 text-3xl font-semibold tabular-nums">
              <IconBolt className="size-6 text-white/85" stroke={1.8} />
              {balance ? (
                balance.available.toLocaleString()
              ) : error ? (
                <span className="text-sm text-muted-foreground">{tw("unavailable")}</span>
              ) : (
                <span
                  className="h-8 w-24 animate-pulse rounded bg-white/10"
                  aria-label={tc("loading")}
                />
              )}
            </div>
            {error && (
              <div
                role="alert"
                className="mt-2 flex items-center gap-2 text-sm text-muted-foreground"
              >
                <span>{error.message}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isFetching}
                  onClick={() => void refetch()}
                >
                  {tc("retry")}
                </Button>
              </div>
            )}
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
          <RechargeControls key={`${user?.id}:${ws.id}`} workspaceId={ws.id} />
        ) : (
          <p className="text-sm text-muted-foreground">{t("onlyBillingAdminsCanTopUp")}</p>
        )}
      </div>
    </Panel>
  );
}

function RechargeControls({ workspaceId }: { workspaceId: string }) {
  const attempt = useRechargeAttempt();
  const locale = useLocale();
  const t = useTranslations("settings");
  const queryClient = useQueryClient();
  // Compute credits are a CUSTOM-amount recharge on every cell — the only per-cell
  // difference is currency + payment provider. CN: ¥ via WeChat 扫码 (¥7 = 100
  // points); global: $ via Airwallex (1 point = 1 US cent). The quick chips are
  // shortcuts into the same input, not fixed packs.
  const isCn = useIsCnSite();
  const sym = isCn ? "¥" : "$";
  const minorPerPoint = isCn ? 7 : 1;
  const [amount, setAmount] = useState("50");
  const [wechatScan, setWechatScan] = useState<{
    orderId: string;
    codeUrl: string;
    successMessage: string;
  } | null>(null);

  const urls = () => {
    const base =
      typeof window !== "undefined"
        ? `${window.location.origin}/${locale}/settings/billing?ws=${encodeURIComponent(workspaceId)}`
        : "";
    return { successUrl: base, backUrl: base };
  };

  const customMut = useMutation({
    mutationFn: () => attempt.request({ amountDollars: Number(amount), workspaceId, ...urls() }),
    onSuccess: async ({ result, urls: returnUrls }) => {
      attempt.assertCurrent();
      const successMessage = t("creditsAddedGeneric");
      const scanUrl = result.paymentIntent?.checkoutUrl;
      if (isWechatScanUrl(scanUrl)) {
        attempt.complete();
        setWechatScan({ orderId: result.order.id, codeUrl: scanUrl, successMessage });
        return;
      }
      const outcome = await redirectToComputePayment(result, returnUrls, attempt.assertCurrent);
      attempt.assertCurrent();
      attempt.complete();
      if (outcome === "fulfilled") {
        void queryClient.invalidateQueries({ queryKey: computeWalletBalanceQueryKey });
        toast.success(successMessage);
      }
    },
    onError: (error) => {
      if (attempt.current() && !(error instanceof DOMException && error.name === "AbortError"))
        toast.error(errMsg(error, t("couldntStartRecharge")));
    },
    onSettled: (_data, error) => attempt.finish(error),
  });

  const amountNum = Number(amount);
  const amountValid = Number.isInteger(amountNum) && amountNum >= 10 && amountNum <= 5000;
  // Preview only — the server (anchor ratio) is authoritative. points = fiatMinor / minorPerPoint.
  const estimatedCredits = amountValid ? Math.floor((amountNum * 100) / minorPerPoint) : null;
  const busy = customMut.isPending;

  return (
    <div className="flex flex-col gap-4">
      {wechatScan && (
        <WechatScanPayDialog
          key={wechatScan.orderId}
          open
          orderId={wechatScan.orderId}
          codeUrl={wechatScan.codeUrl}
          onClose={() => setWechatScan(null)}
          onPaid={() => {
            if (!attempt.current()) return;
            void queryClient.invalidateQueries({
              queryKey: computeWalletBalanceQueryKey,
            });
            toast.success(wechatScan.successMessage);
          }}
        />
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
            {sym}
            {v}
          </button>
        ))}
      </div>

      <div className="flex items-end gap-2">
        <label className="flex flex-1 flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">
            {t(isCn ? "amountCnyRange" : "amountUsdRange")}
          </span>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted-foreground">
              {sym}
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
      <p className="text-xs text-muted-foreground">
        {t(isCn ? "secureCheckoutNoteWechat" : "secureCheckoutNote")}
      </p>
    </div>
  );
}
