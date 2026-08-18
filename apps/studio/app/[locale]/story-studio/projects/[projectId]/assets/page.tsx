import type { Metadata } from "next";
import { StoryAssetsGallery } from "../../../_components/story-assets-gallery";

export const metadata: Metadata = {
  title: "Assets · Interactive Film Studio",
  description: "Manage characters, scenes, and props.",
};

export default function StoryProjectAssetsPage() {
  return <StoryAssetsGallery />;
}
