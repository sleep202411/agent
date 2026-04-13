import { useEffect, useSyncExternalStore, useState } from "react";
import { AuthDialog } from "@/components/layout/auth-dialog";
import { UserMenu } from "@/components/layout/user-menu";
import { useAppSelector, useAppDispatch } from "@/src/store";
import { fetchUser } from "@/src/store/slices/authSlice";
import { Link } from "@tanstack/react-router";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useTranslations, useLocale, setLanguage } from "@/src/i18n/i18n";
import { setCurrentLocale } from "@/src/i18n/locale-url";
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
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";

const HIDDEN_PATTERNS = ["/projects/", "/auth", "/payment"];

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

  const [showAuth, setShowAuth] = useState(false);
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
    { href: "/projects", label: "Studio", icon: IconLayoutDashboard },
    { href: "/news", label: t("news"), icon: IconNews },
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
      <div
        className="mx-auto flex h-14 items-center justify-between px-6"
        style={{ maxWidth: 1400 }}
      >
        {/* Logo + Nav */}
        <div className="flex items-center gap-8">
          <Link to="/ips" className="flex items-center gap-2 shrink-0">
            <img src="/logo.png" alt="FizzDragon" className="h-7" />
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

          {/* User or CTA */}
          {user ? (
            <UserMenu />
          ) : (
            <button
              type="button"
              onClick={() => setShowAuth(true)}
              className="ml-1 rounded-full bg-foreground px-4 py-1.5 text-sm font-semibold text-background transition-colors hover:bg-foreground/90"
            >
              {t("getStarted")}
            </button>
          )}
        </div>
      </div>

      <AuthDialog open={showAuth} onOpenChange={setShowAuth} />
    </header>
  );
}
