"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import {
  IconArtboard,
  IconFolders,
  IconHome,
  IconPhoto,
  IconSettings,
  IconVideo,
  IconVolume,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Locale } from "@/src/i18n/config";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";

export const FIZZSTUDIO_RAIL_WIDTH = 72;

type SidebarIcon = ComponentType<{ className?: string; stroke?: number }>;

type RailItem = {
  key: string;
  href: string;
  icon: SidebarIcon;
  /** Coming-soon items render as a disabled, non-navigating control. */
  disabled?: boolean;
};

/** Active when the path equals the target or is nested under it (locale-prefix agnostic). */
function isRailItemActive(pathname: string, href: string): boolean {
  const stripLocale = (value: string) => value.replace(/^\/[a-z]{2}-[A-Z]{2}/, "") || "/";
  const target = stripLocale(href.split("#")[0] ?? href);
  const path = stripLocale(pathname);
  if (target === "/fizzstudio") {
    return path === "/fizzstudio";
  }
  return path === target || path.startsWith(`${target}/`);
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
  const t = useTranslations("fizzStudio");
  const Icon = item.icon;
  const label = t(`sidebar.items.${item.key}`);
  const disabled = item.disabled ?? false;
  const tooltipLabel = disabled ? `${label} · ${t("sidebar.comingSoon")}` : label;

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
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        {disabled ? (
          <span aria-disabled="true" aria-label={tooltipLabel} className={buttonClassName}>
            {icon}
          </span>
        ) : (
          <Link
            href={item.href}
            aria-label={label}
            aria-current={active ? "page" : undefined}
            className={buttonClassName}
          >
            {icon}
          </Link>
        )}
      </TooltipTrigger>
      <TooltipContent
        side="right"
        sideOffset={10}
        className="border border-white/10 bg-neutral-900 text-neutral-50 shadow-xl [&_svg]:bg-neutral-900 [&_svg]:fill-neutral-900"
      >
        {tooltipLabel}
      </TooltipContent>
    </Tooltip>
  );
}

export function FizzStudioSidebar({ variant = "studio" }: { variant?: "enterprise" | "studio" }) {
  const locale = useLocale() as Locale;
  const t = useTranslations("fizzStudio");
  const pathname = usePathname() ?? "/";

  const homeHref = localizePath("/fizzstudio", locale);

  // Audio routes to the complete standalone Studio composer and history.
  // Canvas remains unavailable in this legacy shell.
  const items: RailItem[] = [
    { key: "home", href: homeHref, icon: IconHome },
    { key: "projects", href: localizePath("/fizzstudio/projects", locale), icon: IconFolders },
    {
      key: "canvas",
      href: localizePath("/fizzstudio/canvas", locale),
      icon: IconArtboard,
      disabled: true,
    },
    { key: "image", href: localizePath("/fizzstudio/images", locale), icon: IconPhoto },
    { key: "video", href: localizePath("/fizzstudio/video", locale), icon: IconVideo },
    {
      key: "audio",
      href: localizePath("/fizzstudio/audio", locale),
      icon: IconVolume,
    },
  ];

  const settingsItem: RailItem = {
    key: "settings",
    href: localizePath("/art-studio/settings", locale),
    icon: IconSettings,
  };

  return (
    <aside
      aria-label={t("sidebar.label")}
      className="fixed inset-y-0 left-0 z-50 hidden w-[72px] flex-col items-center justify-center gap-6 border-white/[0.06] py-5 lg:flex"
    >
      {/* Primary nav — grouped pill */}
      <nav
        aria-label={t("sidebar.groups.main")}
        className="flex flex-col items-center gap-1 rounded-[26px] bg-white/[0.03] p-1.5 ring-1 ring-white/[0.06]"
      >
        {items.map((item) => (
          <RailButton key={item.key} item={item} active={isRailItemActive(pathname, item.href)} />
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
