import { z } from "zod";
import { ExperienceLocalizedTextSchema, ExperienceStableIdSchema } from "./common.js";
import { ExperienceConditionSchema } from "./state.js";

export const EXPERIENCE_CORE_RENDERER_API_VERSION = "1.0.0" as const;
export const EXPERIENCE_CORE_RENDERER_CONFIG_VERSION = "1.0.0" as const;

export const EXPERIENCE_CORE_VIDEO_RENDERER_ID = "core.video" as const;

/**
 * A sequence that plays still images, not only footage.
 *
 * Declared in `compatibility.requiredCapabilities` only by manifests that
 * actually contain a still, so video-only experiences stay playable on hosts
 * that predate stills. A host that cannot render one is refused at runtime
 * construction, by name, instead of silently showing an empty frame.
 */
export const EXPERIENCE_CORE_VIDEO_STILL_CAPABILITY = "core.video.still" as const;
export const EXPERIENCE_CORE_TEXT_RENDERER_ID = "core.text" as const;
export const EXPERIENCE_CORE_CHOICE_RENDERER_ID = "core.choice" as const;
export const EXPERIENCE_CORE_CHARGE_FEEDBACK_RENDERER_ID = "core.charge-feedback" as const;
export const EXPERIENCE_CORE_WORLD_MODEL_RENDERER_ID = "core.world-model" as const;

export const EXPERIENCE_CORE_RENDERER_IDS = [
  EXPERIENCE_CORE_VIDEO_RENDERER_ID,
  EXPERIENCE_CORE_TEXT_RENDERER_ID,
  EXPERIENCE_CORE_CHOICE_RENDERER_ID,
  EXPERIENCE_CORE_CHARGE_FEEDBACK_RENDERER_ID,
  EXPERIENCE_CORE_WORLD_MODEL_RENDERER_ID,
] as const;

export type ExperienceCoreRendererId = (typeof EXPERIENCE_CORE_RENDERER_IDS)[number];

export const ExperienceCoreTextRendererConfigSchema = z
  .object({
    title: ExperienceLocalizedTextSchema.optional(),
    body: ExperienceLocalizedTextSchema,
    completion: z.enum(["continue", "passive"]),
  })
  .strict()
  .superRefine((config, context) => {
    if (Object.keys(config.body).length === 0) {
      context.addIssue({
        code: "custom",
        path: ["body"],
        message: "Text body must provide at least one locale",
      });
    }
    if (config.title && Object.keys(config.title).length === 0) {
      context.addIssue({
        code: "custom",
        path: ["title"],
        message: "Text title must provide at least one locale when present",
      });
    }
  });

const ExperienceCoreVideoEndBehaviorSchema = z.discriminatedUnion("behavior", [
  z.object({ behavior: z.literal("advance") }).strict(),
  z
    .object({
      behavior: z.literal("hold-last-frame"),
      // Still-image segments hold for their full storyboard clip length, so
      // the cap covers long held shots, not just brief end-frame beats.
      durationMs: z.number().int().min(100).max(120_000).optional(),
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
    // "cover"/"contain" fill a fixed full-bleed stage; "native" renders the clip
    // inline at its intrinsic aspect ratio inside a responsive reading stage,
    // for narrative experiences that carry no project-wide frame contract.
    fit: z.enum(["cover", "contain", "native"]),
    // An empty sequence is a video scene with nothing to play yet: the shot
    // exists in the story, its footage does not. Preview Builds emit these so a
    // work in progress stays playable end to end instead of refusing to
    // compile; the player shows a placeholder and advances on the same
    // `media-ended` outcome a real clip would produce. Release Builds still
    // reject a missing clip, so nothing empty reaches a player by accident.
    sequence: z.array(ExperienceCoreVideoSequenceClipSchema),
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
    prompt: ExperienceLocalizedTextSchema.optional(),
    choices: z.array(ExperienceCoreChoiceSchema).min(1).max(6),
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

export const ExperienceCoreChargeFeedbackRendererConfigSchema = z
  .object({
    appearance: z.enum(["ring", "target"]).default("ring"),
    label: ExperienceLocalizedTextSchema.optional(),
  })
  .strict();

export const ExperienceCoreWorldModelRendererConfigSchema = z
  .object({
    projectId: ExperienceStableIdSchema,
    worldId: ExperienceStableIdSchema,
    entryInstruction: z.string().trim().min(1).max(4_000).optional(),
    maxExperienceSeconds: z.union([z.literal(60), z.literal(90), z.literal(120)]),
    autoplay: z.boolean(),
  })
  .strict();

export const ExperienceCoreRendererOpenCommandPayloadSchema = z.object({}).strict();
export const ExperienceCoreVideoPlaybackCommandPayloadSchema = z.object({}).strict();
export const ExperienceCoreVideoSeekCommandPayloadSchema = z
  .object({ timeMs: z.number().min(0) })
  .strict();
export const ExperienceCoreMediaEndedOutcomePayloadSchema = z.object({}).strict();
export const ExperienceCoreTextCompletedOutcomePayloadSchema = z.object({}).strict();
export const ExperienceCoreChoiceSelectedOutcomePayloadSchema = z
  .object({ choiceId: ExperienceStableIdSchema })
  .strict();
export const ExperienceCoreWorldCompletedOutcomePayloadSchema = z.object({}).strict();

export type ExperienceCoreVideoRendererConfig = z.infer<
  typeof ExperienceCoreVideoRendererConfigSchema
>;
export type ExperienceCoreTextRendererConfig = z.infer<
  typeof ExperienceCoreTextRendererConfigSchema
>;
export type ExperienceCoreChoiceRendererConfig = z.infer<
  typeof ExperienceCoreChoiceRendererConfigSchema
>;
export type ExperienceCoreChargeFeedbackRendererConfig = z.infer<
  typeof ExperienceCoreChargeFeedbackRendererConfigSchema
>;
export type ExperienceCoreWorldModelRendererConfig = z.infer<
  typeof ExperienceCoreWorldModelRendererConfigSchema
>;
