"use client";

import { useEffect, useRef, useState } from "react";
import { IconCheck } from "@tabler/icons-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { axonViewItem } from "@/src/lib/axon";

/**
 * Membership pricing — Plus / Pro tiers with a monthly/annual toggle and a
 * limited-time intro price. Prototype: the "Choose" CTA is a stub — real
 * checkout needs the BillingSubscription wiring. Copy is inline English for the
 * prototype; production should move it into messages/* (i18n) like other pages.
 */

type Period = "monthly" | "annual";

interface Plan {
  key: string;
  name: string;
  tagline: string;
  monthly: number;
  introMonthly?: number;
  annual: number;
  cta: string;
  features: string[];
  recommended?: boolean;
}

const PLANS: Plan[] = [
  {
    key: "plus",
    name: "Plus",
    tagline: "Everything you need to binge.",
    monthly: 9.99,
    introMonthly: 5.99,
    annual: 99.9,
    cta: "Choose Plus",
    features: [
      "Full series library — stream free",
      "Full-HD 1080p",
      "2 concurrent streams",
      "Ad-free",
      "Standard early access",
      "Entry AI generation credits",
    ],
  },
  {
    key: "pro",
    name: "Pro",
    tagline: "For superfans and creators.",
    monthly: 19.99,
    introMonthly: 11.99,
    annual: 199.9,
    cta: "Go Pro",
    recommended: true,
    features: [
      "Everything in Plus",
      "4K Ultra HD + HDR",
      "4 concurrent streams + offline downloads",
      "Earliest early-access drops",
      "Larger AI credits + advanced models",
      "Pro-exclusive titles",
    ],
  },
];

function priceParts(plan: Plan, period: Period) {
  if (period === "annual") {
    return {
      big: `$${plan.annual.toFixed(2)}`,
      unit: "/yr",
      sub: `$${(plan.annual / 12).toFixed(2)}/mo · 2 months free`,
      struck: undefined as string | undefined,
      intro: false,
    };
  }
  const intro = plan.introMonthly;
  return {
    big: `$${(intro ?? plan.monthly).toFixed(2)}`,
    unit: "/mo",
    sub: intro ? `then $${plan.monthly.toFixed(2)}/mo` : undefined,
    struck: intro ? `$${plan.monthly.toFixed(2)}` : undefined,
    intro: Boolean(intro),
  };
}

export function MembershipPlans() {
  const [period, setPeriod] = useState<Period>("monthly");

  // Fire the AppLovin `view_item` conversion once on mount for the recommended
  // plan (static prototype data; monthly list price, USD). No-op off .com (axon.ts).
  const viewItemFiredRef = useRef(false);
  useEffect(() => {
    if (viewItemFiredRef.current) return;
    viewItemFiredRef.current = true;
    const recommended = PLANS.find((p) => p.recommended) ?? PLANS[0];
    if (!recommended) return;
    axonViewItem({
      items: [
        {
          item_id: recommended.key,
          item_name: recommended.name,
          price: recommended.monthly,
          quantity: 1,
        },
      ],
      value: recommended.monthly,
      currency: "USD",
    });
  }, []);

  const onChoose = (plan: Plan) =>
    toast.info(`${plan.name} checkout isn't wired yet — billing integration pending.`);

  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6">
      <div className="text-center">
        <div className="text-xs font-medium tracking-[0.25em] text-muted-foreground uppercase">
          Membership
        </div>
        <h1 className="mt-3 text-balance text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
          Watch every series, free.
        </h1>
        <p className="mt-4 text-base text-muted-foreground sm:text-lg">
          Unlimited streaming plus AI generation credits. Cancel anytime.
        </p>
      </div>

      {/* Billing period toggle */}
      <div className="mt-9 flex justify-center">
        <div className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-card/40 p-1">
          {(["monthly", "annual"] as Period[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={cn(
                "rounded-full px-5 py-1.5 text-sm font-medium transition-colors",
                period === p
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {p === "monthly" ? "Monthly" : "Annual"}
              {p === "annual" && <span className="ml-1.5 text-xs opacity-80">save 17%</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Plans */}
      <div className="mx-auto mt-12 grid max-w-3xl gap-6 sm:grid-cols-2">
        {PLANS.map((plan) => {
          const price = priceParts(plan, period);
          return (
            <div
              key={plan.key}
              className={cn(
                "relative flex flex-col rounded-3xl border bg-card p-8",
                plan.recommended ? "border-primary/50" : "border-border/60"
              )}
            >
              {plan.recommended && (
                <span className="absolute -top-3 right-7 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
                  Most popular
                </span>
              )}

              <h2 className="text-xl font-semibold text-foreground">{plan.name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{plan.tagline}</p>

              <div className="mt-6 flex items-end gap-2">
                <span className="text-4xl font-semibold tracking-tight text-foreground">
                  {price.big}
                </span>
                <span className="pb-1 text-sm text-muted-foreground">{price.unit}</span>
                {price.struck && (
                  <span className="pb-1 text-sm text-muted-foreground line-through">
                    {price.struck}
                  </span>
                )}
              </div>
              <p className="mt-1 h-4 text-xs text-muted-foreground">{price.sub ?? ""}</p>
              {price.intro && (
                <p className="mt-1 text-xs font-medium text-primary">Limited-time intro price</p>
              )}

              <button
                type="button"
                onClick={() => onChoose(plan)}
                className={cn(
                  "mt-6 inline-flex h-12 items-center justify-center rounded-full text-sm font-semibold transition-opacity hover:opacity-90",
                  plan.recommended
                    ? "bg-primary text-primary-foreground"
                    : "bg-foreground text-background"
                )}
              >
                {plan.cta}
              </button>

              <ul className="mt-7 space-y-3">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm">
                    <IconCheck className="mt-0.5 size-4 shrink-0 text-primary" stroke={2.4} />
                    <span className="text-foreground/85">{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <p className="mx-auto mt-10 max-w-2xl text-center text-xs text-muted-foreground">
        Prices in USD. Intro pricing for a limited time. Members stream every opted-in series free;
        creators are paid from a watch-time revenue pool.
      </p>
    </section>
  );
}
