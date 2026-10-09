import { z } from "zod";
import { ExperienceUIPresentationSchema } from "./ui.js";

export const ExperienceAppearanceSchema = z
  .object({
    version: z.literal(1),
    presentation: ExperienceUIPresentationSchema.optional(),
  })
  .strict();
export type ExperienceAppearance = z.infer<typeof ExperienceAppearanceSchema>;
export const DEFAULT_EXPERIENCE_APPEARANCE: ExperienceAppearance = { version: 1 };
