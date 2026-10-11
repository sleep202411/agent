import { z } from "zod";
import type { TimelineSequence } from "./story-timeline-api";
const url = z
  .string()
  .url()
  .refine((value) => {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password;
  });
const media = z.object({
  mediaKind: z.enum(["image", "video"]),
  previewUrl: url.nullable(),
  thumbnailUrl: url.nullable().optional(),
});
/** Validate optional media independently: a missing/invalid source remains a visible empty clip. */
export function timelinePlaybackClips(sequence: TimelineSequence, preferOriginalImage = false) {
  return [...sequence.clips]
    .sort((a, b) => a.rank - b.rank)
    .map((clip) => {
      const parsed = media.safeParse(clip.selectedMediaVersion);
      const value = parsed.success ? parsed.data : null;
      const source =
        value?.mediaKind === clip.kind
          ? clip.kind === "video"
            ? value.previewUrl
            : preferOriginalImage
              ? (value.previewUrl ?? value.thumbnailUrl)
              : (value.thumbnailUrl ?? value.previewUrl)
          : null;
      return {
        id: clip.id,
        title: clip.title,
        kind: clip.kind,
        startMs: clip.startMs,
        durationMs: clip.durationMs,
        source,
      };
    });
}
export type PlaybackClip = ReturnType<typeof timelinePlaybackClips>[number];
export function timelineClipAt(clips: PlaybackClip[], timeMs: number) {
  if (!Number.isFinite(timeMs) || timeMs < 0) return null;
  const last = clips.at(-1);
  return (
    clips.find((c) => timeMs >= c.startMs && timeMs < c.startMs + c.durationMs) ??
    (last && timeMs === last.startMs + last.durationMs ? last : null)
  );
}
