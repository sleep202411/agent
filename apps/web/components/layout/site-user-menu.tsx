"use client";

import Link from "next/link";
import { IconLogout } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useAppDispatch, useAppSelector } from "@/src/store";
import { logout } from "@/src/store/slices/authSlice";
import { env } from "@/src/env";

/**
 * Compact user widget for the public-site GlobalNav. Unlike the rich
 * `<UserMenu>` used inside /studio (which surfaces credits, upgrade,
 * theme, etc.), the site nav only needs:
 *   - Avatar → routes directly to /profile
 *   - Logout button next to it (with confirm dialog)
 */
export function SiteUserMenu() {
  const tc = useTranslations("common");
  const dispatch = useAppDispatch();
  const user = useAppSelector((state) => state.auth.user);
  if (!user) return null;

  const displayName = user.nickname || "User";
  // The auth slice stores the raw `headImg` path (e.g. "userAvatar/123.jpg").
  // Match profile-header's resolver: skip prefix if already an absolute
  // URL, otherwise prepend USER_BASE_URL with OSS_BASE_URL as fallback.
  const avatarUrl = (() => {
    const raw = user.avatar;
    if (!raw) return undefined;
    if (raw.startsWith("http")) return raw;
    const base = env.USER_BASE_URL || env.OSS_BASE_URL;
    return base ? `${base}/${raw}` : undefined;
  })();
  const initials = displayName.slice(0, 1).toUpperCase();

  return (
    <div className="flex items-center gap-2">
      <Link
        href="/profile"
        aria-label={displayName}
        className="rounded-full outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Avatar className="size-8">
          <AvatarImage src={avatarUrl} alt={displayName} />
          <AvatarFallback className="text-xs">{initials}</AvatarFallback>
        </Avatar>
      </Link>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <button
            type="button"
            title={tc("logout")}
            aria-label={tc("logout")}
            className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <IconLogout className="size-4" />
          </button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tc("logoutConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{tc("logoutConfirmBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void dispatch(logout())}>
              {tc("logout")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
