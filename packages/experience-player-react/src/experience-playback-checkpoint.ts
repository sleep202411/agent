import {
  EXPERIENCE_CORE_VIDEO_RENDERER_ID,
  ExperienceCoreVideoRendererConfigSchema,
  type ExperienceRuntimeManifest,
  type ExperienceScene,
} from "@repo/shared/experience-runtime";
import {
  experienceJourneyMediaSignature,
  type ExperienceRuntimeEvent,
  type ExperienceTimelineCursor,
} from "@repo/experience-engine";
import {
  validateExperienceAudioCheckpoint,
  type ExperienceAudioCheckpoint,
} from "./experience-audio-checkpoint";

export type ExperiencePlaybackRate = 1 | 1.25 | 1.5 | 2;
export type ExperienceCheckpointReason = "progress" | "transition" | "pause" | "seek" | "access";

export interface ExperienceMediaCheckpoint {
  rendererInstanceId: string;
  sequenceIndex: number;
  assetId: string;
  mediaSignature: string;
  positionMs: number;
  watchedUntilMs: number;
  durationMs: number;
  isStill: boolean;
  terminalMode: null | { kind: "held" } | { kind: "loop"; assetId: string; clipStartTime?: number };
  remainingHoldMs: number | null;
  completed: boolean;
}

/** Presentation state belongs to the player, separate from engine state. */
export interface ExperiencePlaybackCheckpoint {
  version: 1;
  sceneId: string;
  sceneSignature: string;
  sceneTimeMs: number;
  fixedClockEnded: boolean;
  /** Highest dispatched time, retained while a viewer replays earlier footage. */
  cursor: ExperienceTimelineCursor;
  openRendererIds: string[];
  settledGestureIds: string[];
  parkedEvents: ExperienceRuntimeEvent[];
  media: ExperienceMediaCheckpoint[];
  playbackEnabled: boolean;
  rate: ExperiencePlaybackRate;
  audio?: ExperienceAudioCheckpoint;
}

