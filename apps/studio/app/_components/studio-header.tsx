"use client";

import { IconBolt, IconCrown } from "@tabler/icons-react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { AccountMenu } from "./account-menu";
import { CreditsBadge } from "./credits-badge";
import { LocaleSwitcher } from "./locale-switcher";
import { SiteRegionSwitcher } from "./site-region-switcher";
import { SubscriptionDialog } from "./subscription-dialog";
import { useAuth } from "./auth-provider";
import { formatEntitlementPlanName, useMyEntitlement } from "./entitlement-context";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { ComputeRechargeDialog } from "./compute-recharge-dialog";
import { useProjectPayerWorkspace } from "@/app/[locale]/project/_components/project-context";

/**
 * The one product header shared by landing and app surfaces. Layouts own only
 * positioning (overlay vs normal flow); the product chrome never forks again.
 */
export function StudioHeader() {
  const { user, loading, signIn, requireAuth } = useAuth();
  const entitlement = useMyEntitlement();
  const billingWorkspace = useProjectPayerWorkspace();
  const [pricingOpen, setPricingOpen] = useState(false);
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const ta = useTranslations("auth");
  const tc = useTranslations("shell.credits");

  return (
    <header className="relative z-40 flex h-16 items-center justify-end gap-4 overflow-visible px-3 text-[14px] sm:px-6">
      <div className="flex min-w-0 max-w-full items-center gap-2">
        <SiteRegionSwitcher />
        <LocaleSwitcher />
        {!loading &&
          (user ? (
            <CreditsBadge
              variant="secondary"
              onClick={() => setRechargeOpen(true)}
              className="h-8 rounded-[12px] bg-card/95 px-2.5 text-[14px] text-white hover:bg-accent"
            />
          ) : (
            <button
              type="button"
              aria-label={tc("recharge")}
              title={tc("recharge")}
              onClick={() => requireAuth(() => setRechargeOpen(true))}
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-[12px] bg-white/[0.08] px-2.5 py-1.5 text-[14px] leading-5 font-medium whitespace-nowrap text-white transition hover:bg-white/[0.12] focus-visible:ring-2 focus-visible:ring-white/35 disabled:opacity-50"
            >
              <IconBolt className="size-4" stroke={1.8} aria-hidden />
              <span className="hidden sm:inline">{tc("recharge")}</span>
            </button>
          ))}
        {loading ? (
          <>
            <div className="h-8 w-16 animate-pulse rounded-[12px] bg-white/[0.06] sm:w-28" />
            <div className="h-8 w-16 animate-pulse rounded-[12px] bg-white/[0.06] sm:w-56" />
            <div className="size-8 animate-pulse rounded-full bg-white/[0.06]" />
          </>
        ) : user ? (
          <>
            {entitlement.isLoading ? (
              <div className="h-8 w-20 animate-pulse rounded-[12px] bg-white/[0.06]" />
            ) : (
              <MembershipButton
                planKey={entitlement.data?.entitlement.planKey ?? null}
                unavailable={entitlement.isError}
                onClick={() => setPricingOpen(true)}
              />
            )}
            <div className="min-w-0 max-w-56 flex-1">
              <WorkspaceSwitcher />
            </div>
            <AccountMenu
              fallback="initial"
              triggerClassName="size-8 bg-[#744717] text-white hover:bg-[#86531C] data-[state=open]:bg-[#86531C] [&_span]:text-[13px]"
            />
          </>
        ) : (
          <>
            <MembershipButton planKey="free" onClick={() => setPricingOpen(true)} />
            <button
              type="button"
              onClick={signIn}
              className="h-8 rounded-[12px] bg-white px-2.5 py-1.5 text-[14px] leading-5 font-medium text-black transition hover:bg-white/90"
            >
              {ta("signIn")}
            </button>
          </>
        )}
      </div>

      <SubscriptionDialog open={pricingOpen} onOpenChange={setPricingOpen} />
      {rechargeOpen && user && billingWorkspace && (
        <ComputeRechargeDialog open onOpenChange={setRechargeOpen} />
      )}
    </header>
  );
}

function MembershipButton({
  planKey,
  unavailable = false,
  onClick,
}: {
  planKey: string | null;
  unavailable?: boolean;
  onClick: () => void;
}) {
  const t = useTranslations("account");
  const isPaid = Boolean(planKey && planKey !== "free");
  const label = unavailable
    ? t("billing")
    : isPaid
      ? formatEntitlementPlanName(planKey!)
      : t("upgrade");

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={
        isPaid || unavailable
          ? "flex h-8 shrink-0 items-center gap-1.5 rounded-[12px] bg-white/[0.08] px-2.5 py-1.5 text-[14px] leading-5 font-medium whitespace-nowrap text-white transition hover:bg-white/[0.12]"
          : "flex h-8 shrink-0 items-center gap-1.5 rounded-[12px] bg-[#E52227] px-2.5 py-1.5 text-[14px] leading-5 font-medium whitespace-nowrap text-white shadow-[0_0_18px_rgb(229_34_39/0.22)] transition hover:bg-[#c91e22]"
      }
    >
      <IconCrown className="size-4 text-white" stroke={2} />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
