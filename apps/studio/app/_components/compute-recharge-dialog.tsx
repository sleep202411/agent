"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  IconArrowRight,
  IconBolt,
  IconCreditCard,
  IconLoader2,
  IconShieldCheck,
  IconWallet,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { WechatScanPayDialog } from "@/app/_components/wechat-scan-pay-dialog";
import {
  computeWalletBalanceQueryKey,
  useComputeWalletBalance,
} from "@/app/_components/credits-badge";
import { useIsCnSite } from "@/app/_components/region-provider";
import { useProjectPayerWorkspace } from "@/app/[locale]/project/_components/project-context";
import { ApiRequestError } from "@/lib/api";
import { isWechatScanUrl, redirectToComputePayment } from "@/lib/billing";
import { useAuth } from "./auth-provider";
import { useRechargeAttempt } from "@/lib/use-recharge-attempt";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { GlassRim } from "@/components/ui/glass-rim";

const CAN_RECHARGE_TEAM_ROLES = new Set(["owner", "admin", "billing"]);

function errMsg(error: unknown, fallback: string) {
  if (error instanceof ApiRequestError) return error.message;
  if (error instanceof Error) return error.message;
  return fallback;
}

function suggestedRechargeAmount(required: number | null, available: bigint | null, isCn: boolean) {
  const current = available ? Number(available) : 0;
  const gap = required != null ? Math.max(0, Math.ceil(required) - current) : 0;
  const needed = gap > 0 ? (isCn ? Math.ceil((gap * 7) / 100) : Math.ceil(gap / 100)) : 50;
  return String(Math.min(5000, Math.max(10, needed)));
}

