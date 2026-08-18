import type { Metadata } from "next";
import { StoryStepEmptyPage } from "../../../_components/story-step-empty-page";

export const metadata: Metadata = {
  title: "Assets · Interactive Film Studio",
  description: "Manage characters, scenes, and props.",
};

export default function StoryProjectAssetsPage() {
  return <StoryStepEmptyPage step="assets" />;
}
