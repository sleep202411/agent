import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { StoryStoryboardView } from "../../../_components/story-storyboard-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("storyStudio.storyboardPage");
  return { title: t("pageTitle"), description: t("pageDescription") };
}

export default async function StoryProjectStoryboardPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <StoryStoryboardView projectId={projectId} />;
}
