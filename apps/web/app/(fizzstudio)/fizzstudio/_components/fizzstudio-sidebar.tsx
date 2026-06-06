"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import {
  IconApps,
  IconArrowsMaximize,
  IconAsterisk,
  IconBoxMultiple,
  IconBrandDiscord,
  IconDeviceTv,
  IconEdit,
  IconExternalLink,
  IconFileText,
  IconGridDots,
  IconHelpCircle,
  IconHome,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconMovie,
  IconPhoto,
  IconRoute,
  IconSearch,
  IconSettings,
  IconSparkles,
  IconUsers,
  IconVideo,
  IconVolume,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import type { Locale } from "@/src/i18n/config";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";

type SidebarIcon = ComponentType<{ className?: string; stroke?: number }>;

type SidebarLink = {
  badge?: "new";
  external?: boolean;
  key: string;
  href: string;
  icon: SidebarIcon;
};

type SidebarSection = {
  key: "apps" | "more" | "tools";
  items: SidebarLink[];
};

function isHrefActive(pathname: string, href: string) {
  if (href.includes("#")) return false;

  const normalized = href.split("#")[0] ?? href;
  if (normalized.endsWith("/fizzstudio")) {
    return pathname.endsWith("/fizzstudio");
  }
  return pathname.includes(normalized.replace(/^\/[a-z]{2}-[A-Z]{2}/, ""));
}

function BrandMark({ collapsed }: { collapsed: boolean }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center bg-white text-[#0f0f10]",
        collapsed ? "size-9 rounded-2xl" : "size-8 rounded-[14px]"
      )}
    >
      <IconSparkles className={collapsed ? "size-5" : "size-[18px]"} />
    </span>
  );
}

function SidebarItem({
  item,
  collapsed,
  active,
  rail,
  variant,
}: {
  item: SidebarLink;
  collapsed: boolean;
  active: boolean;
  rail: boolean;
  variant: "enterprise" | "studio";
}) {
  const t = useTranslations("fizzStudio");
  const Icon = item.icon;
  const label = t(`sidebar.items.${item.key}`);
  const enterprise = variant === "enterprise";
  const showLabel = !collapsed || rail;

  return (
    <Link
      href={item.href}
      title={label}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex items-center rounded-2xl text-white transition-colors",
        collapsed
          ? rail
            ? "h-[50px] w-12 flex-col justify-center gap-1 rounded-xl"
            : "h-9 w-10 justify-center"
          : enterprise
            ? "h-12 w-full gap-3 px-4"
            : "h-9 w-full gap-2.5 px-3",
        active
          ? enterprise
            ? "bg-[#242424] text-white"
            : "bg-[#252525] text-white"
          : "text-white/88 hover:bg-[#1f1f1f] hover:text-white"
      )}
    >
      <Icon
        className={cn("shrink-0", enterprise && !collapsed ? "size-[22px]" : "size-[18px]")}
        stroke={1.9}
      />
      {showLabel ? (
        <span
          className={cn(
            "min-w-0 truncate font-medium leading-none",
            rail ? "max-w-full text-[9px]" : enterprise ? "flex-1 text-[17px]" : "flex-1 text-sm"
          )}
        >
          {label}
        </span>
      ) : null}
      {showLabel && item.badge ? (
        <span className="ml-auto rounded-full bg-[#4a2077] px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-[#dfc2ff]">
          {t("sidebar.newBadge")}
        </span>
      ) : null}
      {showLabel && item.external ? (
        <IconExternalLink className="ml-auto size-5 text-white/82" stroke={2} />
      ) : null}
    </Link>
  );
}

