"use client";

// Community-point top-up dialog, wired to the NestJS billing path
// (`/aurora/billing/*`). Distinct from CreditsRechargeDialog, which tops up
// Studio (AI generation) credits via the legacy Java payment service.
//
// Two ways to buy:
//  - Preset cards — each maps to a `community_point_pack` price (quantity = 1),
//    paid via a provider hosted checkout (`/billing/checkout`). The provider
//    returns a URL we redirect to.
//  - Custom amount — an arbitrary whole-dollar amount (`/billing/recharge-custom`)
//    paid via an Airwallex Payment Intent. A Payment Intent has NO server-issued
//    URL, so the browser SDK launches the Airwallex hosted page from the intent
//    id + client secret. Custom recharge is USD-only and only where Airwallex is
//    the provider (hidden on the WeChat-only CN cell).
//
// Either way the provider webhook credits the user's PG `community_point` wallet,
// and the success return URL (`?recharge=success`) lands the user back here, where
// we fire onSuccess (refresh balance) and clean the query string.

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { IconBolt, IconCheck, IconCoins, IconLoader2 } from "@tabler/icons-react";
import { toast } from "sonner";
import { useTranslations } from "@/src/i18n/i18n";
import { useCommunityPointBalance } from "@/src/lib/ip-commerce";
import { useCurrentUser } from "@/src/hooks/use-user";
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
  axonAleid,
  axonBeginCheckout,
  axonFlushPendingPurchase,
  axonStashPendingPurchase,
  axonViewItem,
} from "@/src/lib/axon";
import {
  createBillingCheckout,
  createCustomRecharge,
  listCommunityPointPackages,
  type BillingPackage,
} from "@/src/lib/billing/api";

// Whole-dollar bounds for a custom top-up (slider + input). Mirrors the server
// CreateCustomRechargeSchema, which is authoritative.
const CUSTOM_MIN_DOLLARS = 10;
const CUSTOM_MAX_DOLLARS = 5000;
// Points granted per US$1. Mirrors the hidden custom-recharge anchor SKU's
// grantsWalletAmount (server is authoritative; this only drives the live preview).
const POINTS_PER_DOLLAR = 100;
// Custom recharge is denominated in USD (the anchor SKU's currency).
const CUSTOM_CURRENCY = "USD";

// Survives across all dialog instances in one page load (reset on the full-page
// redirect back from the provider). Ensures the `?recharge=success` return is
// processed by exactly one instance — see the return-handler effect below.
let returnClaimed = false;
const RECHARGE_PENDING_KEY = "community_recharge_pending";
// sessionStorage key holding the pending purchase to fire the browser `purchase`
// conversion (with the order id as dedupe_id) on the `?recharge=success` return.
const AXON_PENDING_PURCHASE_KEY = "axon_pending_purchase:recharge";

export interface CommunityRechargeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired when the provider redirect returns with `?recharge=success`. May
   *  return a promise (e.g. a balance refetch) — the dialog awaits it and shows
   *  a "processing" state, keeping the success marker until it resolves. */
  onSuccess?: () => void | Promise<void>;
}

