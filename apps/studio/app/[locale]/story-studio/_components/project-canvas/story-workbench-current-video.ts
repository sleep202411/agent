import type { FilmClipSummary, FilmTrailerSummary, StoryWorkbench } from "@/lib/story-projects-api";

const ACTIVE_GENERATION_STATUSES = new Set(["queued", "running", "processing"]);

/**
 * Projects the server-confirmed Clip summary into the existing workbench cache.
 * Graph node identity is the stable authoring key: saving the draft can
 * materialize a new production Clip id immediately before the current-video
 * PUT returns.
 */
export function projectConfirmedClipCurrentVideo(
  workbench: StoryWorkbench | undefined,
  confirmedClip: FilmClipSummary
): StoryWorkbench | undefined {
  if (!workbench?.film) return workbench;
  const clipIndex = workbench.film.clips.findIndex(
    (clip) => clip.graphNodeId === confirmedClip.graphNodeId || clip.id === confirmedClip.id
  );
  if (clipIndex < 0) return workbench;

  const clips = [...workbench.film.clips];
  clips[clipIndex] = confirmedClip;
  const currentVideoCount = clips.filter((clip) => clip.currentVideo !== null).length;
  const generatingClipCount = clips.filter(
    (clip) => clip.generation && ACTIVE_GENERATION_STATUSES.has(clip.generation.status)
  ).length;

  return {
    ...workbench,
    project: {
      ...workbench.project,
      production: {
        ...workbench.project.production,
        currentVideoCount,
        generatingClipCount,
      },
    },
    film: {
      ...workbench.film,
      clips,
    },
  };
}

/** Projects the server-confirmed Trailer summary without disturbing Clips. */
export function projectConfirmedTrailerCurrentVideo(
  workbench: StoryWorkbench | undefined,
  confirmedTrailer: FilmTrailerSummary
): StoryWorkbench | undefined {
  if (!workbench?.film) return workbench;
  return {
    ...workbench,
    film: {
      ...workbench.film,
      trailer: confirmedTrailer,
    },
  };
}
