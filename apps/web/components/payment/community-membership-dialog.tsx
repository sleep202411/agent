"use client";

// Community membership (社区会员) purchase dialog, on the NestJS `/aurora/billing`
// path. Lists the `community_membership` plan's monthly + yearly prices and
// starts a hosted checkout. Distinct from:
//  - CommunityRechargeDialog — community-point top-ups (a wallet, not a plan).
//  - the legacy Java VIP upgrade dialog — studio membership.
// On provider success the webhook fulfills an EntitlementGrant; the success
// return URL (`?membership=success`) fires onSuccess (refresh membership state).

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { IconCheck, IconCrown, IconLoader2, IconSparkles } from "@tabler/icons-react";
import { toast } from "sonner";
import { useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { siteConfig } from "@/src/config/site";
import { ApiRequestError } from "@/src/lib/api";
import {
  axonAleid,
  axonAddToCart,
  axonBeginCheckout,
  axonFlushPendingPurchase,
  axonStashPendingPurchase,
  axonViewItem,
} from "@/src/lib/axon";
import {
  createBillingCheckout,
  isWechatScanUrl,
  listMembershipPlans,
  priceEffectiveAmountMinor,
} from "@/src/lib/billing/api";
import { WechatScanPayDialog } from "./wechat-scan-pay-dialog";

// Module-level so the `?membership=success` return is handled once per page load
// (the provider redirect back is a full page load), across all mounted instances.
let returnClaimed = false;
// sessionStorage key holding the pending purchase to fire the browser `purchase`
// conversion (with the order id as dedupe_id) on the `?membership=success` return.
const AXON_PENDING_PURCHASE_KEY = "axon_pending_purchase:membership";

export interface CommunityMembershipDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired on the `?membership=success` return (e.g. refetch membership state). */
  onSuccess?: () => void | Promise<void>;
}

