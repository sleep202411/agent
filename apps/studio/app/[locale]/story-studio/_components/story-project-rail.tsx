"use client";

import { useTransition, type ComponentType } from "react";
import {
  IconBook2,
  IconClipboardList,
  IconLanguage,
  IconListTree,
  IconMovie,
  IconShare3,
} from "@tabler/icons-react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams, useSelectedLayoutSegment } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LOCALE_OPTIONS, isValidLocale } from "@/i18n/config";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { isProductionStepSegment } from "../_lib/production-steps";
import { MATERIAL_CANVAS_ENABLED } from "../_lib/feature-flags";
import { useStoryProjectUiStore, type StorySidePanel } from "../_stores/story-project-ui-store";

type RailIcon = ComponentType<{ className?: string; stroke?: number }>;

/**
 * Project rail rendered by the [projectId] layout — the one navigation column
 * for every production step, canvas included. Every rail item toggles its
 * surface in place on the current step: the panels are layout-dock tenants
 * and the share dialog mounts here, so nothing ever switches the step page.
 */
export function StoryProjectRail({ projectId }: { projectId: string }) {
  const segment = useSelectedLayoutSegment();
  const t = useTranslations("storyStudio.canvas");
  const tLocale = useTranslations("localeSwitcher");
  const locale = useLocale();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [, startLocaleTransition] = useTransition();
  const sidePanel = useStoryProjectUiStore((state) => state.sidePanel);
  const setSidePanel = useStoryProjectUiStore((state) => state.setSidePanel);
  const setShareOpen = useStoryProjectUiStore((state) => state.setShareOpen);
  const shareOpen = useStoryProjectUiStore((state) => state.shareOpen);
  const activeChapterId = useStoryProjectUiStore((state) => state.activeChapterId);

  if (!isProductionStepSegment(segment)) return null;

  const chapterQuery = activeChapterId ? `?chapter=${encodeURIComponent(activeChapterId)}` : "";
  const togglePanel = (panel: Exclude<StorySidePanel, null>) => {
    setShareOpen(false);
    setSidePanel(sidePanel === panel ? null : panel);
  };
  const openShare = () => {
    setSidePanel(null);
    setShareOpen(!shareOpen);
  };
  const selectLocale = (next: string) => {
    if (!isValidLocale(next) || next === locale) return;
    const query = searchParams.toString();
    const href = query ? `${pathname}?${query}` : pathname;
    startLocaleTransition(() => router.replace(href, { locale: next }));
  };

  return (
    <aside
      aria-label={t("sidebar.navigation")}
      className="relative z-50 flex h-full w-16 shrink-0 flex-col border-r border-white/10 bg-[#0A0A0A] max-md:hidden"
    >
      <nav className="flex min-h-0 flex-1 flex-col items-center gap-2 px-1.5 py-3">
        <RailButton
          icon={IconClipboardList}
          label={t("sidebar.world")}
          active={sidePanel === "world"}
          onClick={() => togglePanel("world")}
        />
        <RailButton
          icon={IconListTree}
          label={t("sidebar.catalog")}
          active={sidePanel === "catalog"}
          onClick={() => togglePanel("catalog")}
        />
        <RailButton
          icon={IconBook2}
          label={t("chapters.action")}
          active={sidePanel === "chapters"}
          onClick={() => togglePanel("chapters")}
        />
        {/* Material canvas — the free creative canvas scoped to this project. */}
        {MATERIAL_CANVAS_ENABLED && (
          <RailLink
            href={`/story-studio/projects/${projectId}/workbench/canvas${chapterQuery}`}
            icon={IconMovie}
            label={t("sidebar.media")}
          />
        )}
        <div className="flex-1" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={tLocale("label")}
              className={storyProjectRailItemClass()}
            >
              <StoryProjectRailItemContent icon={IconLanguage} label={tLocale("label")} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="end" sideOffset={8} className="min-w-40 p-1.5">
            <DropdownMenuRadioGroup value={locale} onValueChange={selectLocale}>
              {LOCALE_OPTIONS.map((option) => (
                <DropdownMenuRadioItem
                  key={option.value}
                  value={option.value}
                  className="rounded-lg text-sm"
                >
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <RailButton icon={IconShare3} label={t("share")} active={shareOpen} onClick={openShare} />
      </nav>
    </aside>
  );
}

export function storyProjectRailItemClass(active = false) {
  return cn(
    "flex h-[54px] w-[52px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:outline-none",
    active ? "bg-white/[0.08] text-white" : "text-white/90 hover:bg-white/[0.07] hover:text-white"
  );
}

export function StoryProjectRailItemContent({
  icon: Icon,
  label,
}: {
  icon: RailIcon;
  label: string;
}) {
  return (
    <>
      <Icon className="size-[19px] shrink-0" stroke={1.45} />
      <span className="max-w-[48px] truncate text-[10px] leading-4 font-medium tracking-[-0.01em]">
        {label}
      </span>
    </>
  );
}

function RailLink({ href, icon, label }: { href: string; icon: RailIcon; label: string }) {
  return (
    <Link href={href} className={storyProjectRailItemClass()}>
      <StoryProjectRailItemContent icon={icon} label={label} />
    </Link>
  );
}

function RailButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: RailIcon;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={storyProjectRailItemClass(active)}
    >
      <StoryProjectRailItemContent icon={icon} label={label} />
    </button>
  );
}
