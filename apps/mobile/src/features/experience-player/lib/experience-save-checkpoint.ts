import {
  restoreExperienceRuntime,
  validateExperienceJourney,
  type ExperienceRuntimeEvent,
  type ExperienceRuntimeState,
} from "@repo/experience-engine";
import {
  ExperienceScopedStateSnapshotSchema,
  type ExperienceJourney,
  type ExperienceRuntimeManifest,
} from "@repo/shared/experience-runtime";
import { z } from "zod/v4";

import {
  validateExperiencePlaybackCheckpoint,
  type ExperiencePlaybackCheckpoint,
} from "./experience-playback-checkpoint";

export type ExperienceSaveCheckpoint = {
  state: ExperienceRuntimeState;
  events: ExperienceRuntimeEvent[];
  playback?: ExperiencePlaybackCheckpoint;
  journey?: ExperienceJourney;
};

const eventsSchema = z
  .array(
    z.object({
      type: z.string().min(1),
      sourceId: z.string().optional(),
      qualifierId: z.string().optional(),
      payload: z.record(z.string(), z.json()).optional(),
      context: z.record(z.string(), z.json()).optional(),
    })
  )
  .max(64);

const stateSchema = z.object({
  currentSceneId: z.string().min(1),
  status: z.enum(["active", "completed"]),
  completedEndingId: z.string().optional(),
  values: ExperienceScopedStateSnapshotSchema,
  watchedAssetIds: z.array(z.string()).optional(),
  unlockedEndingIds: z.array(z.string()).optional(),
  completedEndingIds: z.array(z.string()).optional(),
  deterministicRuntime: z.object({
    randomSeed: z.string().optional(),
    audioCuePlayCounts: z.record(z.string(), z.number().int().nonnegative()),
  }),
});

/** Saved engine/presentation state is checked against the live manifest, not just its version. */
export function validateExperienceSaveCheckpoint(
  manifest: ExperienceRuntimeManifest,
  source: { state: unknown; events: unknown; playback?: unknown; journey?: unknown }
): ExperienceSaveCheckpoint {
  const events = eventsSchema.parse(source.events) as ExperienceRuntimeEvent[];
  const state = restoreExperienceRuntime(manifest, stateSchema.parse(source.state));
  const playback = validateExperiencePlaybackCheckpoint(
    manifest,
    state.currentSceneId,
    source.playback
  );
  const journey =
    source.journey == null ? undefined : validateExperienceJourney(manifest, source.journey);
  return { state, events, ...(playback ? { playback } : {}), ...(journey ? { journey } : {}) };
}
