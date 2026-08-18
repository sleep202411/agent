import type { Metadata } from "next";
import { StoryStepEmptyPage } from "../../../../_components/story-step-empty-page";

export const metadata: Metadata = {
  title: "Storyboard · Interactive Film Studio",
  description: "Produce per-node keyframes and shot videos.",
};

export default async function StoryProjectStoryboardPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <StoryStepEmptyPage projectId={projectId} step="storyboard" />;
}
