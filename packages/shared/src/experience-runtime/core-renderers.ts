import { z } from "zod";
import { ExperienceLocalizedTextSchema, ExperienceStableIdSchema } from "./common.js";
import { ExperienceConditionSchema } from "./state.js";

export const EXPERIENCE_CORE_RENDERER_API_VERSION = "1.0.0" as const;
export const EXPERIENCE_CORE_RENDERER_CONFIG_VERSION = "1.0.0" as const;

export const EXPERIENCE_CORE_VIDEO_RENDERER_ID = "core.video" as const;
export const EXPERIENCE_CORE_CHOICE_RENDERER_ID = "core.choice" as const;
export const EXPERIENCE_CORE_CHECKPOINT_RENDERER_ID = "core.checkpoint" as const;
export const EXPERIENCE_CORE_CHARGE_FEEDBACK_RENDERER_ID = "core.charge-feedback" as const;

export const EXPERIENCE_CORE_RENDERER_IDS = [
  EXPERIENCE_CORE_VIDEO_RENDERER_ID,
  EXPERIENCE_CORE_CHOICE_RENDERER_ID,
  EXPERIENCE_CORE_CHECKPOINT_RENDERER_ID,
  EXPERIENCE_CORE_CHARGE_FEEDBACK_RENDERER_ID,
] as const;

export type ExperienceCoreRendererId = (typeof EXPERIENCE_CORE_RENDERER_IDS)[number];

const ExperienceCoreVideoEndBehaviorSchema = z.discriminatedUnion("behavior", [
  z.object({ behavior: z.literal("advance") }).strict(),
  z
    .object({
      behavior: z.literal("hold-last-frame"),
      durationMs: z.number().int().min(100).max(10_000).optional(),
    })
    .strict(),
  z
    .object({
      behavior: z.literal("loop-tail"),
      tailSeconds: z.number().min(0.5).max(3),
    })
    .strict(),
  z.object({ behavior: z.literal("loop"), assetId: ExperienceStableIdSchema }).strict(),
]);

const ExperienceCoreVideoSequenceClipSchema = z
  .object({
    clipId: ExperienceStableIdSchema,
    assetId: ExperienceStableIdSchema,
    posterAssetId: ExperienceStableIdSchema.optional(),
    endBehavior: ExperienceCoreVideoEndBehaviorSchema,
  })
  .strict();

export const ExperienceCoreVideoRendererConfigSchema = z
  .object({
    fit: z.enum(["cover", "contain"]),
    sequence: z.array(ExperienceCoreVideoSequenceClipSchema).min(1),
    posterAssetId: ExperienceStableIdSchema.optional(),
    autoplay: z.boolean(),
  })
  .strict()
  .superRefine((config, context) => {
    const clipIds = new Set<string>();
    config.sequence.forEach((clip, index) => {
      if (clipIds.has(clip.clipId)) {
        context.addIssue({
          code: "custom",
          path: ["sequence", index, "clipId"],
          message: `Duplicate sequence clip id ${clip.clipId}`,
        });
      }
      clipIds.add(clip.clipId);

      const isLast = index === config.sequence.length - 1;
      const behavior = clip.endBehavior;
      if (!isLast && behavior.behavior === "hold-last-frame" && !behavior.durationMs) {
        context.addIssue({
          code: "custom",
          path: ["sequence", index, "endBehavior"],
          message: "Only the final clip may hold its last frame indefinitely",
        });
      }
      if (!isLast && (behavior.behavior === "loop" || behavior.behavior === "loop-tail")) {
        context.addIssue({
          code: "custom",
          path: ["sequence", index, "endBehavior"],
          message: "Only the final clip may enter an indefinite wait loop",
        });
      }
    });
  });

const ExperienceCoreChoiceSchema = z
  .object({
    choiceId: ExperienceStableIdSchema,
    label: ExperienceLocalizedTextSchema,
    accessibilityLabel: ExperienceLocalizedTextSchema.optional(),
    visibleWhen: ExperienceConditionSchema.optional(),
  })
  .strict();

export const ExperienceCoreChoiceRendererConfigSchema = z
  .object({
    decisionId: ExperienceStableIdSchema,
    prompt: ExperienceLocalizedTextSchema,
    choices: z.array(ExperienceCoreChoiceSchema).min(2).max(6),
    initiallyOpen: z.boolean(),
  })
  .strict()
  .superRefine((config, context) => {
    const choiceIds = new Set<string>();
    config.choices.forEach((choice, index) => {
      if (!choiceIds.has(choice.choiceId)) {
        choiceIds.add(choice.choiceId);
        return;
      }
      context.addIssue({
        code: "custom",
        path: ["choices", index, "choiceId"],
        message: `Duplicate choice id ${choice.choiceId}`,
      });
    });
  });

export const ExperienceCoreCheckpointRendererConfigSchema = z
  .object({
    actionIds: z.array(ExperienceStableIdSchema).min(1),
    initiallyOpen: z.boolean(),
  })
  .strict()
  .superRefine((config, context) => {
    const actionIds = new Set<string>();
    config.actionIds.forEach((actionId, index) => {
      if (!actionIds.has(actionId)) {
        actionIds.add(actionId);
        return;
      }
      context.addIssue({
        code: "custom",
        path: ["actionIds", index],
        message: `Duplicate checkpoint action id ${actionId}`,
      });
    });
  });

export const ExperienceCoreChargeFeedbackRendererConfigSchema = z
  .object({
    appearance: z.enum(["ring", "target"]).default("ring"),
    label: ExperienceLocalizedTextSchema.optional(),
  })
  .strict();

export const ExperienceCoreRendererOpenCommandPayloadSchema = z.object({}).strict();
export const ExperienceCoreMediaEndedOutcomePayloadSchema = z.object({}).strict();
export const ExperienceCoreChoiceSelectedOutcomePayloadSchema = z
  .object({ choiceId: ExperienceStableIdSchema })
  .strict();
export const ExperienceCoreCheckpointOutcomePayloadSchema = z.object({}).strict();

export type ExperienceCoreVideoRendererConfig = z.infer<
  typeof ExperienceCoreVideoRendererConfigSchema
>;
export type ExperienceCoreChoiceRendererConfig = z.infer<
  typeof ExperienceCoreChoiceRendererConfigSchema
>;
export type ExperienceCoreCheckpointRendererConfig = z.infer<
  typeof ExperienceCoreCheckpointRendererConfigSchema
>;
export type ExperienceCoreChargeFeedbackRendererConfig = z.infer<
  typeof ExperienceCoreChargeFeedbackRendererConfigSchema
>;
