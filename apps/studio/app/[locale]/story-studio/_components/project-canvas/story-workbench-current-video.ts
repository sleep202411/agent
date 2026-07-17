import type {
  StoryClipVideoSummary,
  StoryTrailerVideoSummary,
  StoryWorkbench,
} from "@/lib/story-projects-api";

const ACTIVE_GENERATION_STATUSES = new Set(["queued", "running", "processing"]);

/**
 * Projects the server-confirmed Clip summary into the existing workbench cache.
 * Graph node identity is the stable authoring key.
 */
export function projectConfirmedClipCurrentVideo(
  workbench: StoryWorkbench | undefined,
  confirmedClip: StoryClipVideoSummary
): StoryWorkbench | undefined {
  if (!workbench) return workbench;
  const clipIndex = workbench.video.clips.findIndex(
    (clip) => clip.graphNodeId === confirmedClip.graphNodeId
  );
  if (clipIndex < 0) {
    return {
      ...workbench,
      video: { ...workbench.video, clips: [...workbench.video.clips, confirmedClip] },
    };
  }

  const clips = [...workbench.video.clips];
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
    video: {
      ...workbench.video,
      clips,
    },
  };
}

/** Projects the server-confirmed Trailer summary without disturbing Clips. */
export function projectConfirmedTrailerCurrentVideo(
  workbench: StoryWorkbench | undefined,
  confirmedTrailer: StoryTrailerVideoSummary
): StoryWorkbench | undefined {
  if (!workbench) return workbench;
  return {
    ...workbench,
    video: {
      ...workbench.video,
      trailer: confirmedTrailer,
    },
  };
}
