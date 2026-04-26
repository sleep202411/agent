"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { UserMenu } from "@/components/layout/user-menu";
import { useAppSelector, useAppDispatch } from "@/src/store";
import { fetchUser } from "@/src/store/slices/authSlice";
import { useTranslations, useLocale, setLanguage } from "@/src/i18n/i18n";
import { setCurrentLocale, localizePath, stripLocalePrefix } from "@/src/i18n/locale-url";
import { LOCALE_OPTIONS, type Locale } from "@/src/i18n/config";
import { useTheme } from "next-themes";
import { IconMoon, IconSun, IconLanguage, IconCheck } from "@tabler/icons-react";
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

  const dispatch = useAppDispatch();
  const user = useAppSelector((state) => state.auth.user);

  // Background fades in as the user scrolls past the first ~80px so the
  // hero backdrop sits behind a fully transparent nav at rest.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    dispatch(fetchUser());
  }, [dispatch]);

  // Hide on studio, project editor, and auth pages
  const shouldHide = HIDDEN_PATTERNS.some((pattern) => pathname.includes(pattern));
  if (shouldHide) return null;

  const navItems = [
    { href: "/ips", label: t("ipPlaza") },
    { href: "/crews", label: t("studioHall") },
    { href: "/creators", label: t("creators") },
    { href: "/studio/projects", label: t("studio"), target: "_blank" as const },
    { href: "/news", label: t("news") },
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
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-6">
        {/* Logo */}
        <Link href="/" className="flex shrink-0 items-center">
          <img src="/logo.png" alt="FizzDragon" className="h-6 w-auto object-contain" />
        </Link>

        {/* Nav links */}
        <nav className="ml-6 hidden flex-1 items-center gap-8 lg:flex">
          {navItems.map(({ href, label, target }) => (
            <Link
              key={href}
              href={href}
              target={target}
              className={cn(
                "text-sm transition-colors",
                isActive(href) ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {label}
            </Link>
          ))}
        </nav>

        {/* Right cluster — theme / language / CTA */}
        <div className="ml-auto flex items-center gap-1">
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
            <UserMenu />
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
      </div>
    </header>
  );
}
