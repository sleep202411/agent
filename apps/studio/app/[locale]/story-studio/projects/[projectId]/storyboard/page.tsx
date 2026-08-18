import type { Metadata } from "next";
import { StoryStoryboardView } from "../../../_components/story-storyboard-view";

export const metadata: Metadata = {
  title: "Storyboard · Interactive Film Studio",
  description: "Per-scene production status: prose and the current video.",
};

export default async function StoryProjectStoryboardPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <StoryStoryboardView projectId={projectId} />;
}
