"use client";

// Community-point top-up dialog, wired to the NestJS billing path
// (`/aurora/billing/*`). Distinct from CreditsRechargeDialog, which tops up
// Studio (AI generation) credits via the legacy Java payment service.
//
// Flow: list `community_point_pack` packages for the chosen fiat currency →
// create a hosted checkout → redirect to the provider (Airwallex) → on payment
// the provider webhook credits the user's PG `community_point` wallet, and the
// success return URL (`?recharge=success`) lands the user back here, where we
// fire onSuccess (refresh balance) and clean the query string.

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { IconCheck, IconLoader2 } from "@tabler/icons-react";
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
import { createBillingCheckout, listCommunityPointPackages } from "@/src/lib/billing/api";

export interface CommunityRechargeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired when the provider redirect returns with `?recharge=success`. */
  onSuccess?: () => void;
}

export function CommunityRechargeDialog({
  open,
  onOpenChange,
  onSuccess,
}: CommunityRechargeDialogProps) {
  const t = useTranslations("payment");
  const [currency, setCurrency] = useState(siteConfig.defaultCurrency);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  // React Query owns the fetch — no setState-in-effect. Only runs while open.
  const packagesQuery = useQuery({
    queryKey: ["billing", "community-point-packages", currency],
    queryFn: () => listCommunityPointPackages(currency),
    enabled: open,
    staleTime: 60_000,
  });
  const packages = (packagesQuery.data?.prices ?? []).filter((p) => p.isActive);
  // Derived selection: explicit choice if still present, else the first package.
  // Avoids an effect to reset the selection when the currency/list changes.
  const selected = packages.find((p) => p.id === selectedId) ?? packages[0] ?? null;

  // Handle the provider success/cancel return exactly once. No component state is
  // set here (callback + toast + URL cleanup only), so it doesn't trip
  // react-hooks/set-state-in-effect.
  const handledReturn = useRef(false);
  useEffect(() => {
    if (handledReturn.current) return;
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("recharge");
    if (outcome !== "success" && outcome !== "cancelled") return;
    handledReturn.current = true;
    params.delete("recharge");
    const qs = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    if (outcome === "success") {
      onSuccess?.();
      toast.success(t("paymentSuccess"));
    }
  }, [onSuccess, t]);

  const currencySymbol = siteConfig.currencies.find((c) => c.code === currency)?.symbol ?? "$";
  const fmtFiat = (minor: string) => (Number(minor) / 100).toFixed(2);

  // Plain function — the React Compiler memoizes; a manual useCallback whose dep
  // is the derived `selected` trips react-hooks/preserve-manual-memoization.
  const handlePay = async () => {
    if (!selected) return;
    setPaying(true);
    try {
      const base = `${window.location.origin}${window.location.pathname}`;
      const result = await createBillingCheckout({
        priceId: selected.id,
        quantity: 1,
        idempotencyKey: crypto.randomUUID(),
        successUrl: `${base}?recharge=success`,
        backUrl: `${base}?recharge=cancelled`,
      });
      const url = result.paymentIntent?.checkoutUrl;
      if (url) {
        // Inside the legacy iframe wrapper, ask the shell to navigate the top
        // window; otherwise redirect this window to the hosted checkout.
        if (window.self !== window.top) {
          window.parent.postMessage({ type: "navigateToPayment", url }, "*");
        } else {
          window.location.assign(url);
        }
      } else {
        toast.error(t("paymentNoCheckoutUrl"));
      }
    } catch (e) {
      const apiMsg = e instanceof ApiRequestError ? e.message : null;
      toast.error(apiMsg || (e instanceof Error ? e.message : null) || t("paymentFailed"));
    } finally {
      setPaying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("credits")}</DialogTitle>
          <DialogDescription className="sr-only">{t("creditsRechargeDesc")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 p-4">
          {siteConfig.currencies.length > 1 && (
            <div className="flex items-center justify-center gap-1 rounded-full border border-border bg-muted/30 p-1">
              {siteConfig.currencies.map((c) => (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => setCurrency(c.code)}
                  className={cn(
                    "rounded-full px-4 py-1.5 text-xs font-medium transition-all",
                    currency === c.code
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {c.symbol} {c.code}
                </button>
              ))}
            </div>
          )}

          {packagesQuery.isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : packages.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">{t("noPackages")}</div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {packages.map((pkg) => {
                const isSelected = selected?.id === pkg.id;
                return (
                  <button
                    key={pkg.id}
                    type="button"
                    onClick={() => setSelectedId(pkg.id)}
                    className={cn(
                      "flex flex-col items-center rounded-xl border p-4 transition-all",
                      isSelected
                        ? "border-primary bg-primary/5"
                        : "border-border/60 hover:border-border"
                    )}
                  >
                    <div className="text-2xl font-bold tabular-nums">
                      {pkg.grantsWalletAmount ?? "0"}
                    </div>
                    <div className="mb-3 text-xs text-muted-foreground">{t("creditsUnit")}</div>
                    <div className="text-lg font-semibold">
                      <span className="text-sm font-normal text-muted-foreground">
                        {currencySymbol}
                      </span>
                      {fmtFiat(pkg.amountMinor)}
                    </div>
                    {isSelected && <IconCheck className="mt-2 size-4 text-primary" />}
                  </button>
                );
              })}
            </div>
          )}

          {selected && (
            <Button className="w-full" onClick={() => void handlePay()} disabled={paying}>
              {paying && <IconLoader2 className="size-4 animate-spin" />}
              {t("payNow")} {currencySymbol}
              {fmtFiat(selected.amountMinor)}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
