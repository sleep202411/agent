"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  IconArrowRight,
  IconBolt,
  IconCheck,
  IconCircleCheckFilled,
  IconCrown,
  IconLoader2,
  IconReceipt,
  IconShieldCheck,
  IconUsersGroup,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getApiWorkspaceId } from "@/src/lib/api";
import {
  createBillingCheckout,
  listMembershipPlans,
  type MembershipPlan,
  type MembershipPrice,
} from "@/src/lib/billing/api";
import { useCountry } from "@/src/lib/region/provider";
import { useTranslations } from "@/src/i18n/i18n";

type ProductType = "membership_plan" | "team_membership_plan";
type BillingInterval = "month" | "year";

export interface UpgradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function UpgradeDialog({ open, onOpenChange, onSuccess }: UpgradeDialogProps) {
  const t = useTranslations("payment");
  const country = useCountry();
  const currency = membershipCurrencyForCountry(country);
  const [productType, setProductType] = useState<ProductType>("membership_plan");
  const [billingInterval, setBillingInterval] = useState<BillingInterval>("month");
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [selectedPlanKey, setSelectedPlanKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [payingPriceId, setPayingPriceId] = useState<string | null>(null);

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.planKey === selectedPlanKey) ?? plans[0] ?? null,
    [plans, selectedPlanKey]
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
    queueMicrotask(() => {
      if (!cancelled) setLoading(true);
    });
    listMembershipPlans({ productType, currency })
      .then((result) => {
        if (cancelled) return;
        const activePlans = result.plans
          .filter((plan) => plan.status === "active")
          .sort((a, b) => a.rank - b.rank);
        setPlans(activePlans);
        setSelectedPlanKey((current) =>
          current && activePlans.some((plan) => plan.planKey === current)
            ? current
            : (activePlans[0]?.planKey ?? null)
        );
      })
      .catch((err) => {
        if (cancelled) return;
        setPlans([]);
        toast.error(err instanceof Error ? err.message : t("membership.loadFailed"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currency, open, productType, t]);

  const handlePay = useCallback(
    async (plan: MembershipPlan, price: MembershipPrice | null) => {
      if (!price) return;
      const workspaceId = getApiWorkspaceId();
      if (price.subjectType === "workspace" && !workspaceId) {
        toast.error(t("membership.workspaceRequired"));
        return;
      }
      setSelectedPlanKey(plan.planKey);
      setPayingPriceId(price.id);
      try {
        const baseUrl = `${window.location.origin}${window.location.pathname}`;
        const result = await createBillingCheckout({
          priceId: price.id,
          idempotencyKey: `membership:${price.id}:${crypto.randomUUID()}`,
          quantity: 1,
          workspaceId: price.subjectType === "workspace" ? (workspaceId ?? undefined) : undefined,
          successUrl: `${baseUrl}?payment=success`,
          backUrl: `${baseUrl}?payment=cancelled`,
        });
        if (result.order.status === "fulfilled" && !result.paymentIntent) {
          toast.success(t("paymentSuccess"));
          onSuccess?.();
          onOpenChange(false);
          return;
        }
        const checkoutUrl = result.paymentIntent?.checkoutUrl;
        if (!checkoutUrl) {
          toast.error(t("paymentNoCheckoutUrl"));
          return;
        }
        if (window.self !== window.top) {
          window.parent.postMessage({ type: "navigateToPayment", url: checkoutUrl }, "*");
        } else {
          window.location.href = checkoutUrl;
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("paymentFailed"));
      } finally {
        setPayingPriceId(null);
      }
    },
    [onOpenChange, onSuccess, t]
  );

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("membership.headline")}
      className="fixed inset-0 z-[90] overflow-hidden bg-[#050505] text-white"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[#E52227]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,#151515_0%,#070707_42%,#030303_100%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.14] [background-image:linear-gradient(rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:48px_48px]" />

      <button
        type="button"
        onClick={() => onOpenChange(false)}
        className="fixed right-4 top-4 z-30 flex size-11 items-center justify-center rounded-full border border-white/12 bg-white/[0.06] text-white/72 backdrop-blur-md transition-colors hover:bg-white/12 hover:text-white sm:right-6 sm:top-6"
        aria-label={t("close")}
      >
        <IconX className="size-5" />
      </button>

      <div className="relative z-10 h-full overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto flex min-h-full w-full max-w-[1500px] flex-col">
          <header className="flex flex-col gap-5 pb-8 pt-12 sm:pt-10 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-white/70">
                <IconCrown className="size-4 text-[#E52227]" />
                <span>{t("membership.subscriptionLabel")}</span>
              </div>
              <h1 className="text-4xl font-black leading-none sm:text-5xl lg:text-6xl">
                {t("membership.headline")}
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-white/58 sm:text-lg">
                {t("membership.subheadline")}
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap lg:justify-end">
              <div className="inline-flex w-fit items-center gap-2 rounded-full border border-white/12 bg-white/[0.06] px-3 py-2 text-sm font-semibold text-white/72">
                <IconReceipt className="size-4" />
                {t("membership.currencyNote", { currency })}
              </div>
              <a
                href="mailto:business@fizzdragon.com"
                className="inline-flex w-fit items-center gap-2 rounded-full border border-white/12 bg-white text-sm font-bold text-black transition-colors hover:bg-white/90 px-4 py-2"
              >
                {t("membership.contactSales")}
                <IconArrowRight className="size-4" />
              </a>
            </div>
          </header>

          <div className="mb-7 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <SegmentGroup label={t("membership.planAudience")}>
              <SegmentButton
                active={productType === "membership_plan"}
                onClick={() => setProductType("membership_plan")}
              >
                <IconCrown className="size-4" />
                {t("membership.individual")}
              </SegmentButton>
              <SegmentButton
                active={productType === "team_membership_plan"}
                onClick={() => setProductType("team_membership_plan")}
              >
                <IconUsersGroup className="size-4" />
                {t("membership.teams")}
              </SegmentButton>
            </SegmentGroup>

            <SegmentGroup label={t("membership.billingCycle")}>
              <SmallSegmentButton
                active={billingInterval === "month"}
                onClick={() => setBillingInterval("month")}
              >
                {t("membership.monthly")}
              </SmallSegmentButton>
              <SmallSegmentButton
                active={billingInterval === "year"}
                onClick={() => setBillingInterval("year")}
              >
                {t("membership.yearly")}
                <span className="ml-2 rounded-full bg-[#E52227] px-2 py-0.5 text-[11px] font-black text-white">
                  {t("membership.annualSavings")}
                </span>
              </SmallSegmentButton>
            </SegmentGroup>
          </div>

          {loading ? (
            <LoadingPlans />
          ) : plans.length === 0 ? (
            <div className="flex min-h-[360px] items-center justify-center rounded-2xl border border-white/12 bg-white/[0.04] p-8 text-center">
              <div className="max-w-md">
                <p className="text-lg font-black">{t("membership.emptyTitle")}</p>
                <p className="mt-2 text-sm leading-6 text-white/56">{t("membership.emptyBody")}</p>
              </div>
            </div>
          ) : (
            <div className="grid flex-1 grid-cols-1 gap-4 pb-8 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5">
              {plans.map((plan) => {
                const price = priceForInterval(plan, billingInterval) ?? plan.prices[0] ?? null;
                return (
                  <PlanCard
                    key={plan.id}
                    plan={plan}
                    price={price}
                    interval={billingInterval}
                    selected={selectedPlan?.planKey === plan.planKey}
                    paying={payingPriceId === price?.id}
                    onSelect={() => setSelectedPlanKey(plan.planKey)}
                    onSubscribe={() => void handlePay(plan, price)}
                  />
                );
              })}
            </div>
          )}

          <footer className="mt-auto flex flex-col gap-3 border-t border-white/10 py-5 text-xs leading-5 text-white/45 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <IconShieldCheck className="size-4 text-white/60" />
              <span>{t("membership.secureCheckout")}</span>
            </div>
            <p className="max-w-3xl">{t("disclaimer")}</p>
          </footer>
        </div>
      </div>
    </div>
  );
}

function PlanCard({
  plan,
  price,
  selected,
  paying,
  interval,
  onSelect,
  onSubscribe,
}: {
  plan: MembershipPlan;
  price: MembershipPrice | null;
  selected: boolean;
  paying: boolean;
  interval: BillingInterval;
  onSelect: () => void;
  onSubscribe: () => void;
}) {
  const t = useTranslations("payment");
  const badge = stringField(plan.marketing, "badge");
  const audience = stringField(plan.marketing, "audience");
  const featureItems = membershipFeatureItems(plan, t);
  const originalAmount = price ? originalAmountMinor(price) : null;
  const hasOriginal = price && originalAmount && BigInt(originalAmount) > BigInt(price.amountMinor);
  const isFeatured = Boolean(badge) || selected;

  return (
    <article
      onClick={onSelect}
      className={cn(
        "relative flex min-h-[560px] cursor-pointer flex-col overflow-hidden rounded-2xl border bg-[#111] p-5 transition-colors",
        isFeatured
          ? "border-[#E52227]/70 bg-[#180b0c]"
          : "border-white/12 bg-white/[0.045] hover:border-white/24",
        selected && "shadow-[0_0_0_1px_rgba(229,34,39,0.55)]"
      )}
    >
      {badge ? (
        <div className="absolute inset-x-0 top-0 flex h-9 items-center justify-center bg-[#E52227] px-3 text-xs font-black uppercase text-white">
          {badge}
        </div>
      ) : null}

      <div className={cn("flex items-start justify-between gap-3", badge ? "pt-9" : "")}>
        <div className="min-w-0">
          <p className="text-2xl font-black leading-tight">{plan.name}</p>
          <p className="mt-2 min-h-12 text-sm leading-6 text-white/52">
            {plan.description || audience || t("membership.defaultDescription")}
          </p>
        </div>
        {selected ? <IconCircleCheckFilled className="size-6 shrink-0 text-[#E52227]" /> : null}
      </div>

      <div className="mt-6">
        {price ? (
          <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
            {hasOriginal ? (
              <span className="pb-1 text-2xl font-black text-white/35 line-through">
                {formatMoneyMinor(originalAmount, price.currency)}
              </span>
            ) : null}
            <span className="text-5xl font-black leading-none">
              {formatMoneyMinor(price.amountMinor, price.currency)}
            </span>
            <span className="pb-1 text-sm font-semibold text-white/45">
              {intervalLabel(price.interval || interval, t)}
            </span>
          </div>
        ) : (
          <div>
            <span className="text-5xl font-black leading-none">{t("membership.customPrice")}</span>
            <p className="mt-2 text-sm text-white/45">{t("membership.priceUnavailable")}</p>
          </div>
        )}
      </div>

      <div className="mt-6 border-y border-white/10 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm font-bold text-white/82">
            <IconBolt className="size-4 text-[#E52227]" />
            <span>{t("membership.includedInPlan")}</span>
          </div>
          <span className="text-sm font-black">
            {formatInteger(plan.includedComputeCredits)} {t("membership.computeCredits")}
          </span>
        </div>
        <p className="mt-2 text-xs font-semibold text-white/45">
          {plan.includedSeats} {t("membership.seats")}
          {plan.maxSeats ? ` · ${t("membership.maxSeats", { count: plan.maxSeats })}` : ""}
        </p>
      </div>

      <ul className="mt-5 space-y-3">
        {featureItems.map((item) => (
          <li key={item} className="flex items-start gap-2 text-sm leading-5 text-white/70">
            <IconCheck className="mt-0.5 size-4 shrink-0 text-white" />
            <span>{item}</span>
          </li>
        ))}
      </ul>

      <div className="mt-auto pt-6">
        {price ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onSubscribe();
            }}
            disabled={paying}
            className={cn(
              "flex h-12 w-full items-center justify-center gap-2 rounded-full text-base font-black transition-colors disabled:pointer-events-none disabled:opacity-60",
              isFeatured
                ? "bg-[#E52227] text-white hover:bg-[#f33a3f]"
                : "bg-white text-black hover:bg-white/90"
            )}
          >
            {paying ? <IconLoader2 className="size-5 animate-spin" /> : t("membership.getStarted")}
            {!paying ? <IconArrowRight className="size-4" /> : null}
          </button>
        ) : (
          <a
            href="mailto:business@fizzdragon.com"
            onClick={(event) => event.stopPropagation()}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-white text-base font-black text-black transition-colors hover:bg-white/90"
          >
            {t("membership.contactSales")}
            <IconArrowRight className="size-4" />
          </a>
        )}
      </div>
    </article>
  );
}

