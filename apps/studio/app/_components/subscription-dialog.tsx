"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import {
  IconArrowRight,
  IconBolt,
  IconCheck,
  IconChevronRight,
  IconCrown,
  IconLoader2,
  IconShieldCheck,
  IconUsersGroup,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";
import {
  createBillingCheckout,
  listMembershipPlans,
  type MembershipPlan,
  type MembershipPrice,
} from "@/lib/billing";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useAuth } from "./auth-provider";
import { useCountry } from "./region-provider";
import { useWorkspace } from "./workspace-context";

type ProductType = "membership_plan" | "team_membership_plan";
type BillingInterval = "month" | "year";

/**
 * Commerce accent palette (see DESIGN.md "Commerce accents"). Functional
 * color that encodes plan tier on the subscription surface only — these are
 * deliberately NOT tokens and must not leak into general chrome.
 */
type PlanAccent = {
  base: string;
  deep: string;
};

/** Brand red crowns the top tier — sanctioned commerce use (rule 3). */
const ACCENT_RED: PlanAccent = { base: "#E52227", deep: "#a3161b" };
/** Blue marks the recommended (Popular) tier. */
const ACCENT_BLUE: PlanAccent = { base: "#3a86ff", deep: "#2b6bcb" };
/** Billing-interval savings chip — distinct from any plan accent. */
const ACCENT_YELLOW: PlanAccent = { base: "#ffbe0b", deep: "#e3a400" };

const PLAN_ACCENTS: Record<string, PlanAccent | null> = {
  basic: null,
  standard: null,
  pro: ACCENT_BLUE,
  studio: ACCENT_RED,
  enterprise: null,
  team_ultimate: null,
  team_creator: ACCENT_BLUE,
  team_scale: ACCENT_RED,
  team_enterprise: null,
};

const ACCENT_CYCLE: (PlanAccent | null)[] = [null, null, ACCENT_BLUE, ACCENT_RED];

function accentForPlan(plan: MembershipPlan, index: number): PlanAccent | null {
  if (plan.planKey in PLAN_ACCENTS) return PLAN_ACCENTS[plan.planKey];
  return ACCENT_CYCLE[index % ACCENT_CYCLE.length];
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
  const currency = membershipCurrencyForCountry(country);
  const { user, signIn } = useAuth();
  const { activeWorkspace } = useWorkspace();
  const signedIn = Boolean(user);
  const [productType, setProductType] = useState<ProductType>("membership_plan");
  const [billingInterval, setBillingInterval] = useState<BillingInterval>("month");
  const [payingPriceId, setPayingPriceId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // The plan a signed-out visitor tried to buy — checkout resumes here once
  // the global login dialog succeeds. A ref: it drives no UI.
  const pendingPriceRef = useRef<MembershipPrice | null>(null);

  // Loading is derived: the latest fetch result carries the request key it
  // answered; a stale or absent key means the current tuple is still loading.
  const plansKey = `${productType}:${currency}:${reloadKey}`;
  const [plansResult, setPlansResult] = useState<{
    key: string;
    plans: MembershipPlan[];
    error: string | null;
  } | null>(null);
  const loaded = plansResult?.key === plansKey ? plansResult : null;
  const loading = open && !loaded;
  const plans = loaded?.plans ?? EMPTY_PLANS;
  const errorMessage = loaded?.error ?? null;

  // Custom-priced (enterprise) plans are a teams-only sales motion; on the
  // Individual tab they are hidden entirely.
  const visiblePlans = useMemo(
    () =>
      productType === "team_membership_plan"
        ? plans
        : plans.filter((plan) => plan.prices.length > 0),
    [plans, productType]
  );

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
    listMembershipPlans({ productType, currency })
      .then((result) => {
        if (cancelled) return;
        const activePlans = result.plans
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
  }, [currency, open, productType, plansKey]);

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
      // Team plans are workspace-scoped: they attach to the active TEAM
      // workspace (create-then-upgrade, Vercel-style). A personal workspace
      // can't hold a team plan, so steer the user to create/switch first.
      const isTeamPrice = price.subjectType === "workspace";
      if (isTeamPrice && activeWorkspace?.type !== "team") {
        toast.error(t("toast.teamWorkspaceRequired"));
        return;
      }

      setPayingPriceId(price.id);
      try {
        const baseUrl = `${window.location.origin}${window.location.pathname}`;
        const result = await createBillingCheckout({
          priceId: price.id,
          idempotencyKey: `studio-membership:${price.id}:${crypto.randomUUID()}`,
          quantity: 1,
          workspaceId: isTeamPrice ? activeWorkspace?.id : undefined,
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
        window.location.href = checkoutUrl;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t("toast.paymentFailed"));
      } finally {
        setPayingPriceId(null);
      }
    },
    [activeWorkspace, onOpenChange, signIn, signedIn, t]
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
                    className="rounded-full px-1.5 py-px text-[10px] font-bold text-black/85"
                    style={{
                      background: `linear-gradient(90deg, ${ACCENT_YELLOW.deep}, ${ACCENT_YELLOW.base} 33%, ${ACCENT_YELLOW.base} 67%, ${ACCENT_YELLOW.deep})`,
                    }}
                  >
                    -25%
                  </span>
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </header>

          <div className="mb-6 flex justify-center">
            <Tabs
              value={productType}
              onValueChange={(value) => setProductType(value as ProductType)}
            >
              <TabsList>
                <TabsTrigger value="membership_plan" className="px-2.5">
                  <IconCrown stroke={1.9} />
                  {t("productType.individual")}
                </TabsTrigger>
                <TabsTrigger value="team_membership_plan" className="px-2.5">
                  <IconUsersGroup stroke={1.9} />
                  {t("productType.teams")}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

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
                {visiblePlans.map((plan, index) => {
                  const price = priceForInterval(plan, billingInterval) ?? plan.prices[0] ?? null;
                  return (
                    <PlanCard
                      key={plan.id}
                      plan={plan}
                      price={price}
                      accent={accentForPlan(plan, index)}
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
      {/* Ribbon cards sit inside a solid accent frame; plain cards reserve the
          same 36px so all inner cards align across the row. */}
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
      <div
        className={cn("flex flex-1 rounded-b-3xl", !ribbon && "rounded-t-3xl")}
        style={ribbon ? { background: accent!.base, padding: "0 3px 3px" } : undefined}
      >
        <div
          className={cn(
            "relative flex min-h-[524px] w-full flex-col overflow-hidden p-5 shadow-2xl",
            ribbon ? "rounded-b-[19px] rounded-t-none" : "rounded-3xl",
            accent ? "bg-[#121212]" : "bg-card"
          )}
        >
          {accent ? (
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background: `linear-gradient(180deg, ${rgba(accent.base, 0.03)}, ${rgba(accent.base, 0.3)})`,
              }}
            />
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
        </div>
      </div>
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
