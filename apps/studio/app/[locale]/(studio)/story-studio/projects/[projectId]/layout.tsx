import { StoryProjectWorkspaceGate } from "@/app/[locale]/story-studio/_components/story-project-workspace-gate";

/**
 * Workbench project routes (overview, story, references, production) inside the
 * studio chrome. Same gate as the immersive tree: the project's workspace is
 * resolved and switched to before any workspace-scoped read runs.
 */
export default async function StoryProjectWorkbenchLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <StoryProjectWorkspaceGate projectId={projectId}>{children}</StoryProjectWorkspaceGate>;
}
