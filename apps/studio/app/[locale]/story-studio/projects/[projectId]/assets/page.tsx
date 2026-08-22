import type { Metadata } from "next";
import { StoryAssetsGallery } from "../../../_components/story-assets-gallery";

export const metadata: Metadata = {
  title: "Assets · Interactive Film Studio",
  description: "Manage chapter-local logical Asset Specs and selected media.",
};

export default async function StoryProjectAssetsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <StoryAssetsGallery projectId={projectId} />;
}
