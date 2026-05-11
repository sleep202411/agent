"use client";

import Link from "next/link";
import { IconLogout } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { UserAvatar } from "@/components/user-avatar";
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
import { useCurrentUser } from "@/src/hooks/use-user";
import { useLogout } from "@/src/hooks/use-logout";

/**
 * Compact user widget for the public-site GlobalNav. Unlike the rich
 * `<UserMenu>` used inside /studio (which surfaces credits, upgrade,
 * theme, etc.), the site nav only needs:
 *   - Avatar → routes directly to /profile
 *   - Logout button next to it (with confirm dialog)
 */
export function SiteUserMenu() {
  const tc = useTranslations("common");
  const logout = useLogout();
  const { user } = useCurrentUser();
  if (!user) return null;

  const displayName = user.nickname || "User";
  const avatarUrl = user.avatar;

  return (
    <div className="flex items-center gap-2">
      <Link
        href="/profile"
        aria-label={displayName}
        className="rounded-full outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <UserAvatar src={avatarUrl} seed={user.id} name={displayName} className="size-8" />
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
            <AlertDialogAction onClick={() => void logout()}>{tc("logout")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
