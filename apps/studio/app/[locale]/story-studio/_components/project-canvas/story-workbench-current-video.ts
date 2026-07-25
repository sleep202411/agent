import type { StoryClipVideoSummary, StoryWorkbench } from "@/lib/story-projects-api";

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
  return {
    ...workbench,
    project: {
      ...workbench.project,
      production: {
        ...workbench.project.production,
        currentVideoCount,
      },
    },
    video: {
      ...workbench.video,
      clips,
    },
  };
}
