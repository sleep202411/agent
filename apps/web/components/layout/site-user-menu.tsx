"use client";

import Link from "next/link";
import { IconLogout } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAppDispatch, useAppSelector } from "@/src/store";
import { logout } from "@/src/store/slices/authSlice";

/**
 * Compact user widget for the public-site GlobalNav. Unlike the rich
 * `<UserMenu>` used inside /studio (which surfaces credits, upgrade,
 * theme, etc.), the site nav only needs:
 *   - Avatar → routes directly to /profile
 *   - Logout button next to it
 */
export function SiteUserMenu() {
  const tc = useTranslations("common");
  const dispatch = useAppDispatch();
  const user = useAppSelector((state) => state.auth.user);

  if (!user) return null;

  const displayName = user.nickname || "User";
  const avatarUrl = user.avatar || undefined;
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
      <button
        type="button"
        onClick={() => void dispatch(logout())}
        title={tc("logout")}
        aria-label={tc("logout")}
        className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <IconLogout className="size-4" />
      </button>
    </div>
  );
}
