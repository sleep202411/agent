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
  const navItems: { href: string; label: string; Icon?: typeof IconWand }[] = [
    { href: "/ips", label: t("ipPlaza") },
    { href: "/crews", label: t("studioHall") },
    { href: "/creators", label: t("creators") },
    { href: "/art-studio/projects", label: t("studio"), Icon: IconWand },
    // Legacy uni-app route — flip to "/courses" once the native page in
    // app/(site)/courses/ ships per its README migration plan.
    { href: "/pages/course/course", label: t("course"), Icon: IconBook },
    { href: "/news", label: t("news"), Icon: IconNews },
  ];

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
        "fixed inset-x-0 top-0 z-50 transition-[background-color,backdrop-filter,border-color] duration-300 ease-out",
        scrolled
          ? "border-b border-white/5 bg-background/60 backdrop-blur-xl backdrop-saturate-150"
          : "border-b border-transparent bg-transparent"
      )}
    >
      <div className="mx-auto flex h-16 max-w-[1800px] items-center gap-4 px-6">
        {/* Logo */}
        <Link href="/" className="flex shrink-0 items-center">
          <img src="/logo.png" alt="FizzDragon" className="h-6 w-auto object-contain" />
        </Link>

        {/* Nav links (desktop) */}
        <nav className="ml-6 hidden flex-1 items-center gap-8 lg:flex">
          {navItems.map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "inline-flex items-center gap-1.5 text-sm transition-colors",
                isActive(href) ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {Icon && <Icon className="size-4" />}
              {label}
            </Link>
          ))}
        </nav>

        {/* Right cluster — desktop: theme / language / CTA */}
        <div className="ml-auto hidden items-center gap-1 lg:flex">
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
        <div className="border-t border-border/50 bg-background/95 backdrop-blur-xl lg:hidden">
          <nav className="mx-auto flex max-w-[1800px] flex-col px-6 py-3">
            {navItems.map(({ href, label, Icon }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-3 text-sm transition-colors",
                  isActive(href)
                    ? "bg-foreground/5 text-foreground"
                    : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                )}
              >
                {Icon && <Icon className="size-4" />}
                {label}
              </Link>
            ))}

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
