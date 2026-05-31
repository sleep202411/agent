"use client";

import { useState } from "react";
import Link from "next/link";
import {
  IconCredits,
  IconCrown,
  IconCoin,
  IconSettings,
  IconLogout,
  IconRosetteDiscountCheckFilled,
} from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLogout } from "@/src/hooks/use-logout";
import { CreditsRechargeDialog } from "@/components/payment/credits-recharge-dialog";
import { UpgradeDialog } from "@/components/payment/upgrade-dialog";
import { useCredits, useCurrentUser, useUserInfo } from "@/src/hooks/use-user";
import { useCertificationRoles, useMyCertifications } from "@/src/hooks/use-certification";
import { AUTH_STATUS } from "@/src/services/certification";

export function UserMenu() {
  const tc = useTranslations("common");
  const logout = useLogout();
  const { user } = useCurrentUser();

  const [menuOpen, setMenuOpen] = useState(false);
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const { data: credits } = useCredits();
  const { data: userInfo } = useUserInfo();
  const { data: roleMap } = useCertificationRoles();
  const { data: myCertifications } = useMyCertifications();

  const displayName = user?.nickname || "User";
  const displayEmail = user?.email || "";
  const avatarUrl = user?.avatar || undefined;
  const initials = displayName.slice(0, 1).toUpperCase();
  const userLevel = user?.userLevel || "";
  const userId = userInfo?.id != null ? String(userInfo.id) : "";
  const isVerified = userInfo?.authStatus === AUTH_STATUS.APPROVED;
  const authenticatedRoles = (myCertifications ?? [])
    .filter((c) => c.authStatus === AUTH_STATUS.APPROVED)
    .map((c) => roleMap?.[String(c.authRoleId)])
    .filter((name): name is string => Boolean(name));

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
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

        <DropdownMenuContent align="end" className="w-72 p-0">
          {/* User info */}
          <div className="flex items-center gap-3 px-4 py-4">
            <Avatar className="size-12">
              <AvatarImage src={avatarUrl} alt={displayName} />
              <AvatarFallback className="text-sm">{initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="truncate text-sm font-semibold">{displayName}</p>
                {isVerified && (
                  <IconRosetteDiscountCheckFilled
                    className="size-4 shrink-0 text-primary"
                    aria-label={tc("verified")}
                  />
                )}
                {userLevel && (
                  <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                    {userLevel}
                  </span>
                )}
              </div>
              {userId && (
                <p className="truncate text-xs text-muted-foreground">
                  {tc("personalAccount")}：{userId}
                </p>
              )}
              {displayEmail && !userId && (
                <p className="truncate text-xs text-muted-foreground">{displayEmail}</p>
              )}
            </div>
            <Link
              href="/art-studio/settings"
              target="_blank"
              rel="noopener noreferrer"
              className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <IconSettings className="size-4" />
            </Link>
          </div>

          {authenticatedRoles.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-4 pb-4">
              {authenticatedRoles.map((name) => (
                <span
                  key={name}
                  className="rounded-full border border-border/70 bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground"
                >
                  {name}
                </span>
              ))}
            </div>
          )}

          <DropdownMenuSeparator />

          {/* Credits */}
          <div className="px-4 py-3">
            <div className="mb-3 flex items-center gap-2">
              <IconCredits className="size-4 text-primary" />
              <span className="text-xl font-bold">{credits?.toLocaleString() ?? "—"}</span>
              <span className="text-xs text-muted-foreground">{tc("creditsLeft")}</span>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                className="flex-1"
                onClick={() => {
                  setMenuOpen(false);
                  setUpgradeOpen(true);
                }}
              >
                <IconCrown className="size-3.5" />
                {tc("upgrade")}
              </Button>
              <Button
                variant="outline"
                color="muted"
                size="sm"
                className="flex-1"
                onClick={() => {
                  setMenuOpen(false);
                  setRechargeOpen(true);
                }}
              >
                <IconCoin className="size-3.5" />
                {tc("rechargeCredits")}
              </Button>
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

      <CreditsRechargeDialog open={rechargeOpen} onOpenChange={setRechargeOpen} />
      <UpgradeDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} />
    </>
  );
}
