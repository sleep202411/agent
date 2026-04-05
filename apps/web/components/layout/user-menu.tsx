"use client";

import { useEffect, useState } from "react";
import {
  IconArrowBack,
  IconCredits,
  IconCrown,
  IconDeviceDesktop,
  IconLanguage,
  IconLogout,
  IconMoon,
  IconSettings,
  IconSun,
} from "@tabler/icons-react";
import { useLocale, useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { usePathname, useRouter } from "@/src/i18n/navigation";
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
import { useAppDispatch } from "@/src/store";
import { logout } from "@/src/store/slices/authSlice";
import { backendApi } from "@/src/lib/api";

// ── Types ───────────────────────────────────────────────

interface UserInfo {
  nickName?: string;
  userName?: string;
  email?: string;
  headImg?: string;
  phone?: string;
  [key: string]: unknown;
}

export interface UserMenuProps {
  credits?: number;
  onUpgrade?: () => void;
  onRecharge?: () => void;
}

// ── Component ───────────────────────────────────────────

export function UserMenu({ credits, onUpgrade, onRecharge }: UserMenuProps) {
  const tc = useTranslations("common");
  const dispatch = useAppDispatch();
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    backendApi
      .get<UserInfo>("/user/query/user/info")
      .then((data) => setUserInfo(data))
      .catch(() => {});
  }, []);

  const displayName = userInfo?.nickName || userInfo?.userName || "User";
  const displayEmail = userInfo?.email || userInfo?.phone || "";
  const avatarUrl = userInfo?.headImg ? String(userInfo.headImg) : undefined;
  const initials = displayName.slice(0, 1).toUpperCase();

  const switchLocale = (nextLocale: string) => {
    if (nextLocale === locale) return;
    router.replace(pathname, { locale: nextLocale });
  };

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

      <DropdownMenuContent align="end" className="w-72">
        {/* User info */}
        <div className="flex items-center gap-3 px-3 py-3">
          <Avatar className="size-10">
            <AvatarImage src={avatarUrl} alt={displayName} />
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{displayName}</p>
            {displayEmail && (
              <p className="truncate text-xs text-muted-foreground">{displayEmail}</p>
            )}
          </div>
          <Button variant="ghost" color="muted" size="icon-sm">
            <IconSettings className="size-4" />
          </Button>
        </div>

        <DropdownMenuSeparator />

        {/* Credits */}
        <div className="px-3 py-2.5">
          <div className="flex items-center gap-2">
            <IconCredits className="size-4 text-primary" />
            <span className="text-xl font-bold">{credits ?? 0}</span>
            <span className="text-xs text-muted-foreground">{tc("credits")}</span>
          </div>
          <div className="mt-2 flex gap-2">
            {onUpgrade ? (
              <Button size="sm" className="flex-1" onClick={onUpgrade}>
                <IconCrown className="size-3.5" />
                {tc("upgrade")}
              </Button>
            ) : null}
            {onRecharge ? (
              <Button
                variant="outline"
                color="muted"
                size="sm"
                className="flex-1"
                onClick={onRecharge}
              >
                <IconCredits className="size-3.5" />
                {tc("credits")}
              </Button>
            ) : null}
          </div>
        </div>

        <DropdownMenuSeparator />

        {/* Theme */}
        {mounted && (
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-sm">Theme</span>
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

        {/* Language */}
        <div className="flex items-center justify-between px-3 py-2">
          <div className="flex items-center gap-2">
            <IconLanguage className="size-4 text-muted-foreground" />
            <span className="text-sm">语言</span>
          </div>
          <div className="flex rounded-lg border border-border">
            {(
              [
                { key: "zh-CN", label: "简" },
                { key: "zh-HK", label: "繁" },
                { key: "en-US", label: "EN" },
              ] as const
            ).map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => switchLocale(item.key)}
                className={cn(
                  "flex size-8 items-center justify-center text-xs font-medium transition-colors first:rounded-l-lg last:rounded-r-lg",
                  locale === item.key ? "bg-accent text-foreground" : "text-muted-foreground"
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <DropdownMenuSeparator />

        {/* Back to old version (only in iframe) */}
        {typeof window !== "undefined" && window.self !== window.top && (
          <DropdownMenuItem
            onClick={() => window.parent.postMessage({ type: "switchToOldVersion" }, "*")}
          >
            <IconArrowBack className="size-4" />
            {tc("backToOldVersion")}
          </DropdownMenuItem>
        )}

        {/* Logout */}
        <DropdownMenuItem variant="destructive" onClick={() => void dispatch(logout())}>
          <IconLogout className="size-4" />
          {tc("logout")}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* Footer */}
        <div className="flex items-center justify-center gap-3 px-3 py-2 text-[11px] text-muted-foreground">
          <a href="/terms" className="hover:text-foreground">
            Terms
          </a>
          <span className="text-border">|</span>
          <a href="/privacy" className="hover:text-foreground">
            Privacy
          </a>
          <span className="text-border">|</span>
          <a href="/blog" className="hover:text-foreground">
            Blog
          </a>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
