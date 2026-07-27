import { z } from "zod";
import {
  ExperienceJsonObjectSchema,
  ExperienceStableIdSchema,
  ExperienceValueExpressionSchema,
} from "./common.js";
import { ExperienceConditionSchema } from "./state.js";

export const ExperienceRendererOutcomeSchema = z
  .object({
    outcomeType: ExperienceStableIdSchema,
    payloadSchemaAssetId: ExperienceStableIdSchema.optional(),
  })
  .strict();

export const ExperienceRendererCommandSchema = z
  .object({
    commandType: ExperienceStableIdSchema,
    payloadSchemaAssetId: ExperienceStableIdSchema.optional(),
  })
  .strict();

export const ExperienceRendererRequirementSchema = z
  .object({
    rendererId: ExperienceStableIdSchema,
    apiVersion: ExperienceStableIdSchema,
    configSchemaVersion: ExperienceStableIdSchema,
    requiredCapabilities: z.array(ExperienceStableIdSchema).default([]),
    outcomes: z.array(ExperienceRendererOutcomeSchema).default([]),
    commands: z.array(ExperienceRendererCommandSchema).default([]),
  })
  .strict();

const AccessibleFallbackSchema = z
  .object({
    rendererId: ExperienceStableIdSchema,
    config: ExperienceJsonObjectSchema,
  })
  .strict();

/**
 * Widest stacking band a manifest may claim. Renderer overlays are painted with
 * `layer` as a raw CSS `zIndex`, so player chrome that must stay above ANY
 * renderer (rather than above the layers our own compiler happens to emit) has
 * to stack against this bound rather than a hand-picked number.
 */
export const EXPERIENCE_RENDERER_MAX_LAYER = 10_000;

export const ExperienceRendererInstanceSchema = z
  .object({
    instanceId: ExperienceStableIdSchema,
    rendererId: ExperienceStableIdSchema,
    layer: z.number().int().min(-EXPERIENCE_RENDERER_MAX_LAYER).max(EXPERIENCE_RENDERER_MAX_LAYER),
    config: ExperienceJsonObjectSchema,
    bindings: z.record(ExperienceStableIdSchema, ExperienceValueExpressionSchema).default({}),
    visibleWhen: ExperienceConditionSchema.optional(),
    anchorId: ExperienceStableIdSchema.optional(),
    accessibleFallback: AccessibleFallbackSchema.optional(),
  })
  .strict();

export type ExperienceRendererRequirement = z.infer<typeof ExperienceRendererRequirementSchema>;
export type ExperienceRendererInstance = z.infer<typeof ExperienceRendererInstanceSchema>;
