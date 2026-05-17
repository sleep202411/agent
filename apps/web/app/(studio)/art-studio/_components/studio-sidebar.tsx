"use client";

/**
 * Studio sidebar — fixed pill anchored to the left, vertically
 * centered. Two destinations for now (home + projects). Active route
 * gets brand-red fill; inactive items hover-glow on glass.
 *
 * Hidden below `lg`: on narrow viewports the studio top nav already
 * carries the only crucial actions (composer, recharge, membership);
 * a floating left rail would just steal real estate.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconHome, IconLayoutGrid, IconSparkles } from "@tabler/icons-react";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath, stripLocalePrefix } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/art-studio", labelKey: "sidebarHome" as const, Icon: IconHome },
  {
    href: "/art-studio/projects",
    labelKey: "sidebarProjects" as const,
    Icon: IconLayoutGrid,
  },
  {
    href: "/art-studio/image",
    labelKey: "sidebarImageLab" as const,
    Icon: IconSparkles,
  },
];

export function StudioSidebar() {
  const pathname = usePathname() ?? "/";
  const locale = useLocale() as Locale;
  const t = useTranslations("workspace");

  // Strip the locale prefix so route comparison is locale-agnostic.
  // `/zh-CN/art-studio/projects` → `/art-studio/projects`.
  const appPath = stripLocalePrefix(pathname);

  return (
    <aside
      aria-label={t("sidebarLabel")}
      className="fixed left-4 top-1/2 z-30 hidden -translate-y-1/2 lg:block"
    >
      <nav
        className={cn(
          "flex flex-col items-center gap-1 rounded-full p-2",
          // Liquid glass per DESIGN.md § "Surface — Glass":
          // translucent fill + backdrop-blur + glass-border ring +
          // top inset highlight. All three are required for the
          // surface to read as glass.
          "bg-white/[0.04] ring-1 ring-inset ring-white/[0.08] backdrop-blur-xl",
          "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06),0_8px_28px_-12px_rgba(0,0,0,0.5)]"
        )}
      >
        {ITEMS.map(({ href, labelKey, Icon }) => {
          // Exact match for /art-studio (home) so it doesn't stay
          // active when the user drills into a sub-route. Other items
          // use startsWith so deep links keep the parent highlighted.
          const isActive =
            href === "/art-studio" ? appPath === "/art-studio" : appPath.startsWith(href);
          return (
            <Link
              key={href}
              href={localizePath(href, locale)}
              title={t(labelKey)}
              aria-label={t(labelKey)}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex size-10 items-center justify-center rounded-full transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground/60 hover:bg-white/[0.08] hover:text-foreground"
              )}
            >
              <Icon className="size-[18px]" />
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
