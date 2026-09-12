import { StoryProjectWorkbench } from "../_components/story-project-workbench";

export default async function StoryProjectOverviewPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  // WEB_APP_URL optionally points to apps/web during local development.
  // Production defaults to the current deployment region in the workbench.
  return (
    <StoryProjectWorkbench
      projectId={projectId}
      stage="overview"
      earningsWebBase={process.env.WEB_APP_URL}
    />
  );
}
