import { useSyncExternalStore } from "react";
import { Link } from "@tanstack/react-router";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useTranslations, useLocale, setLanguage } from "@/src/i18n/i18n";
import { setCurrentLocale } from "@/src/i18n/locale-url";
import { useTheme } from "next-themes";
import {
  IconFlame,
  IconUsers,
  IconLayoutDashboard,
  IconDiamond,
  IconMovie,
  IconTarget,
  IconMoon,
  IconSun,
  IconLanguage,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";

const HIDDEN_PATTERNS = ["/projects/", "/auth", "/payment", "/profile"];

export function GlobalNav() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const t = useTranslations("nav");
  const locale = useLocale();
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  // Hide on studio, project editor, and auth pages
  const shouldHide = HIDDEN_PATTERNS.some((pattern) => pathname.includes(pattern));
  if (shouldHide) return null;

  const navItems = [
    { href: "/projects", label: t("studio"), icon: IconLayoutDashboard },
    { href: "/workbench", label: t("workbench"), icon: IconTarget },
    { href: "/crews", label: t("studioHall"), icon: IconMovie },
    { href: "/ips", label: t("ipPlaza"), icon: IconDiamond },
    { href: "/creators", label: t("creators"), icon: IconUsers },
  ];

  const isActive = (href: string) => pathname.startsWith(href);

  const isDark = mounted && theme === "dark";

  const toggleTheme = () => {
    setTheme(isDark ? "light" : "dark");
  };

  const cycleLocale = () => {
    const locales = ["zh-CN", "en-US", "zh-HK"];
    const currentIndex = locales.indexOf(locale);
    const nextLocale = locales[(currentIndex + 1) % locales.length];
    setCurrentLocale(nextLocale);
    setLanguage(nextLocale);
    void navigate({ to: pathname, replace: true });
  };

  return (
    <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-screen-2xl items-center justify-between px-6">
        {/* Logo + Nav */}
        <div className="flex items-center gap-8">
          <Link to="/projects" className="flex items-center gap-2 shrink-0">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary">
              <IconFlame className="size-5 text-primary-foreground" />
            </div>
            <span className="text-sm font-bold tracking-tight">
              <span className="text-foreground">Fizz</span>
              <span className="text-primary">Dragon</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {navItems.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                to={href}
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

          {/* Language toggle */}
          <button
            type="button"
            onClick={cycleLocale}
            className="flex size-9 items-center justify-center rounded-lg bg-secondary text-muted-foreground transition-colors hover:text-foreground"
            title={locale}
          >
            <IconLanguage className="size-4" />
          </button>

          {/* CTA */}
          <Link
            to="/projects"
            className="ml-1 rounded-full bg-foreground px-4 py-1.5 text-sm font-semibold text-background transition-colors hover:bg-foreground/90"
          >
            {t("getStarted")}
          </Link>
        </div>
      </div>
    </header>
  );
}