function LoadingPlans() {
  return (
    <div className="grid flex-1 grid-cols-1 gap-4 pb-8 md:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={index}
          className="min-h-[520px] animate-pulse rounded-2xl border border-white/10 bg-white/[0.045] p-5"
        >
          <div className="h-7 w-36 rounded-full bg-white/10" />
          <div className="mt-4 h-4 w-full rounded-full bg-white/8" />
          <div className="mt-2 h-4 w-3/4 rounded-full bg-white/8" />
          <div className="mt-8 h-12 w-44 rounded-full bg-white/10" />
          <div className="mt-8 space-y-3">
            <div className="h-4 rounded-full bg-white/8" />
            <div className="h-4 rounded-full bg-white/8" />
            <div className="h-4 w-2/3 rounded-full bg-white/8" />
          </div>
        </div>
      ))}
    </div>
  );
}

function SegmentGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex w-fit flex-col gap-2">
      <span className="px-1 text-xs font-bold uppercase text-white/38">{label}</span>
      <div className="flex items-center rounded-full border border-white/12 bg-white/[0.06] p-1">
        {children}
      </div>
    </div>
  );
}

function SegmentButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-11 items-center gap-2 rounded-full px-4 text-sm font-black transition-colors",
        active ? "bg-white text-black" : "text-white/54 hover:text-white"
      )}
    >
      {children}
    </button>
  );
}

function SmallSegmentButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-11 items-center rounded-full px-4 text-sm font-black transition-colors",
        active ? "bg-white text-black" : "text-white/54 hover:text-white"
      )}
    >
      {children}
    </button>
  );
}

function membershipCurrencyForCountry(country: string) {
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

function intervalLabel(interval: string, t: ReturnType<typeof useTranslations>) {
  if (interval === "month") return t("membership.perMonth");
  if (interval === "year") return t("membership.perYear");
  return t("membership.oneTime");
}

function membershipFeatureItems(plan: MembershipPlan, t: ReturnType<typeof useTranslations>) {
  const items: string[] = [];
  const flags = plan.featureFlags ?? {};
  const limits = plan.limits ?? {};
  const approximateImagesPerMonth = numberField(limits, "approximateImagesPerMonth");
  const concurrentJobs = numberField(limits, "concurrentJobs");
  const queuedJobs = numberField(limits, "queuedJobs");
  if (approximateImagesPerMonth !== null) {
    items.push(
      t("membership.approxImages", {
        count: approximateImagesPerMonth,
      })
    );
  }
  if (flags.privateGenerations) items.push(t("membership.privateGenerations"));
  if (flags.advancedWorkflows) items.push(t("membership.advancedWorkflows"));
  if (flags.prioritySupport) items.push(t("membership.prioritySupport"));
  if (flags.sharedCredits) items.push(t("membership.sharedCredits"));
  if (concurrentJobs !== null) {
    items.push(t("membership.concurrentJobs", { count: concurrentJobs }));
  }
  if (queuedJobs !== null) {
    items.push(t("membership.queuedJobs", { count: queuedJobs }));
  }
  if (plan.topupDiscountBps > 0) {
    items.push(
      t("benefits.creditDiscount", {
        percent: plan.topupDiscountBps / 100,
        discount: (10000 - plan.topupDiscountBps) / 1000,
      })
    );
  }
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
