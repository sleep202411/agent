import { z } from "zod";
import {
  EXPERIENCE_PLAYER_PROTOCOL_VERSION,
  ExperienceEventTypeSchema,
  ExperienceJsonObjectSchema,
  ExperienceLocaleSchema,
  ExperienceSha256Schema,
  ExperienceStableIdSchema,
} from "./common.js";
import { ExperienceScopedStateSnapshotSchema } from "./state.js";

const IsoTimestampSchema = z.string().datetime({ offset: true });

const ExperienceSessionLifecycleSchema = z
  .object({
    status: z.enum(["active", "completed"]),
    completedEndingId: ExperienceStableIdSchema.optional(),
  })
  .strict()
  .superRefine((lifecycle, context) => {
    if (lifecycle.status === "completed" && !lifecycle.completedEndingId) {
      context.addIssue({
        code: "custom",
        path: ["completedEndingId"],
        message: "Completed sessions require completedEndingId",
      });
    }
    if (lifecycle.status === "active" && lifecycle.completedEndingId) {
      context.addIssue({
        code: "custom",
        path: ["completedEndingId"],
        message: "Active sessions cannot have completedEndingId",
      });
    }
  });

export const ExperienceDeterministicRuntimeSnapshotSchema = z
  .object({
    randomSeed: ExperienceStableIdSchema.optional(),
    audioCuePlayCounts: z
      .record(ExperienceStableIdSchema, z.number().int().nonnegative())
      .default({}),
  })
  .strict();

export const ExperiencePlayerPreferencesSchema = z
  .object({
    locale: ExperienceLocaleSchema,
    masterMuted: z.boolean().default(false),
    audioBusGains: z.record(ExperienceStableIdSchema, z.number().min(0).max(4)).default({}),
    reducedMotion: z.boolean().default(false),
    captionsEnabled: z.boolean().default(false),
  })
  .strict();

export const ExperienceSessionSnapshotSchema = z
  .object({
    protocolVersion: z.literal(EXPERIENCE_PLAYER_PROTOCOL_VERSION),
    sessionId: ExperienceStableIdSchema,
    clientSessionId: ExperienceStableIdSchema,
    gameId: ExperienceStableIdSchema,
    manifestHash: ExperienceSha256Schema,
    buildId: ExperienceStableIdSchema,
    contentVersion: ExperienceStableIdSchema,
    sessionVersion: z.number().int().nonnegative(),
    playerStateId: ExperienceStableIdSchema,
    playerStateVersion: z.number().int().nonnegative(),
    currentSceneId: ExperienceStableIdSchema,
    lifecycle: ExperienceSessionLifecycleSchema,
    deterministicRuntime: ExperienceDeterministicRuntimeSnapshotSchema,
    state: ExperienceScopedStateSnapshotSchema,
    watchedAssetIds: z.array(ExperienceStableIdSchema).default([]),
    unlockedEndingIds: z.array(ExperienceStableIdSchema).default([]),
    completedEndingIds: z.array(ExperienceStableIdSchema).default([]),
    preferences: ExperiencePlayerPreferencesSchema,
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
  })
  .strict();

export const ExperienceCheckpointWriteSchema = z
  .object({
    protocolVersion: z.literal(EXPERIENCE_PLAYER_PROTOCOL_VERSION),
    clientWriteId: ExperienceStableIdSchema,
    expectedSessionVersion: z.number().int().nonnegative(),
    expectedPlayerStateVersion: z.number().int().nonnegative(),
    checkpointId: ExperienceStableIdSchema,
    currentSceneId: ExperienceStableIdSchema,
    lifecycle: ExperienceSessionLifecycleSchema,
    deterministicRuntime: ExperienceDeterministicRuntimeSnapshotSchema,
    state: ExperienceScopedStateSnapshotSchema,
    watchedAssetIds: z.array(ExperienceStableIdSchema).default([]),
    unlockedEndingIds: z.array(ExperienceStableIdSchema).default([]),
    completedEndingIds: z.array(ExperienceStableIdSchema).default([]),
    preferences: ExperiencePlayerPreferencesSchema,
  })
  .strict();

