import { z } from "zod";
import { ExperienceJsonObjectSchema, ExperienceStableIdSchema } from "./common.js";

export const ExperienceThemeReferenceSchema = z
  .object({
    themeId: ExperienceStableIdSchema,
    apiVersion: ExperienceStableIdSchema,
    configAssetId: ExperienceStableIdSchema,
  })
  .strict();
export type ExperienceThemeReference = z.infer<typeof ExperienceThemeReferenceSchema>;

const ExperienceThemeTokenValueSchema = z.union([z.string().trim().min(1), z.number().finite()]);

/** Declarative theme payload loaded through the manifest's immutable data asset. */
export const ExperienceThemeConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    colorScheme: z.enum(["light", "dark"]),
    tokens: z.record(ExperienceStableIdSchema, ExperienceThemeTokenValueSchema),
    rendererStyles: z.record(ExperienceStableIdSchema, ExperienceJsonObjectSchema).default({}),
    motion: z
      .object({
        reducedMotionBehavior: z.enum(["preserve", "minimize", "disable"]),
      })
      .strict(),
  })
  .strict();

export type ExperienceThemeConfig = z.infer<typeof ExperienceThemeConfigSchema>;
