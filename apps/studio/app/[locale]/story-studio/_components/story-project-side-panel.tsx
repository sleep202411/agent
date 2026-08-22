"use client";

import { useSelectedLayoutSegment } from "next/navigation";
import { StoryProjectCatalog } from "@/app/[locale]/story-studio/_components/story-project-catalog";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";

/** Production-step segments where the dock (like the rail) may appear. */
const DOCK_SEGMENTS = new Set(["canvas", "script", "assets", "storyboard"]);

/**
 * The one place the side-panel dock's width is set. Tenants render width-less
 * content (flex column, internal scroll) and must not size themselves.
 */
export function StoryProjectSidePanelShell({
  label,
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <aside
      aria-label={label}
      className="flex w-92 shrink-0 flex-col overflow-hidden border-r border-white/8 bg-[#0C0C0D] max-md:hidden"
    >
      {children}
    </aside>
  );
}

/**
 * The side-panel dock — the column between the rail and the work view where
 * rail-toggled panels live. It dispatches the active tenant by `sidePanel`;
 * adding a new docked panel is one line here plus a `sidePanel` value.
 *
 * `world` and `chapters` are the tenants NOT rendered here. Both must funnel
 * their writes through the canvas's single-writer autosave/workbench state, so
 * the canvas renders them into this same visual slot (wrapped in the same
 * shell) while this dock stays empty — the tenants are mutually exclusive, so
 * they never collide.
 */
export function StoryProjectSidePanel({ projectId }: { projectId: string }) {
  const segment = useSelectedLayoutSegment();
  const sidePanel = useStoryProjectUiStore((state) => state.sidePanel);
  if (!DOCK_SEGMENTS.has(segment ?? "")) return null;
  switch (sidePanel) {
    case "catalog":
      return (
        <StoryProjectSidePanelShell>
          <StoryProjectCatalog projectId={projectId} />
        </StoryProjectSidePanelShell>
      );
    default:
      return null;
  }
}
