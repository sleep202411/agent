"use client";

import type { ComponentType } from "react";
import {
  IconArrowLeft,
  IconBook2,
  IconListTree,
  IconMovie,
  IconShare3,
  IconWorld,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { useSelectedLayoutSegment } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import {
  CLOSED_STORY_CANVAS_INSPECTOR,
  STORY_FOUNDATION_INSPECTOR,
} from "./project-canvas/story-canvas-inspector-target";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";

type RailIcon = ComponentType<{ className?: string; stroke?: number }>;

const RAIL_SEGMENTS = new Set(["canvas", "script", "assets", "storyboard"]);

/**
 * Project rail rendered by the [projectId] layout — the one navigation column
 * for every production step, canvas included. World/Share act on canvas-owned
 * surfaces (inspector, share dialog) through the shared store, so they are
 * only live on the canvas segment. The playtest stays chrome-free.
 */
export function StoryProjectRail({ projectId }: { projectId: string }) {
  const segment = useSelectedLayoutSegment();
  const onCanvas = segment === "canvas";
  const t = useTranslations("storyStudio.canvas");
  const catalogOpen = useStoryProjectUiStore((state) => state.catalogOpen);
  const toggleCatalog = useStoryProjectUiStore((state) => state.toggleCatalog);
  const foundationOpen = useStoryProjectUiStore(
    (state) => state.inspectorTarget.kind === "foundation"
  );
  const setInspectorTarget = useStoryProjectUiStore((state) => state.setInspectorTarget);
  const setShareOpen = useStoryProjectUiStore((state) => state.setShareOpen);
  const backGuard = useStoryProjectUiStore((state) => state.backGuard);

  if (!RAIL_SEGMENTS.has(segment ?? "")) return null;

  return (
    <aside
      aria-label={t("sidebar.navigation")}
      className="relative z-50 flex h-full w-16 shrink-0 flex-col border-r border-white/10 bg-[#0A0A0A] max-md:hidden"
    >
      <div className="flex h-16 shrink-0 items-center justify-center">
        <Link
          href="/story-studio"
          onNavigate={backGuard ?? undefined}
          aria-label={t("back")}
          className="flex size-11 items-center justify-center rounded-lg text-white/90 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:outline-none"
        >
          <IconArrowLeft className="size-[22px]" stroke={1.6} />
        </Link>
      </div>
      <nav className="flex min-h-0 flex-1 flex-col items-center gap-2 px-1.5 py-2">
        <RailButton
          icon={IconListTree}
          label={t("sidebar.catalog")}
          active={catalogOpen}
          onClick={toggleCatalog}
        />
        {/* Chapters lives on the canvas (its dropdown needs the draft data);
            from other steps the button navigates there. */}
        <RailLink
          href={`/story-studio/projects/${projectId}/canvas`}
          icon={IconBook2}
          label={t("chapters.action")}
        />
        {onCanvas ? (
          <RailButton
            icon={IconWorld}
            label={t("sidebar.world")}
            active={foundationOpen}
            onClick={() =>
              setInspectorTarget((current) =>
                current.kind === "foundation"
                  ? CLOSED_STORY_CANVAS_INSPECTOR
                  : STORY_FOUNDATION_INSPECTOR
              )
            }
          />
        ) : (
          <RailDisabled icon={IconWorld} label={t("sidebar.world")} />
        )}
        {/* Material canvas — the free creative canvas scoped to this project. */}
        <RailLink
          href={`/story-studio/projects/${projectId}/workbench/canvas`}
          icon={IconMovie}
          label={t("sidebar.media")}
        />
        <div className="flex-1" />
        {onCanvas ? (
          <RailButton
            icon={IconShare3}
            label={t("share")}
            active={false}
            onClick={() => setShareOpen(true)}
          />
        ) : (
          <RailDisabled icon={IconShare3} label={t("share")} />
        )}
      </nav>
    </aside>
  );
}

function railItemClass(active = false) {
  return cn(
    "flex h-[54px] w-[52px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:outline-none",
    active ? "bg-white/[0.08] text-white" : "text-white/90 hover:bg-white/[0.07] hover:text-white"
  );
}

function RailLink({ href, icon: Icon, label }: { href: string; icon: RailIcon; label: string }) {
  return (
    <Link href={href} className={railItemClass()}>
      <Icon className="size-[19px] shrink-0" stroke={1.45} />
      <span className="max-w-[48px] truncate text-[10px] leading-4 font-medium tracking-[-0.01em]">
        {label}
      </span>
    </Link>
  );
}

function RailButton({
  icon: Icon,
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
    <button type="button" aria-pressed={active} onClick={onClick} className={railItemClass(active)}>
      <Icon className="size-[19px] shrink-0" stroke={1.45} />
      <span className="max-w-[48px] truncate text-[10px] leading-4 font-medium tracking-[-0.01em]">
        {label}
      </span>
    </button>
  );
}

function RailDisabled({ icon: Icon, label }: { icon: RailIcon; label: string }) {
  return (
    <span aria-disabled="true" className={cn(railItemClass(), "cursor-default opacity-40")}>
      <Icon className="size-[19px] shrink-0" stroke={1.45} />
      <span className="max-w-[48px] truncate text-[10px] leading-4 font-medium tracking-[-0.01em]">
        {label}
      </span>
    </span>
  );
}
