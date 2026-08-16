"use client";

import type { ComponentType } from "react";
import {
  IconArrowLeft,
  IconBook2,
  IconMovie,
  IconShare3,
  IconSparkles,
  IconWorld,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StoryChapterDropdown, type StoryChapterDropdownProps } from "./story-chapter-dropdown";
import type { StoryCanvasNavigationEvent } from "./story-canvas-leave-guard";

type StoryCanvasSidebarProps = {
  agentLabel: string;
  agentOpen: boolean;
  chapterDropdown: StoryChapterDropdownProps;
  foundationOpen: boolean;
  onBackNavigate: (event: StoryCanvasNavigationEvent) => void;
  onOpenMediaCreation: () => void;
  onShare: () => void;
  onToggleAgent: () => void;
  onToggleFoundation: () => void;
};

type SidebarIcon = ComponentType<{ className?: string; stroke?: number }>;

export function StoryCanvasSidebar({
  agentLabel,
  agentOpen,
  chapterDropdown,
  foundationOpen,
  onBackNavigate,
  onOpenMediaCreation,
  onShare,
  onToggleAgent,
  onToggleFoundation,
}: StoryCanvasSidebarProps) {
  const t = useTranslations("storyStudio.canvas");

  return (
    <aside
      aria-label={t("sidebar.navigation")}
      className="relative z-50 flex h-full w-16 shrink-0 flex-col border-r border-white/10 bg-[#0A0A0A]"
    >
      <div className="flex h-16 shrink-0 items-center justify-center">
        <Link
          href="/story-studio"
          onNavigate={onBackNavigate}
          aria-label={t("back")}
          className="flex size-11 items-center justify-center rounded-lg text-white/90 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:outline-none"
        >
          <IconArrowLeft className="size-[22px]" stroke={1.6} />
        </Link>
      </div>

      <nav className="flex min-h-0 flex-1 flex-col items-center gap-2 px-1.5 py-2">
        <StoryChapterDropdown
          {...chapterDropdown}
          contentSide="right"
          contentAlign="start"
          trigger={
            <button
              type="button"
              aria-label={t("chapters.action")}
              aria-pressed={chapterDropdown.open}
              className={cn(
                "flex h-[54px] w-[52px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:outline-none",
                chapterDropdown.open
                  ? "bg-white/[0.08] text-white"
                  : "text-white/90 hover:bg-white/[0.07] hover:text-white"
              )}
            >
              <IconBook2 className="size-[19px] shrink-0" stroke={1.45} />
              <span className="max-w-[48px] truncate text-[10px] leading-4 font-medium tracking-[-0.01em]">
                {t("chapters.action")}
              </span>
            </button>
          }
        />
        <SidebarButton
          icon={IconWorld}
          label={t("filmFoundation.title")}
          visualLabel={t("sidebar.world")}
          active={foundationOpen}
          onClick={onToggleFoundation}
        />
        <SidebarButton
          icon={IconMovie}
          label={t("mediaCreation")}
          visualLabel={t("sidebar.media")}
          onClick={onOpenMediaCreation}
        />
        <SidebarButton
          icon={IconSparkles}
          label={agentLabel}
          visualLabel={t("sidebar.agent")}
          active={agentOpen}
          onClick={onToggleAgent}
        />
      </nav>

      <div className="flex shrink-0 flex-col items-center gap-1 px-3 pt-2 pb-4">
        <SidebarUtilityButton icon={IconShare3} label={t("share")} onClick={onShare} />
      </div>
    </aside>
  );
}

function SidebarButton({
  active = false,
  icon: Icon,
  label,
  visualLabel = label,
  onClick,
}: {
  active?: boolean;
  icon: SidebarIcon;
  label: string;
  visualLabel?: string;
  onClick?: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          onClick={onClick}
          className={cn(
            "flex h-[54px] w-[52px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:outline-none",
            active
              ? "bg-white/[0.08] text-white"
              : "text-white/90 hover:bg-white/[0.07] hover:text-white"
          )}
        >
          <Icon className="size-[19px] shrink-0" stroke={1.45} />
          <span className="max-w-[48px] truncate text-[10px] leading-4 font-medium tracking-[-0.01em]">
            {visualLabel}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={10}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function SidebarUtilityButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: SidebarIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          className="flex size-9 items-center justify-center rounded-lg text-white/90 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:outline-none"
        >
          <Icon className="size-[19px]" stroke={1.45} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={10}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
