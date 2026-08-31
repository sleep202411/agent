import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { StoryTimelineEditorView } from "../../../_components/story-timeline-editor-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("storyStudio.editorPage");
  return { title: t("pageTitle"), description: t("pageDescription") };
}

export default async function StoryProjectEditorPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <StoryTimelineEditorView projectId={projectId} />;
}
