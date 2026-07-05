"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import {
  IconArrowRight,
  IconBolt,
  IconCheck,
  IconChevronRight,
  IconLoader2,
  IconShieldCheck,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";
import {
  createBillingCheckout,
  isWechatScanUrl,
  listMembershipPlans,
  type MembershipPlan,
  type MembershipPrice,
} from "@/lib/billing";
import { WechatScanPayDialog } from "@/app/_components/wechat-scan-pay-dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FrostedPanel } from "@/components/ui/frosted-panel";
import { GlassRim } from "@/components/ui/glass-rim";
import { cn } from "@/lib/utils";
import { useAuth } from "./auth-provider";
import { useCountry, useIsCnSite } from "./region-provider";
import { useWorkspace } from "./workspace-context";

type BillingInterval = "month" | "year";

/**
 * Commerce accent (see DESIGN.md "Commerce accents"). The base is monochrome
 * AI glass; brand red is the single functional accent that crowns the one
 * recommended tier on this purchase surface. Deliberately NOT a token — it
 * must not leak into general chrome.
 */
type PlanAccent = {
  base: string;
  deep: string;
};

/** Brand red crowns the recommended (Popular) tier — sanctioned commerce use (rule 3). */
const ACCENT_RED: PlanAccent = { base: "#E52227", deep: "#a3161b" };

/** A red conic rim-light for the recommended card's glass edge. */
const RED_RIM_GRADIENT = `conic-gradient(from 288deg, ${rgba(ACCENT_RED.base, 0.7)} 0%, ${rgba(ACCENT_RED.base, 0.2)} 42%, ${rgba(ACCENT_RED.base, 0)} 43%, ${rgba(ACCENT_RED.base, 0.25)} 48%, ${rgba(ACCENT_RED.base, 0)} 88%, ${rgba(ACCENT_RED.base, 0)} 90%, ${rgba(ACCENT_RED.base, 0.7)} 100%)`;

/**
 * Only the recommended tier — the plan flagged `marketing.badge === "Popular"`
 * — is crowned in brand red; every other tier stays neutral monochrome glass.
 */
function accentForPlan(plan: MembershipPlan): PlanAccent | null {
  return stringField(plan.marketing, "badge") === "Popular" ? ACCENT_RED : null;
}

const EMPTY_PLANS: MembershipPlan[] = [];

// FAQ copy lives in the "billing" message namespace under faq.<key>.question
// and faq.<key>.answer; this array only fixes the display order.
const FAQ_KEYS = [
  "computeCredits",
  "generationFails",
  "rollover",
  "freeTier",
  "subscriptionVsTopups",
  "teamShareCredits",
  "cancelOrChange",
  "commercialUse",
] as const;