type RechargeDialogProps = {
  available?: bigint | null;
  modelName?: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  required?: number | null;
};
export function ComputeRechargeDialog(props: RechargeDialogProps) {
  const { user } = useAuth();
  const workspace = useProjectPayerWorkspace();
  if (!props.open || user?.id == null || !workspace) return null;
  return <RechargeDialogBody key={`${user.id}:${workspace.id}:${workspace.role}`} {...props} />;
}
function RechargeDialogBody({
  available,
  modelName,
  onOpenChange,
  open,
  required,
}: RechargeDialogProps) {
  const attempt = useRechargeAttempt();
  const t = useTranslations("billing.rechargePrompt");
  const ts = useTranslations("settings");
  const queryClient = useQueryClient();
  const wallet = useComputeWalletBalance(open);
  const isCn = useIsCnSite();
  // Recharge the project workspace, or the active workspace outside a project.
  const billingWorkspace = useProjectPayerWorkspace();
  const sym = isCn ? "¥" : "$";
  const minorPerPoint = isCn ? 7 : 1;
  const effectiveAvailable = available ?? wallet.data?.available ?? null;
  const suggestedAmount = useMemo(
    () => suggestedRechargeAmount(required ?? null, effectiveAvailable, isCn),
    [effectiveAvailable, isCn, required]
  );
  const [customAmount, setCustomAmount] = useState<string | null>(null);
  const amount = customAmount ?? suggestedAmount;
  const [wechatScan, setWechatScan] = useState<{
    orderId: string;
    codeUrl: string;
    successMessage: string;
  } | null>(null);

  const close = useCallback(() => {
    attempt.cancel();
    setCustomAmount(null);
    onOpenChange(false);
  }, [onOpenChange, attempt]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [close, open]);

  const canRecharge =
    !billingWorkspace ||
    Boolean(billingWorkspace.role && CAN_RECHARGE_TEAM_ROLES.has(billingWorkspace.role));

  const amountNum = Number(amount);
  const amountValid = Number.isInteger(amountNum) && amountNum >= 10 && amountNum <= 5000;
  const estimatedCredits = amountValid ? Math.floor((amountNum * 100) / minorPerPoint) : null;
  const urls = () => {
    const base = typeof window !== "undefined" ? window.location.href : "";
    return { successUrl: base, backUrl: base };
  };

  const recharge = useMutation({
    mutationFn: () =>
      attempt.request({
        amountDollars: amountNum,
        workspaceId: billingWorkspace!.id,
        ...urls(),
      }),
    onSuccess: async ({ result, urls: returnUrls }) => {
      attempt.assertCurrent();
      const successMessage = ts("creditsAddedGeneric");
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
        close();
      }
    },
    onError: (error) => {
      if (attempt.current() && !(error instanceof DOMException && error.name === "AbortError"))
        toast.error(errMsg(error, ts("couldntStartRecharge")));
    },
    onSettled: (_data, error) => attempt.finish(error),
  });

  const quickAmounts = [10, 50, 100, 500];
  const missing = useMemo(() => {
    if (required == null || effectiveAvailable == null) return null;
    return Math.max(0, Math.ceil(required) - Number(effectiveAvailable));
  }, [effectiveAvailable, required]);

  if (!open) return null;

  return createPortal(
    <>
      <div className="fixed top-0 left-0 z-[90] h-dvh w-screen bg-black/82 backdrop-blur-sm" />
      <div className="fixed top-0 left-0 z-[91] flex h-dvh w-screen items-center justify-center px-4 py-6">
        <div className="relative max-h-[calc(100dvh-3rem)] w-full max-w-[560px] overflow-y-auto rounded-3xl bg-[oklch(0.19_0_0)] text-white shadow-[0_36px_110px_rgba(0,0,0,0.72),inset_0_1px_0_rgba(255,255,255,0.16)]">
          <GlassRim className="opacity-70" />
          <button
            type="button"
            aria-label={t("close")}
            onClick={close}
            className="absolute top-4 right-4 z-20 flex size-9 items-center justify-center rounded-full bg-white/[0.08] text-white/70 transition-colors hover:bg-white/[0.14] hover:text-white"
          >
            <IconX className="size-4" stroke={1.8} />
          </button>

          <div className="relative grid gap-5 p-5 sm:p-6">
            <div className="grid gap-5 sm:grid-cols-[1fr_168px] sm:items-center">
              <div className="min-w-0 pr-8 sm:pr-0">
                <div className="mb-3 inline-flex h-8 items-center gap-1.5 rounded-full bg-white/[0.08] px-3 text-xs font-medium text-white/75">
                  <IconBolt className="size-3.5" stroke={1.8} />
                  {required != null ? t("eyebrow") : ts("computeCredits")}
                </div>
                <h2 className="max-w-[360px] text-2xl leading-tight font-semibold tracking-normal text-white sm:text-3xl">
                  {t(required != null ? "title" : "rechargeTitle")}
                </h2>
                <p className="mt-2 max-w-[390px] text-sm leading-6 text-white/58">
                  {required == null
                    ? t("rechargeBody")
                    : modelName
                      ? t("bodyWithModel", { model: modelName })
                      : t("body")}
                </p>
              </div>

              <div className="relative hidden h-[156px] overflow-hidden rounded-2xl bg-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] sm:block">
                <div className="absolute inset-x-5 top-5 flex items-center justify-between">
                  <span className="h-2 w-16 rounded-full bg-white/20" />
                  <IconShieldCheck className="size-5 text-white/55" stroke={1.6} />
                </div>
                <div className="absolute right-5 bottom-5 left-5 grid gap-2">
                  {[0, 1, 2].map((index) => (
                    <div
                      key={index}
                      className={cn(
                        "flex h-9 items-center justify-between rounded-xl px-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.13)]",
                        index === 0 ? "bg-[#E52227]" : "bg-white/[0.09]"
                      )}
                    >
                      <span className="h-2 w-16 rounded-full bg-white/55" />
                      <span className="h-2 w-8 rounded-full bg-white/30" />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className={cn("grid gap-2", required != null && "grid-cols-3")}>
              <Metric label={t("available")} value={effectiveAvailable?.toLocaleString() ?? "—"} />
              {required != null && (
                <>
                  <Metric label={t("required")} value={Math.ceil(required).toLocaleString()} />
                  <Metric label={t("missing")} value={missing?.toLocaleString() ?? "—"} />
                </>
              )}
            </div>

            {canRecharge ? (
              <div className="grid gap-4 rounded-2xl bg-white/[0.055] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
                <div className="flex flex-wrap gap-2">
                  {quickAmounts.map((value) => (
                    <button
                      key={value}
                      type="button"
                      disabled={recharge.isPending}
                      onClick={() => setCustomAmount(String(value))}
                      className={cn(
                        "h-9 rounded-xl px-3 text-sm font-medium tabular-nums transition-colors disabled:opacity-50",
                        amountNum === value
                          ? "bg-white text-background"
                          : "bg-white/[0.08] text-white/75 hover:bg-white/[0.13] hover:text-white"
                      )}
                    >
                      {sym}
                      {value}
                    </button>
                  ))}
                </div>

                <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                  <label className="grid gap-1.5">
                    <span className="text-xs text-white/45">
                      {ts(isCn ? "amountCnyRange" : "amountUsdRange")}
                    </span>
                    <div className="relative">
                      <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-white/45">
                        {sym}
                      </span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={10}
                        max={5000}
                        value={amount}
                        onChange={(event) => setCustomAmount(event.target.value)}
                        className="h-11 w-full rounded-xl bg-white/[0.08] pr-3 pl-7 text-sm font-medium tabular-nums text-white outline-none transition-colors placeholder:text-white/30 focus:bg-white/[0.12]"
                      />
                    </div>
                  </label>
                  <div className="px-1 py-1.5">
                    <span className="flex items-center gap-1 text-base font-semibold tabular-nums">
                      <span className="text-sm font-medium text-white/55">≈</span>
                      <IconBolt className="size-4 text-white/80" stroke={1.8} />
                      {estimatedCredits != null ? estimatedCredits.toLocaleString() : "—"}
                    </span>
                  </div>
                </div>

                <Button
                  type="button"
                  variant="primary-cta"
                  disabled={!amountValid || recharge.isPending}
                  onClick={() => recharge.mutate()}
                  className="h-11 w-full rounded-xl text-sm font-semibold shadow-lg shadow-[#E52227]/25"
                >
                  {recharge.isPending ? (
                    <IconLoader2 className="size-4 animate-spin" />
                  ) : (
                    <IconCreditCard className="size-4" stroke={1.8} />
                  )}
                  {t("cta")}
                  <IconArrowRight className="size-4" stroke={1.8} />
                </Button>
                <p className="text-center text-xs leading-5 text-white/42">
                  {ts(isCn ? "secureCheckoutNoteWechat" : "secureCheckoutNote")}
                </p>
              </div>
            ) : (
              <div className="flex items-start gap-3 rounded-2xl bg-white/[0.055] p-4 text-sm text-white/65">
                <IconWallet className="mt-0.5 size-5 shrink-0 text-white/55" stroke={1.6} />
                <p>{t("billingAdminOnly")}</p>
              </div>
            )}
          </div>
        </div>
      </div>

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
            setWechatScan(null);
            close();
          }}
        />
      )}
    </>,
    document.body
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/[0.055] px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]">
      <span className="block text-xs text-white/42">{label}</span>
      <span className="mt-1 flex items-center gap-1 text-base font-semibold tabular-nums text-white">
        <IconBolt className="size-3.5 text-white/70" stroke={1.8} />
        {value}
      </span>
    </div>
  );
}
