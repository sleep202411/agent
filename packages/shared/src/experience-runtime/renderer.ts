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

export const ExperienceRendererInstanceSchema = z
  .object({
    instanceId: ExperienceStableIdSchema,
    rendererId: ExperienceStableIdSchema,
    layer: z.number().int().min(-10_000).max(10_000),
    config: ExperienceJsonObjectSchema,
    bindings: z.record(ExperienceStableIdSchema, ExperienceValueExpressionSchema).default({}),
    visibleWhen: ExperienceConditionSchema.optional(),
    anchorId: ExperienceStableIdSchema.optional(),
    accessibleFallback: AccessibleFallbackSchema.optional(),
  })
  .strict();

export type ExperienceRendererRequirement = z.infer<typeof ExperienceRendererRequirementSchema>;
export type ExperienceRendererInstance = z.infer<typeof ExperienceRendererInstanceSchema>;
