import type {
  StoryClipVideoSummary,
  StoryTrailerVideoSummary,
  StoryVideoGeneration,
  StoryWorkbench,
} from "@/lib/story-projects-api";

const ACTIVE_VIDEO_GENERATION_STATUSES = new Set<StoryVideoGeneration["status"]>([
  "queued",
  "running",
  "processing",
]);

export function isActiveVideoGeneration(
  generation: StoryVideoGeneration | null | undefined
): boolean {
  return Boolean(generation && ACTIVE_VIDEO_GENERATION_STATUSES.has(generation.status));
}

export function storyGenerationError(
  generation: StoryVideoGeneration | null | undefined
): string | null {
  if (generation?.status !== "failed" || !generation.error) return null;
  const message = generation.error.message;
  return typeof message === "string" && message.trim() ? message : null;
}

export function resolveStoryVideoState(
  target: StoryClipVideoSummary | StoryTrailerVideoSummary | null | undefined
) {
  return {
    currentVideo: target?.currentVideo ?? null,
    generation: target?.generation ?? null,
    generationActive: isActiveVideoGeneration(target?.generation),
  };
}

export function workbenchHasActiveGeneration(workbench: StoryWorkbench | undefined): boolean {
  const video = workbench?.video;
  if (!video) return false;
  return (
    video.clips.some((clip) => isActiveVideoGeneration(clip.generation)) ||
    isActiveVideoGeneration(video.trailer.generation)
  );
}
