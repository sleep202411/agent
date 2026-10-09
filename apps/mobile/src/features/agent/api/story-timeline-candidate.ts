import { z } from "zod";
import type { TimelineSequence } from "./story-timeline-api";
const media = z.object({
  mediaAssetId: z.string().uuid(),
  mediaKind: z.enum(["image", "video"]),
  mediaStatus: z.literal("ready"),
});
/** Read from the saved sequence, never infer media identity from editable clip fields. */
export function timelineCandidateId(sequence: TimelineSequence | undefined, clipId?: string) {
  const clip = clipId ? sequence?.clips.find((item) => item.id === clipId) : undefined;
  const parsed = media.safeParse(clip?.selectedMediaVersion);
  return clip && parsed.success && parsed.data.mediaKind === clip.kind
    ? parsed.data.mediaAssetId
    : undefined;
}
