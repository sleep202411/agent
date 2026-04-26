"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { UserMenu } from "@/components/layout/user-menu";
import { useAppSelector, useAppDispatch } from "@/src/store";
import { fetchUser } from "@/src/store/slices/authSlice";
import { useTranslations, useLocale, setLanguage } from "@/src/i18n/i18n";
import { setCurrentLocale, localizePath, stripLocalePrefix } from "@/src/i18n/locale-url";
import { LOCALE_OPTIONS, type Locale } from "@/src/i18n/config";
import { useTheme } from "next-themes";
import {
  IconUsers,
  IconLayoutDashboard,
  IconDiamond,
  IconMovie,
  IconMoon,
  IconSun,
  IconLanguage,
  IconNews,
  IconCheck,
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

  const dispatch = useAppDispatch();
  const user = useAppSelector((state) => state.auth.user);

  useEffect(() => {
    dispatch(fetchUser());
  }, [dispatch]);

  // Hide on studio, project editor, and auth pages
  const shouldHide = HIDDEN_PATTERNS.some((pattern) => pathname.includes(pattern));
  if (shouldHide) return null;

  const navItems = [
    { href: "/ips", label: t("ipPlaza"), icon: IconDiamond },
    { href: "/crews", label: t("studioHall"), icon: IconMovie },
    { href: "/creators", label: t("creators"), icon: IconUsers },
    {
      href: "/studio/projects",
      label: t("studio"),
      icon: IconLayoutDashboard,
      target: "_blank" as const,
    },
    { href: "/news", label: t("news"), icon: IconNews },
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
    return (
      <header className="fixed inset-x-0 top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 items-center" style={{ maxWidth: 1400 }} />
      </header>
    );
  }

  return (
    <header className="fixed inset-x-0 top-0 z-50 backdrop-blur-xl">
      <div className="mx-auto flex h-14 items-center justify-between px-6">
        {/* Logo + Nav */}
        <div className="flex items-center gap-8">
          <Link href="/ips" className="flex items-center gap-2 shrink-0">
            <img src="/logo.png" alt="FizzDragon" className="h-7" />
          </Link>

          <nav className="hidden items-center gap-1 md:flex mx-auto">
            {navItems.map(({ href, label, icon: Icon, target }) => (
              <Link
                key={href}
                href={href}
                target={target}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors",
                  isActive(href)
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                )}
              >
                <Icon className="size-4" />
                {label}
              </Link>
            ))}
          </nav>
        </div>

        {/* Right side: theme + language + CTA */}
        <div className="flex items-center gap-2">
          {/* Theme toggle */}
          {mounted && (
            <button
              type="button"
              onClick={toggleTheme}
              className="flex size-9 items-center justify-center rounded-lg bg-secondary text-muted-foreground transition-colors hover:text-foreground"
            >
              {isDark ? <IconMoon className="size-4" /> : <IconSun className="size-4" />}
            </button>
          )}

          {/* Language menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t("language")}
                className="flex size-9 items-center justify-center rounded-lg bg-secondary text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
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

          {/* User or CTA */}
          {user ? (
            <UserMenu />
          ) : (
            <button
              type="button"
              onClick={() => router.push(localizePath("/login", locale as Locale))}
              className="ml-1 rounded-full bg-foreground px-4 py-1.5 text-sm font-semibold text-background transition-colors hover:bg-foreground/90"
            >
              {t("getStarted")}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