function Section({
  section,
  collapsed,
  pathname,
  rail,
  variant,
}: {
  section: SidebarSection;
  collapsed: boolean;
  pathname: string;
  rail: boolean;
  variant: "enterprise" | "studio";
}) {
  const t = useTranslations("fizzStudio");
  const enterprise = variant === "enterprise";

  return (
    <section className={cn(enterprise ? "mt-7" : "mt-4", collapsed && "mt-3")}>
      {!collapsed ? (
        <h2
          className={cn(
            "font-semibold text-white/42",
            enterprise ? "mb-2 px-4 text-[15px] leading-6" : "mb-2 px-2 text-[11px] uppercase"
          )}
        >
          {t(`sidebar.groups.${section.key}`)}
        </h2>
      ) : (
        <div className="mx-auto mb-3 h-px w-7 rounded-full bg-white/12" />
      )}
      <div className="flex flex-col gap-1">
        {section.items.map((item) => (
          <SidebarItem
            key={item.key}
            item={item}
            collapsed={collapsed}
            rail={rail}
            active={isHrefActive(pathname, item.href)}
            variant={variant}
          />
        ))}
      </div>
    </section>
  );
}

function BottomShortcut({
  href,
  label,
  icon: Icon,
}: {
  href: string;
  label: string;
  icon: SidebarIcon;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className="flex size-8 items-center justify-center rounded-2xl text-white/88 transition-colors hover:bg-white/10 hover:text-white"
    >
      <Icon className="size-[18px]" stroke={1.9} />
    </Link>
  );
}

