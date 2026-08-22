import { Suspense } from "react";
import { StoryProjectAgentPanel } from "@/app/[locale]/story-studio/_components/story-project-agent-panel";
import { StoryProjectChapterScope } from "@/app/[locale]/story-studio/_components/story-project-chapter-scope";
import { StoryProjectHeader } from "@/app/[locale]/story-studio/_components/story-project-header";
import { StoryProjectMobileNav } from "@/app/[locale]/story-studio/_components/story-project-mobile-nav";
import { StoryProjectRail } from "@/app/[locale]/story-studio/_components/story-project-rail";
import { StoryProjectShareDialog } from "@/app/[locale]/story-studio/_components/story-project-share-dialog";
import { StoryProjectSidePanel } from "@/app/[locale]/story-studio/_components/story-project-side-panel";
import { StoryProjectWorkView } from "@/app/[locale]/story-studio/_components/story-project-work-view";
import { StoryProjectWorkspaceGate } from "@/app/[locale]/story-studio/_components/story-project-workspace-gate";

/**
 * Project layout — owns the whole project chrome: header (title + production
 * stepper), the left rail, the single FizzAgent panel, and the phone bottom
 * bar. Pages render only their content; the playtest stays chrome-free (all
 * chrome self-hides on that segment). Below md the layout flips to
 * conversation-first: the agent panel is the full-screen default and the
 * bottom bar switches between it and the step pages.
 */
export default async function StoryProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return (
    <StoryProjectWorkspaceGate projectId={projectId}>
      <Suspense fallback={null}>
        <StoryProjectChapterScope projectId={projectId}>
          <div className="flex h-dvh flex-col overflow-hidden bg-[var(--canvas-background)] text-white">
            {/* Header */}
            <StoryProjectHeader projectId={projectId} />
            <section className="flex min-h-0 min-w-0 flex-1">
              <div className="flex min-h-0 shrink-0">
                {/* Sidebar */}
                <StoryProjectRail projectId={projectId} />
                {/* Side Panel — the dock for every rail-toggled panel. */}
                <StoryProjectSidePanel projectId={projectId} />
              </div>

              <StoryProjectWorkView>{children}</StoryProjectWorkView>
              <StoryProjectAgentPanel projectId={projectId} />
            </section>
            <StoryProjectShareDialog projectId={projectId} />
            <StoryProjectMobileNav projectId={projectId} />
          </div>
        </StoryProjectChapterScope>
      </Suspense>
    </StoryProjectWorkspaceGate>
  );
}
