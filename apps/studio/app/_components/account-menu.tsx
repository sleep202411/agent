"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { openSettings } from "@/lib/settings-hash";
import {
  IconBolt,
  IconCopy,
  IconInfoCircle,
  IconLanguage,
  IconLogout,
  IconReceipt,
  IconSettings,
  IconUser,
  IconUserCircle,
} from "@tabler/icons-react";
import { APP_DOWNLOADS_BY_SITE, encodeUserId } from "@repo/shared";
import { toast } from "sonner";
import { useAuth } from "./auth-provider";
import { formatEntitlementPlanName, useMyEntitlement } from "./entitlement-context";
import { useComputeWalletBalance } from "./credits-badge";
import { SubscriptionDialog } from "./subscription-dialog";
import { cn } from "@/lib/utils";
import { buildWebHref, getWebBaseUrl, WEB_PATHS } from "@/lib/web-base";
import { useSiteRegion } from "@/app/_components/region-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GlassRim } from "@/components/ui/glass-rim";
import { LocaleMenuItems } from "./locale-switcher";

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

export function AccountMenu({
  triggerClassName,
  fallback = "icon",
}: {
  triggerClassName?: string;
  fallback?: "icon" | "initial";
} = {}) {
  const t = useTranslations("account");
  const tLocale = useTranslations("localeSwitcher");
  const locale = useLocale();
  const siteRegion = useSiteRegion();
  const { user, loading, signIn, signOut } = useAuth();
  const entitlement = useMyEntitlement();
  const { data: computeCredits } = useComputeWalletBalance(Boolean(user));
  const [menuOpen, setMenuOpen] = useState(false);
  const [subscriptionOpen, setSubscriptionOpen] = useState(false);
  const openSubscription = () => {
    setMenuOpen(false);
    window.requestAnimationFrame(() => setSubscriptionOpen(true));
  };
  const openUsageAnalytics = () => {
    setMenuOpen(false);
    openSettings("analytics");
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("upgrade") !== "1") return;
    const frame = window.requestAnimationFrame(() => setSubscriptionOpen(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  if (loading) {
    return <div className="size-9 animate-pulse rounded-full bg-white/[0.06]" />;
  }

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
  const planKey = entitlement.data?.entitlement.planKey ?? null;
  const planActionLabel = entitlement.isLoading
    ? t("planLoading")
    : entitlement.isError || !planKey
      ? t("billing")
      : planKey === "free"
        ? t("upgrade")
        : t("currentPlan", { plan: formatEntitlementPlanName(planKey) });

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
          className={cn(
            "relative flex size-9 shrink-0 aspect-square items-center justify-center overflow-hidden rounded-full bg-secondary text-white/80 transition-colors outline-none hover:bg-accent hover:text-white focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=open]:bg-accent data-[state=open]:text-white",
            triggerClassName
          )}
        >
          {user?.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.avatar} alt={name} className="size-full object-cover" />
          ) : fallback === "initial" ? (
            <span className="text-[18px] font-semibold leading-none">{name[0]?.toUpperCase()}</span>
          ) : (
            <IconUser className="size-5" stroke={1.8} />
          )}
          <GlassRim />
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
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                openSettings("account");
              }}
              aria-label={t("settings")}
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-white/70 transition-colors hover:bg-white/[0.1] hover:text-white"
            >
              <IconSettings className="size-4.5" stroke={1.8} />
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              if (!publicUserId) return;
              // The public profile lives in apps/web; the domain follows the deployment.
              const base = getWebBaseUrl(siteRegion);
              window.open(
                `${base}/${locale}/creators/${publicUserId}`,
                "_blank",
                "noopener,noreferrer"
              );
            }}
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
            <PillButton label={planActionLabel} onClick={openSubscription} />
            <PillButton label={t("usageAnalytics")} onClick={openUsageAnalytics} />
          </div>

          <DropdownMenuSeparator className="my-3" />

          {/* Menu — no Theme row: this app is dark-only by design. */}
          <DropdownMenuItem onSelect={openSubscription} className="gap-2.5 rounded-lg p-2 text-sm">
            <IconReceipt className="size-4.5" stroke={1.8} />
            {t("billing")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => openSettings("account")}
            className="gap-2.5 rounded-lg p-2 text-sm"
          >
            <IconSettings className="size-4.5" stroke={1.8} />
            {t("settings")}
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="gap-2.5 rounded-lg p-2 text-sm">
              <IconLanguage className="size-4.5" stroke={1.8} />
              {tLocale("label")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-40 p-1.5">
              <LocaleMenuItems />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem
            onSelect={() => void signOut()}
            className="gap-2.5 rounded-lg p-2 text-sm"
          >
            <IconLogout className="size-4.5" stroke={1.8} />
            {t("logout")}
          </DropdownMenuItem>

          <DropdownMenuSeparator className="my-3" />

          {/* Footer links — terms/privacy go to the main site; App is coming soon. */}
          <div className="flex items-center justify-between px-1 pb-1">
            {[
              {
                key: "terms",
                label: t("terms"),
                href: buildWebHref(siteRegion, locale, WEB_PATHS.terms),
              },
              {
                key: "privacy",
                label: t("privacy"),
                href: buildWebHref(siteRegion, locale, WEB_PATHS.privacy),
              },
              { key: "app", label: t("app"), href: null },
            ].map(({ key, label, href }, i) => (
              <span key={key} className="flex flex-1 items-center justify-center">
                {i > 0 && <span className="mr-auto h-3.5 w-px bg-border" aria-hidden />}
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mx-auto text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {label}
                  </a>
                ) : (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger className="mx-auto gap-1 text-xs font-medium text-muted-foreground">
                      {label}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {APP_DOWNLOADS_BY_SITE[siteRegion].map((download) => (
                        <DropdownMenuItem key={download.platform} asChild>
                          <a
                            href={download.href}
                            download={download.download}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {t(download.labelKey)}
                          </a>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                )}
              </span>
            ))}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      <SubscriptionDialog open={subscriptionOpen} onOpenChange={setSubscriptionOpen} />
    </>
  );
}