function rgba(hex: string, alpha: number) {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function SubscriptionDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("billing");
  const tc = useTranslations("common");
  const country = useCountry();
  // The CELL (deployment), not the currency/country, decides CN behaviour: .cn is a
  // one-off CNY pass (no interval toggle) paid via WeChat 扫码; .com is a USD/SGD
  // subscription via Airwallex.
  const isCn = useIsCnSite();
  const currency = isCn ? "CNY" : membershipCurrencyForCountry(country);
  const { user, signIn } = useAuth();
  const { workspaces, activeWorkspace, createTeam } = useWorkspace();
  const signedIn = Boolean(user);
  const [billingInterval, setBillingInterval] = useState<BillingInterval>("month");
  const [payingPriceId, setPayingPriceId] = useState<string | null>(null);
  const [wechatScan, setWechatScan] = useState<{
    orderId: string;
    codeUrl: string;
  } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // The plan a signed-out visitor tried to buy — checkout resumes here once
  // the global login dialog succeeds. A ref: it drives no UI.
  const pendingPriceRef = useRef<MembershipPrice | null>(null);

  // Loading is derived: the latest fetch result carries the request key it
  // answered; a stale or absent key means the current tuple is still loading.
  const plansKey = `${currency}:${reloadKey}`;
  const [plansResult, setPlansResult] = useState<{
    key: string;
    plans: MembershipPlan[];
    error: string | null;
  } | null>(null);
  const loaded = plansResult?.key === plansKey ? plansResult : null;
  const loading = open && !loaded;
  const plans = loaded?.plans ?? EMPTY_PLANS;
  const errorMessage = loaded?.error ?? null;

  // The lineup is one combined list (individual + team tiers). Custom-priced
  // plans (enterprise / team_enterprise) keep their prices-less rows so they
  // render as the "Custom / Contact Sales" card, exactly as the Teams tab did.
  const visiblePlans = plans;

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onOpenChange, open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // One combined lineup: load individual + team plans together, merge, keep
    // active rows, and order by rank so the row reads basic → … → pro → team
    // → enterprise / team_enterprise.
    Promise.all([
      listMembershipPlans({ productType: "membership_plan", currency }),
      listMembershipPlans({ productType: "team_membership_plan", currency }),
    ])
      .then(([individual, team]) => {
        if (cancelled) return;
        const activePlans = [...individual.plans, ...team.plans]
          .filter((plan) => plan.status === "active")
          .sort((a, b) => a.rank - b.rank);
        setPlansResult({ key: plansKey, plans: activePlans, error: null });
      })
      .catch((error) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : t("toast.plansLoadFailed");
        setPlansResult({ key: plansKey, plans: [], error: message });
        toast.error(message);
      });
    return () => {
      cancelled = true;
    };
  }, [currency, open, plansKey, t]);

  const subscribe = useCallback(
    async (price: MembershipPrice | null) => {
      if (!price) return;
      if (!signedIn) {
        // Park the intent and raise the global login dialog; the effect
        // below resumes checkout once the session exists.
        pendingPriceRef.current = price;
        signIn();
        return;
      }
      // Team plans are workspace-scoped: they attach to a TEAM workspace
      // (create-then-upgrade, Vercel-style). Resolve one automatically — reuse
      // the active team, else any team the user already has, else create one —
      // so a personal-workspace user can buy a team plan without a detour.
      const isTeamPrice = price.subjectType === "workspace";

      setPayingPriceId(price.id);
      try {
        let workspaceId: string | undefined;
        if (isTeamPrice) {
          if (activeWorkspace?.type === "team") {
            workspaceId = activeWorkspace.id;
          } else {
            const existingTeam = workspaces.find((w) => w.type === "team");
            if (existingTeam) {
              workspaceId = existingTeam.id;
            } else {
              const defaultName = `${user?.nickName ?? user?.email ?? "My"}'s Team`;
              const created = await createTeam(defaultName);
              workspaceId = created.id;
            }
          }
        }
        const baseUrl = `${window.location.origin}${window.location.pathname}`;
        const result = await createBillingCheckout({
          priceId: price.id,
          idempotencyKey: `studio-membership:${price.id}:${crypto.randomUUID()}`,
          quantity: 1,
          workspaceId,
          successUrl: `${baseUrl}?payment=success`,
          backUrl: `${baseUrl}?payment=cancelled`,
        });
        if (result.order.status === "fulfilled" && !result.paymentIntent) {
          toast.success(t("toast.membershipActivated"));
          onOpenChange(false);
          return;
        }
        const checkoutUrl = result.paymentIntent?.checkoutUrl;
        if (!checkoutUrl) {
          toast.error(t("toast.checkoutUrlMissing"));
          return;
        }
        // WeChat 扫码 returns a weixin:// code_url — render it as a QR + poll the
        // order instead of navigating the browser to it.
        if (isWechatScanUrl(checkoutUrl)) {
          setWechatScan({ orderId: result.order.id, codeUrl: checkoutUrl });
          return;
        }
        window.location.href = checkoutUrl;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t("toast.paymentFailed"));
      } finally {
        setPayingPriceId(null);
      }
    },
    [activeWorkspace, createTeam, onOpenChange, signIn, signedIn, t, user, workspaces]
  );

  // Resume the checkout a signed-out visitor started: once login lands the
  // parked plan goes straight back through subscribe().
  useEffect(() => {
    if (!signedIn) return;
    const pending = pendingPriceRef.current;
    if (!pending) return;
    pendingPriceRef.current = null;
    void subscribe(pending);
  }, [signedIn, subscribe]);

  // Closing the pricing dialog abandons any parked intent.
  useEffect(() => {
    if (!open) pendingPriceRef.current = null;
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("dialogLabel")}
      className="fixed left-0 top-0 z-50 h-[100dvh] w-screen overflow-hidden bg-background text-foreground"
    >
      {wechatScan && (
        <WechatScanPayDialog
          key={wechatScan.orderId}
          open
          orderId={wechatScan.orderId}
          codeUrl={wechatScan.codeUrl}
          onClose={() => setWechatScan(null)}
          onPaid={() => {
            toast.success(t("toast.membershipActivated"));
            setWechatScan(null);
            onOpenChange(false);
          }}
        />
      )}
      <button
        type="button"
        aria-label={t("closeDialog")}
        onClick={() => onOpenChange(false)}
        className="fixed right-4 top-4 z-20 flex size-11 items-center justify-center rounded-full bg-popover text-muted-foreground shadow-2xl transition-colors hover:bg-secondary hover:text-foreground sm:right-6 sm:top-6"
      >
        <IconX className="size-5" stroke={1.9} />
      </button>

      <div className="relative z-10 h-[100dvh] overflow-y-auto px-4 py-6 sm:px-6 lg:px-10">
        <div className="flex min-h-full w-full flex-col">
          <header className="flex flex-col items-center gap-3 pb-8 pt-14 text-center sm:pt-12">
            <h1 className="text-3xl font-bold uppercase tracking-tight sm:text-4xl">
              {t("header.title")}
            </h1>
            <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
              {t("header.subtitle")}
            </p>
            {!isCn && (
              <Tabs
                className="mt-3"
                value={billingInterval}
                onValueChange={(value) => setBillingInterval(value as BillingInterval)}
              >
                <TabsList>
                  <TabsTrigger value="month" className="px-2.5">
                    {t("interval.monthly")}
                  </TabsTrigger>
                  <TabsTrigger value="year" className="px-2.5">
                    {t("interval.yearly")}
                    <span
                      className="rounded-full px-1.5 py-px text-[10px] font-bold text-white"
                      style={{
                        background: `linear-gradient(90deg, ${ACCENT_RED.deep}, ${ACCENT_RED.base} 33%, ${ACCENT_RED.base} 67%, ${ACCENT_RED.deep})`,
                      }}
                    >
                      -25%
                    </span>
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            )}
          </header>

          {loading ? (
            <LoadingPlans />
          ) : plans.length === 0 ? (
            <div className="flex min-h-[380px] items-center justify-center rounded-3xl bg-card p-8 text-center shadow-2xl">
              <div className="max-w-md">
                <p className="text-lg font-semibold">
                  {errorMessage ? t("empty.errorTitle") : t("empty.title")}
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {errorMessage || t("empty.description")}
                </p>
                <button
                  type="button"
                  onClick={() => setReloadKey((value) => value + 1)}
                  className="mt-5 inline-flex h-11 items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                >
                  {tc("retry")}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div
                className={cn(
                  "grid grid-cols-1 gap-4 md:grid-cols-2",
                  visiblePlans.length >= 4 ? "xl:grid-cols-4" : "xl:grid-cols-3"
                )}
              >
                {visiblePlans.map((plan) => {
                  const price = priceForInterval(plan, billingInterval) ?? plan.prices[0] ?? null;
                  return (
                    <PlanCard
                      key={plan.id}
                      plan={plan}
                      price={price}
                      accent={accentForPlan(plan)}
                      interval={billingInterval}
                      paying={payingPriceId === price?.id}
                      onSubscribe={() => void subscribe(price)}
                    />
                  );
                })}
              </div>
              <div className="pb-8" />
            </>
          )}

          <FaqSection />

          <footer className="mt-auto flex flex-col gap-3 py-5 text-xs leading-5 text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <IconShieldCheck className="size-4" stroke={1.9} />
              <span>{t("footer.secureCheckout")}</span>
            </div>
            <p className="max-w-3xl">{t("footer.disclaimer")}</p>
          </footer>
        </div>
      </div>
    </div>,
    document.body
  );
}

