import type { Metadata } from "next";
import { StoryStepEmptyPage } from "../../../../_components/story-step-empty-page";

export const metadata: Metadata = {
  title: "Script · Interactive Film Studio",
  description: "Author and review the story script.",
};

export default async function StoryProjectScriptPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <StoryStepEmptyPage projectId={projectId} step="script" />;
}
