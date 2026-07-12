import { z } from "zod";

export const JINLING_PLAYER_ORIGINS = ["weave", "kin", "medic"] as const;
export const JinlingPlayerOriginSchema = z.enum(JINLING_PLAYER_ORIGINS);
export type JinlingPlayerOrigin = z.infer<typeof JinlingPlayerOriginSchema>;

export const JINLING_PLAYER_TRAITS = ["heart", "careful", "quick"] as const;

export const JinlingPlayerTraitSchema = z.enum(JINLING_PLAYER_TRAITS);
export type JinlingPlayerTrait = z.infer<typeof JinlingPlayerTraitSchema>;

export const JinlingPlayerProfileSchema = z
  .object({
    displayName: z.string().trim().min(1),
    origin: JinlingPlayerOriginSchema,
    trait: JinlingPlayerTraitSchema,
  })
  .strict()
  .superRefine((profile, context) => {
    const characterCount = Array.from(profile.displayName).length;
    if (characterCount > 8) {
      context.addIssue({
        code: "custom",
        path: ["displayName"],
        message: "Player name must contain between 1 and 8 characters",
      });
    }
  });

export type JinlingPlayerProfile = z.infer<typeof JinlingPlayerProfileSchema>;

export const JINLING_ORIGIN_KEEPSAKE = {
  weave: "PROP-TOKEN-WEAVE",
  kin: "PROP-TOKEN-KIN",
  medic: "PROP-TOKEN-MEDIC",
} as const satisfies Record<JinlingPlayerProfile["origin"], string>;

export function keepsakeForJinlingProfile(profile: JinlingPlayerProfile): string {
  return JINLING_ORIGIN_KEEPSAKE[profile.origin];
}
