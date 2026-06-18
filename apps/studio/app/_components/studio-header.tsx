"use client";

import Image from "next/image";
import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { AccountMenu } from "./account-menu";
import { CreditsBadge } from "./credits-badge";
import { LocaleSwitcher } from "./locale-switcher";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { useAuth } from "./auth-provider";

/** Full-viewport-width top bar — spans edge to edge, above the nav rail. */
export function StudioHeader() {
  const t = useTranslations("shell");
  const { user, loading } = useAuth();
  const showWorkspaceControls = loading || Boolean(user);
  return (
    <header className="sticky top-0 z-40 bg-background/90 backdrop-blur-xl">
      <div className="flex w-full items-center justify-between gap-2 px-4 py-4 sm:px-6">
        <Link
          href="/"
          aria-label={t("header.homeAriaLabel")}
          className="flex shrink-0 items-center"
        >
          <Image
            src="/logo.png"
            alt="FizzDragon"
            width={439}
            height={78}
            priority
            className="h-7 w-auto"
          />
        </Link>

        <div className="flex shrink-0 items-center gap-3">
          {showWorkspaceControls ? (
            loading ? (
              <>
                <div className="h-9 w-20 animate-pulse rounded-full bg-white/[0.06]" />
                <div className="h-10 w-48 animate-pulse rounded-full bg-white/[0.06]" />
              </>
            ) : (
              <>
                <CreditsBadge />
                <WorkspaceSwitcher />
              </>
            )
          ) : null}
          <LocaleSwitcher />
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}
