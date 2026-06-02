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
//
// Two ways to buy:
//  - Preset cards — each maps to a `community_point_pack` price (quantity = 1).
//  - Custom amount — reuses the SINGLE unit price
//    (`COMMUNITY_POINT_UNIT_USD`, $1 → 100 pts) with quantity = whole dollars,
//    so $40 → priceId=unit, quantity=40 → 4000 points. The unit price is NOT a
//    customer-facing card; it is excluded from the grid and only powers this
//    input. If the unit price is missing from the list the section is hidden.

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { IconCheck, IconCoins, IconLoader2 } from "@tabler/icons-react";
import { toast } from "sonner";
import { useTranslations } from "@/src/i18n/i18n";
import { useCommunityPointBalance } from "@/src/lib/ip-commerce";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { siteConfig } from "@/src/config/site";
import { ApiRequestError } from "@/src/lib/api";
import {
  createBillingCheckout,
  listCommunityPointPackages,
  type BillingPackage,
} from "@/src/lib/billing/api";

// Catalog code of the $1 → 100pt unit price that backs the custom-amount input.
// NOT a customer-facing tier — excluded from the preset grid.
const UNIT_PACKAGE_CODE = "COMMUNITY_POINT_UNIT_USD";
// Minimum whole-dollar amount for a custom top-up.
const CUSTOM_MIN_DOLLARS = 10;

// Survives across all dialog instances in one page load (reset on the full-page
// redirect back from the provider). Ensures the `?recharge=success` return is
// processed by exactly one instance — see the return-handler effect below.
let returnClaimed = false;
const RECHARGE_PENDING_KEY = "community_recharge_pending";

export interface CommunityRechargeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired when the provider redirect returns with `?recharge=success`. May
   *  return a promise (e.g. a balance refetch) — the dialog awaits it and shows
   *  a "processing" state, keeping the success marker until it resolves. */
  onSuccess?: () => void | Promise<void>;
}

// The concrete purchase intent the pay button submits: a price + quantity.
// Presets are { priceId, quantity: 1 }; custom is { unitPriceId, dollars }.
type PurchaseIntent = { priceId: string; quantity: number };

