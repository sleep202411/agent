import type {
  FilmClipSummary,
  FilmTrailerSummary,
  FilmVideoGeneration,
  StoryWorkbench,
} from "@/lib/story-projects-api";

const ACTIVE_VIDEO_GENERATION_STATUSES = new Set<FilmVideoGeneration["status"]>([
  "queued",
  "running",
  "processing",
]);

export function isActiveVideoGeneration(
  generation: FilmVideoGeneration | null | undefined
): boolean {
  return Boolean(generation && ACTIVE_VIDEO_GENERATION_STATUSES.has(generation.status));
}

export function filmGenerationError(
  generation: FilmVideoGeneration | null | undefined
): string | null {
  if (generation?.status !== "failed" || !generation.error) return null;
  const message = generation.error.message;
  return typeof message === "string" && message.trim() ? message : null;
}

export function resolveStoryVideoState(
  target: FilmClipSummary | FilmTrailerSummary | null | undefined
) {
  return {
    currentVideo: target?.currentVideo ?? null,
    generation: target?.generation ?? null,
    generationActive: isActiveVideoGeneration(target?.generation),
  };
}

export function workbenchHasActiveGeneration(workbench: StoryWorkbench | undefined): boolean {
  const film = workbench?.film;
  if (!film) return false;
  return (
    film.clips.some((clip) => isActiveVideoGeneration(clip.generation)) ||
    isActiveVideoGeneration(film.trailer?.generation)
  );
}
