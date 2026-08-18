import { StoryProjectAgentPanel } from "@/app/[locale]/story-studio/_components/story-project-agent-panel";
import { StoryProjectCatalog } from "@/app/[locale]/story-studio/_components/story-project-catalog";
import { StoryProjectHeader } from "@/app/[locale]/story-studio/_components/story-project-header";
import { StoryProjectRail } from "@/app/[locale]/story-studio/_components/story-project-rail";
import { StoryProjectWorkspaceGate } from "@/app/[locale]/story-studio/_components/story-project-workspace-gate";

/**
 * Project layout — owns the whole project chrome: header (title + production
 * stepper), the left rail, and the single FizzAgent panel. Pages render only
 * their content. The canvas keeps its own richer chrome and the playtest
 * stays chrome-free (header/rail self-hide on those segments).
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
      <div className="flex h-screen flex-col overflow-hidden bg-[var(--canvas-background)] text-white">
        {/* Header */}
        <StoryProjectHeader projectId={projectId} />
        <section className="flex min-h-0 min-w-0 flex-1">
          <div className="flex min-h-0 shrink-0">
            {/* Sidebar */}
            <StoryProjectRail projectId={projectId} />
            {/* Side Panel — rail-toggled panels dock here (catalog for now). */}
            <StoryProjectCatalog projectId={projectId} />
          </div>

          <div className="flex min-w-0 flex-1">{children}</div>
          <StoryProjectAgentPanel projectId={projectId} />
        </section>
      </div>
    </StoryProjectWorkspaceGate>
  );
}
