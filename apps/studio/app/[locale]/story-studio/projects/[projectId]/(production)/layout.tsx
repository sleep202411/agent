import { StoryProjectProductionShell } from "../../../_components/story-project-production-shell";

/**
 * Production step routes (canvas, script) share the project rail + Agent
 * panel via this shell. Playtest stays outside the group — the player gets
 * no creation chrome.
 */
export default async function StoryProjectProductionLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return (
    <StoryProjectProductionShell projectId={projectId}>{children}</StoryProjectProductionShell>
  );
}
