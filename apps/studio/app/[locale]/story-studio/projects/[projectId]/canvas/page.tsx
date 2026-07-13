import type { Metadata } from "next";
import { StoryProjectCanvas } from "../../../_components/project-canvas/story-project-canvas";

export const metadata: Metadata = {
  title: "Story Canvas · Story Studio",
  description: "Author the story foundation and interactive-film graph.",
};

export default async function StoryProjectCanvasPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <StoryProjectCanvas projectId={projectId} />;
}