export const STANDARD_EXPERIENCE_EVENT_TYPES = [
  "session.started",
  "session.resumed",
  "session.checkpointed",
  "session.completed",
  "scene.entered",
  "scene.exited",
  "media.started",
  "media.completed",
  "media.error",
  "choice.presented",
  "choice.selected",
  "interaction.started",
  "interaction.cancelled",
  "interaction.completed",
  "interaction.timed-out",
  "ending.reached",
  "runtime.error",
] as const;

export const ExperiencePlayerEventSchema = z
  .object({
    protocolVersion: z.literal(EXPERIENCE_PLAYER_PROTOCOL_VERSION),
    eventId: ExperienceStableIdSchema,
    sequence: z.number().int().nonnegative(),
    eventType: ExperienceEventTypeSchema,
    occurredAt: IsoTimestampSchema,
    gameId: ExperienceStableIdSchema,
    manifestHash: ExperienceSha256Schema,
    buildId: ExperienceStableIdSchema,
    contentVersion: ExperienceStableIdSchema,
    sessionId: ExperienceStableIdSchema,
    sceneId: ExperienceStableIdSchema.optional(),
    sourceId: ExperienceStableIdSchema.optional(),
    assetId: ExperienceStableIdSchema.optional(),
    mediaTimeMs: z.number().int().nonnegative().optional(),
    platform: z.enum(["web", "ios", "android", "desktop"]),
    payload: ExperienceJsonObjectSchema.default({}),
  })
  .strict();

export const ExperiencePlayerEventBatchSchema = z
  .object({
    protocolVersion: z.literal(EXPERIENCE_PLAYER_PROTOCOL_VERSION),
    events: z.array(ExperiencePlayerEventSchema).min(1).max(200),
  })
  .strict()
  .superRefine((batch, context) => {
    const first = batch.events[0];
    if (!first) return;
    const eventIds = new Set<string>();
    const sequences = new Set<number>();
    batch.events.forEach((event, index) => {
      if (event.sessionId !== first.sessionId) {
        context.addIssue({
          code: "custom",
          path: ["events", index, "sessionId"],
          message: "A telemetry batch may contain only one player session",
        });
      }
      if (event.gameId !== first.gameId) {
        context.addIssue({
          code: "custom",
          path: ["events", index, "gameId"],
          message: "A telemetry batch may contain only one game",
        });
      }
      if (event.manifestHash !== first.manifestHash) {
        context.addIssue({
          code: "custom",
          path: ["events", index, "manifestHash"],
          message: "A telemetry batch may contain only one manifest version",
        });
      }
      if (event.buildId !== first.buildId) {
        context.addIssue({
          code: "custom",
          path: ["events", index, "buildId"],
          message: "A telemetry batch may contain only one build",
        });
      }
      if (event.contentVersion !== first.contentVersion) {
        context.addIssue({
          code: "custom",
          path: ["events", index, "contentVersion"],
          message: "A telemetry batch may contain only one content version",
        });
      }
      if (eventIds.has(event.eventId)) {
        context.addIssue({
          code: "custom",
          path: ["events", index, "eventId"],
          message: `Duplicate event id ${event.eventId}`,
        });
      }
      eventIds.add(event.eventId);
      if (sequences.has(event.sequence)) {
        context.addIssue({
          code: "custom",
          path: ["events", index, "sequence"],
          message: `Duplicate session sequence ${event.sequence}`,
        });
      }
      sequences.add(event.sequence);
      const previous = batch.events[index - 1];
      if (previous && event.sequence <= previous.sequence) {
        context.addIssue({
          code: "custom",
          path: ["events", index, "sequence"],
          message: "Telemetry event sequences must be strictly increasing",
        });
      }
    });
  });

export type ExperienceSessionSnapshot = z.infer<typeof ExperienceSessionSnapshotSchema>;
export type ExperienceCheckpointWrite = z.infer<typeof ExperienceCheckpointWriteSchema>;
export type ExperiencePlayerEvent = z.infer<typeof ExperiencePlayerEventSchema>;
export type ExperiencePlayerEventBatch = z.infer<typeof ExperiencePlayerEventBatchSchema>;
