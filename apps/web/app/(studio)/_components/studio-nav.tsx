"use client";

/**
 * Studio-only top nav. Mounted by `app/(studio)/layout.tsx`, so it
 * only renders for the `(studio)` route group — never on the main
 * site. When `/art-studio` eventually moves to its own domain (see
 * `memory/project_fizzstudio_subdomain.md`), this nav travels with
 * it; the main-site `GlobalNav` stays on the marketing surface.
 *
 * Right-cluster order matches the spec:
 *   Language · Membership · Avatar
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { IconCheck, IconCrown, IconLanguage, IconSparkles } from "@tabler/icons-react";
import { useTranslations, useLocale, setLanguage } from "@/src/i18n/i18n";
import { setCurrentLocale, localizePath, stripLocalePrefix } from "@/src/i18n/locale-url";
import { SITE_LOCALE_OPTIONS, type Locale } from "@/src/i18n/config";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UpgradeDialog } from "@/components/payment/upgrade-dialog";
import { UserMenu } from "@/components/layout/user-menu";
import { CreateWorldDialog } from "@/app/(studio)/art-studio/_components/create-world-dialog";
import { cn } from "@/lib/utils";

export function StudioNav() {
  const t = useTranslations("nav");
  const tProject = useTranslations("project");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname() ?? "/";

  const [upgradeOpen, setUpgradeOpen] = useState(false);
  // Mirrors the 一键成片 CTA from `project-header.tsx`. In the project
  // surface that button deep-links to `/projects/[id]/produce`, but here
  // we have no project context — opening `CreateWorldDialog` is the
  // natural entry (it's the same dialog the studio home / projects
  // section uses to create a new world; once the /produce pipeline is
  // re-enabled in that dialog, the file-aware variant routes there
  // automatically).
  const [createWorldOpen, setCreateWorldOpen] = useState(false);

  // Background fades in once the user scrolls past the first ~16px so
  // the hero backdrop sits behind a fully transparent nav at rest.
  // Same threshold as GlobalNav for behavioral consistency.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const switchLocale = (next: Locale) => {
    if (next === locale) return;
    setCurrentLocale(next);
    setLanguage(next);
    const stripped = stripLocalePrefix(pathname);
    const search = typeof window !== "undefined" ? window.location.search : "";
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    router.replace(`${localizePath(stripped, next)}${search}${hash}`);
  };

  return (
    <header
      className={cn(
        "sticky top-0 z-40 h-14 transition-colors",
        scrolled
          ? "border-b border-border bg-background/80 backdrop-blur-xl"
          : "border-b border-transparent bg-transparent"
      )}
    >
      <div className="mx-auto flex h-full max-w-450 items-center gap-2 px-6">
        {/* Logo — links to studio home. */}
        {/* Logo links back to the main marketing site root — studio
            is a "side app", so the brand mark is the user's escape
            hatch back to the rest of FizzDragon. Same-tab navigation
            (no `_blank`) so the studio tab gets replaced rather than
            piling up another window. */}
        <Link href={localizePath("/", locale as Locale)} className="flex shrink-0 items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="FizzDragon Studio" className="h-6 w-auto object-contain" />
        </Link>

        {/* Right cluster */}
        <div className="ml-auto flex items-center gap-1">
          {/* 一键成片 — mirrors the gradient CTA on `project-header.tsx`
              so users have a parallel entry from studio surfaces. Same
              fuchsia→purple sparkle gradient + label so the affordance
              reads identically across contexts. */}
          <button
            type="button"
            onClick={() => setCreateWorldOpen(true)}
            className={cn(
              "mr-1 inline-flex h-8 items-center gap-1 rounded-full px-3 text-xs font-semibold text-white",
              "bg-gradient-to-r from-fuchsia-500 to-purple-500",
              "transition-colors hover:from-fuchsia-400 hover:to-purple-400"
            )}
          >
            <IconSparkles className="size-3.5" />
            <span>{tProject("oneClickProduce")}</span>
          </button>

          {/* Language switcher */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t("language")}
                className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <IconLanguage className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-36">
              <DropdownMenuLabel>{t("language")}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {SITE_LOCALE_OPTIONS.map((opt) => {
                const current = opt.value === locale;
                return (
                  <DropdownMenuItem
                    key={opt.value}
                    onSelect={() => switchLocale(opt.value)}
                    className="justify-between"
                  >
                    <span>{opt.label}</span>
                    {current ? <IconCheck className="size-4 text-primary" /> : null}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Membership — liquid-glass premium CTA. Mirrors the
              GlobalNav Studio button pattern (DESIGN.md § "Surface —
              Glass" + the brand-forward CTA pattern):
                - warm-tinted glass body (red bleeds through, not
                  painted on top)
                - 1px red rim + soft outer red bloom = "glowing from
                  within", not "drop shadow"
                - inset top white highlight = the refractive top edge
                  on real glass
              Still the only red surface in the cluster — counts as
              one red region per DESIGN.md's rule. */}
          <button
            type="button"
            onClick={() => setUpgradeOpen(true)}
            className={cn(
              "group relative inline-flex h-8 items-center gap-1.5 overflow-hidden rounded-full px-3 text-xs font-semibold text-foreground",
              "bg-linear-to-br from-[rgba(255,200,200,0.28)] via-white/8 to-[rgba(229,34,39,0.18)]",
              "dark:from-[rgba(255,140,140,0.18)] dark:via-white/4 dark:to-[rgba(229,34,39,0.22)]",
              "backdrop-blur-xl backdrop-saturate-150",
              "border border-[rgba(229,34,39,0.45)] dark:border-[rgba(255,90,90,0.45)]",
              "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.55),0_0_0_1px_rgba(229,34,39,0.25),0_6px_24px_-4px_rgba(229,34,39,0.55),0_2px_8px_-2px_rgba(229,34,39,0.4)]",
              "dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.3),0_0_0_1px_rgba(229,34,39,0.3),0_6px_28px_-4px_rgba(229,34,39,0.7),0_2px_10px_-2px_rgba(229,34,39,0.5)]",
              "transition-all duration-300 ease-out",
              "hover:from-[rgba(255,200,200,0.4)] hover:via-white/12 hover:to-[rgba(229,34,39,0.3)]",
              "hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.65),0_0_0_1px_rgba(229,34,39,0.45),0_8px_32px_-4px_rgba(229,34,39,0.75),0_4px_14px_-2px_rgba(229,34,39,0.55)]",
              "dark:hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.4),0_0_0_1px_rgba(229,34,39,0.5),0_8px_36px_-4px_rgba(229,34,39,0.9),0_4px_16px_-2px_rgba(229,34,39,0.65)]"
            )}
          >
            {/* Inner red orb — absolute-positioned blurred disc that
                glows through from underneath, so the red feels like
                it's *inside* the glass rather than painted on. */}
            <span
              aria-hidden
              className="pointer-events-none absolute -right-2 top-1/2 size-8 -translate-y-1/2 rounded-full bg-[rgba(229,34,39,0.4)] blur-md transition-opacity duration-300 group-hover:opacity-80"
            />
            <IconCrown className="relative size-3.5" />
            <span className="relative">{t("membership")}</span>
          </button>

          {/* Avatar / user menu — reuses the global UserMenu so logout
              / verified-roles / settings shortcuts come for free. */}
          <UserMenu />
        </div>
      </div>

      <UpgradeDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} />
      <CreateWorldDialog open={createWorldOpen} onOpenChange={setCreateWorldOpen} />
    </header>
  );
}
