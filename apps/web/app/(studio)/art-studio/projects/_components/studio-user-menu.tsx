"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  IconCredits,
  IconLanguage,
  IconListDetails,
  IconLogout,
  IconUsers,
} from "@tabler/icons-react";
import { useTranslations, useLocale, setLanguage } from "@/src/i18n/i18n";
import { setCurrentLocale, localizePath, stripLocalePrefix } from "@/src/i18n/locale-url";
import { SITE_LOCALE_OPTIONS, type Locale } from "@/src/i18n/config";
import { UserAvatar } from "@/components/user-avatar";
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
  onTeam?: () => void;
  /** Opens the credits + integral-records popover that the project
   *  header already owns. Without this entry the records view was
   *  only reachable by clicking the credits chip elsewhere on the
   *  header — easy to miss. */
  onIntegralRecords?: () => void;
}

export function StudioUserMenu({ credits, onTeam, onIntegralRecords }: StudioUserMenuProps) {
  const tc = useTranslations("common");
  const tn = useTranslations("nav");
  const logout = useLogout();
  const { user } = useCurrentUser();
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const locale = useLocale();

  const switchLocale = (next: Locale) => {
    if (next === locale) return;
    setCurrentLocale(next);
    setLanguage(next);
    // Preserve the project's search params + hash (worldId / episodeId
    // / etc) — usePathname() drops them, so pull from window directly.
    const stripped = stripLocalePrefix(pathname);
    const canonicalPath =
      stripped === "/projects"
        ? "/art-studio"
        : stripped.replace(/^\/projects(?=\/)/, "/art-studio/projects");
    const search = typeof window !== "undefined" ? window.location.search : "";
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    router.replace(`${localizePath(canonicalPath, next)}${search}${hash}`);
  };

  const displayName = user?.nickname || "User";
  const avatarUrl = user?.avatar || undefined;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center rounded-full outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <UserAvatar src={avatarUrl} seed={user?.id} name={displayName} className="size-8" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80 p-0">
        {/* User info */}
        <div className="flex items-center gap-3 px-4 py-4">
          <UserAvatar src={avatarUrl} seed={user?.id} name={displayName} className="size-12" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="truncate text-sm font-semibold">{displayName}</p>
            </div>
          </div>
        </div>

        <DropdownMenuSeparator />

        {/* Credits */}
        <div className="px-4 py-3">
          <div className="flex items-center gap-2">
            <IconCredits className="size-4 text-primary" />
            <span className="text-xl font-bold">{credits?.toLocaleString() ?? "—"}</span>
            <span className="text-xs text-muted-foreground">{tc("creditsLeft")}</span>
          </div>
        </div>

        <DropdownMenuSeparator />

        {/* Account actions — integral records lives here alongside
            Team so anything "about my account state" sits in one
            grouped block. Each entry is independently feature-gated:
            the project-header passes onIntegralRecords today; pages
            that don't surface the credits popover can simply omit it
            and the item won't render. */}
        {(onIntegralRecords || onTeam) && (
          <>
            <div className="py-1">
              {onIntegralRecords && (
                <DropdownMenuItem className="px-4" onClick={onIntegralRecords}>
                  <IconListDetails className="size-4" />
                  {tc("integralRecords")}
                </DropdownMenuItem>
              )}
              {onTeam && (
                <DropdownMenuItem className="px-4" onClick={onTeam}>
                  <IconUsers className="size-4" />
                  {tc("team")}
                </DropdownMenuItem>
              )}
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
            {SITE_LOCALE_OPTIONS.map((opt, i) => {
              const current = opt.value === locale;
              const isFirst = i === 0;
              const isLast = i === SITE_LOCALE_OPTIONS.length - 1;
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
