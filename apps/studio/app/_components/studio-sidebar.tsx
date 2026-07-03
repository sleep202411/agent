"use client";

import { Link } from "@/i18n/navigation";
import { openSettings } from "@/lib/settings-hash";
import { usePathname } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import type { ComponentType } from "react";
import {
  IconBook2,
  IconLayoutGrid,
  IconHome,
  IconPhoto,
  IconSettings,
  IconVideo,
  IconVolume,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { GlassRim } from "@/components/ui/glass-rim";
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
        ? // Active = a brighter liquid-glass puck: frosted fill, top rim-light +
          // bottom shade for depth, soft drop shadow. The GlassRim below catches
          // the specular edge.
          "bg-white/[0.14] text-white backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.3),inset_0_-1px_1px_rgba(0,0,0,0.28),0_4px_16px_-4px_rgba(0,0,0,0.55)]"
        : detached
          ? "text-white/60 hover:bg-white/[0.1] hover:text-white"
          : "text-white/55 hover:bg-white/[0.08] hover:text-white"
  );
  const icon = (
    <>
      {active && !disabled ? <GlassRim className="opacity-80" /> : null}
      <Icon className="relative size-[22px]" stroke={1.8} />
    </>
  );

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
    { label: t("nav.creativeStudio"), href: "/projects", icon: IconLayoutGrid },
    // Story Studio has no route yet — keep the entry disabled (coming soon).
    { label: t("nav.storyStudio"), href: "/story", icon: IconBook2, disabled: true },
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
      {/* Primary nav — flowing liquid-glass pill: frosted body (blur+saturate
          refracts the backdrop), the static GlassRim edge, and a slow specular
          highlight drifting around the rim (`liquid-rim`). */}
      <nav
        aria-label={t("nav.main")}
        className="liquid-rim relative flex flex-col items-center gap-1 rounded-4xl bg-white/[0.05] p-1.5 backdrop-blur-2xl backdrop-saturate-[1.8] shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_16px_48px_-14px_rgba(0,0,0,0.6)]"
      >
        <GlassRim />
        {items.map((item) => (
          <RailButton key={item.href} item={item} active={isRailItemActive(pathname, item.href)} />
        ))}
      </nav>

      {/* Detached utility — its own liquid-glass puck */}
      <div className="liquid-rim relative rounded-full bg-white/[0.05] p-1.5 backdrop-blur-2xl backdrop-saturate-[1.8] shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_12px_36px_-12px_rgba(0,0,0,0.55)]">
        <GlassRim />
        <RailButton
          item={settingsItem}
          active={isRailItemActive(pathname, settingsItem.href)}
          detached
        />
      </div>
    </aside>
  );
}
