import type { Metadata } from "next";
import { StoryStepEmptyPage } from "../../../../_components/story-step-empty-page";

export const metadata: Metadata = {
  title: "Assets · Interactive Film Studio",
  description: "Manage characters, scenes, and props.",
};

export default async function StoryProjectAssetsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <StoryStepEmptyPage projectId={projectId} step="assets" />;
}
