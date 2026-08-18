import type { Metadata } from "next";
import { StoryStepEmptyPage } from "../../../_components/story-step-empty-page";

export const metadata: Metadata = {
  title: "Storyboard · Interactive Film Studio",
  description: "Produce per-node keyframes and shot videos.",
};

export default function StoryProjectStoryboardPage() {
  return <StoryStepEmptyPage step="storyboard" />;
}
