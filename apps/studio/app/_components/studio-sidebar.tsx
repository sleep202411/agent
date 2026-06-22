"use client";

import { Link } from "@/i18n/navigation";
import { openSettings } from "@/lib/settings-hash";
import { usePathname } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import type { ComponentType } from "react";
import {
  IconArtboard,
  IconHome,
  IconPhoto,
  IconSettings,
  IconVideo,
  IconVolume,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type SidebarIcon = ComponentType<{ className?: string; stroke?: number }>;

type RailItem = {
  label: string;
  href: string;
  icon: SidebarIcon;
  /** Coming-soon items render as a disabled, non-navigating control. */
  disabled?: boolean;
  /** When set, the item is a button that runs this instead of navigating. */
  onClick?: () => void;
};

/** Active when the path equals the target or is nested under it. */
function isRailItemActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function RailButton({
  item,
  active,
  detached = false,
}: {
  item: RailItem;
  active: boolean;
  detached?: boolean;
}) {
  const t = useTranslations("shell");
  const Icon = item.icon;
  const disabled = item.disabled ?? false;
  const tooltipLabel = disabled ? t("nav.comingSoonLabel", { label: item.label }) : item.label;

  const buttonClassName = cn(
    "group relative flex size-11 items-center justify-center rounded-2xl transition-colors",
    disabled
      ? "cursor-not-allowed text-white/25"
      : active
        ? "bg-white/[0.12] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]"
        : detached
          ? "bg-white/[0.04] text-white/55 hover:bg-white/[0.09] hover:text-white"
          : "text-white/55 hover:bg-white/[0.07] hover:text-white"
  );
  const icon = <Icon className="size-[22px]" stroke={1.8} />;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {disabled ? (
          // A real (focusable) button so keyboard/SR users still reach the
          // "Coming soon" tooltip; native `disabled` would suppress both.
          <button
            type="button"
            aria-disabled="true"
            aria-label={tooltipLabel}
            onClick={(e) => e.preventDefault()}
            className={buttonClassName}
          >
            {icon}
          </button>
        ) : item.onClick ? (
          <button
            type="button"
            onClick={item.onClick}
            aria-label={item.label}
            className={buttonClassName}
          >
            {icon}
          </button>
        ) : (
          <Link
            href={item.href}
            aria-label={item.label}
            aria-current={active ? "page" : undefined}
            className={buttonClassName}
          >
            {icon}
          </Link>
        )}
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={10}>
        {tooltipLabel}
      </TooltipContent>
    </Tooltip>
  );
}

export function StudioSidebar() {
  const t = useTranslations("shell");
  const pathname = usePathname() ?? "/";

  // Primary nav — the studio workspaces. Audio has a UI shell for review, but
  // generation is not connected yet, so keep its public entry disabled.
  const items: RailItem[] = [
    { label: t("nav.home"), href: "/", icon: IconHome },
    { label: t("nav.canvas"), href: "/canvas", icon: IconArtboard },
    // Plural to match the web app's /fizzstudio/images so that page ports 1:1.
    { label: t("nav.image"), href: "/images", icon: IconPhoto },
    { label: t("nav.video"), href: "/video", icon: IconVideo },
    { label: t("nav.audio"), href: "/audio", icon: IconVolume, disabled: true },
  ];

  const settingsItem: RailItem = {
    label: t("nav.settings"),
    href: "/settings/account",
    icon: IconSettings,
    onClick: () => openSettings("account"),
  };

  return (
    <aside
      aria-label={t("nav.studioNavigation")}
      className="fixed inset-y-0 left-6 z-50 hidden w-14 flex-col items-center justify-center gap-6 py-5 lg:flex"
    >
      {/* Primary nav — grouped pill */}
      <nav
        aria-label={t("nav.main")}
        className="flex flex-col items-center gap-1 rounded-4xl bg-white/[0.04] p-1.5"
      >
        {items.map((item) => (
          <RailButton key={item.href} item={item} active={isRailItemActive(pathname, item.href)} />
        ))}
      </nav>

      {/* Detached utility */}
      <RailButton
        item={settingsItem}
        active={isRailItemActive(pathname, settingsItem.href)}
        detached
      />
    </aside>
  );
}
