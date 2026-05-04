"use client";

import { useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  IconCredits,
  IconCrown,
  IconCoin,
  IconLanguage,
  IconSun,
  IconMoon,
  IconDeviceDesktop,
  IconLogout,
  IconUsers,
} from "@tabler/icons-react";
import { useTranslations, useLocale, setLanguage } from "@/src/i18n/i18n";
import { setCurrentLocale, localizePath, stripLocalePrefix } from "@/src/i18n/locale-url";
import { LOCALE_OPTIONS, type Locale } from "@/src/i18n/config";
import { useTheme } from "next-themes";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useLogout } from "@/src/hooks/use-logout";

interface StudioUserMenuProps {
  credits?: number;
  onUpgrade?: () => void;
  onRecharge?: () => void;
  onTeam?: () => void;
}

export function StudioUserMenu({ credits, onUpgrade, onRecharge, onTeam }: StudioUserMenuProps) {
  const tc = useTranslations("common");
  const tn = useTranslations("nav");
  const logout = useLogout();
  const { user } = useCurrentUser();
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const locale = useLocale();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  const switchLocale = (next: Locale) => {
    if (next === locale) return;
    setCurrentLocale(next);
    setLanguage(next);
    // Preserve the project's search params + hash (worldId / episodeId
    // / etc) — usePathname() drops them, so pull from window directly.
    const stripped = stripLocalePrefix(pathname);
    const search = typeof window !== "undefined" ? window.location.search : "";
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    router.replace(`${localizePath(stripped, next)}${search}${hash}`);
  };

  const displayName = user?.nickname || "User";
  const avatarUrl = user?.avatar || undefined;
  const initials = displayName.slice(0, 1).toUpperCase();
  const userLevel = user?.userLevel || "";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center rounded-full outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Avatar className="size-8">
            <AvatarImage src={avatarUrl} alt={displayName} />
            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80 p-0">
        {/* User info */}
        <div className="flex items-center gap-3 px-4 py-4">
          <Avatar className="size-12">
            <AvatarImage src={avatarUrl} alt={displayName} />
            <AvatarFallback className="text-sm">{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="truncate text-sm font-semibold">{displayName}</p>
              {userLevel && (
                <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                  {userLevel}
                </span>
              )}
            </div>
          </div>
        </div>

        <DropdownMenuSeparator />

        {/* Credits */}
        <div className="px-4 py-3">
          <div className="mb-3 flex items-center gap-2">
            <IconCredits className="size-4 text-primary" />
            <span className="text-xl font-bold">{credits?.toLocaleString() ?? "—"}</span>
            <span className="text-xs text-muted-foreground">{tc("creditsLeft")}</span>
          </div>
          <div className="flex gap-2">
            <Button size="sm" className="flex-1" onClick={onUpgrade}>
              <IconCrown className="size-3.5" />
              {tc("upgrade")}
            </Button>
            <Button
              variant="outline"
              color="muted"
              size="sm"
              className="flex-1"
              onClick={onRecharge}
            >
              <IconCoin className="size-3.5" />
              {tc("rechargeCredits")}
            </Button>
          </div>
        </div>

        <DropdownMenuSeparator />

        {/* Team */}
        {onTeam && (
          <>
            <div className="py-1">
              <DropdownMenuItem className="px-4" onClick={onTeam}>
                <IconUsers className="size-4" />
                {tc("team")}
              </DropdownMenuItem>
            </div>
            <DropdownMenuSeparator />
          </>
        )}

        {/* Language */}
        <div className="flex items-center justify-between px-4 py-2.5">
          <div className="flex items-center gap-2">
            <IconLanguage className="size-4 text-muted-foreground" />
            <span className="text-sm">{tn("language")}</span>
          </div>
          <div className="flex rounded-lg border border-border">
            {LOCALE_OPTIONS.map((opt, i) => {
              const current = opt.value === locale;
              const isFirst = i === 0;
              const isLast = i === LOCALE_OPTIONS.length - 1;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => switchLocale(opt.value)}
                  className={cn(
                    "flex h-8 items-center justify-center px-2 text-xs transition-colors",
                    isFirst && "rounded-l-lg",
                    isLast && "rounded-r-lg",
                    current
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <DropdownMenuSeparator />

        {/* Theme */}
        {mounted && (
          <div className="flex items-center justify-between px-4 py-2.5">
            <div className="flex items-center gap-2">
              <IconMoon className="size-4 text-muted-foreground" />
              <span className="text-sm">{tc("theme")}</span>
            </div>
            <div className="flex rounded-lg border border-border">
              <button
                type="button"
                onClick={() => setTheme("light")}
                className={cn(
                  "flex size-8 items-center justify-center rounded-l-lg transition-colors",
                  theme === "light" ? "bg-accent text-foreground" : "text-muted-foreground"
                )}
              >
                <IconSun className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setTheme("dark")}
                className={cn(
                  "flex size-8 items-center justify-center transition-colors",
                  theme === "dark" ? "bg-accent text-foreground" : "text-muted-foreground"
                )}
              >
                <IconMoon className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setTheme("system")}
                className={cn(
                  "flex size-8 items-center justify-center rounded-r-lg transition-colors",
                  theme === "system" ? "bg-accent text-foreground" : "text-muted-foreground"
                )}
              >
                <IconDeviceDesktop className="size-3.5" />
              </button>
            </div>
          </div>
        )}

        <DropdownMenuSeparator />

        {/* Logout */}
        <div className="py-1">
          <DropdownMenuItem className="px-4" onClick={() => void logout()}>
            <IconLogout className="size-4" />
            {tc("logout")}
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
