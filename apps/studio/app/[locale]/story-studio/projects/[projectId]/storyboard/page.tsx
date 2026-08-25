import type { Metadata } from "next";
import { StoryStoryboardView } from "../../../_components/story-storyboard-view";

export const metadata: Metadata = {
  title: "Storyboard · Interactive Film Studio",
  description: "Edit chapter-local Plot sequences, clips, cues, and Asset bindings.",
};

export default async function StoryProjectStoryboardPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <StoryStoryboardView projectId={projectId} />;
}
