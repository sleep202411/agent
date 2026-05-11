"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { SiteUserMenu } from "@/components/layout/site-user-menu";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useLogout } from "@/src/hooks/use-logout";
import { useTranslations, useLocale, setLanguage } from "@/src/i18n/i18n";
import { setCurrentLocale, localizePath, stripLocalePrefix } from "@/src/i18n/locale-url";
import { LOCALE_OPTIONS, type Locale } from "@/src/i18n/config";
import { useTheme } from "next-themes";
import {
  IconMoon,
  IconSun,
  IconLanguage,
  IconCheck,
  IconWand,
  IconNews,
  IconBook,
  IconBook2,
  IconX,
  IconDotsVertical,
  IconUser,
  IconLogout,
} from "@tabler/icons-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

// Rendered only under app/(site)/layout.tsx. One exception: the interactive
// editor inside (site) wants a full-screen canvas, so hide here by pathname.
const HIDDEN_PATTERNS = ["/editor"];

export function GlobalNav() {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const t = useTranslations("nav");
  const locale = useLocale();
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  const { user } = useCurrentUser();
  const logout = useLogout();

  // Background fades in as the user scrolls past the first ~80px so the
  // hero backdrop sits behind a fully transparent nav at rest.
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Hide on studio, project editor, and auth pages
  const shouldHide = HIDDEN_PATTERNS.some((pattern) => pathname.includes(pattern));
  if (shouldHide) return null;

  // Browse-style entries (IP / Crews / Creators) read as text-only labels;
  // tool-style entries (Studio onward) keep their icon glyph as an affordance
  // hint that they're an action surface, not a directory.
  // `requiresAuth` items intercept clicks while the user is signed out
  // and route to /login with `?redirect=` so post-login lands them back
  // here. Without this, clicking e.g. Academy when logged out lets the
  // legacy iframe try to load and its own bundle internally bounces
  // through the studio subdomain (cross-origin auth loss). Native Next
  // routes have AuthGate / AuthInterceptor as a fallback; the click
  // gate is a strictly nicer UX.
  const navItems: {
    href: string;
    label: string;
    Icon?: typeof IconWand;
    requiresAuth?: boolean;
  }[] = [
    { href: "/ips", label: t("ipPlaza") },
    { href: "/crews", label: t("studioHall") },
    { href: "/creators", label: t("creators") },
    // Legacy uni-app route — flip to "/courses" once the native page in
    // app/(site)/courses/ ships per its README migration plan.
    {
      href: "/courses",
      label: t("course"),
      Icon: IconBook,
      requiresAuth: true,
    },
    { href: "/news", label: t("news"), Icon: IconNews },
  ];

  // The Studio entry lives outside the regular nav array so the right
  // cluster can render it as a liquid-glass CTA — the brand-forward
  // primary action on the page, distinct from the text-link directory
  // items above. `requiresAuth: true` keeps logged-out clicks routed
  // through /login?redirect= like the others.
  const studioItem = {
    href: "/art-studio",
    label: t("studio"),
    Icon: IconWand,
    requiresAuth: true,
  };

  const onNavClick = (e: React.MouseEvent<HTMLAnchorElement>, item: (typeof navItems)[number]) => {
    if (!item.requiresAuth) return;
    if (user) return;
    e.preventDefault();
    router.push(`/login?redirect=${encodeURIComponent(item.href)}`);
  };

  const USER_GUIDE_URL = "https://flowus.cn/share/cca82279-3553-47eb-beea-f71bc4cfb5c6?code=81LL9V";

  const isActive = (href: string) => pathname.startsWith(href);

  const isDark = mounted && theme === "dark";

  const toggleTheme = () => {
    setTheme(isDark ? "light" : "dark");
  };

  const switchLocale = (next: Locale) => {
    if (next === locale) return;
    setCurrentLocale(next);
    setLanguage(next);
    // Navigate to the properly locale-prefixed URL so SSR + proxy.ts
    // see the new locale. Without this, router.replace(pathname) with
    // the same path is a no-op and i18n never re-initializes on reload.
    const stripped = stripLocalePrefix(pathname);
    const target = localizePath(stripped, next);
    router.replace(target);
  };

  if (!mounted) {
    return <header className="fixed inset-x-0 top-0 z-50 h-16" />;
  }

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-[background-color,border-color] duration-300 ease-out",
        scrolled || mobileOpen
          ? "border-b border-white/5 bg-popover text-popover-foreground"
          : "border-b border-transparent bg-transparent"
      )}
    >
      <div className="mx-auto flex h-16 max-w-450 items-center gap-0 px-6">
        {/* Logo */}
        <Link href="/" className="flex shrink-0 items-center">
          <img src="/logo.png" alt="FizzDragon" className="h-6 w-auto object-contain" />
        </Link>

        {/* Nav links (desktop) */}
        <nav className="ml-4 hidden flex-1 items-center gap-6 lg:flex">
          {navItems.map((item) => {
            const { href, label, Icon } = item;
            // Localize the click target so navigation doesn't shed the
            // user's current locale via an unprefixed → proxy → cookie
            // round-trip. legacy uni-app routes (`/pages/...`) are
            // served outside the locale prefix and must stay raw.
            const target = href.startsWith("/pages/") ? href : localizePath(href, locale as Locale);
            return (
              <Link
                key={href}
                href={target}
                onClick={(e) => onNavClick(e, item)}
                className={cn(
                  "inline-flex items-center gap-1.5 text-sm font-medium transition-colors hover:text-foreground",
                  isActive(href) ? "text-foreground" : "text-foreground/80"
                )}
              >
                {Icon && <Icon className="size-4" />}
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Right cluster — desktop: user guide / theme / language / CTA */}
        <div className="ml-auto hidden items-center gap-1 lg:flex">
          <a
            href={USER_GUIDE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            <IconBook2 className="size-4" />
            <span>{t("userGuide")}</span>
          </a>

          <button
            type="button"
            onClick={toggleTheme}
            aria-label={t("language")}
            className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            {isDark ? <IconMoon className="size-4" /> : <IconSun className="size-4" />}
          </button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t("language")}
                className="flex size-9 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <IconLanguage className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-36">
              <DropdownMenuLabel>{t("language")}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {LOCALE_OPTIONS.map((opt) => {
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

          {/* Studio liquid-glass CTA — brand-red forward, the visual anchor of
              the right cluster. Three layers stack to balance "glass" + "red":
              - layer 0 (Link surface): warm-tinted translucent gradient + red
                rim border + heavy backdrop-blur. The glass plane.
              - layer 1 (red orb span): an absolute-positioned blurred red disc
                glowing through from underneath. This is what makes the red
                feel like it's *inside* the glass, not painted on top.
              - layer 2 (sheen sweep): on hover, a diagonal white highlight
                wipes across, the premium-feel finish.
              Outer box-shadow stack adds a tight 1px brand ring + a wide
              soft red glow (the "ember" radiating into the page chrome).
           */}
          <Link
            href={localizePath(studioItem.href, locale as Locale)}
            onClick={(e) => onNavClick(e, studioItem)}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "mr-4 group relative ml-2 inline-flex h-9 items-center gap-1.5 overflow-hidden rounded-full px-4 text-sm font-medium",
              // Glass body — warm-tinted (top-left blush, bottom-right ember)
              // so red bleeds through the surface instead of just orbiting it.
              "bg-linear-to-br from-[rgba(255,200,200,0.28)] via-white/8 to-[rgba(229,34,39,0.18)]",
              "dark:from-[rgba(255,140,140,0.18)] dark:via-white/4 dark:to-[rgba(229,34,39,0.22)]",
              "backdrop-blur-xl backdrop-saturate-150",
              // Red-tinted rim (replaces white border) — subtle in light, more
              // pronounced in dark where contrast against bg-popover demands it.
              "border border-[rgba(229,34,39,0.45)] dark:border-[rgba(255,90,90,0.45)]",
              // Outer shadow stack: 1px brand ring + soft red bloom + inset
              // top-edge gloss for the glass rim. Two-layer red (tight ring
              // + wide spread) reads as "this thing is glowing", not "this
              // thing has a drop shadow".
              "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.55),0_0_0_1px_rgba(229,34,39,0.25),0_6px_24px_-4px_rgba(229,34,39,0.55),0_2px_8px_-2px_rgba(229,34,39,0.4)]",
              "dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.3),0_0_0_1px_rgba(229,34,39,0.3),0_6px_28px_-4px_rgba(229,34,39,0.7),0_2px_10px_-2px_rgba(229,34,39,0.5)]",
              "text-foreground",
              "transition-all duration-300 ease-out",
              // Hover pumps both inner gradient (more red) and outer bloom.
              "hover:from-[rgba(255,200,200,0.4)] hover:via-white/12 hover:to-[rgba(229,34,39,0.3)]",
              "hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.65),0_0_0_1px_rgba(229,34,39,0.45),0_8px_32px_-4px_rgba(229,34,39,0.75),0_4px_14px_-2px_rgba(229,34,39,0.55)]",
              "dark:hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.4),0_0_0_1px_rgba(229,34,39,0.5),0_8px_36px_-4px_rgba(229,34,39,0.9),0_4px_16px_-2px_rgba(229,34,39,0.65)]",
              "hover:-translate-y-px active:translate-y-0",
              isActive(studioItem.href) && "ring-1 ring-primary/60"
            )}
            aria-label={studioItem.label}
          >
            {/* Inner red orb — blurred disc sitting behind the glass surface.
                Breathes on a 2.6s loop (see `@keyframes studio-breath`) so the
                button reads as live. On hover, the keyframe is killed
                (`group-hover:animate-none`) and the transition takes over to
                pump scale+brightness — a single source of motion at any time. */}
            <span
              aria-hidden
              className="pointer-events-none absolute -right-2 -bottom-2 h-8 w-8 rounded-full bg-primary/50 blur-md animate-[studio-breath_2.6s_ease-in-out_infinite] transition-all duration-500 group-hover:scale-150 group-hover:bg-primary/70 group-hover:animate-none"
            />
            {/* Sheen sweep — diagonal white highlight that wipes across on hover. */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 -skew-x-12 bg-linear-to-r from-transparent via-white/45 to-transparent opacity-0 transition-all duration-700 ease-out group-hover:left-[150%] group-hover:opacity-100 dark:via-white/30"
            />
            <studioItem.Icon className="relative size-4 text-primary drop-shadow-[0_0_4px_rgba(229,34,39,0.6)] transition-transform duration-300 group-hover:rotate-[-8deg] group-hover:scale-110" />
            <span className="relative tracking-wide">{studioItem.label}</span>
          </Link>

          {user ? (
            <SiteUserMenu />
          ) : (
            <button
              type="button"
              onClick={() => router.push(localizePath("/login", locale as Locale))}
              className="ml-1 flex h-9 items-center rounded-full border border-border/40 bg-foreground/5 px-4 text-sm font-medium text-foreground transition-colors hover:bg-foreground/10"
            >
              {t("getStarted")}
            </button>
          )}
        </div>

        {/* Right cluster — mobile: a single "more" button toggles the unified drawer below */}
        <div className="ml-auto flex items-center lg:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label={t("menu")}
            aria-expanded={mobileOpen}
            className="flex size-9 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            {mobileOpen ? <IconX className="size-5" /> : <IconDotsVertical className="size-5" />}
          </button>
        </div>
      </div>

      {/* Mobile drawer — nav links + theme / language / account, all in one place */}
      {mobileOpen && (
        <div className="border-t border-white/5 bg-popover text-popover-foreground lg:hidden">
          <nav className="mx-auto flex max-w-[1800px] flex-col px-6 py-3">
            {/* Studio CTA — hero entry, same red-forward liquid-glass treatment
                as the desktop right cluster, sized up for thumb reach. */}
            <Link
              href={localizePath(studioItem.href, locale as Locale)}
              onClick={(e) => {
                onNavClick(e, studioItem);
                setMobileOpen(false);
              }}
              className={cn(
                "group relative mb-2 inline-flex h-12 items-center justify-center gap-2 overflow-hidden rounded-2xl px-5 text-base font-semibold",
                "bg-linear-to-br from-[rgba(255,200,200,0.28)] via-white/8 to-[rgba(229,34,39,0.18)]",
                "dark:from-[rgba(255,140,140,0.18)] dark:via-white/4 dark:to-[rgba(229,34,39,0.22)]",
                "backdrop-blur-xl backdrop-saturate-150",
                "border border-[rgba(229,34,39,0.45)] dark:border-[rgba(255,90,90,0.45)]",
                "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.55),0_0_0_1px_rgba(229,34,39,0.25),0_8px_28px_-4px_rgba(229,34,39,0.6),0_2px_10px_-2px_rgba(229,34,39,0.45)]",
                "dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.3),0_0_0_1px_rgba(229,34,39,0.3),0_8px_32px_-4px_rgba(229,34,39,0.75),0_2px_12px_-2px_rgba(229,34,39,0.55)]",
                "text-foreground transition-all duration-300 ease-out active:scale-[0.98]"
              )}
            >
              <span
                aria-hidden
                className="pointer-events-none absolute -right-3 -bottom-3 h-12 w-12 rounded-full bg-primary/50 blur-lg animate-[studio-breath_2.6s_ease-in-out_infinite]"
              />
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 -skew-x-12 bg-linear-to-r from-transparent via-white/45 to-transparent opacity-0 transition-all duration-700 ease-out group-hover:left-[150%] group-hover:opacity-100 dark:via-white/30"
              />
              <studioItem.Icon className="relative size-5 text-primary drop-shadow-[0_0_4px_rgba(229,34,39,0.6)]" />
              <span className="relative tracking-wide">{studioItem.label}</span>
            </Link>

            {navItems.map((item) => {
              const { href, label, Icon } = item;
              const target = href.startsWith("/pages/")
                ? href
                : localizePath(href, locale as Locale);
              return (
                <Link
                  key={href}
                  href={target}
                  onClick={(e) => {
                    onNavClick(e, item);
                    setMobileOpen(false);
                  }}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors",
                    isActive(href)
                      ? "bg-foreground/5 text-foreground"
                      : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                  )}
                >
                  {Icon && <Icon className="size-4" />}
                  {label}
                </Link>
              );
            })}

            <a
              href={USER_GUIDE_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setMobileOpen(false)}
              className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
            >
              <IconBook2 className="size-4" />
              {t("userGuide")}
            </a>

            <div className="my-2 h-px bg-border/50" />

            {/* Theme toggle */}
            <button
              type="button"
              onClick={toggleTheme}
              className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
            >
              {isDark ? <IconSun className="size-4" /> : <IconMoon className="size-4" />}
              <span>{isDark ? "Light" : "Dark"}</span>
            </button>

            {/* Language */}
            <div className="px-3 pt-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
              {t("language")}
            </div>
            {LOCALE_OPTIONS.map((opt) => {
              const current = opt.value === locale;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    setMobileOpen(false);
                    switchLocale(opt.value);
                  }}
                  className={cn(
                    "flex items-center justify-between rounded-lg px-3 py-2.5 text-sm transition-colors",
                    current
                      ? "text-foreground"
                      : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                  )}
                >
                  <span className="inline-flex items-center gap-3">
                    <IconLanguage className="size-4" />
                    {opt.label}
                  </span>
                  {current && <IconCheck className="size-4 text-primary" />}
                </button>
              );
            })}

            <div className="my-2 h-px bg-border/50" />

            {/* Account */}
            {user ? (
              <>
                <Link
                  href={localizePath("/profile", locale as Locale)}
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                >
                  <IconUser className="size-4" />
                  <span>{user.nickname || "Profile"}</span>
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setMobileOpen(false);
                    void logout();
                  }}
                  className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                >
                  <IconLogout className="size-4" />
                  <span>Logout</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setMobileOpen(false);
                  router.push(localizePath("/login", locale as Locale));
                }}
                className="mt-1 flex h-10 items-center justify-center rounded-full border border-border/40 bg-foreground/5 px-4 text-sm font-medium text-foreground transition-colors hover:bg-foreground/10"
              >
                {t("getStarted")}
              </button>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
