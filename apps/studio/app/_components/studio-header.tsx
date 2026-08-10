"use client";

import { IconCrown } from "@tabler/icons-react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { AccountMenu } from "./account-menu";
import { SubscriptionDialog } from "./subscription-dialog";
import { useAuth } from "./auth-provider";
import { WorkspaceSwitcher } from "./workspace-switcher";

/**
 * The one product header shared by landing and app surfaces. Layouts own only
 * positioning (overlay vs normal flow); the product chrome never forks again.
 */
export function StudioHeader() {
  const { user, loading, signIn } = useAuth();
  const [pricingOpen, setPricingOpen] = useState(false);
  const ta = useTranslations("auth");

  return (
    <header className="relative z-40 flex h-16 items-center justify-end gap-4 overflow-visible px-6 text-[14px]">
      <div className="flex items-center gap-2">
        {loading ? (
          <>
            <div className="h-8 w-28 animate-pulse rounded-[12px] bg-white/[0.06]" />
            <div className="h-9 w-56 animate-pulse rounded-[14px] bg-white/[0.06]" />
            <div className="size-8 animate-pulse rounded-full bg-white/[0.06]" />
          </>
        ) : user ? (
          <>
            <UpgradeButton onClick={() => setPricingOpen(true)} />
            <WorkspaceSwitcher />
            <AccountMenu
              fallback="initial"
              triggerClassName="size-8 bg-[#744717] text-white hover:bg-[#86531C] data-[state=open]:bg-[#86531C] [&_span]:text-[13px]"
            />
          </>
        ) : (
          <>
            <UpgradeButton onClick={() => setPricingOpen(true)} />
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
    </header>
  );
}

function UpgradeButton({ onClick }: { onClick: () => void }) {
  const t = useTranslations("account");

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-8 items-center gap-1.5 rounded-[12px] bg-[#E52227] px-2.5 py-1.5 text-[14px] leading-5 font-medium text-white shadow-[0_0_18px_rgb(229_34_39/0.22)] transition hover:bg-[#c91e22]"
    >
      <IconCrown className="size-4 text-white" stroke={2} />
      {t("upgrade")}
    </button>
  );
}
