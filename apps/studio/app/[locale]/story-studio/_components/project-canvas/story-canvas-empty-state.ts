import type { StoryChapter } from "@/lib/story-projects-api";

export function isStoryCanvasProjectBootstrap(
  chapters: StoryChapter[],
  currentChapterId: string
): boolean {
  const currentChapter = chapters.find((chapter) => chapter.id === currentChapterId);
  if (!currentChapter || currentChapter.nodeCount > 0) return false;

  const projectHasScenes = chapters.some((chapter) => chapter.nodeCount > 0);
  return !projectHasScenes && currentChapter.id === chapters[0]?.id;
}
