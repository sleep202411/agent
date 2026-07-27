import { StoryProjectWorkspaceGate } from "@/app/[locale]/story-studio/_components/story-project-workspace-gate";

/**
 * Immersive project routes (canvas, playtest). The gate resolves the project's
 * own workspace before the route loads so a shared link opens for an invited
 * member, whose active workspace is their personal one until we switch it.
 */
export default async function StoryProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <StoryProjectWorkspaceGate projectId={projectId}>{children}</StoryProjectWorkspaceGate>;
}
