"use client";

import { useEffect, useState } from "react";
import { IconCheck, IconWorld } from "@tabler/icons-react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname } from "@/i18n/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SITE_REGION_OPTIONS, studioSiteRegionHref } from "@/lib/studio-site";
import { useSiteRegion, type SiteRegion } from "./region-provider";

/** Switch between the international and CN FizzStudio cells. */
export function SiteRegionSwitcher() {
  const t = useTranslations("siteSwitcher");
  const locale = useLocale();
  const pathname = usePathname() ?? "/";
  const current = useSiteRegion();
  const [pathWithSearchHash, setPathWithSearchHash] = useState(pathname);

  useEffect(() => {
    setPathWithSearchHash(`${pathname}${window.location.search}${window.location.hash}`);
  }, [pathname]);

  const labelFor = (region: SiteRegion) => (region === "cn" ? t("cn") : t("global"));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("label")}
        title={t("label")}
        className="flex h-8 shrink-0 items-center gap-1.5 rounded-[12px] bg-white/[0.08] px-2.5 text-[13px] font-medium text-white transition hover:bg-white/[0.12] focus-visible:ring-2 focus-visible:ring-white/35"
      >
        <IconWorld className="size-3.5 opacity-80" stroke={1.8} aria-hidden />
        <span className="hidden sm:inline">{labelFor(current)}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40 p-1.5">
        <DropdownMenuLabel className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {t("label")}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {SITE_REGION_OPTIONS.map((region) => {
          const active = region === current;
          const label = labelFor(region);
          if (active) {
            return (
              <DropdownMenuItem
                key={region}
                disabled
                className="justify-between rounded-lg text-sm"
              >
                <span>{label}</span>
                <IconCheck className="size-3.5 text-primary" aria-hidden />
              </DropdownMenuItem>
            );
          }
          return (
            <DropdownMenuItem key={region} asChild className="rounded-lg text-sm">
              <a href={studioSiteRegionHref(region, locale, pathWithSearchHash)}>{label}</a>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
