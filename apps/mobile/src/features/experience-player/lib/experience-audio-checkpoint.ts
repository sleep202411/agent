import type { ExperienceRuntimeManifest } from "@repo/shared/experience-runtime";

export interface ExperienceAudioCheckpoint {
  playbacks: {
    cueId: string;
    assetId: string;
    playbackRate: number;
    playbackOrdinal: number;
    playbackId?: string;
    positionSeconds: number;
  }[];
  busGains: Record<string, number>;
}

export function validateExperienceAudioCheckpoint(
  manifest: ExperienceRuntimeManifest,
  input: unknown
): ExperienceAudioCheckpoint | undefined {
  if (input === undefined) return undefined;
  const invalid = () => {
    throw new Error("Saved audio no longer matches this scene.");
  };
  if (!input || typeof input !== "object" || Array.isArray(input)) return invalid();
  const value = input as ExperienceAudioCheckpoint;
  if (
    !Array.isArray(value.playbacks) ||
    value.playbacks.length > 128 ||
    !value.busGains ||
    typeof value.busGains !== "object" ||
    Array.isArray(value.busGains)
  )
    return invalid();
  const keys = new Set<string>();
  for (const playback of value.playbacks) {
    if (!playback || typeof playback !== "object") return invalid();
    const cue = manifest.audio?.cues.find((candidate) => candidate.cueId === playback.cueId);
    const key = `${playback.cueId}:${playback.playbackOrdinal}`;
    if (
      !cue ||
      !cue.assetIds.includes(playback.assetId) ||
      keys.has(key) ||
      !Number.isInteger(playback.playbackOrdinal) ||
      playback.playbackOrdinal < 0 ||
      !Number.isFinite(playback.playbackRate) ||
      playback.playbackRate <= 0 ||
      !Number.isFinite(playback.positionSeconds) ||
      playback.positionSeconds < 0 ||
      (playback.playbackId !== undefined && typeof playback.playbackId !== "string")
    )
      return invalid();
    keys.add(key);
  }
  for (const [busId, gain] of Object.entries(value.busGains)) {
    if (
      !manifest.audio?.buses.some((bus) => bus.busId === busId) ||
      !Number.isFinite(gain) ||
      gain < 0
    )
      return invalid();
  }
  return structuredClone(value);
}