// The concrete purchase the pay button submits: a preset price, or a custom
// whole-dollar amount. Both carry the fiat total in minor units for the label.
type SubmitIntent =
  | { kind: "preset"; priceId: string; totalMinor: number }
  | { kind: "custom"; dollars: number; totalMinor: number };

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
  const { user } = useCurrentUser();

  // Idempotency key bound to ONE concrete submit intent. The server returns the
  // prior order for a repeated (userId, idempotencyKey) without re-checking the
  // amount, so the key must NOT outlive the intent — it is regenerated when the
  // resolved intent (preset price / custom dollars / currency) changes (in
  // handlePay below), and cleared on a failed/incomplete attempt so a retry
  // starts a fresh order. Genuine double-clicks are blocked by the `paying` guard.
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
  // Every listed price is a customer-facing preset: the custom-recharge anchor SKU
  // has no provider binding, so the server already excludes it from this listing.
  const presetPackages = (packagesQuery.data?.prices ?? []).filter((p) => p.isActive);

  // Custom amount needs Airwallex (Payment Intents) and is USD-denominated. Hidden
  // on the WeChat-only CN cell and when the user has toggled to a non-USD currency.
  const customRechargeEnabled =
    siteConfig.paymentProviders.includes("airwallex") && currency === CUSTOM_CURRENCY;

  // Currencies that actually have at least one active package right now. Avoids
  // rendering an empty SGD tab when only USD is stocked. Plain derived value —
  // the React Compiler memoizes; a manual useMemo over the inline-derived
  // `presetPackages` trips react-hooks/preserve-manual-memoization.
  const stockedCurrencies = new Set([currency, ...presetPackages.map((p) => p.currency)]);
  const availableCurrencies = siteConfig.currencies.filter((c) => stockedCurrencies.has(c.code));

  // Derived preset selection: explicit choice if still present, else the first
  // preset. Avoids an effect to reset selection when currency/list changes.
  const selectedPreset =
    presetPackages.find((p) => p.id === selectedId) ?? presetPackages[0] ?? null;

  // Parse / validate the custom dollar amount (whole integers, within bounds).
  const customDollarsNum = Number(customDollars);
  const customValid =
    customDollars.trim() !== "" &&
    Number.isInteger(customDollarsNum) &&
    customDollarsNum >= CUSTOM_MIN_DOLLARS &&
    customDollarsNum <= CUSTOM_MAX_DOLLARS;
  const customPoints = customValid ? customDollarsNum * POINTS_PER_DOLLAR : 0;

  // The active submit intent + its fiat total in minor units. Custom wins when the
  // user has engaged the custom input; otherwise the selected preset card.
  const submit: SubmitIntent | null = (() => {
    if (customActive && customRechargeEnabled && customValid) {
      return { kind: "custom", dollars: customDollarsNum, totalMinor: customDollarsNum * 100 };
    }
    if (!customActive && selectedPreset) {
      return {
        kind: "preset",
        priceId: selectedPreset.id,
        totalMinor: Number(selectedPreset.amountMinor),
      };
    }
    return null;
  })();

  // Fire the AppLovin `view_item` conversion once per dialog open, after the
  // preset packages have loaded — using the default-selected preset as the item
  // (amountMinor is in cents → divide by 100). No-op off .com (axon.ts).
  const viewItemFiredRef = useRef(false);
  useEffect(() => {
    if (!open) {
      viewItemFiredRef.current = false;
      return;
    }
    if (viewItemFiredRef.current || !selectedPreset) return;
    viewItemFiredRef.current = true;
    const value = Number(selectedPreset.amountMinor) / 100;
    axonViewItem({
      items: [
        { item_id: selectedPreset.id, item_name: selectedPreset.name, price: value, quantity: 1 },
      ],
      value,
      currency: selectedPreset.currency,
      userData: user
        ? { user_id: user.id, email: user.email ? user.email.toLowerCase() : undefined }
        : undefined,
    });
  }, [open, selectedPreset, user]);

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
      // Airwallex appends its own params (e.g. the intent id) on return; strip the
      // ones we recognise and keep the rest off the visible URL.
      params.delete("id");
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
    // Fire the AppLovin browser `purchase` conversion with the SAME dedupe_id as
    // the server S2S report (the order id), so AppLovin merges the two (5-min
    // window). Only on the genuine provider return (`outcome === "success"`), not
    // the pending-only reload that just retries the balance refresh. No-op off
    // .com / when nothing is pending.
    if (outcome === "success") {
      axonFlushPendingPurchase(AXON_PENDING_PURCHASE_KEY);
    }
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
  // is the derived `submit` trips react-hooks/preserve-manual-memoization.
  const handlePay = async () => {
    if (!submit) return;
    // Fire the AppLovin `begin_checkout` conversion at pay initiation (before the
    // provider redirect), for both the custom-amount and preset-package paths.
    // No-op off .com (axon.ts). Custom is USD whole-dollars; preset totalMinor is
    // cents → divide by 100.
    {
      const checkoutValue =
        submit.kind === "custom" ? submit.dollars : Number(submit.totalMinor) / 100;
      axonBeginCheckout({
        items: [
          submit.kind === "custom"
            ? {
                item_id: `custom:${submit.dollars}`,
                item_name: "Community points (custom)",
                price: checkoutValue,
                quantity: 1,
              }
            : {
                item_id: submit.priceId,
                item_name: selectedPreset?.name ?? "Community points",
                price: checkoutValue,
                quantity: 1,
              },
        ],
        currency,
        value: checkoutValue,
        userData: user
          ? { user_id: user.id, email: user.email ? user.email.toLowerCase() : undefined }
          : undefined,
      });
    }
    setPaying(true);
    // Fresh key whenever the intent differs from the last attempt, so switching
    // packages — or changing the custom amount — can never reuse a prior order.
    const intentSig =
      submit.kind === "custom"
        ? `custom:${submit.dollars}:${currency}`
        : `${submit.priceId}:1:${currency}`;
    if (idemKeyRef.current?.sig !== intentSig) {
      idemKeyRef.current = { sig: intentSig, key: crypto.randomUUID() };
    }
    const base = `${window.location.origin}${window.location.pathname}`;
    const successUrl = `${base}?recharge=success`;
    const backUrl = `${base}?recharge=cancelled`;
    const aleid = axonAleid();
    try {
      if (submit.kind === "custom") {
        const result = await createCustomRecharge({
          amountDollars: submit.dollars,
          idempotencyKey: idemKeyRef.current.key,
          successUrl,
          backUrl,
          ...(aleid ? { attribution: { aleid } } : {}),
        });
        const pi = result.paymentIntent;
        if (!pi?.providerPaymentIntentId || !pi.clientSecret) {
          idemKeyRef.current = null;
          toast.error(t("paymentFailed"));
          return;
        }
        // Stash the purchase so the `?recharge=success` return fires the browser
        // `purchase` event with the order id as dedupe_id (matches the S2S report).
        axonStashPendingPurchase(AXON_PENDING_PURCHASE_KEY, {
          transactionId: result.order.orderNo ?? result.order.id,
          value: submit.dollars,
          currency: result.order.currency,
          items: [
            {
              item_id: `custom:${submit.dollars}`,
              item_name: "Community points (custom)",
              price: submit.dollars,
              quantity: 1,
            },
          ],
        });
        // A Payment Intent has no hosted URL — launch the Airwallex page via the
        // browser SDK. It does a full-page redirect and returns to successUrl, so
        // the return handler above is reused verbatim. The SDK script loads from
        // Airwallex's CDN; that's why custom recharge is gated off on the CN cell.
        const { init } = await import("@airwallex/components-sdk");
        const aw = await init({ env: result.env, enabledElements: ["payments"] });
        if (!aw.payments) {
          idemKeyRef.current = null;
          toast.error(t("paymentFailed"));
          return;
        }
        await aw.payments.redirectToCheckout({
          env: result.env,
          mode: "payment",
          intent_id: pi.providerPaymentIntentId,
          client_secret: pi.clientSecret,
          currency: result.order.currency,
          country_code: result.shopperCountry,
          successUrl,
          failUrl: backUrl,
        });
        // redirectToCheckout navigates away; nothing else to do on success.
        return;
      }

      const result = await createBillingCheckout({
        priceId: submit.priceId,
        quantity: 1,
        idempotencyKey: idemKeyRef.current.key,
        successUrl,
        backUrl,
        ...(aleid ? { attribution: { aleid } } : {}),
      });
      const url = result.paymentIntent?.checkoutUrl;
      if (url) {
        // Stash the purchase so the `?recharge=success` return fires the browser
        // `purchase` event with the order id as dedupe_id (matches the S2S report).
        const presetValue = Number(submit.totalMinor) / 100;
        axonStashPendingPurchase(AXON_PENDING_PURCHASE_KEY, {
          transactionId: result.order.orderNo ?? result.order.id,
          value: presetValue,
          currency,
          items: [
            {
              item_id: submit.priceId,
              item_name: selectedPreset?.name ?? "Community points",
              price: presetValue,
              quantity: 1,
            },
          ],
        });
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
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("communityRechargeTitle")}</DialogTitle>
          <DialogDescription className="sr-only">{t("communityRechargeDesc")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 p-4">
          {/* Account header — avatar, display name, current consumable balance. */}
          <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/30 p-4">
            {user?.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.avatar}
                alt=""
                className="size-11 shrink-0 rounded-full object-cover ring-1 ring-border"
              />
            ) : (
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
                <IconCoins className="size-5" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">
                {user?.nickname || t("communityRechargeTitle")}
              </p>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <IconCoins className="size-3.5 text-primary" />
                {t("communityBalanceLabel")}
                <span className="font-semibold tabular-nums text-foreground">
                  {fmtPoints(balance)}
                </span>
              </p>
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
            !customRechargeEnabled && (
              <div className="py-12 text-center text-sm text-muted-foreground">
                {t("noPackages")}
              </div>
            )
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {presetPackages.map((pkg, i) => (
                <PresetCard
                  key={pkg.id}
                  pkg={pkg}
                  index={i}
                  selected={!customActive && selectedPreset?.id === pkg.id}
                  currencySymbol={currencySymbol}
                  fmtFiat={fmtFiat}
                  fmtPoints={fmtPoints}
                  pointsTypeLabel={t("pointsTypeLabel")}
                  onSelect={() => {
                    setCustomActive(false);
                    setSelectedId(pkg.id);
                  }}
                />
              ))}
            </div>
          )}

          {/* Custom amount — Airwallex Payment Intent, USD-only. Two-column panel:
              a paid-amount/points summary on the left, slider + entry on the right. */}
          {customRechargeEnabled && (
            <div
              className={cn(
                "w-full rounded-2xl border p-4 transition-colors",
                customActive ? "border-primary/60 bg-primary/[0.04]" : "border-border/60"
              )}
            >
              <div className="flex items-stretch gap-4">
                {/* Summary — what you pay and what you get. */}
                <div className="flex w-28 shrink-0 flex-col justify-center border-r border-border/60 pr-4">
                  <span className="text-3xl font-bold leading-none tabular-nums text-foreground">
                    <span className="align-top text-base font-normal text-muted-foreground">
                      {currencySymbol}
                    </span>
                    {customValid ? customDollarsNum : CUSTOM_MIN_DOLLARS}
                  </span>
                  <span className="mt-2 text-[11px] leading-tight text-muted-foreground">
                    {t("customGetLabel")}
                    <br />
                    <span className="font-semibold text-foreground">
                      {fmtPoints(customPoints || CUSTOM_MIN_DOLLARS * POINTS_PER_DOLLAR)}
                    </span>{" "}
                    {t("creditsUnit")}
                  </span>
                </div>

                {/* Slider + numeric entry. */}
                <div className="min-w-0 flex-1 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <Label
                      htmlFor="community-custom-amount"
                      className="text-xs text-muted-foreground"
                    >
                      {t("customAmountLabel")}
                    </Label>
                    <div className="relative w-24">
                      <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                        {currencySymbol}
                      </span>
                      <Input
                        id="community-custom-amount"
                        type="number"
                        inputMode="numeric"
                        min={CUSTOM_MIN_DOLLARS}
                        max={CUSTOM_MAX_DOLLARS}
                        step={1}
                        placeholder={String(CUSTOM_MIN_DOLLARS)}
                        value={customDollars}
                        onFocus={() => setCustomActive(true)}
                        onChange={(e) => {
                          setCustomActive(true);
                          setCustomDollars(e.target.value);
                        }}
                        className="h-8 pl-5 text-right text-sm tabular-nums"
                      />
                    </div>
                  </div>
                  <input
                    type="range"
                    aria-label={t("customAmountLabel")}
                    min={CUSTOM_MIN_DOLLARS}
                    max={CUSTOM_MAX_DOLLARS}
                    step={1}
                    value={Math.min(
                      Math.max(
                        customValid ? customDollarsNum : CUSTOM_MIN_DOLLARS,
                        CUSTOM_MIN_DOLLARS
                      ),
                      CUSTOM_MAX_DOLLARS
                    )}
                    onChange={(e) => {
                      setCustomActive(true);
                      setCustomDollars(e.target.value);
                    }}
                    className="w-full accent-primary"
                  />
                  <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums">
                    <span>
                      {currencySymbol}
                      {CUSTOM_MIN_DOLLARS}
                    </span>
                    <span>
                      {currencySymbol}
                      {CUSTOM_MAX_DOLLARS.toLocaleString()}
                    </span>
                  </div>
                  {customActive && customDollars.trim() !== "" && !customValid && (
                    <p className="text-[11px] text-primary">
                      {t("customAmountMin", { min: CUSTOM_MIN_DOLLARS })}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          <Button className="w-full" onClick={() => void handlePay()} disabled={paying || !submit}>
            {paying && <IconLoader2 className="size-4 animate-spin" />}
            {t("payNow")} {submit ? `${currencySymbol}${fmtFiat(submit.totalMinor)}` : ""}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Distinct premium gradient per card slot (blue / violet / amber), a soft diagonal
// sheen from the top-right matching the reference tiered look. Cycles past three.
const CARD_GRADIENTS = [
  "from-sky-500/20 via-sky-500/[0.06] to-transparent",
  "from-violet-500/20 via-indigo-500/[0.06] to-transparent",
  "from-amber-400/20 via-amber-500/[0.06] to-transparent",
];

function PresetCard({
  pkg,
  index,
  selected,
  currencySymbol,
  fmtFiat,
  fmtPoints,
  pointsTypeLabel,
  onSelect,
}: {
  pkg: BillingPackage;
  index: number;
  selected: boolean;
  currencySymbol: string;
  fmtFiat: (minor: number | string) => string;
  fmtPoints: (n: number | string) => string;
  pointsTypeLabel: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group relative flex flex-col items-center justify-center gap-2.5 overflow-hidden rounded-2xl border px-3 py-7 text-center transition-all",
        selected
          ? "border-primary ring-2 ring-primary/50"
          : "border-border/60 hover:border-border hover:bg-muted/20"
      )}
    >
      {/* Premium diagonal gradient sheen from the top-right corner. */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 bg-gradient-to-bl",
          CARD_GRADIENTS[index % CARD_GRADIENTS.length]
        )}
      />
      <span className="relative text-xs font-medium text-muted-foreground">{pointsTypeLabel}</span>
      <span className="relative flex items-center gap-1.5 text-[1.7rem] font-bold leading-none tabular-nums text-foreground">
        <IconBolt className="size-6 shrink-0 text-primary" />
        {fmtPoints(pkg.grantsWalletAmount ?? "0")}
      </span>
      <span className="relative text-sm font-medium text-muted-foreground">
        {currencySymbol}
        {fmtFiat(pkg.amountMinor)}
      </span>
      {selected && (
        <span className="absolute right-2.5 top-2.5 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
          <IconCheck className="size-3.5" />
        </span>
      )}
    </button>
  );
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
