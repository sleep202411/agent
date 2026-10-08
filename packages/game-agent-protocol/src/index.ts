import { z } from "zod";
import { GameUIProjectSchema } from "@repo/shared/experience-runtime";

export { ExperienceUIPresentationSchema as AppearancePresentationSchema } from "@repo/shared/experience-runtime";
import { ExperienceUIPresentationSchema as AppearancePresentationSchema } from "@repo/shared/experience-runtime";

export type AppearancePresentation = z.infer<typeof AppearancePresentationSchema>;

export { ExperienceAppearanceSchema as AppearanceStateSchema } from "@repo/shared/experience-runtime";
import { ExperienceAppearanceSchema as AppearanceStateSchema } from "@repo/shared/experience-runtime";
export type AppearanceState = z.infer<typeof AppearanceStateSchema>;

export const AppearanceDesignRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    prompt: z.string().trim().min(1).max(2000),
    locale: z.enum(["en-US", "zh-CN", "zh-HK"]),
    appearance: AppearanceStateSchema,
    gameUi: GameUIProjectSchema.nullable().optional(),
    // Context is explicitly supplied data, never a path for the executor to read.
    context: z
      .object({
        title: z.string().max(200),
        choiceLabels: z.array(z.string().max(500)).max(12),
      })
      .strict(),
    history: z
      .array(
        z
          .object({
            role: z.enum(["user", "assistant"]),
            text: z.string().max(2000),
          })
          .strict()
      )
      .max(12),
  })
  .strict();
export type AppearanceDesignRequest = z.infer<typeof AppearanceDesignRequestSchema>;

export const AppearanceDesignResultSchema = z
  .object({
    requestId: z.string().uuid(),
    appearance: AppearanceStateSchema,
    gameUi: GameUIProjectSchema.nullable().optional(),
    message: z.string().trim().min(1).max(2000),
  })
  .strict()
  .refine(
    (result) => result.gameUi !== undefined || result.appearance.presentation !== undefined,
    "A design result must contain an appearance presentation or game UI source."
  );
export type AppearanceDesignResult = z.infer<typeof AppearanceDesignResultSchema>;

/** Browser requests never choose the actor, project, parent origin or filesystem. */
export const AppearanceWebActionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("open"),
      key: z.string().uuid(),
      leaseId: z.string().uuid(),
      request: AppearanceDesignRequestSchema,
      draft: z.string().max(2000),
    })
    .strict(),
  z.object({ action: z.literal("poll"), id: z.string().uuid() }).strict(),
  z
    .object({ action: z.literal("close"), id: z.string().uuid(), leaseId: z.string().uuid() })
    .strict(),
]);
export type AppearanceWebAction = z.infer<typeof AppearanceWebActionSchema>;

/** Supplied by the authenticated control plane, never accepted from a browser. */
export const AppearanceWebScopeSchema = z
  .object({
    userId: z.string().regex(/^[A-Za-z0-9:_-]{1,128}$/),
    projectId: z.string().uuid(),
  })
  .strict();
export type AppearanceWebScope = z.infer<typeof AppearanceWebScopeSchema>;

export const AppearanceWebOpenResultSchema = z
  .object({
    id: z.string().uuid(),
    requestId: z.string().uuid(),
    leaseId: z.string().uuid(),
    // Worker returns a relative sentinel; only Server constructs the browser mount.
    url: z.string().min(1).max(2048),
  })
  .strict();
export const AppearanceWebPollResultSchema = z
  .object({ result: AppearanceDesignResultSchema.nullable() })
  .strict();
export const AppearanceWebCloseResultSchema = z.object({ closed: z.boolean() }).strict();