export function CommunityRechargeDialog({
  open,
  onOpenChange,
  onSuccess,
}: CommunityRechargeDialogProps) {
  const t = useTranslations("payment");
  const [currency, setCurrency] = useState(siteConfig.defaultCurrency);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [customDollars, setCustomDollars] = useState("");
  const [customActive, setCustomActive] = useState(false);
  const [paying, setPaying] = useState(false);

  const { balance } = useCommunityPointBalance(open);

  // Idempotency key bound to ONE concrete submit intent (priceId + quantity +
  // currency). The server returns the prior order for a repeated
  // (userId, idempotencyKey) without checking the price/quantity, so the key
  // must NOT outlive the intent — it is regenerated when the resolved priceId,
  // quantity OR currency changes (in handlePay below), and cleared on a
  // failed/incomplete attempt so a retry starts a fresh order. Genuine
  // double-clicks are already blocked by the `paying` guard.
  const idemKeyRef = useRef<{ sig: string; key: string } | null>(null);
  useEffect(() => {
    if (!open) idemKeyRef.current = null;
  }, [open]);

  // React Query owns the fetch — no setState-in-effect. Only runs while open.
  const packagesQuery = useQuery({
    queryKey: ["billing", "community-point-packages", currency],
    queryFn: () => listCommunityPointPackages(currency),
    enabled: open,
    staleTime: 60_000,
  });
  const allPackages = (packagesQuery.data?.prices ?? []).filter((p) => p.isActive);
  // The $1 unit price that powers the custom-amount input. Excluded from cards.
  const unitPackage = allPackages.find((p) => p.code === UNIT_PACKAGE_CODE) ?? null;
  const presetPackages = allPackages.filter((p) => p.code !== UNIT_PACKAGE_CODE);
  // Points granted per whole dollar of the unit price (e.g. 100). Used to
  // live-preview the custom amount's payout.
  const pointsPerUnit = Number(unitPackage?.grantsWalletAmount ?? "0") || 0;

  // Currencies that actually have at least one active package right now. Avoids
  // rendering an empty SGD tab when only USD is stocked. Plain derived value —
  // the React Compiler memoizes; a manual useMemo over the inline-derived
  // `allPackages` trips react-hooks/preserve-manual-memoization.
  const stockedCurrencies = new Set([currency, ...allPackages.map((p) => p.currency)]);
  const availableCurrencies = siteConfig.currencies.filter((c) => stockedCurrencies.has(c.code));

  // Derived preset selection: explicit choice if still present, else the first
  // preset. Avoids an effect to reset selection when currency/list changes.
  const selectedPreset =
    presetPackages.find((p) => p.id === selectedId) ?? presetPackages[0] ?? null;

  // Parse / validate the custom dollar amount (whole integers, >= min).
  const customDollarsNum = Number(customDollars);
  const customValid =
    customDollars.trim() !== "" &&
    Number.isInteger(customDollarsNum) &&
    customDollarsNum >= CUSTOM_MIN_DOLLARS;
  const customPoints = customValid ? customDollarsNum * pointsPerUnit : 0;

  // The active purchase intent + its fiat total in minor units. Custom wins when
  // the user has engaged the custom input; otherwise the selected preset card.
  const { intent, totalMinor }: { intent: PurchaseIntent | null; totalMinor: number } = (() => {
    if (customActive && unitPackage && customValid) {
      return {
        intent: { priceId: unitPackage.id, quantity: customDollarsNum },
        totalMinor: Number(unitPackage.amountMinor) * customDollarsNum,
      };
    }
    if (!customActive && selectedPreset) {
      return {
        intent: { priceId: selectedPreset.id, quantity: 1 },
        totalMinor: Number(selectedPreset.amountMinor),
      };
    }
    return { intent: null, totalMinor: 0 };
  })();

  // Handle the provider success/cancel return exactly once PER PAGE LOAD, across
  // ALL mounted instances. The site mounts a global wallet-chip dialog AND
  // page-level dialogs (e.g. the IP detail page) simultaneously; without a
  // cross-instance claim, each would fire its own loading/success toast and
  // refetch on the same `?recharge=success` return. A module-level flag
  // (`returnClaimed`, reset because the provider redirect back is a full page
  // load) lets the first instance win; the rest bail. The URL marker is cleared
  // synchronously on claim so nothing re-handles it, and a sessionStorage flag
  // preserves the "pending balance refresh" so a failed refresh retries on
  // reload. (No component setState here — so it doesn't trip
  // react-hooks/set-state-in-effect.)
  useEffect(() => {
    if (returnClaimed) return;
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("recharge");
    const pending = window.sessionStorage?.getItem(RECHARGE_PENDING_KEY) === "1";
    if (outcome !== "success" && outcome !== "cancelled" && !pending) return;
    returnClaimed = true;

    const cleanUrl = () => {
      params.delete("recharge");
      const qs = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    };

    if (outcome === "cancelled") {
      cleanUrl();
      return;
    }

    // Claim synchronously: drop the URL marker now (so a second instance can't
    // re-handle it) and persist the pending state. The provider webhook credits
    // the wallet asynchronously, so refetch now and again after a short delay to
    // cover the lag, showing a processing state in between. On success clear the
    // pending flag; on failure keep it so a reload retries.
    cleanUrl();
    window.sessionStorage?.setItem(RECHARGE_PENDING_KEY, "1");
    const toastId = toast.loading(t("paymentProcessing"));
    void (async () => {
      try {
        await onSuccess?.();
        await sleep(2500);
        await onSuccess?.();
        window.sessionStorage?.removeItem(RECHARGE_PENDING_KEY);
        toast.success(t("paymentSuccess"), { id: toastId });
      } catch {
        toast.error(t("paymentBalanceRefreshFailed"), { id: toastId });
      }
    })();
  }, [onSuccess, t]);

  const currencySymbol = siteConfig.currencies.find((c) => c.code === currency)?.symbol ?? "$";
  const fmtFiat = (minor: number | string) => (Number(minor) / 100).toFixed(2);
  const fmtPoints = (n: number | string) => Number(n).toLocaleString();

  // Plain function — the React Compiler memoizes; a manual useCallback whose dep
  // is the derived `intent` trips react-hooks/preserve-manual-memoization.
  const handlePay = async () => {
    if (!intent) return;
    setPaying(true);
    // Fresh key whenever the intent (priceId + quantity + currency) differs from
    // the last attempt, so switching packages — or changing the custom amount —
    // can never reuse a prior intent's order.
    const intentSig = `${intent.priceId}:${intent.quantity}:${currency}`;
    if (idemKeyRef.current?.sig !== intentSig) {
      idemKeyRef.current = { sig: intentSig, key: crypto.randomUUID() };
    }
    try {
      const base = `${window.location.origin}${window.location.pathname}`;
      const result = await createBillingCheckout({
        priceId: intent.priceId,
        quantity: intent.quantity,
        idempotencyKey: idemKeyRef.current.key,
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
        // No hosted-checkout URL — drop the key so a retry opens a fresh order
        // rather than rebinding to this incomplete attempt.
        idemKeyRef.current = null;
        toast.error(t("paymentNoCheckoutUrl"));
      }
    } catch (e) {
      // Order/provider failure — discard the key so the next click is a clean
      // intent, not a replay that could resurface a half-created order.
      idemKeyRef.current = null;
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
          <DialogTitle>{t("communityRechargeTitle")}</DialogTitle>
          <DialogDescription className="sr-only">{t("communityRechargeDesc")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 p-4">
          {/* Balance header — current consumable community-point wallet. */}
          <div className="flex items-center justify-between rounded-xl border border-border/60 bg-muted/30 p-4 backdrop-blur-sm">
            <div className="flex items-center gap-2.5">
              <span className="grid size-9 place-items-center rounded-lg bg-primary/15 text-primary">
                <IconCoins className="size-5" />
              </span>
              <span className="text-xs text-muted-foreground">{t("communityBalanceLabel")}</span>
            </div>
            <div className="text-2xl font-bold tabular-nums text-foreground">
              {fmtPoints(balance)}
            </div>
          </div>

          {/* Currency toggle — only currencies with active packages. */}
          {availableCurrencies.length > 1 && (
            <div className="flex items-center justify-center gap-1 rounded-full border border-border bg-muted/30 p-1">
              {availableCurrencies.map((c) => (
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
          ) : presetPackages.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">{t("noPackages")}</div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {presetPackages.map((pkg) => (
                <PresetCard
                  key={pkg.id}
                  pkg={pkg}
                  selected={!customActive && selectedPreset?.id === pkg.id}
                  currencySymbol={currencySymbol}
                  fmtFiat={fmtFiat}
                  fmtPoints={fmtPoints}
                  pointsUnit={t("creditsUnit")}
                  onSelect={() => {
                    setCustomActive(false);
                    setSelectedId(pkg.id);
                  }}
                />
              ))}
            </div>
          )}

          {/* Custom amount — degrades gracefully (hidden) if the unit price is
              not synced into the list yet. */}
          {unitPackage && (
            <div
              className={cn(
                "space-y-2 rounded-xl border p-4 transition-all",
                customActive ? "border-primary bg-primary/5" : "border-border/60"
              )}
            >
              <Label htmlFor="community-custom-amount" className="text-xs text-muted-foreground">
                {t("customAmountLabel")}
              </Label>
              <div className="flex items-center gap-3">
                <div className="relative flex-1">
                  <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    {currencySymbol}
                  </span>
                  <Input
                    id="community-custom-amount"
                    type="number"
                    inputMode="numeric"
                    min={CUSTOM_MIN_DOLLARS}
                    step={1}
                    size="lg"
                    placeholder={String(CUSTOM_MIN_DOLLARS)}
                    value={customDollars}
                    onFocus={() => setCustomActive(true)}
                    onChange={(e) => {
                      setCustomActive(true);
                      setCustomDollars(e.target.value);
                    }}
                    className="pl-6 tabular-nums"
                  />
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-lg font-bold tabular-nums text-foreground">
                    {fmtPoints(customPoints)}
                  </div>
                  <div className="text-[11px] text-muted-foreground">{t("creditsUnit")}</div>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {customActive && customDollars.trim() !== "" && !customValid
                  ? t("customAmountMin", { min: CUSTOM_MIN_DOLLARS })
                  : t("customAmountHint", { min: CUSTOM_MIN_DOLLARS })}
              </p>
            </div>
          )}

          <Button className="w-full" onClick={() => void handlePay()} disabled={paying || !intent}>
            {paying && <IconLoader2 className="size-4 animate-spin" />}
            {t("payNow")} {intent ? `${currencySymbol}${fmtFiat(totalMinor)}` : ""}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PresetCard({
  pkg,
  selected,
  currencySymbol,
  fmtFiat,
  fmtPoints,
  pointsUnit,
  onSelect,
}: {
  pkg: BillingPackage;
  selected: boolean;
  currencySymbol: string;
  fmtFiat: (minor: number | string) => string;
  fmtPoints: (n: number | string) => string;
  pointsUnit: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "relative flex flex-col items-center rounded-xl border p-4 transition-all",
        selected ? "border-primary bg-primary/5" : "border-border/60 hover:border-border"
      )}
    >
      <div className="text-2xl font-bold tabular-nums text-foreground">
        {fmtPoints(pkg.grantsWalletAmount ?? "0")}
      </div>
      <div className="mb-3 text-xs text-muted-foreground">{pointsUnit}</div>
      <div className="text-lg font-semibold">
        <span className="text-sm font-normal text-muted-foreground">{currencySymbol}</span>
        {fmtFiat(pkg.amountMinor)}
      </div>
      {selected && (
        <span className="absolute right-2 top-2 text-primary">
          <IconCheck className="size-4" />
        </span>
      )}
    </button>
  );
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
