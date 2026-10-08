"use client";

import { useSelectedLayoutSegment } from "next/navigation";
import { StoryProjectAgentPanel } from "./story-project-agent-panel";
import { StoryProjectHeader } from "./story-project-header";
import { StoryProjectMobileNav } from "./story-project-mobile-nav";
import { StoryProjectRail } from "./story-project-rail";
import { StoryProjectShareDialog } from "./story-project-share-dialog";
import { StoryProjectSidePanel } from "./story-project-side-panel";
import { StoryProjectWorkView } from "./story-project-work-view";

/**
 * Selects the chrome for a project route. Production stages share the normal
 * Story Studio shell, while the timeline editor owns the full viewport so its
 * preview and timeline are never compressed by navigation or Agent panels.
 */
export function StoryProjectShell({
  projectId,
  children,
}: {
  projectId: string;
  children: React.ReactNode;
}) {
  const segment = useSelectedLayoutSegment();

  if (segment === "edit" || segment === "playtest") {
    return (
      <div
        data-slot={
          segment === "playtest" ? "story-project-preview-shell" : "story-project-editor-shell"
        }
        className="grid h-dvh min-h-0 min-w-0 overflow-hidden bg-[var(--canvas-background)] text-white"
      >
        {children}
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[var(--canvas-background)] text-white">
      <StoryProjectHeader projectId={projectId} />
      <section className="flex min-h-0 min-w-0 flex-1">
        <div className="flex min-h-0 shrink-0">
          <StoryProjectRail projectId={projectId} />
          <StoryProjectSidePanel projectId={projectId} />
        </div>

        <StoryProjectWorkView>{children}</StoryProjectWorkView>
        <StoryProjectAgentPanel projectId={projectId} />
      </section>
      <StoryProjectShareDialog projectId={projectId} />
      <StoryProjectMobileNav projectId={projectId} />
    </div>
  );
}
