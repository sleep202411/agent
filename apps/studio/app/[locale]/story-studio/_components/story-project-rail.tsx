"use client";

import type { ComponentType } from "react";
import { IconBook2, IconListTree, IconMovie, IconShare3, IconWorld } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { useSelectedLayoutSegment } from "next/navigation";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { MATERIAL_CANVAS_ENABLED } from "../_lib/feature-flags";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";

type RailIcon = ComponentType<{ className?: string; stroke?: number }>;

const RAIL_SEGMENTS = new Set(["canvas", "script", "assets", "storyboard"]);

/**
 * Project rail rendered by the [projectId] layout — the one navigation column
 * for every production step, canvas included. Every destination remains
 * operable from every step: canvas-owned surfaces navigate to the canvas and
 * open there instead of degrading into disabled placeholders.
 */
export function StoryProjectRail({ projectId }: { projectId: string }) {
  const segment = useSelectedLayoutSegment();
  const onCanvas = segment === "canvas";
  const t = useTranslations("storyStudio.canvas");
  const router = useRouter();
  const sidePanel = useStoryProjectUiStore((state) => state.sidePanel);
  const setSidePanel = useStoryProjectUiStore((state) => state.setSidePanel);
  const setShareOpen = useStoryProjectUiStore((state) => state.setShareOpen);
  const shareOpen = useStoryProjectUiStore((state) => state.shareOpen);
  const chapterMenuOpen = useStoryProjectUiStore((state) => state.chapterMenuOpen);
  const activeChapterId = useStoryProjectUiStore((state) => state.activeChapterId);
  const setChapterMenuOpen = useStoryProjectUiStore((state) => state.setChapterMenuOpen);
  const setChapterRailSlot = useStoryProjectUiStore((state) => state.setChapterRailSlot);

  if (!RAIL_SEGMENTS.has(segment ?? "")) return null;

  const chapterQuery = activeChapterId ? `?chapter=${encodeURIComponent(activeChapterId)}` : "";
  const canvasHref = `/story-studio/projects/${projectId}/canvas${chapterQuery}`;
  const openCanvas = () => {
    if (!onCanvas) router.push(canvasHref);
  };
  const openOverview = () => {
    setChapterMenuOpen(false);
    setShareOpen(false);
    setSidePanel("world");
    openCanvas();
  };
  const openCatalog = () => {
    setChapterMenuOpen(false);
    setShareOpen(false);
    setSidePanel("catalog");
  };
  const openChapters = () => {
    setSidePanel(null);
    setShareOpen(false);
    setChapterMenuOpen(true);
    openCanvas();
  };
  const openShare = () => {
    setSidePanel(null);
    setChapterMenuOpen(false);
    setShareOpen(true);
    openCanvas();
  };

  return (
    <aside
      aria-label={t("sidebar.navigation")}
      className="relative z-50 flex h-full w-16 shrink-0 flex-col border-r border-white/10 bg-[#0A0A0A] max-md:hidden"
    >
      <nav className="flex min-h-0 flex-1 flex-col items-center gap-2 px-1.5 py-3">
        <RailButton
          icon={IconWorld}
          label={t("sidebar.world")}
          active={sidePanel === "world"}
          onClick={openOverview}
        />
        <RailButton
          icon={IconListTree}
          label={t("sidebar.catalog")}
          active={sidePanel === "catalog"}
          onClick={openCatalog}
        />
        {onCanvas ? (
          <div
            ref={setChapterRailSlot}
            className="flex h-[54px] w-[52px] shrink-0 items-center justify-center"
          />
        ) : (
          <RailButton
            icon={IconBook2}
            label={t("chapters.action")}
            active={chapterMenuOpen}
            onClick={openChapters}
          />
        )}
        {/* Material canvas — the free creative canvas scoped to this project. */}
        {MATERIAL_CANVAS_ENABLED && (
          <RailLink
            href={`/story-studio/projects/${projectId}/workbench/canvas${chapterQuery}`}
            icon={IconMovie}
            label={t("sidebar.media")}
          />
        )}
        <div className="flex-1" />
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
