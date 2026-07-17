import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { StoryProjectPlaytest } from "./_components/story-project-playtest";
import {
  parseStoryPlaytestSource,
  type StoryPlaytestSearchParams,
} from "./_lib/story-playtest-source";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("storyStudio.canvas.workingPreview");
  return { title: t("pageTitle"), description: t("pageDescription") };
}

export default async function StoryProjectPlaytestPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<StoryPlaytestSearchParams>;
}) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  return <StoryProjectPlaytest projectId={projectId} source={parseStoryPlaytestSource(query)} />;
}