export function CommunityMembershipDialog({
  open,
  onOpenChange,
  onSuccess,
}: CommunityMembershipDialogProps) {
  const t = useTranslations("payment");
  const [currency] = useState(siteConfig.defaultCurrency);
  const [selectedPriceId, setSelectedPriceId] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [wechatScan, setWechatScan] = useState<{
    orderId: string;
    codeUrl: string;
    amountLabel: string;
  } | null>(null);

  // Idempotency key bound to one (priceId, currency) intent; regenerated when the
  // intent changes, cleared on a failed/incomplete attempt so a retry is fresh.
  const idemKeyRef = useRef<{ sig: string; key: string } | null>(null);
  useEffect(() => {
    if (!open) idemKeyRef.current = null;
  }, [open]);

  const plansQuery = useQuery({
    queryKey: ["billing", "community-membership-plans", currency],
    queryFn: () => listMembershipPlans({ productType: "community_membership_plan", currency }),
    enabled: open,
    staleTime: 60_000,
  });

  const plan = plansQuery.data?.plans?.[0] ?? null;
  const monthly = plan?.prices.find((p) => p.isActive && p.interval === "month") ?? null;
  const yearly = plan?.prices.find((p) => p.isActive && p.interval === "year") ?? null;
  const hasPrices = Boolean(monthly || yearly);

  // Annual savings vs 12× monthly — drives the "Save X%" badge on the yearly card.
  const yearlySavePercent =
    monthly && yearly
      ? Math.max(
          0,
          Math.round((1 - Number(yearly.amountMinor) / (Number(monthly.amountMinor) * 12)) * 100)
        )
      : 0;

  // Default selection: yearly (better value) when present, else monthly.
  const selected =
    [monthly, yearly].find((p) => p && p.id === selectedPriceId) ?? yearly ?? monthly ?? null;

  const currencySymbol = siteConfig.currencies.find((c) => c.code === currency)?.symbol ?? "$";
  const fmtFiat = (minor: number | string) => (Number(minor) / 100).toFixed(2);

  // Fire the AppLovin `view_item` conversion once per dialog open, after the plan
  // prices have loaded — the plan as the item, valued at the default-selected
  // price's effective amount (cents → divide by 100). No-op off .com (axon.ts).
  const viewItemFiredRef = useRef(false);
  useEffect(() => {
    if (!open) {
      viewItemFiredRef.current = false;
      return;
    }
    if (viewItemFiredRef.current || !plan || !selected) return;
    viewItemFiredRef.current = true;
    const value = Number(priceEffectiveAmountMinor(selected)) / 100;
    axonViewItem({
      items: [{ item_id: plan.id, item_name: plan.name, price: value, quantity: 1 }],
      value,
      currency: selected.currency,
    });
  }, [open, plan, selected]);

  // Handle the provider success return once per page load.
  useEffect(() => {
    if (returnClaimed) return;
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("membership");
    if (outcome !== "success" && outcome !== "cancelled") return;
    returnClaimed = true;
    params.delete("membership");
    params.delete("id");
    const qs = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    if (outcome === "cancelled") return;
    // Fire the AppLovin browser `purchase` conversion with the SAME dedupe_id as
    // the server S2S report (the order id), so AppLovin merges the two (5-min
    // window) instead of double-counting. No-op off .com / when nothing pending.
    axonFlushPendingPurchase(AXON_PENDING_PURCHASE_KEY);
    const toastId = toast.loading(t("paymentProcessing"));
    void (async () => {
      try {
        await onSuccess?.();
        toast.success(t("paymentSuccess"), { id: toastId });
      } catch {
        toast.dismiss(toastId);
      }
    })();
  }, [onSuccess, t]);

  const handleSubscribe = async () => {
    if (!selected) return;
    // Fire AppLovin purchase-funnel conversions at subscribe initiation
    // (before the provider redirect). Effective price is in cents → divide by
    // 100. No-op off .com (axon.ts).
    {
      const value = Number(priceEffectiveAmountMinor(selected)) / 100;
      const items = [
        {
          item_id: selected.id,
          item_name: plan?.name ?? "Community membership",
          price: value,
          quantity: 1,
        },
      ];
      axonAddToCart({
        items,
        currency: selected.currency,
        value,
      });
      axonBeginCheckout({
        items,
        currency: selected.currency,
        value,
      });
    }
    setPaying(true);
    const sig = `${selected.id}:${currency}`;
    if (idemKeyRef.current?.sig !== sig) {
      idemKeyRef.current = { sig, key: crypto.randomUUID() };
    }
    const base = `${window.location.origin}${window.location.pathname}`;
    const aleid = axonAleid();
    try {
      const result = await createBillingCheckout({
        priceId: selected.id,
        quantity: 1,
        idempotencyKey: idemKeyRef.current.key,
        successUrl: `${base}?membership=success`,
        backUrl: `${base}?membership=cancelled`,
        ...(aleid ? { attribution: { aleid } } : {}),
      });
      const url = result.paymentIntent?.checkoutUrl;
      if (url) {
        // Stash the purchase so the `?membership=success` return fires the browser
        // `purchase` event with the order id as dedupe_id (matches the S2S report).
        const orderId = result.order.orderNo ?? result.order.id;
        const value = Number(priceEffectiveAmountMinor(selected)) / 100;
        axonStashPendingPurchase(AXON_PENDING_PURCHASE_KEY, {
          transactionId: orderId,
          value,
          currency: selected.currency,
          items: [
            {
              item_id: selected.id,
              item_name: plan?.name ?? "Community membership",
              price: value,
              quantity: 1,
            },
          ],
        });
        // WeChat 扫码 returns a weixin:// code_url — render a QR to scan, not a
        // desktop navigation (which just prompts a useless "Open WeChat?").
        if (isWechatScanUrl(url)) {
          setWechatScan({
            orderId: result.order.id,
            codeUrl: url,
            amountLabel: `${currencySymbol}${value.toFixed(2)}`,
          });
          return;
        }
        if (window.self !== window.top) {
          window.parent.postMessage({ type: "navigateToPayment", url }, "*");
        } else {
          window.location.assign(url);
        }
      } else {
        idemKeyRef.current = null;
        toast.error(t("paymentNoCheckoutUrl"));
      }
    } catch (e) {
      idemKeyRef.current = null;
      const apiMsg = e instanceof ApiRequestError ? e.message : null;
      toast.error(apiMsg || (e instanceof Error ? e.message : null) || t("paymentFailed"));
    } finally {
      setPaying(false);
    }
  };

  const benefits = [
    t("communityMembershipBenefitFreeViewing"),
    t("communityMembershipBenefitDiscount"),
    t("communityMembershipBenefitExclusive"),
  ];

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <IconCrown className="size-5 text-primary" />
              {t("communityMembershipTitle")}
            </DialogTitle>
            <DialogDescription>{t("communityMembershipDesc")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 p-4">
            <ul className="space-y-2">
              {benefits.map((b) => (
                <li key={b} className="flex items-start gap-2 text-sm text-foreground">
                  <IconSparkles className="mt-0.5 size-4 shrink-0 text-primary" />
                  {b}
                </li>
              ))}
            </ul>

            {plansQuery.isLoading ? (
              <div className="flex h-28 items-center justify-center">
                <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : !plan || !hasPrices ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                {t("communityMembershipNoPlan")}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {monthly && (
                  <IntervalCard
                    label={t("communityMembershipMonthly")}
                    unit={t("communityMembershipPerMonth")}
                    price={`${currencySymbol}${fmtFiat(priceEffectiveAmountMinor(monthly))}`}
                    originalPrice={
                      monthly.activeDiscount
                        ? `${currencySymbol}${fmtFiat(monthly.amountMinor)}`
                        : undefined
                    }
                    badge={monthly.activeDiscount ? t("communityMembershipSaleBadge") : undefined}
                    selected={selected?.id === monthly.id}
                    onSelect={() => setSelectedPriceId(monthly.id)}
                  />
                )}
                {yearly && (
                  <IntervalCard
                    label={t("communityMembershipYearly")}
                    unit={t("communityMembershipPerYear")}
                    price={`${currencySymbol}${fmtFiat(priceEffectiveAmountMinor(yearly))}`}
                    originalPrice={
                      yearly.activeDiscount
                        ? `${currencySymbol}${fmtFiat(yearly.amountMinor)}`
                        : undefined
                    }
                    badge={
                      yearly.activeDiscount
                        ? t("communityMembershipSaleBadge")
                        : yearlySavePercent > 0
                          ? t("communityMembershipSave", { percent: yearlySavePercent })
                          : undefined
                    }
                    selected={selected?.id === yearly.id}
                    onSelect={() => setSelectedPriceId(yearly.id)}
                  />
                )}
              </div>
            )}

            <Button
              className="w-full"
              onClick={() => void handleSubscribe()}
              disabled={paying || !selected}
            >
              {paying && <IconLoader2 className="size-4 animate-spin" />}
              {t("communityMembershipSubscribe")}
              {selected
                ? ` · ${currencySymbol}${fmtFiat(priceEffectiveAmountMinor(selected))}`
                : ""}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {wechatScan && (
        <WechatScanPayDialog
          key={wechatScan.orderId}
          open
          orderId={wechatScan.orderId}
          codeUrl={wechatScan.codeUrl}
          amountLabel={wechatScan.amountLabel}
          onClose={() => setWechatScan(null)}
          onPaid={() => {
            setWechatScan(null);
            toast.success(t("paymentSuccess"));
            void onSuccess?.();
            onOpenChange(false);
          }}
        />
      )}
    </>
  );
}

function IntervalCard({
  label,
  unit,
  price,
  originalPrice,
  badge,
  selected,
  onSelect,
}: {
  label: string;
  unit: string;
  price: string;
  /** List price shown struck-through when an automatic sale is active. */
  originalPrice?: string;
  badge?: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "relative flex flex-col items-center gap-1.5 overflow-hidden rounded-2xl border px-3 py-5 text-center transition-all",
        selected
          ? "border-primary ring-2 ring-primary/50"
          : "border-border/60 hover:border-border hover:bg-muted/20"
      )}
    >
      {badge && (
        <span className="absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
          {badge}
        </span>
      )}
      <span className={cn("text-xs font-medium text-muted-foreground", badge && "mt-3")}>
        {label}
      </span>
      {originalPrice && (
        <span className="text-xs font-medium tabular-nums text-muted-foreground line-through">
          {originalPrice}
        </span>
      )}
      <span className="text-xl font-bold leading-none tabular-nums text-foreground">{price}</span>
      <span className="text-[11px] text-muted-foreground">{unit}</span>
      {selected && (
        <span className="absolute right-2 top-2 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
          <IconCheck className="size-3.5" />
        </span>
      )}
    </button>
  );
}
