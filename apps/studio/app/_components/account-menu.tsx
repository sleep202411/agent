"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  IconBolt,
  IconCopy,
  IconInfoCircle,
  IconLogout,
  IconReceipt,
  IconSettings,
  IconUser,
  IconUserCircle,
} from "@tabler/icons-react";
import { encodeUserId } from "@repo/shared";
import { toast } from "sonner";
import { useAuth } from "./auth-provider";
import { useComputeWalletBalance } from "./credits-badge";
import { SubscriptionDialog } from "./subscription-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function PillButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-10 flex-1 items-center justify-center rounded-full bg-white/[0.06] text-sm font-medium transition-colors hover:bg-white/[0.1]"
    >
      {label}
    </button>
  );
}

export function AccountMenu() {
  const t = useTranslations("account");
  const { user, signIn, signOut } = useAuth();
  const { data: computeCredits } = useComputeWalletBalance(Boolean(user));
  const [menuOpen, setMenuOpen] = useState(false);
  const comingSoon = (label: string) => toast.info(t("comingSoon", { label }));
  const [subscriptionOpen, setSubscriptionOpen] = useState(false);
  const openSubscription = () => {
    setMenuOpen(false);
    window.requestAnimationFrame(() => setSubscriptionOpen(true));
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("upgrade") !== "1") return;
    const frame = window.requestAnimationFrame(() => setSubscriptionOpen(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  // Signed out → a Sign in button instead of the avatar menu.
  if (!user) {
    return (
      <>
        <button
          type="button"
          onClick={signIn}
          className="flex h-9 items-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          {t("signIn")}
        </button>
        <SubscriptionDialog open={subscriptionOpen} onOpenChange={setSubscriptionOpen} />
      </>
    );
  }

  const name = user?.nickName || user?.email || user?.phone || t("account");
  const contact = user?.email || user?.phone || "";
  const publicUserId = encodeUserId(user?.id);

  const copyPublicUserId = async () => {
    if (!publicUserId) return;
    try {
      await navigator.clipboard.writeText(publicUserId);
      toast.success(t("publicIdCopied"));
    } catch {
      toast.error(t("publicIdCopyFailed"));
    }
  };

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger
          aria-label={t("account")}
          className="flex size-9 items-center justify-center overflow-hidden rounded-full bg-secondary text-white/80 transition-colors outline-none hover:bg-accent hover:text-white focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=open]:bg-accent data-[state=open]:text-white"
        >
          {user?.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.avatar} alt={name} className="size-full object-cover" />
          ) : (
            <IconUser className="size-5" stroke={1.8} />
          )}
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" sideOffset={8} className="w-80 p-3">
          {/* Identity */}
          <div className="flex items-center gap-3 p-1">
            {user?.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.avatar}
                alt={name}
                className="size-10 shrink-0 rounded-full object-cover"
              />
            ) : (
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold">
                {name[0]?.toUpperCase()}
              </span>
            )}
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium">{name}</span>
              {contact ? (
                <span className="truncate text-xs text-muted-foreground">{contact}</span>
              ) : null}
              {publicUserId ? (
                <button
                  type="button"
                  onClick={copyPublicUserId}
                  className="mt-0.5 inline-flex max-w-full items-center gap-1 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  <span className="truncate">{t("publicId", { id: publicUserId })}</span>
                  <IconCopy className="size-3 shrink-0" stroke={1.8} />
                </button>
              ) : null}
            </span>
            <Link
              href="/settings"
              aria-label={t("settings")}
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-white/70 transition-colors hover:bg-white/[0.1] hover:text-white"
            >
              <IconSettings className="size-4.5" stroke={1.8} />
            </Link>
          </div>

          <button
            type="button"
            onClick={() => comingSoon(t("myProfile"))}
            className="mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-full bg-white/[0.06] text-sm font-medium transition-colors hover:bg-white/[0.1]"
          >
            <IconUserCircle className="size-4.5" stroke={1.8} />
            {t("myProfile")}
          </button>

          <DropdownMenuSeparator className="my-3" />

          {/* Credits */}
          <div className="p-1">
            <div className="flex items-center gap-2">
              <IconBolt className="size-4.5" stroke={1.8} />
              <span className="text-lg font-semibold tabular-nums">
                {computeCredits != null ? computeCredits.available.toLocaleString() : "—"}
              </span>
              <span className="text-sm text-muted-foreground">{t("availableCredits")}</span>
              <IconInfoCircle className="size-4 text-muted-foreground" stroke={1.8} />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-xl bg-white/[0.05] px-3 py-2">
                <span className="block text-muted-foreground">{t("held")}</span>
                <span className="mt-1 block font-semibold tabular-nums text-white/85">
                  {computeCredits != null ? computeCredits.held.toLocaleString() : "—"}
                </span>
              </div>
              <div className="rounded-xl bg-white/[0.05] px-3 py-2">
                <span className="block text-muted-foreground">{t("total")}</span>
                <span className="mt-1 block font-semibold tabular-nums text-white/85">
                  {computeCredits != null ? computeCredits.total.toLocaleString() : "—"}
                </span>
              </div>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <PillButton label={t("upgrade")} onClick={openSubscription} />
            <PillButton
              label={t("usageAnalytics")}
              onClick={() => comingSoon(t("usageAnalytics"))}
            />
          </div>

          <DropdownMenuSeparator className="my-3" />

          {/* Menu — no Theme row: this app is dark-only by design. */}
          <DropdownMenuItem onSelect={openSubscription} className="gap-2.5 rounded-lg p-2 text-sm">
            <IconReceipt className="size-4.5" stroke={1.8} />
            {t("billing")}
          </DropdownMenuItem>
          <DropdownMenuItem className="gap-2.5 rounded-lg p-2 text-sm">
            <Link href="/settings" className="flex flex-1 items-center gap-2.5">
              <IconSettings className="size-4.5" stroke={1.8} />
              {t("settings")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => void signOut()}
            className="gap-2.5 rounded-lg p-2 text-sm"
          >
            <IconLogout className="size-4.5" stroke={1.8} />
            {t("logout")}
          </DropdownMenuItem>

          <DropdownMenuSeparator className="my-3" />

          {/* Footer links */}
          <div className="flex items-center justify-between px-1 pb-1">
            {[
              { key: "terms", label: t("terms") },
              { key: "privacy", label: t("privacy") },
              { key: "blogs", label: t("blogs") },
            ].map(({ key, label }, i) => (
              <span key={key} className="flex flex-1 items-center justify-center">
                {i > 0 && <span className="mr-auto h-3.5 w-px bg-border" aria-hidden />}
                <button
                  type="button"
                  onClick={() => comingSoon(label)}
                  className="mx-auto text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  {label}
                </button>
              </span>
            ))}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      <SubscriptionDialog open={subscriptionOpen} onOpenChange={setSubscriptionOpen} />
    </>
  );
}
