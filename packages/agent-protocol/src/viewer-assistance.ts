import { z } from "zod";

/** Server-curated public metadata only; never production context or media URLs. */
export const ViewerAssistanceRequestSchema = z
  .object({
    preference: z.string().trim().min(1).max(1000),
    locale: z.enum(["en-US", "zh-CN", "zh-HK"]),
    candidates: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            title: z.string().max(240),
            summary: z.string().max(1500),
          })
          .strict()
      )
      .max(20),
  })
  .strict()
  .refine(
    (value) => new Set(value.candidates.map((row) => row.id)).size === value.candidates.length,
    "Duplicate candidate IDs"
  );

export const ViewerAssistanceResponseSchema = z
  .object({
    suggestions: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            reason: z.string().trim().min(1).max(400),
          })
          .strict()
      )
      .max(5),
  })
  .strict()
  .refine(
    (value) => new Set(value.suggestions.map((row) => row.id)).size === value.suggestions.length,
    "Duplicate suggestions"
  );
