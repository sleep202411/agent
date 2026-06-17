"use client";

import Image from "next/image";
import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { AccountMenu } from "./account-menu";
import { CreditsBadge } from "./credits-badge";
import { WorkspaceSwitcher } from "./workspace-switcher";

/** Full-viewport-width top bar — spans edge to edge, above the nav rail. */
export function StudioHeader() {
  const t = useTranslations("shell");
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
          <CreditsBadge />
          <WorkspaceSwitcher />
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}
