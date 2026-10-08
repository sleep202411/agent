"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { IconCheck, IconWorld } from "@tabler/icons-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTranslations } from "@/src/i18n/i18n";
import { CURRENT_CELL } from "@/src/lib/region/cell";
import { cn } from "@/lib/utils";

export const SITE_ORIGINS = {
  global: "https://fizzdragon.com",
  cn: "https://fizzdragon.fizzspace.cn",
} as const;

export type SiteRegionKey = keyof typeof SITE_ORIGINS;

export function currentSiteRegion(): SiteRegionKey {
  return CURRENT_CELL === "cn" ? "cn" : "global";
}

export function siteRegionHref(region: SiteRegionKey, pathWithSearchHash: string): string {
  const path = pathWithSearchHash.startsWith("/") ? pathWithSearchHash : `/${pathWithSearchHash}`;
  return `${SITE_ORIGINS[region]}${path || "/"}`;
}

export const SITE_REGION_OPTIONS: SiteRegionKey[] = ["global", "cn"];

export function SiteRegionMenu({ className }: { className?: string }) {
  const t = useTranslations("nav");
  const pathname = usePathname() ?? "/";
  const [pathWithSearchHash, setPathWithSearchHash] = useState(pathname);
  const current = currentSiteRegion();

  useEffect(() => {
    setPathWithSearchHash(
      `${window.location.pathname}${window.location.search}${window.location.hash}`
    );
  }, [pathname]);

  const labelFor = (region: SiteRegionKey) => (region === "cn" ? t("siteCn") : t("siteGlobal"));

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={cn(className, "gap-1.5")} aria-label={t("siteSwitch")}>
          <IconWorld className="size-3.5 shrink-0 opacity-80" aria-hidden />
          <span>{labelFor(current)}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={10}
        className="w-44 border-white/10 bg-[oklch(0.16_0_0)] p-1.5 text-white shadow-xl"
      >
        <p className="px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wide text-white/45">
          {t("siteSwitch")}
        </p>
        <ul className="space-y-0.5">
          {SITE_REGION_OPTIONS.map((region) => {
            const active = region === current;
            const label = labelFor(region);
            return (
              <li key={region}>
                {active ? (
                  <div className="flex items-center justify-between rounded-lg px-2.5 py-2 text-sm font-medium text-white">
                    <span>{label}</span>
                    <IconCheck className="size-3.5 text-primary" aria-hidden />
                  </div>
                ) : (
                  <a
                    href={siteRegionHref(region, pathWithSearchHash)}
                    className={cn(
                      "flex items-center justify-between rounded-lg px-2.5 py-2 text-sm font-medium text-white/80 transition-colors",
                      "hover:bg-white/10 hover:text-white"
                    )}
                  >
                    <span>{label}</span>
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
