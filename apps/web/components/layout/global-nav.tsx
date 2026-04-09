import { Link } from "@tanstack/react-router";
import { useLocation } from "@tanstack/react-router";
import { useTranslations } from "@/src/i18n/i18n";
import {
  IconFlame,
  IconUsers,
  IconSparkles,
  IconLayoutDashboard,
  IconBell,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { UserMenu } from "@/components/layout/user-menu";

const HIDDEN_PATTERNS = ["/projects/", "/auth", "/payment"];

export function GlobalNav() {
  const { pathname } = useLocation();
  const t = useTranslations("nav");

  // Hide on studio, project editor, and auth pages
  const shouldHide = HIDDEN_PATTERNS.some((pattern) => pathname.includes(pattern));
  if (shouldHide) return null;

  const navItems = [
    { href: "/projects", label: t("studio"), icon: IconLayoutDashboard },
    { href: "/creators", label: t("creators"), icon: IconUsers },
  ];

  const isActive = (href: string) => pathname.startsWith(href);

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

        {/* Right side */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="relative flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            <IconBell className="size-4" />
          </button>

          <UserMenu />
        </div>
      </div>
    </header>
  );
}
