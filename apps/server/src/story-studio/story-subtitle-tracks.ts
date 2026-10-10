import {
  StorySubtitleTracksSchema,
  type RuntimeSubtitleTrack,
  type StorySubtitleTimeline,
} from '@repo/shared/story-subtitles';
import { canonicalJsonHash } from './canonical-json';
import { chooseStoryboardClipVariant } from './story-video-production.schema';

interface SubtitleClip {
  id: string;
  kind: string;
  track: string;
  startMs: number;
  rank: number;
  durationMs: number;
  selectedMediaVersion: {
    id: string;
    archivedAt: Date | null;
    preferredVariant: SubtitleVariant | null;
    mediaAsset: {
      kind: string;
      status: string;
      deletedAt: Date | null;
      moderationStatus: string;
      variants: SubtitleVariant[];
    };
  } | null;
}
interface SubtitleVariant {
  id: string;
  variantKey: string;
  durationMs: number | null;
  checksumSha256: string | null;
  status: string;
  deletedAt: Date | null;
  contentType: string;
}

export function orderedSubtitleClips<T extends SubtitleClip>(
  clips: readonly T[],
): T[] {
  return [...clips].sort(
    (a, b) =>
      a.track.localeCompare(b.track) ||
      a.startMs - b.startMs ||
      a.rank - b.rank ||
      a.id.localeCompare(b.id),
  );
}

export function storySubtitleTimeline(sequence: {
  clips: readonly SubtitleClip[];
}): StorySubtitleTimeline {
  let offset: number | null = 0;
  const identities = orderedSubtitleClips(sequence.clips).map((clip) => {
    const media =
      clip.selectedMediaVersion?.archivedAt === null
        ? clip.selectedMediaVersion
        : null;
    const variant = media ? chooseStoryboardClipVariant(media) : null;
    const available = Boolean(
      media &&
      variant &&
      media.mediaAsset.kind === clip.kind &&
      media.mediaAsset.status === 'ready' &&
      media.mediaAsset.deletedAt === null &&
      media.mediaAsset.moderationStatus !== 'blocked' &&
      variant.status === 'ready' &&
      variant.deletedAt === null &&
      variant.contentType.toLowerCase().startsWith(`${clip.kind}/`),
    );
    const durationMs = !available
      ? null
      : clip.kind === 'image'
        ? Math.max(100, Math.min(clip.durationMs, 120_000))
        : (variant?.durationMs ?? null);
    const startMs = offset;
    offset =
      offset !== null && durationMs !== null && durationMs > 0
        ? offset + durationMs
        : null;
    return {
      clipId: clip.id,
      kind: clip.kind,
      mediaVersionId: media?.id ?? null,
      variantId: variant?.id ?? null,
      checksumSha256: variant?.checksumSha256 ?? null,
      startMs,
      durationMs,
    };
  });
  return {
    fingerprint: canonicalJsonHash(identities),
    durationMs: identities.length ? offset : null,
    ready: identities.length > 0 && offset !== null,
    segments: identities.map(({ clipId, startMs, durationMs }) => ({
      clipId,
      startMs,
      durationMs,
    })),
  };
}

/** Keep authored cues on the node; immutable runtimes use segment-relative slices. */
export function resolveStorySubtitleTracks(sequence: {
  clips: readonly SubtitleClip[];
  subtitleTracks?: unknown;
}) {
  const timeline = storySubtitleTimeline(sequence);
  const tracks = StorySubtitleTracksSchema.parse(sequence.subtitleTracks ?? []);
  const current = timeline.ready
    ? tracks.filter(
        (track) => track.timelineFingerprint === timeline.fingerprint,
      )
    : [];
  const outOfRange = current.some((track) =>
    track.cues.some((cue) => cue.endMs > timeline.durationMs!),
  );
  const byClipId = new Map<string, RuntimeSubtitleTrack[]>();
  for (const segment of timeline.segments) {
    const subtitles: RuntimeSubtitleTrack[] = [];
    if (
      !outOfRange &&
      segment.startMs !== null &&
      segment.durationMs !== null
    ) {
      const start = segment.startMs,
        end = start + segment.durationMs;
      for (const track of current) {
        const cues = track.cues
          .filter((cue) => cue.startMs < end && cue.endMs > start)
          .map((cue) => ({
            ...cue,
            startMs: Math.max(cue.startMs, start) - start,
            endMs: Math.min(cue.endMs, end) - start,
          }));
        if (cues.length) subtitles.push({ language: track.language, cues });
      }
    }
    byClipId.set(segment.clipId, subtitles);
  }
  return {
    timeline,
    byClipId,
    stale: current.length !== tracks.length,
    outOfRange,
  };
}
