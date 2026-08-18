import type { Metadata } from "next";
import { StoryProjectCanvas } from "../../../_components/project-canvas/story-project-canvas";

export const metadata: Metadata = {
  title: "Story Canvas · Interactive Film Studio",
  description: "Author the story foundation and interactive-film graph.",
};

export default async function StoryProjectCanvasPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ chapter?: string | string[] }>;
}) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  const requestedChapterId = typeof query.chapter === "string" ? query.chapter : undefined;
  return <StoryProjectCanvas projectId={projectId} requestedChapterId={requestedChapterId} />;
}
