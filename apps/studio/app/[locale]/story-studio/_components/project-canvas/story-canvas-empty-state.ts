import type { StoryChapter } from "@/lib/story-projects-api";

/**
 * True only for the first chapter of a project that has never held a scene.
 *
 * A later empty chapter — or an empty chapter in a project where authoring has
 * already begun — deliberately stays blank: the creator knows the canvas by
 * then, and an onboarding hero over a working project is noise.
 */
export function isStoryCanvasProjectBootstrap(
  chapters: StoryChapter[],
  currentChapterId: string
): boolean {
  const currentChapter = chapters.find((chapter) => chapter.id === currentChapterId);
  if (!currentChapter || currentChapter.nodeCount > 0) return false;

  const projectHasScenes = chapters.some((chapter) => chapter.nodeCount > 0);
  return !projectHasScenes && currentChapter.id === chapters[0]?.id;
}
