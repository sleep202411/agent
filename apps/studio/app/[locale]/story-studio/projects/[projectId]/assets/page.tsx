import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { StoryAssetsGallery } from "../../../_components/story-assets-gallery";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("storyStudio.assetsPage");
  return { title: t("pageTitle"), description: t("pageDescription") };
}

export default async function StoryProjectAssetsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <StoryAssetsGallery projectId={projectId} />;
}
