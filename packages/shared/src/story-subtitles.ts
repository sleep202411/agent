import { z } from "zod";

export const STORY_SUBTITLE_FILE_MAX_BYTES = 512_000;
export const STORY_SUBTITLE_CUES_MAX = 2_000;
export const STORY_SUBTITLE_LANGUAGES = ["zh-CN", "zh-HK", "en-US"] as const;
export const STORY_SUBTITLE_LANGUAGES_MAX = STORY_SUBTITLE_LANGUAGES.length;
export const StorySubtitleLanguageSchema = z.enum(STORY_SUBTITLE_LANGUAGES);
export const StorySubtitleTimelineFingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/);

/** Playback time for the complete storyboard node, using actual media durations. */
export interface StorySubtitleTimeline {
  fingerprint: string;
  durationMs: number | null;
  ready: boolean;
  segments: { clipId: string; startMs: number | null; durationMs: number | null }[];
}

export const StorySubtitleCueSchema = z
  .object({
    startMs: z.number().int().min(0).max(86_400_000),
    endMs: z.number().int().positive().max(86_400_000),
    text: z.string().trim().min(1).max(2_000),
  })
  .strict()
  .refine((cue) => cue.endMs > cue.startMs, "Subtitle end must follow its start.");

export const StorySubtitleCuesSchema = z
  .array(StorySubtitleCueSchema)
  .min(1)
  .max(STORY_SUBTITLE_CUES_MAX)
  .refine(
    (cues) => cues.every((cue, index) => index === 0 || cue.startMs >= cues[index - 1]!.startMs),
    "Subtitle cues must be ordered by start time."
  );

export const RuntimeSubtitleTrackSchema = z
  .object({
    language: StorySubtitleLanguageSchema,
    cues: StorySubtitleCuesSchema,
  })
  .strict();

export const RuntimeSubtitleTracksSchema = z
  .array(RuntimeSubtitleTrackSchema)
  .max(STORY_SUBTITLE_LANGUAGES_MAX)
  .refine(
    (tracks) => new Set(tracks.map((track) => track.language)).size === tracks.length,
    "Only one subtitle track per language is allowed."
  );

export const StorySubtitleTrackSchema = RuntimeSubtitleTrackSchema.extend({
  timelineFingerprint: StorySubtitleTimelineFingerprintSchema,
  fileName: z.string().trim().min(1).max(255),
  format: z.enum(["srt", "vtt"]),
}).strict();

export const StorySubtitleTracksSchema = z
  .array(StorySubtitleTrackSchema)
  .max(STORY_SUBTITLE_LANGUAGES_MAX)
  .refine(
    (tracks) => new Set(tracks.map((track) => track.language)).size === tracks.length,
    "Only one subtitle track per language is allowed."
  );

export const StorySubtitleUploadSchema = z
  .object({
    language: StorySubtitleLanguageSchema,
    timelineFingerprint: StorySubtitleTimelineFingerprintSchema,
    fileName: z.string().trim().min(1).max(255),
    format: z.enum(["srt", "vtt"]),
    content: z.string().min(1).max(STORY_SUBTITLE_FILE_MAX_BYTES),
  })
  .strict();

export type StorySubtitleCue = z.infer<typeof StorySubtitleCueSchema>;
export type RuntimeSubtitleTrack = z.infer<typeof RuntimeSubtitleTrackSchema>;
export type StorySubtitleTrack = z.infer<typeof StorySubtitleTrackSchema>;
export type StorySubtitleUpload = z.infer<typeof StorySubtitleUploadSchema>;

export type StorySubtitleLanguage = z.infer<typeof StorySubtitleLanguageSchema>;
