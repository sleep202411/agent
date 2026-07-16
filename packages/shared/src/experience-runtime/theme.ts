import { z } from "zod";
import { ExperienceStableIdSchema } from "./common.js";

export const ExperienceThemeReferenceSchema = z
  .object({
    themeId: ExperienceStableIdSchema,
    apiVersion: ExperienceStableIdSchema,
    configAssetId: ExperienceStableIdSchema,
  })
  .strict();
export type ExperienceThemeReference = z.infer<typeof ExperienceThemeReferenceSchema>;
