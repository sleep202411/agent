import { notFound } from "next/navigation";
import { StoryCreativeWorkbench } from "../../../../_components/workbench/story-creative-workbench";

export default async function StoryCreativeWorkbenchPage({
  params,
}: {
  params: Promise<{ projectId: string; mode: string }>;
}) {
  const { projectId, mode } = await params;
  if (mode !== "canvas" && mode !== "storyboard") notFound();
  return <StoryCreativeWorkbench projectId={projectId} activeMode={mode} />;
}
