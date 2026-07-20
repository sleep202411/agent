import type { ExperienceScene } from "@repo/shared/experience-runtime";
import type { ExperienceRuntimeEvent } from "./runtime.js";

export interface ExperienceTimelineCursor {
  sceneId: string;
  positionMs: number;
  firedOnceCueIds: string[];
}

export interface ExperienceTimelineAdvance {
  cursor: ExperienceTimelineCursor;
  events: ExperienceRuntimeEvent[];
}

export function createExperienceTimelineCursor(sceneId: string): ExperienceTimelineCursor {
  return { sceneId, positionMs: -1, firedOnceCueIds: [] };
}

export function advanceExperienceTimeline(
  scene: ExperienceScene,
  currentCursor: ExperienceTimelineCursor,
  positionMs: number
): ExperienceTimelineAdvance {
  if (!Number.isFinite(positionMs) || positionMs < 0) {
    throw new RangeError("Timeline position must be a finite non-negative number");
  }
  const cursor =
    currentCursor.sceneId === scene.sceneId
      ? {
          ...currentCursor,
          firedOnceCueIds: [...currentCursor.firedOnceCueIds],
        }
      : createExperienceTimelineCursor(scene.sceneId);

  if (positionMs < cursor.positionMs) {
    return { cursor: { ...cursor, positionMs }, events: [] };
  }

  const fired = new Set(cursor.firedOnceCueIds);
  const events = scene.timeline.cues.flatMap((cue) => {
    if (cue.atMs <= cursor.positionMs || cue.atMs > positionMs) return [];
    if (cue.once && fired.has(cue.cueId)) return [];
    if (cue.once) fired.add(cue.cueId);
    return [
      {
        type: "timeline.cue",
        sourceId: scene.sceneId,
        qualifierId: cue.cueId,
        payload: { atMs: cue.atMs },
      } satisfies ExperienceRuntimeEvent,
    ];
  });

  return {
    cursor: {
      sceneId: scene.sceneId,
      positionMs,
      firedOnceCueIds: [...fired],
    },
    events,
  };
}