function PlanCard({
  plan,
  price,
  accent,
  paying,
  interval,
  onSubscribe,
}: {
  plan: MembershipPlan;
  price: MembershipPrice | null;
  accent: PlanAccent | null;
  paying: boolean;
  interval: BillingInterval;
  onSubscribe: () => void;
}) {
  const t = useTranslations("billing");
  const badge = stringField(plan.marketing, "badge");
  const featureItems = membershipFeatureItems(plan, t);
  const originalAmount = price ? originalAmountMinor(price) : null;
  const hasOriginal =
    price && originalAmount ? BigInt(originalAmount) > BigInt(price.amountMinor) : false;
  const discountPercent =
    price && originalAmount && hasOriginal
      ? Math.round((1 - Number(BigInt(price.amountMinor)) / Number(BigInt(originalAmount))) * 100)
      : null;
  const ribbon = Boolean(badge && accent);

  return (
    <article className="flex flex-col">
      {/* The recommended tier wears a brand-red ribbon; plain cards reserve the
          same 36px so all inner glass panels align across the row. */}
      {ribbon ? (
        <div
          className="flex h-9 shrink-0 items-center justify-center rounded-t-3xl text-xs font-bold uppercase tracking-[0.12em] text-white"
          style={{ background: accent!.base }}
        >
          {badge}
        </div>
      ) : (
        <div className="h-9 shrink-0" />
      )}
      <FrostedPanel
        // The recommended card gets a custom red rim; others keep the default
        // neutral white rim. Either way the surface is AI glass, not a flat box.
        rim={!accent}
        className={cn(
          "flex min-h-[524px] flex-1 flex-col overflow-hidden rounded-3xl p-5 shadow-2xl",
          ribbon && "rounded-t-none"
        )}
      >
        {accent ? (
          <>
            {/* Brand-red wash over the glass + a red rim-light edge — restrained,
                only the recommended tier is crowned. */}
            <div
              className="pointer-events-none absolute inset-0 rounded-[inherit]"
              style={{
                background: `linear-gradient(180deg, ${rgba(accent.base, 0.04)}, ${rgba(accent.base, 0.16)})`,
              }}
            />
            <GlassRim gradient={RED_RIM_GRADIENT} width="1.5px" />
          </>
        ) : null}

        <div className="relative flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-2xl font-semibold leading-tight tracking-tight">{plan.name}</p>
              {discountPercent ? (
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs font-bold",
                    accent ? "text-white" : "bg-primary text-primary-foreground"
                  )}
                  style={
                    accent
                      ? {
                          background: `linear-gradient(90deg, ${accent.deep}, ${accent.base} 33%, ${accent.base} 67%, ${accent.deep})`,
                        }
                      : undefined
                  }
                >
                  -{discountPercent}%
                </span>
              ) : null}
            </div>
            <p className="mt-2 min-h-12 text-sm leading-6 text-muted-foreground">
              {plan.description || t("plan.defaultDescription")}
            </p>
          </div>
        </div>

        <div className="relative mt-6">
          {price ? (
            <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
              {hasOriginal ? (
                <span
                  className="pb-1 text-xl font-bold line-through"
                  style={{ color: accent ? accent.base : undefined }}
                >
                  <span className={accent ? undefined : "text-muted-foreground"}>
                    {formatMoneyMinor(originalAmount, price.currency)}
                  </span>
                </span>
              ) : null}
              <span className="bg-gradient-to-b from-white to-white/70 bg-clip-text text-5xl font-bold leading-none tracking-tight text-transparent">
                {formatMoneyMinor(price.amountMinor, price.currency)}
              </span>
              <span className="pb-1 text-sm font-medium text-muted-foreground">
                {intervalLabel(price.interval || interval, t)}
              </span>
            </div>
          ) : (
            <div>
              <span className="text-5xl font-bold leading-none tracking-tight">
                {t("plan.custom")}
              </span>
              <p className="mt-2 text-sm text-muted-foreground">{t("plan.contactForPricing")}</p>
            </div>
          )}
        </div>

        <div className="relative mt-6">
          {price ? (
            <button
              type="button"
              onClick={onSubscribe}
              disabled={paying}
              className={cn(
                "flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-base font-semibold transition-all hover:brightness-110 disabled:pointer-events-none disabled:opacity-60",
                accent
                  ? "text-white"
                  : "bg-primary text-primary-foreground hover:opacity-90 hover:brightness-100"
              )}
              style={
                accent
                  ? {
                      background: `radial-gradient(120% 140% at 50% 0%, ${accent.base} 0%, ${accent.base} 60%, ${accent.deep} 100%)`,
                      boxShadow: `0 12px 24px ${rgba(accent.deep, 0.15)}, 0 2px 10px ${rgba(accent.base, 0.25)}`,
                    }
                  : undefined
              }
            >
              {paying ? <IconLoader2 className="size-5 animate-spin" /> : t("plan.getStarted")}
              {!paying ? <IconArrowRight className="size-4" stroke={2.2} /> : null}
            </button>
          ) : (
            <a
              href="mailto:business@fizzdragon.com"
              className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-base font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              {t("plan.contactSales")}
              <IconArrowRight className="size-4" stroke={2.2} />
            </a>
          )}
        </div>

        <div className="relative mt-2 py-4">
          <div className="h-px bg-border" />
          <div className="flex items-center justify-between gap-4 py-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <IconBolt className="size-4" stroke={1.9} style={{ color: accent?.base }} />
              <span>{t("plan.includedInPlan")}</span>
            </div>
            <span className="text-sm font-bold" style={{ color: accent?.base }}>
              {price
                ? t("plan.computeCreditsAmount", {
                    amount: formatInteger(plan.includedComputeCredits),
                  })
                : t("plan.customCreditsAmount")}
            </span>
          </div>
          <p className="text-xs font-medium text-muted-foreground">
            {t("plan.seats", { count: plan.includedSeats })}
            {plan.maxSeats ? t("plan.seatsUpTo", { max: plan.maxSeats }) : ""}
          </p>
          <div className="mt-4 h-px bg-border" />
        </div>

        <ul className="relative space-y-3 pb-1">
          {featureItems.map((item) => (
            <li
              key={item}
              className="flex items-start gap-2 text-sm leading-5 text-muted-foreground"
            >
              <IconCheck
                className={cn("mt-0.5 size-4 shrink-0", !accent && "text-foreground")}
                stroke={2}
                style={{ color: accent?.base }}
              />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </FrostedPanel>
    </article>
  );
}

function FaqSection() {
  const t = useTranslations("billing");
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  return (
    <section className="mx-auto mt-14 w-full max-w-6xl pb-12">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <h2 className="text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
          {t.rich("faq.heading", { br: () => <br /> })}
        </h2>
        <div>
          {FAQ_KEYS.map((key, index) => {
            const open = openIndex === index;
            return (
              <div key={key}>
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenIndex(open ? null : index)}
                  className="flex w-full items-center justify-between gap-4 py-5 text-left"
                >
                  <span className="text-base font-medium">{t(`faq.${key}.question`)}</span>
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground">
                    <IconChevronRight
                      className={cn(
                        "size-4 transition-transform duration-300",
                        open && "rotate-90"
                      )}
                      stroke={2}
                    />
                  </span>
                </button>
                <div
                  className={cn(
                    "grid transition-[grid-template-rows] duration-300 ease-out",
                    open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                  )}
                >
                  <div className="overflow-hidden">
                    <p className="pb-5 pr-12 text-sm leading-7 text-muted-foreground">
                      {t(`faq.${key}.answer`)}
                    </p>
                  </div>
                </div>
                <div className="h-px bg-border" />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function LoadingPlans() {
  return (
    <div className="grid grid-cols-1 gap-4 pb-8 md:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={index}
          className="mt-9 min-h-[520px] animate-pulse rounded-3xl bg-card p-5 shadow-2xl"
        >
          <div className="h-7 w-36 rounded-full bg-white/10" />
          <div className="mt-4 h-4 w-full rounded-full bg-white/[0.08]" />
          <div className="mt-2 h-4 w-3/4 rounded-full bg-white/[0.08]" />
          <div className="mt-8 h-12 w-44 rounded-full bg-white/10" />
          <div className="mt-8 space-y-3">
            <div className="h-4 rounded-full bg-white/[0.08]" />
            <div className="h-4 rounded-full bg-white/[0.08]" />
            <div className="h-4 w-2/3 rounded-full bg-white/[0.08]" />
          </div>
        </div>
      ))}
    </div>
  );
}

function membershipCurrencyForCountry(country: string): "USD" | "SGD" {
  return country.toUpperCase() === "SG" ? "SGD" : "USD";
}

function priceForInterval(plan: MembershipPlan, interval: BillingInterval) {
  return plan.prices.find((price) => price.interval === interval) ?? null;
}

function originalAmountMinor(price: MembershipPrice) {
  const value = price.metadata?.originalAmountMinor;
  return typeof value === "string" && /^\d+$/.test(value) ? value : null;
}

function formatMoneyMinor(amountMinor: string | null, currency: string) {
  if (!amountMinor) return "";
  const cents = Number(BigInt(amountMinor));
  const amount = cents / 100;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount);
}

function formatInteger(value: string | number) {
  return new Intl.NumberFormat().format(Number(value));
}

// Translator handle from useTranslations("billing"); helpers receive it so
// they can stay module-level while emitting localized copy.
type BillingTranslator = ReturnType<typeof useTranslations<"billing">>;

function intervalLabel(interval: string, t: BillingTranslator) {
  if (interval === "month") return t("plan.perMonth");
  if (interval === "year") return t("plan.perYear");
  return t("plan.oneTime");
}

function membershipFeatureItems(plan: MembershipPlan, t: BillingTranslator) {
  const items: string[] = [];
  const flags = plan.featureFlags ?? {};
  const limits = plan.limits ?? {};
  const images = numberField(limits, "approximateImagesPerMonth");
  const concurrentJobs = numberField(limits, "concurrentJobs");
  const queuedJobs = numberField(limits, "queuedJobs");
  if (images !== null) items.push(t("features.imagesPerMonth", { count: formatInteger(images) }));
  if (flags.privateGenerations) items.push(t("features.privateGenerations"));
  if (flags.advancedWorkflows) items.push(t("features.advancedWorkflows"));
  if (flags.prioritySupport) items.push(t("features.prioritySupport"));
  if (flags.sharedCredits) items.push(t("features.sharedCredits"));
  if (concurrentJobs !== null) items.push(t("features.concurrentJobs", { count: concurrentJobs }));
  if (queuedJobs !== null) items.push(t("features.queuedJobs", { count: queuedJobs }));
  if (plan.topupDiscountBps > 0)
    items.push(t("features.topupDiscount", { percent: plan.topupDiscountBps / 100 }));
  return items.slice(0, 6);
}

function stringField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function numberField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
