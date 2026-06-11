"use client";

import Image from "next/image";
import Link from "next/link";
import { AccountMenu } from "./account-menu";
import { WorkspaceSwitcher } from "./workspace-switcher";

export function StudioHeader() {
  return (
    <header className="sticky top-0 z-40 bg-background/90 backdrop-blur-xl">
      <div className="flex h-16 items-center justify-between gap-2 px-4 sm:px-6">
        <Link href="/" aria-label="FizzStudio home" className="flex shrink-0 items-center">
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
          <WorkspaceSwitcher />
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}
