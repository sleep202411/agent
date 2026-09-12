import { z } from "zod";
import { ExperienceLocalizedTextSchema } from "./common.js";

/** A stable authored node purchase, independent of release version. */
export const ExperienceAccessRequirementSchema = z
  .object({
    key: z.string().min(1).max(512),
    communityPointPrice: z.number().int().positive().max(2_147_483_647),
    title: ExperienceLocalizedTextSchema,
  })
  .strict();
export type ExperienceAccessRequirement = z.infer<typeof ExperienceAccessRequirementSchema>;
export const EXPERIENCE_COMMUNITY_ACCESS_CAPABILITY = "commerce.community-points";
