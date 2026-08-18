import type { Metadata } from "next";
import { StoryScriptDocument } from "../../../_components/story-script-document";

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
  return <StoryScriptDocument projectId={projectId} />;
}
