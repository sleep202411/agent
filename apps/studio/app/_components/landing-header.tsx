"use client";

/**
 * Shared header for the immersive landing surfaces ((landing) route group:
 * home, story-studio…). Floats transparently over each page's full-bleed
 * backdrop — the solid sticky bar for app surfaces is `StudioHeader`.
 */

import { IconCrown } from "@tabler/icons-react";
import Image from "next/image";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { getWebBaseUrl } from "@/lib/web-base";
import { useSiteRegion } from "@/app/_components/region-provider";
import { useAuth } from "./auth-provider";
import { AccountMenu } from "./account-menu";
import { SubscriptionDialog } from "./subscription-dialog";
import { WorkspaceSwitcher } from "./workspace-switcher";

export function LandingHeader() {
  // Real auth. Mirrors the imagine.art account cluster: Upgrade, workspace,
  // avatar. Signed-out users keep a compact sign-in entry so the public
  // landings stay usable.
  const { user, loading, signIn } = useAuth();
  const [pricingOpen, setPricingOpen] = useState(false);
  const locale = useLocale();
  const t = useTranslations("shell");
  const ta = useTranslations("auth");
  const tc = useTranslations("common");
  const siteRegion = useSiteRegion();

  return (
    <header className="flex h-16 items-center justify-between gap-4 overflow-visible px-6 text-[14px]">
      {/* Logo → main web app home (cell-keyed), same web base as the profile link. */}
      <a
        href={`${getWebBaseUrl(siteRegion)}/${locale}`}
        aria-label={t("header.fizzDragonHomeAriaLabel")}
        className="flex shrink-0 items-center"
      >
        <Image
          src="/logo.png"
          alt={tc("fizzDragon")}
          width={439}
          height={78}
          priority
          className="h-7 w-auto"
        />
      </a>

      <div className="flex items-center gap-2">
        {loading ? (
          <>
            <div className="h-8 w-28 animate-pulse rounded-[12px] bg-white/[0.06]" />
            <div className="h-8 w-52 animate-pulse rounded-[12px] bg-white/[0.06]" />
            <div className="size-8 animate-pulse rounded-full bg-white/[0.06]" />
          </>
        ) : user ? (
          <>
            <UpgradeButton onClick={() => setPricingOpen(true)} />
            <WorkspaceSwitcher
              triggerClassName="h-8 min-w-[220px] max-w-[260px] gap-1.5 rounded-[12px] border border-[#2C263D] bg-[#15151A]/80 py-1.5 pr-2.5 pl-1.5 hover:bg-[#1B1B22]/90 data-[state=open]:bg-[#1B1B22]/90"
              avatarSize="size-5"
              avatarFallbackClassName="bg-[#744717] text-[12px] text-white"
              nameClassName="max-w-[170px] text-[14px] leading-5 font-medium text-white"
              chevronClassName="size-4 text-white/65"
            />
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
