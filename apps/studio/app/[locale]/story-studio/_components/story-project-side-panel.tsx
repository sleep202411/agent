"use client";

import { StoryProjectCatalog } from "@/app/[locale]/story-studio/_components/story-project-catalog";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";

/**
 * The side-panel dock — the column between the rail and the work view where
 * rail-toggled panels live. It dispatches the active tenant by `sidePanel`;
 * adding a new docked panel is one line here plus a `sidePanel` value.
 *
 * `world` is the one tenant NOT rendered here. The story-bible panel must
 * funnel its writes through the canvas's single-writer autosave, so the canvas
 * renders it into this same visual slot while this dock stays empty (the two
 * are mutually exclusive, so they never collide).
 */
export function StoryProjectSidePanel({ projectId }: { projectId: string }) {
  const sidePanel = useStoryProjectUiStore((state) => state.sidePanel);
  switch (sidePanel) {
    case "catalog":
      return <StoryProjectCatalog projectId={projectId} />;
    default:
      return null;
  }
}