export function FizzStudioSidebar({
  collapsed,
  hideToggle = false,
  onToggleCollapsed,
  variant = "studio",
}: {
  collapsed: boolean;
  hideToggle?: boolean;
  onToggleCollapsed: () => void;
  variant?: "enterprise" | "studio";
}) {
  const locale = useLocale() as Locale;
  const t = useTranslations("fizzStudio");
  const pathname = usePathname() ?? "/";

  const homeHref = localizePath("/fizzstudio", locale);
  const aiLabHref = localizePath("/ai-lab", locale);
  const assetsHref = localizePath("/art-studio/assets", locale);
  const imageHref =
    variant === "enterprise"
      ? localizePath("/fizzstudio/images", locale)
      : localizePath("/art-studio/image", locale);
  const rail = variant === "enterprise" && collapsed;

  const primaryItems: SidebarLink[] =
    variant === "enterprise"
      ? [
          { key: "home", href: homeHref, icon: IconHome },
          { key: "assets", href: assetsHref, icon: IconBoxMultiple },
          { key: "search", href: `${homeHref}#works-show`, icon: IconSearch },
        ]
      : [
          { key: "home", href: homeHref, icon: IconHome },
          {
            key: "assets",
            href: assetsHref,
            icon: IconBoxMultiple,
          },
          { key: "search", href: `${homeHref}#works-show`, icon: IconSearch },
        ];

  const sections: SidebarSection[] =
    variant === "enterprise"
      ? [
          {
            key: "tools",
            items: [
              { key: "image", href: imageHref, icon: IconPhoto },
              { key: "video", href: aiLabHref, icon: IconVideo },
              { key: "edit", href: `${imageHref}#edit`, icon: IconEdit },
              { key: "upscale", href: `${imageHref}#upscale`, icon: IconArrowsMaximize },
              { key: "audio", href: aiLabHref, icon: IconVolume },
              {
                key: "filmStudio",
                href: `${homeHref}#film-studio`,
                icon: IconMovie,
                badge: "new",
              },
              { key: "adStudio", href: aiLabHref, icon: IconDeviceTv, badge: "new" },
              { key: "workflow", href: aiLabHref, icon: IconRoute },
            ],
          },
          {
            key: "apps",
            items: [
              { key: "allTools", href: aiLabHref, icon: IconGridDots },
              { key: "apps", href: aiLabHref, icon: IconApps },
              { key: "community", href: localizePath("/creators", locale), icon: IconUsers },
            ],
          },
          {
            key: "more",
            items: [
              {
                key: "chatly",
                href: localizePath("/messages", locale),
                icon: IconAsterisk,
                external: true,
              },
            ],
          },
        ]
      : [
          {
            key: "tools",
            items: [
              { key: "image", href: imageHref, icon: IconPhoto },
              { key: "video", href: aiLabHref, icon: IconVideo },
              { key: "audio", href: aiLabHref, icon: IconVolume },
            ],
          },
        ];

  return (
    <aside
      aria-label={t("sidebar.label")}
      className={cn(
        "fixed inset-y-0 left-0 z-50 hidden border-r border-white/[0.08] bg-[#0f0f10] text-white shadow-[20px_0_60px_rgba(0,0,0,0.34)] transition-[width] duration-300 lg:flex",
        collapsed ? "w-16" : "w-[288px]"
      )}
    >
      <div
        className={cn(
          "flex h-full w-full flex-col overflow-hidden",
          collapsed ? "items-center px-2 py-4" : "px-4 py-5"
        )}
      >
        <div className={cn("flex w-full items-center", collapsed ? "justify-center" : "gap-3")}>
          <Link
            href={homeHref}
            aria-label={t("brand")}
            className={cn("flex min-w-0 items-center", collapsed ? "justify-center" : "gap-2.5")}
          >
            <BrandMark collapsed={collapsed} />
            {!collapsed ? (
              <span
                className={cn(
                  "min-w-0 truncate font-semibold leading-none",
                  variant === "enterprise" ? "text-[26px]" : "text-[22px]"
                )}
              >
                {t("brand")}
              </span>
            ) : null}
          </Link>
          {!collapsed ? <div className="flex-1" /> : null}
          {!hideToggle ? (
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-label={collapsed ? t("sidebar.expand") : t("sidebar.collapse")}
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-2xl text-white/76 transition-colors hover:bg-white/10 hover:text-white",
                collapsed && "mt-4"
              )}
            >
              {collapsed ? (
                <IconLayoutSidebarLeftExpand className="size-[18px]" stroke={1.8} />
              ) : (
                <IconLayoutSidebarLeftCollapse className="size-[18px]" stroke={1.8} />
              )}
            </button>
          ) : null}
        </div>

        <div
          className={cn(
            "min-h-0 w-full flex-1 overflow-y-auto overflow-x-hidden pr-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            rail ? "mt-4" : "mt-8"
          )}
        >
          <nav
            className={cn("flex flex-col", rail ? "items-center gap-2" : "gap-1")}
            aria-label={t("sidebar.groups.main")}
          >
            {primaryItems.map((item) => (
              <SidebarItem
                key={item.key}
                item={item}
                collapsed={collapsed}
                rail={rail}
                active={isHrefActive(pathname, item.href)}
                variant={variant}
              />
            ))}
          </nav>
          {sections.map((section) => (
            <Section
              key={section.key}
              section={section}
              collapsed={collapsed}
              pathname={pathname}
              rail={rail}
              variant={variant}
            />
          ))}
        </div>

        <div className={cn("w-full pt-5", collapsed && "flex flex-col items-center")}>
          <Link
            href={homeHref}
            aria-label={t("sidebar.creatorHub")}
            className={cn(
              "flex items-center justify-center rounded-full bg-white text-[#0f0f10] shadow-xl shadow-black/40 transition-transform hover:scale-105",
              collapsed ? "size-12" : "size-12"
            )}
          >
            {variant === "enterprise" ? (
              <span className="text-lg font-black tracking-[-0.08em]">co</span>
            ) : (
              <IconSparkles className="size-6" />
            )}
          </Link>

          <div
            className={cn(
              "mt-5 flex text-white/88",
              collapsed ? "flex-col gap-2" : "items-center justify-between gap-3"
            )}
          >
            <BottomShortcut
              href={localizePath("/art-studio/settings", locale)}
              label={t("sidebar.items.settings")}
              icon={IconSettings}
            />
            <BottomShortcut
              href={localizePath("/creators", locale)}
              label={t("sidebar.items.discord")}
              icon={IconBrandDiscord}
            />
            <BottomShortcut href={homeHref} label={t("sidebar.items.docs")} icon={IconFileText} />
            <BottomShortcut
              href={localizePath("/messages", locale)}
              label={t("sidebar.items.help")}
              icon={IconHelpCircle}
            />
          </div>
        </div>
      </div>
    </aside>
  );
}
