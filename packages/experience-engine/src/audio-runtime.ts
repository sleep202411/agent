import type {
  ExperienceAudioCue,
  ExperienceRuntimeManifest,
} from "@repo/shared/experience-runtime";
import { ExperienceRuntimeInvariantError } from "./runtime.js";

export interface ExperienceDeterministicRuntimeState {
  randomSeed?: string;
  audioCuePlayCounts: Record<string, number>;
}

export interface ExperienceResolvedAudioPlayback {
  cueId: string;
  assetId: string;
  playbackRate: number;
  playbackOrdinal: number;
}

export function createExperienceDeterministicRuntimeState(
  randomSeed?: string
): ExperienceDeterministicRuntimeState {
  return {
    ...(randomSeed ? { randomSeed } : {}),
    audioCuePlayCounts: Object.create(null) as Record<string, number>,
  };
}

export function resolveExperienceAudioPlayback(
  manifest: ExperienceRuntimeManifest,
  runtime: ExperienceDeterministicRuntimeState,
  cueId: string
): ExperienceResolvedAudioPlayback {
  const cue = manifest.audio?.cues.find((candidate) => candidate.cueId === cueId);
  if (!cue) {
    throw new ExperienceRuntimeInvariantError(
      "AUDIO_CUE_UNKNOWN",
      `Cannot resolve unknown audio cue ${cueId}`
    );
  }
  const playbackOrdinal = runtime.audioCuePlayCounts[cueId] ?? 0;
  const requiresRandom =
    cue.selection === "random" || cue.playbackRate.minimum !== cue.playbackRate.maximum;
  if (requiresRandom && !runtime.randomSeed) {
    throw new ExperienceRuntimeInvariantError(
      "RANDOM_SEED_REQUIRED",
      `Audio cue ${cueId} requires a persisted runtime random seed`
    );
  }

  const assetId = selectAudioAsset(cue, runtime.randomSeed, playbackOrdinal);
  const playbackRate = selectPlaybackRate(cue, runtime.randomSeed, playbackOrdinal);
  runtime.audioCuePlayCounts[cueId] = playbackOrdinal + 1;
  return { cueId, assetId, playbackRate, playbackOrdinal };
}

function selectAudioAsset(
  cue: ExperienceAudioCue,
  randomSeed: string | undefined,
  playbackOrdinal: number
): string {
  if (cue.selection === "single") return cue.assetIds[0] as string;
  if (cue.selection === "sequential") {
    return cue.assetIds[playbackOrdinal % cue.assetIds.length] as string;
  }
  const random = deterministicUnitInterval(
    `${randomSeed as string}|${cue.cueId}|asset|${playbackOrdinal}`
  );
  return cue.assetIds[Math.floor(random * cue.assetIds.length)] as string;
}

function selectPlaybackRate(
  cue: ExperienceAudioCue,
  randomSeed: string | undefined,
  playbackOrdinal: number
): number {
  if (cue.playbackRate.minimum === cue.playbackRate.maximum) {
    return cue.playbackRate.minimum;
  }
  const random = deterministicUnitInterval(
    `${randomSeed as string}|${cue.cueId}|rate|${playbackOrdinal}`
  );
  return cue.playbackRate.minimum + (cue.playbackRate.maximum - cue.playbackRate.minimum) * random;
}

/** FNV-1a 32-bit: stable across JS runtimes and independent of platform RNG. */
function deterministicUnitInterval(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash / 0x1_0000_0000;
}