// Compatibility identity, not an authorization credential. Entitlements are
// always verified by the runtime, independently of a saved playback position.
function signature(value: unknown): string {
  let hash = 2166136261;
  const text = JSON.stringify(value);
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export function scenePlaybackSignature(scene: ExperienceScene): string {
  return signature(scene);
}

export function mediaPlaybackSignature(
  manifest: ExperienceRuntimeManifest,
  assetId: string
): string {
  return experienceJourneyMediaSignature(manifest, assetId);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function time(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function ids(value: unknown, allowed: Set<string>): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((id) => typeof id === "string" && allowed.has(id)) &&
    new Set(value).size === value.length
  );
}

/** Reject incompatible presentation state; never replay actions over restored state. */
export function validateExperiencePlaybackCheckpoint(
  manifest: ExperienceRuntimeManifest,
  sceneId: string,
  value: unknown
): ExperiencePlaybackCheckpoint | undefined {
  if (value === undefined || value === null) return undefined; // Existing saves predate seconds resume.
  const invalid = () => {
    throw new Error("Saved playback no longer matches this scene.");
  };
  const scene = manifest.graph.nodes.find((node) => node.sceneId === sceneId);
  if (!scene || scene.kind !== "scene" || !record(value)) return invalid();
  validateExperienceAudioCheckpoint(manifest, value.audio);
  const rendererIds = new Set(scene.renderers.map((renderer) => renderer.instanceId));
  const gestureIds = new Set(scene.gestures.map((gesture) => gesture.gestureId));
  const cueIds = new Set(scene.timeline.cues.filter((cue) => cue.once).map((cue) => cue.cueId));
  const cursor = value.cursor;
  if (
    value.version !== 1 ||
    value.sceneId !== sceneId ||
    value.sceneSignature !== scenePlaybackSignature(scene) ||
    !time(value.sceneTimeMs) ||
    !record(cursor) ||
    cursor.sceneId !== sceneId ||
    !(cursor.positionMs === -1 || time(cursor.positionMs)) ||
    !ids(cursor.firedOnceCueIds, cueIds) ||
    !ids(value.openRendererIds, rendererIds) ||
    !ids(value.settledGestureIds, gestureIds) ||
    typeof value.playbackEnabled !== "boolean" ||
    typeof value.fixedClockEnded !== "boolean" ||
    (value.fixedClockEnded && scene.clock.kind !== "fixed") ||
    ![1, 1.25, 1.5, 2].includes(value.rate as number) ||
    !Array.isArray(value.parkedEvents) ||
    !Array.isArray(value.media) ||
    value.media.length > scene.renderers.length
  )
    return invalid();
  for (const event of value.parkedEvents) {
    if (
      !record(event) ||
      typeof event.type !== "string" ||
      !["gesture.started", "gesture.completed", "gesture.cancelled", "gesture.timed-out"].includes(
        event.type
      ) ||
      typeof event.sourceId !== "string" ||
      !gestureIds.has(event.sourceId)
    )
      return invalid();
  }
  const seen = new Set<string>();
  for (const media of value.media) {
    if (
      !record(media) ||
      typeof media.rendererInstanceId !== "string" ||
      seen.has(media.rendererInstanceId)
    )
      return invalid();
    seen.add(media.rendererInstanceId);
    const renderer = scene.renderers.find(
      (candidate) =>
        candidate.instanceId === media.rendererInstanceId &&
        candidate.rendererId === EXPERIENCE_CORE_VIDEO_RENDERER_ID
    );
    const parsed = ExperienceCoreVideoRendererConfigSchema.safeParse(renderer?.config);
    if (
      !parsed.success ||
      typeof media.sequenceIndex !== "number" ||
      !Number.isInteger(media.sequenceIndex) ||
      media.sequenceIndex < 0
    )
      return invalid();
    const clip = parsed.data.sequence[media.sequenceIndex];
    const terminal = media.terminalMode;
    if (
      !clip ||
      (terminal !== null &&
        (!record(terminal) || !["held", "loop"].includes(terminal.kind as string)))
    )
      return invalid();
    let assetId = clip.assetId;
    if (record(terminal) && terminal.kind === "loop") {
      const behavior = clip.endBehavior;
      if (behavior.behavior !== "loop" && behavior.behavior !== "loop-tail") return invalid();
      assetId = behavior.behavior === "loop" ? behavior.assetId : clip.assetId;
      if (
        terminal.assetId !== assetId ||
        (terminal.clipStartTime !== undefined && !time(terminal.clipStartTime))
      )
        return invalid();
    }
    if (
      record(terminal) &&
      terminal.kind === "held" &&
      clip.endBehavior.behavior !== "hold-last-frame"
    )
      return invalid();
    if (
      media.assetId !== assetId ||
      media.mediaSignature !== mediaPlaybackSignature(manifest, assetId) ||
      !time(media.positionMs) ||
      !time(media.watchedUntilMs) ||
      !time(media.durationMs) ||
      media.positionMs > media.durationMs ||
      media.watchedUntilMs > media.durationMs ||
      (media.remainingHoldMs !== null && !time(media.remainingHoldMs)) ||
      typeof media.completed !== "boolean" ||
      typeof media.isStill !== "boolean"
    )
      return invalid();
  }
  return structuredClone(value) as unknown as ExperiencePlaybackCheckpoint;
}

/** Replays do not dispatch cues for a second time, including once:false cues. */
export function shouldAdvancePlaybackTimeline(
  cursor: ExperienceTimelineCursor,
  positionMs: number
): boolean {
  return Number.isFinite(positionMs) && positionMs >= 0 && positionMs > cursor.positionMs;
}

export function clampWatchedSeek(
  positionMs: number,
  durationMs: number,
  watchedUntilMs: number
): number {
  if (![positionMs, durationMs, watchedUntilMs].every(Number.isFinite)) return 0;
  return Math.max(0, Math.min(positionMs, durationMs, watchedUntilMs));
}
