import type { PutStoryStoryboardTimelineInput } from "@repo/shared";
import type {
  StoryStoryboardClip,
  StoryStoryboardCue,
  StoryStoryboardSequence,
} from "@/lib/story-production-api";

export const STORY_TIMELINE_VISUAL_TRACK_ID = "visual" as const;
export const STORY_TIMELINE_MIN_CLIP_DURATION_MS = 250;
export const STORY_TIMELINE_MAX_DURATION_MS = 3_600_000;

/**
 * Editor-facing projection of one Plot node's presentation timeline.
 * Branches remain in StoryDraft; the editor owns only time-based presentation.
 */
export interface StoryTimelineDocument {
  sequenceId: string;
  plotNodeId: string;
  durationMs: number;
  visualTrack: {
    id: typeof STORY_TIMELINE_VISUAL_TRACK_ID;
    clips: readonly StoryStoryboardClip[];
  };
  cues: readonly StoryStoryboardCue[];
}

export interface NewStoryTimelineClip {
  stableKey: string;
  kind: StoryStoryboardClip["kind"];
  title: string;
  durationMs: number;
  prompt: string;
  description: string | null;
  sourceMediaAssetId?: string;
}

export function storySequenceToTimeline(sequence: StoryStoryboardSequence): StoryTimelineDocument {
  const clips = [...sequence.clips].sort((left, right) => left.rank - right.rank);
  return {
    sequenceId: sequence.id,
    plotNodeId: sequence.plotNodeId,
    durationMs: sequence.durationMs,
    visualTrack: { id: STORY_TIMELINE_VISUAL_TRACK_ID, clips },
    cues: sequence.cues,
  };
}

/**
 * Build the one atomic command used by every timeline UI. New clips append to
 * the visual track without rewriting identities of retained clips.
 */
export function appendStoryTimelineClip(
  sequence: StoryStoryboardSequence,
  clip: NewStoryTimelineClip
): PutStoryStoryboardTimelineInput {
  if (!Number.isInteger(clip.durationMs) || clip.durationMs < STORY_TIMELINE_MIN_CLIP_DURATION_MS) {
    throw new Error("A Storyboard clip duration must be at least 250 milliseconds.");
  }
  const durationMs = sequence.durationMs + clip.durationMs;
  if (durationMs > STORY_TIMELINE_MAX_DURATION_MS) {
    throw new Error("A Storyboard timeline cannot exceed one hour.");
  }

  const newClip: PutStoryStoryboardTimelineInput["clips"][number] =
    clip.kind === "image"
      ? {
          expectedVersion: 0,
          ...(clip.sourceMediaAssetId ? { sourceMediaAssetId: clip.sourceMediaAssetId } : {}),
          stableKey: clip.stableKey,
          title: clip.title.trim(),
          startMs: sequence.durationMs,
          durationMs: clip.durationMs,
          description: clip.description,
          negativePrompt: null,
          kind: "image",
          imagePrompt: clip.prompt.trim(),
          videoPrompt: null,
        }
      : {
          expectedVersion: 0,
          ...(clip.sourceMediaAssetId ? { sourceMediaAssetId: clip.sourceMediaAssetId } : {}),
          stableKey: clip.stableKey,
          title: clip.title.trim(),
          startMs: sequence.durationMs,
          durationMs: clip.durationMs,
          description: clip.description,
          negativePrompt: null,
          kind: "video",
          imagePrompt: null,
          videoPrompt: clip.prompt.trim(),
        };

  return {
    expectedVersion: sequence.version,
    durationMs,
    clips: [
      ...sequence.clips
        .slice()
        .sort((left, right) => left.rank - right.rank)
        .map(storyboardClipToTimelineInput),
      newClip,
    ],
  };
}

/**
 * Remove one clip while keeping the visual track continuous. The timeline PUT
 * archives the omitted clip server-side and preserves every retained clip id.
 */
