"use client";

import { useTranslations } from "next-intl";
import { useSelectedLayoutSegment } from "next/navigation";
import { StoryChaptersDock } from "@/app/[locale]/story-studio/_components/story-chapters-dock";
import { StoryProjectCatalog } from "@/app/[locale]/story-studio/_components/story-project-catalog";
import { StoryWorldDock } from "@/app/[locale]/story-studio/_components/story-world-dock";
import { isProductionStepSegment } from "../_lib/production-steps";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";

/**
 * The one place the side-panel dock's width is set. Tenants render width-less
 * content (flex column, internal scroll) and must not size themselves; each
 * passes the label that names the docked column to assistive tech.
 */
export function StoryProjectSidePanelShell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <aside
      aria-label={label}
      className="flex w-80 shrink-0 flex-col overflow-hidden border-r border-white/8 bg-[#0C0C0D] max-md:hidden"
    >
      {children}
    </aside>
  );
}

/**
 * The side-panel dock — the column between the rail and the work view where
 * rail-toggled panels live, on every production step. It dispatches the
 * active tenant by `sidePanel`; adding a new docked panel is one case here
 * plus a `sidePanel` value. Tenants that touch canvas-owned draft state do so
 * through the store bridges the canvas registers while mounted
 * (guardedNavigate, foundationWriter, liveDraft/liveFoundation) — never by
 * being canvas-rendered.
 */
export function StoryProjectSidePanel({ projectId }: { projectId: string }) {
  const t = useTranslations("storyStudio.canvas");
  const segment = useSelectedLayoutSegment();
  const sidePanel = useStoryProjectUiStore((state) => state.sidePanel);
  if (!isProductionStepSegment(segment)) return null;
  switch (sidePanel) {
    case "catalog":
      return (
        <StoryProjectSidePanelShell label={t("sidebar.catalog")}>
          <StoryProjectCatalog projectId={projectId} />
        </StoryProjectSidePanelShell>
      );
    case "world":
      return (
        <StoryProjectSidePanelShell label={t("sidebar.world")}>
          <StoryWorldDock projectId={projectId} />
        </StoryProjectSidePanelShell>
      );
    case "chapters":
      return (
        <StoryProjectSidePanelShell label={t("chapters.action")}>
          <StoryChaptersDock projectId={projectId} />
        </StoryProjectSidePanelShell>
      );
    default:
      return null;
  }
}
