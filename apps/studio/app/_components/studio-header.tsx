"use client";

import Image from "next/image";
import { useTranslations, useLocale } from "next-intl";
import { getWebBaseUrl } from "@/lib/web-base";
import { useSiteRegion } from "@/app/_components/region-provider";
import { AccountMenu } from "./account-menu";
import { CreditsBadge } from "./credits-badge";
import { LocaleSwitcher } from "./locale-switcher";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { useAuth } from "./auth-provider";

/** Full-viewport-width top bar — spans edge to edge, above the nav rail. */
export function StudioHeader() {
  const t = useTranslations("shell");
  const tc = useTranslations("common");
  const { user, loading } = useAuth();
  const locale = useLocale();
  const siteRegion = useSiteRegion();
  const showWorkspaceControls = loading || Boolean(user);
  return (
    <header className="sticky top-0 z-40 bg-background/90 backdrop-blur-xl">
      <div className="flex w-full items-center justify-between gap-2 px-4 py-4 sm:px-6">
        {/* Logo → the main web app home (fizzdragon.com / fizzstudio.fizzspace.cn),
            keyed on the deployment cell — same web base as the profile link. */}
        <a
          href={`${getWebBaseUrl(siteRegion)}/${locale}`}
          aria-label={t("header.homeAriaLabel")}
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

        <div className="flex shrink-0 items-center gap-3">
          {showWorkspaceControls ? (
            <div className="hidden items-center gap-3 sm:flex">
              {loading ? (
                <>
                  <div className="h-9 w-20 animate-pulse rounded-full bg-white/[0.06]" />
                  <div className="h-10 w-48 animate-pulse rounded-full bg-white/[0.06]" />
                </>
              ) : (
                <>
                  <CreditsBadge />
                  <WorkspaceSwitcher />
                </>
              )}
            </div>
          ) : null}
          <LocaleSwitcher />
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}
