import { z } from "zod";
import { ExperienceStableIdSchema } from "./common.js";

export const ExperienceAudioBusRoleSchema = z.enum([
  "master",
  "music",
  "ambience",
  "dialogue",
  "sfx",
  "ui",
  "media",
  "custom",
]);

export const ExperienceAudioBusSchema = z
  .object({
    busId: ExperienceStableIdSchema,
    role: ExperienceAudioBusRoleSchema,
    parentBusId: ExperienceStableIdSchema.optional(),
    defaultGain: z.number().min(0).max(4).default(1),
    defaultMuted: z.boolean().default(false),
  })
  .strict();

const AudioConcurrencySchema = z
  .object({
    groupId: ExperienceStableIdSchema,
    maxInstances: z.number().int().positive().max(64),
    overflowBehavior: z.enum(["reject-new", "stop-oldest", "stop-quietest"]),
  })
  .strict();

export const ExperienceAudioCueSchema = z
  .object({
    cueId: ExperienceStableIdSchema,
    busId: ExperienceStableIdSchema,
    assetIds: z.array(ExperienceStableIdSchema).min(1),
    selection: z.enum(["single", "random", "sequential"]).default("single"),
    loop: z.boolean().default(false),
    gain: z.number().min(0).max(4).default(1),
    playbackRate: z
      .object({ minimum: z.number().positive(), maximum: z.number().positive() })
      .strict()
      .default({ minimum: 1, maximum: 1 }),
    fadeInMs: z.number().int().nonnegative().max(60_000).default(0),
    fadeOutMs: z.number().int().nonnegative().max(60_000).default(0),
    concurrency: AudioConcurrencySchema.optional(),
    spatialAnchorId: ExperienceStableIdSchema.optional(),
  })
  .strict()
  .superRefine((cue, context) => {
    if (cue.selection === "single" && cue.assetIds.length !== 1) {
      context.addIssue({
        code: "custom",
        path: ["assetIds"],
        message: "single audio cues must reference exactly one asset",
      });
    }
    if (cue.playbackRate.maximum < cue.playbackRate.minimum) {
      context.addIssue({
        code: "custom",
        path: ["playbackRate", "maximum"],
        message: "maximum playback rate must be greater than or equal to minimum",
      });
    }
  });

export const ExperienceAudioSnapshotSchema = z
  .object({
    snapshotId: ExperienceStableIdSchema,
    busGains: z.record(ExperienceStableIdSchema, z.number().min(0).max(4)),
    transitionMs: z.number().int().nonnegative().max(60_000).default(0),
  })
  .strict();

export const ExperienceAudioDuckingRuleSchema = z
  .object({
    ruleId: ExperienceStableIdSchema,
    triggerBusId: ExperienceStableIdSchema,
    targetBusId: ExperienceStableIdSchema,
    targetGain: z.number().min(0).max(1),
    attackMs: z.number().int().nonnegative().max(10_000),
    releaseMs: z.number().int().nonnegative().max(10_000),
  })
  .strict();

export const ExperienceAudioDefinitionSchema = z
  .object({
    buses: z.array(ExperienceAudioBusSchema).min(1),
    cues: z.array(ExperienceAudioCueSchema).default([]),
    snapshots: z.array(ExperienceAudioSnapshotSchema).default([]),
    duckingRules: z.array(ExperienceAudioDuckingRuleSchema).default([]),
  })
  .strict();

export type ExperienceAudioDefinition = z.infer<typeof ExperienceAudioDefinitionSchema>;
export type ExperienceAudioCue = z.infer<typeof ExperienceAudioCueSchema>;
