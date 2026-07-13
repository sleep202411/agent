import { StoryProjectWorkbench } from "../_components/story-project-workbench";

export default async function StoryProjectStoryPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <StoryProjectWorkbench projectId={projectId} stage="story" />;
}
