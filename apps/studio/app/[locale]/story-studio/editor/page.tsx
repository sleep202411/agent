import type { Metadata } from "next";
import { StoryStudioCanvas } from "../_components/story-studio-canvas";

export const metadata: Metadata = {
  title: "Story Canvas",
  description: "Design playable text-game stories, characters, clues, actions, and endings.",
};

type StoryStudioEditorPageProps = {
  searchParams?: Promise<{
    projectId?: string | string[];
  }>;
};

export default async function StoryStudioEditorPage({ searchParams }: StoryStudioEditorPageProps) {
  const params = searchParams ? await searchParams : {};
  const rawProjectId = params.projectId;
  const projectId = Array.isArray(rawProjectId) ? rawProjectId[0] : rawProjectId;

  return <StoryStudioCanvas projectId={projectId ?? null} />;
}
