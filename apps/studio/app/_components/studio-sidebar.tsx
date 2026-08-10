"use client";

import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import type { ComponentType } from "react";
import {
  IconBrandDiscord,
  IconDeviceGamepad2,
  IconDeviceDesktopDown,
  IconDeviceMobileDown,
  IconHelpCircle,
  IconHome,
  IconLayoutGrid,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconPhoto,
  IconSettings,
  IconVideo,
  IconVolume,
  IconWriting,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { Link, usePathname } from "@/i18n/navigation";
import { getWebBaseUrl } from "@/lib/web-base";
import { openSettings } from "@/lib/settings-hash";
import { cn } from "@/lib/utils";
import { useSiteRegion } from "@/app/_components/region-provider";
import { GlassRim } from "@/components/ui/glass-rim";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useStudioSidebar } from "./studio-sidebar-context";

type SidebarIcon = ComponentType<{ className?: string; stroke?: number }>;

type SidebarItem = {
  label: string;
  href: string;
  icon: SidebarIcon;
  badge?: string;
  disabled?: boolean;
  onClick?: () => void;
};

function isSidebarItemActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function SidebarButton({
  item,
  active,
  collapsed,
  onNavigate,
}: {
  item: SidebarItem;
  active: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const t = useTranslations("shell");
  const Icon = item.icon;
  const disabled = item.disabled ?? false;
  const accessibleLabel = disabled ? t("nav.comingSoonLabel", { label: item.label }) : item.label;
  const className = cn(
    "group relative flex h-10 items-center rounded-xl text-left text-[13px] font-medium transition-colors",
    collapsed ? "w-10 justify-center" : "w-full gap-[6px] px-3",
    disabled
      ? "cursor-not-allowed text-white/25"
      : active
        ? "bg-white/[0.11] text-white"
        : "text-white hover:bg-white/[0.07]"
  );
  const contents = (
    <>
      {active && !disabled ? <GlassRim className="opacity-70" /> : null}
      <Icon className="relative size-[19px] shrink-0" stroke={1.8} />
      {collapsed ? null : (
        <>
          <span className="relative min-w-0 flex-1 truncate">{item.label}</span>
          {item.badge ? (
            <span className="absolute -top-1 right-1 rounded-md bg-primary px-1 py-0.5 text-[8px] leading-none font-semibold tracking-[0.04em] text-primary-foreground uppercase">
              {item.badge}
            </span>
          ) : null}
        </>
      )}
    </>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {disabled ? (
          <button
            type="button"
            aria-disabled="true"
            aria-label={accessibleLabel}
            onClick={(event) => event.preventDefault()}
            className={className}
          >
            {contents}
          </button>
        ) : item.onClick ? (
          <button
            type="button"
            onClick={() => {
              item.onClick?.();
              onNavigate?.();
            }}
            aria-label={collapsed ? item.label : undefined}
            className={className}
          >
            {contents}
          </button>
        ) : (
          <Link
            href={item.href}
            onClick={onNavigate}
            aria-label={collapsed ? item.label : undefined}
            aria-current={active ? "page" : undefined}
            className={className}
          >
            {contents}
          </Link>
        )}
      </TooltipTrigger>
      {collapsed || disabled ? (
        <TooltipContent side="right" sideOffset={12}>
          {accessibleLabel}
        </TooltipContent>
      ) : null}
    </Tooltip>
  );
}

function SidebarSection({
  label,
  items,
  pathname,
  collapsed,
  onNavigate,
}: {
  label?: string;
  items: SidebarItem[];
  pathname: string;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  return (
    <div className="space-y-1">
      {label && !collapsed ? (
        <p className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-[0.08em] text-white uppercase">
          {label}
        </p>
      ) : null}
      {label && collapsed ? <div className="mx-auto my-2 h-px w-8 bg-white/[0.08]" /> : null}
      {items.map((item) => (
        <SidebarButton
          key={item.href}
          item={item}
          active={isSidebarItemActive(pathname, item.href)}
          collapsed={collapsed}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  );
}

type SidebarUtilityItem = {
  label: string;
  icon: SidebarIcon;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
};

function SidebarUtilityButton({ item }: { item: SidebarUtilityItem }) {
  const t = useTranslations("shell");
  const Icon = item.icon;
  const accessibleLabel = item.disabled
    ? t("nav.comingSoonLabel", { label: item.label })
    : item.label;
  const className = cn(
    "relative flex size-9 items-center justify-center rounded-xl transition-colors",
    item.disabled
      ? "cursor-not-allowed text-white/30"
      : item.active
        ? "bg-white/[0.11] text-white"
        : "text-white/60 hover:bg-white/[0.07] hover:text-white"
  );
  const contents = <Icon className="size-[18px]" stroke={1.8} />;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {item.disabled ? (
          <button
            type="button"
            aria-disabled="true"
            aria-label={accessibleLabel}
            onClick={(event) => event.preventDefault()}
            className={className}
          >
            {contents}
          </button>
        ) : item.href ? (
          <a
            href={item.href}
            target="_blank"
            rel="noreferrer"
            aria-label={item.label}
            className={className}
          >
            {contents}
          </a>
        ) : (
          <button
            type="button"
            onClick={item.onClick}
            aria-label={item.label}
            className={className}
          >
            {contents}
          </button>
        )}
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={10}>
        {accessibleLabel}
      </TooltipContent>
    </Tooltip>
  );
}

export function StudioSidebar() {
  const t = useTranslations("shell");
  const tc = useTranslations("common");
  const locale = useLocale();
  const pathname = usePathname() ?? "/";
  const siteRegion = useSiteRegion();
  const webBaseUrl = getWebBaseUrl(siteRegion);
  const { collapsed, width, narrowSidebarOpen, expandSidebar, collapseSidebar } =
    useStudioSidebar();

  const primaryItems: SidebarItem[] = [
    { label: t("nav.home"), href: "/", icon: IconHome },
    { label: t("nav.creativeStudio"), href: "/projects", icon: IconLayoutGrid },
    {
      label: t("nav.storyStudio"),
      href: "/story-studio",
      icon: IconDeviceGamepad2,
      badge: t("nav.newBadge"),
    },
    {
      label: t("nav.textAdventures"),
      href: "/text-adventures",
      icon: IconWriting,
      badge: t("nav.newBadge"),
    },
  ];
  const toolItems: SidebarItem[] = [
    { label: t("nav.image"), href: "/images", icon: IconPhoto },
    { label: t("nav.video"), href: "/video", icon: IconVideo },
    { label: t("nav.audio"), href: "/audio", icon: IconVolume, disabled: true },
  ];
  const settingsItem: SidebarItem = {
    label: t("nav.settings"),
    href: "/settings/account",
    icon: IconSettings,
    onClick: () => openSettings("account"),
  };

  const downloadMobileApp = async () => {
    const platform = /iPad|iPhone|iPod/.test(window.navigator.userAgent) ? "ios" : "android";
    try {
      const response = await fetch(`/aurora/app-releases/latest?platform=${platform}`);
      const payload = (await response.json()) as {
        code?: number;
        message?: string;
        data?: { release?: { downloadUrl?: string } | null };
      };
      if (!response.ok || payload.code !== 200) {
        throw new Error(payload.message || `${response.status} ${response.statusText}`);
      }
      const downloadUrl = payload.data?.release?.downloadUrl;
      if (!downloadUrl) {
        toast.info(t("nav.appDownloadUnavailable"));
        return;
      }
      window.location.assign(downloadUrl);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("nav.appDownloadUnavailable"));
    }
  };

  const utilityItems: SidebarUtilityItem[] = [
    {
      label: t("nav.settings"),
      icon: IconSettings,
      active: isSidebarItemActive(pathname, settingsItem.href),
      onClick: () => openSettings("account"),
    },
    {
      label: t("nav.discord"),
      icon: IconBrandDiscord,
      disabled: true,
    },
    {
      label: t("nav.downloadApp"),
      icon: IconDeviceMobileDown,
      onClick: () => void downloadMobileApp(),
    },
    {
      label: t("nav.downloadDesktop"),
      icon: IconDeviceDesktopDown,
      disabled: true,
    },
    {
      label: t("nav.help"),
      icon: IconHelpCircle,
      disabled: true,
    },
  ];

  return (
    <>
      {narrowSidebarOpen ? (
        <button
          type="button"
          aria-label={t("nav.collapseSidebar")}
          onClick={collapseSidebar}
          className="fixed inset-y-0 right-0 z-[45] bg-black/45 backdrop-blur-[1px]"
          style={{ left: width }}
        />
      ) : null}

      <aside
        aria-label={t("nav.studioNavigation")}
        className="fixed inset-y-0 left-0 z-50 flex flex-col border-r border-white/[0.08] bg-[#0f0f0f] transition-[width] duration-200 ease-out"
        style={{ width }}
      >
        <div
          className={cn("flex h-16 shrink-0 items-center", collapsed ? "justify-center" : "px-4")}
        >
          {collapsed ? (
            <button
              type="button"
              aria-label={t("nav.expandSidebar")}
              onClick={expandSidebar}
              className="flex size-10 items-center justify-center rounded-xl bg-white/[0.06] text-white/60 transition-colors hover:bg-white/[0.11] hover:text-white focus-visible:ring-2 focus-visible:ring-white/35"
            >
              <IconLayoutSidebarLeftExpand className="size-5" stroke={1.8} />
            </button>
          ) : (
            <>
              <a
                href={`${webBaseUrl}/${locale}`}
                aria-label={t("header.fizzDragonHomeAriaLabel")}
                className="flex min-w-0 flex-1 items-center"
              >
                <Image
                  src="/logo.png"
                  alt={tc("fizzDragon")}
                  width={439}
                  height={78}
                  priority
                  className="h-6 w-auto"
                />
              </a>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={t("nav.collapseSidebar")}
                    onClick={collapseSidebar}
                    className="flex size-8 shrink-0 items-center justify-center rounded-xl text-white/45 transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:ring-2 focus-visible:ring-white/35"
                  >
                    <IconLayoutSidebarLeftCollapse className="size-[18px]" stroke={1.8} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={10}>
                  {t("nav.collapseSidebar")}
                </TooltipContent>
              </Tooltip>
            </>
          )}
        </div>

        <nav
          aria-label={t("nav.main")}
          className={cn("min-h-0 flex-1 overflow-y-auto", collapsed ? "px-4" : "px-3")}
        >
          <SidebarSection
            items={primaryItems}
            pathname={pathname}
            collapsed={collapsed}
            onNavigate={narrowSidebarOpen ? collapseSidebar : undefined}
          />
          <div className="mt-3">
            <SidebarSection
              label={t("nav.tools")}
              items={toolItems}
              pathname={pathname}
              collapsed={collapsed}
              onNavigate={narrowSidebarOpen ? collapseSidebar : undefined}
            />
          </div>
        </nav>

        <div className={cn("shrink-0 pt-3 pb-4", collapsed ? "px-4" : "px-3")}>
          <div
            className={cn(
              collapsed ? "flex flex-col items-center gap-1" : "grid grid-cols-5 gap-1"
            )}
          >
            {utilityItems.map((item) => (
              <SidebarUtilityButton key={item.label} item={item} />
            ))}
          </div>
        </div>
      </aside>
    </>
  );
}