export function removeStoryTimelineClip(
  sequence: StoryStoryboardSequence,
  clipId: string
): PutStoryStoryboardTimelineInput {
  const orderedClips = sequence.clips.slice().sort((left, right) => left.rank - right.rank);
  if (!orderedClips.some((clip) => clip.id === clipId)) {
    throw new Error(`Storyboard clip ${clipId} does not exist in this timeline.`);
  }

  let startMs = 0;
  const clips = orderedClips
    .filter((clip) => clip.id !== clipId)
    .map((clip) => {
      const input = { ...storyboardClipToTimelineInput(clip), startMs };
      startMs += clip.durationMs;
      return input;
    });

  return {
    expectedVersion: sequence.version,
    durationMs: startMs,
    clips,
  };
}

export function createManualStoryTimelineClipStableKey(
  uuid: string = globalThis.crypto.randomUUID()
): string {
  const suffix = uuid.replaceAll(/[^A-Za-z0-9_]/g, "").slice(0, 24);
  if (!suffix) throw new Error("A random identifier is required for a manual Storyboard clip.");
  return `manual_clip_${suffix}`;
}

/** Move before a target (null appends), preserving identities and optimistic versions. */
export function moveStoryTimelineClip(
  sequence: StoryStoryboardSequence,
  clipId: string,
  beforeId: string | null
): PutStoryStoryboardTimelineInput {
  const ordered = sequence.clips.slice().sort((a, b) => a.rank - b.rank);
  const moved = ordered.find((clip) => clip.id === clipId);
  if (!moved || (beforeId !== null && !ordered.some((clip) => clip.id === beforeId))) {
    throw new Error("The timeline changed. Refresh before moving this clip.");
  }
  const clips = beforeId === clipId ? ordered : ordered.filter((clip) => clip.id !== clipId);
  if (beforeId !== clipId)
    clips.splice(
      beforeId === null ? clips.length : clips.findIndex((clip) => clip.id === beforeId),
      0,
      moved
    );
  let startMs = 0;
  return {
    expectedVersion: sequence.version,
    durationMs: clips.reduce((sum, clip) => sum + clip.durationMs, 0),
    clips: clips.map((clip) => {
      const input = { ...storyboardClipToTimelineInput(clip), startMs };
      startMs += clip.durationMs;
      return input;
    }),
  };
}

export function insertStoryTimelineClip(
  sequence: StoryStoryboardSequence,
  clip: NewStoryTimelineClip,
  beforeId: string | null
): PutStoryStoryboardTimelineInput {
  const input = appendStoryTimelineClip(sequence, clip);
  if (beforeId === null) return input;
  const index = input.clips.findIndex((item) => item.id === beforeId);
  if (index < 0) throw new Error("The timeline changed. Refresh before adding media.");
  const added = input.clips.pop()!;
  input.clips.splice(index, 0, added);
  let startMs = 0;
  input.clips = input.clips.map((item) => {
    const result = { ...item, startMs };
    startMs += item.durationMs;
    return result;
  });
  return input;
}

function storyboardClipToTimelineInput(
  clip: StoryStoryboardClip
): PutStoryStoryboardTimelineInput["clips"][number] {
  const common = {
    id: clip.id,
    expectedVersion: clip.version,
    stableKey: clip.stableKey,
    title: clip.title,
    startMs: clip.startMs,
    durationMs: clip.durationMs,
    description: clip.description,
    negativePrompt: clip.negativePrompt,
  };
  if (clip.kind === "image") {
    if (!clip.imagePrompt?.trim()) {
      throw new Error(`Storyboard image clip ${clip.id} has no image prompt.`);
    }
    return { ...common, kind: "image", imagePrompt: clip.imagePrompt, videoPrompt: null };
  }
  if (!clip.videoPrompt?.trim()) {
    throw new Error(`Storyboard video clip ${clip.id} has no video prompt.`);
  }
  return { ...common, kind: "video", imagePrompt: null, videoPrompt: clip.videoPrompt };
}
