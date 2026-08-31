import { z } from "zod";
import {
  ExperienceJsonObjectSchema,
  ExperienceStableIdSchema,
  type ExperienceJsonObject,
} from "./common.js";

const ExperienceDisplayTextSchema = z.string().trim().min(1).max(240);

const ExperienceHttpUrlSchema = z.url().superRefine((value, context) => {
  const protocol = new URL(value).protocol;
  if (protocol === "http:" || protocol === "https:") return;
  context.addIssue({
    code: "custom",
    message: "Release URLs must use HTTP or HTTPS",
  });
});

// Decorative catalogue fields must NEVER drop a game: Java sends explicit
// null (no cover / no subtitle) and occasionally a malformed value. A valid
// value is kept; anything else (null, missing, bad URL, blank) collapses to
// undefined so the game still lists/plays — just without that decoration.
const ExperienceOptionalCoverUrlSchema = z
  .any()
  .transform((value) => {
    const parsed = ExperienceHttpUrlSchema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
  })
  .optional();
const ExperienceOptionalSubtitleSchema = z
  .any()
  .transform((value) => {
    const parsed = ExperienceDisplayTextSchema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
  })
  .optional();

export const ExperienceReleaseStatusSchema = z.enum(["published", "draft"]);

/**
 * Exact POST {prefix}/releases transport. Java intentionally treats manifest
 * as opaque JSON and must persist the received value without materializing,
 * normalizing, or semantically interpreting it.
 */
export const ExperienceReleaseRequestSchema = z
  .object({
    gameId: ExperienceStableIdSchema,
    contentVersion: ExperienceStableIdSchema,
    title: ExperienceDisplayTextSchema.optional(),
    // The OUTBOUND publish request is fully under our control — no null
    // tolerance needed. Keep these plain-optional so the publisher may omit
    // them (the read schemas below use the null-tolerant transform, which is
    // only safe on the consume side).
    subtitle: ExperienceDisplayTextSchema.optional(),
    coverUrl: ExperienceHttpUrlSchema.optional(),
    manifest: ExperienceJsonObjectSchema,
    status: ExperienceReleaseStatusSchema,
    setCurrent: z.boolean().optional(),
  })
  .strict();

export const ExperienceReleaseResponseSchema = z
  .object({
    gameId: ExperienceStableIdSchema,
    contentVersion: ExperienceStableIdSchema,
    status: ExperienceReleaseStatusSchema,
    manifestUrl: ExperienceHttpUrlSchema,
  })
  .strict();

export const ExperienceGameSummarySchema = z
  .object({
    gameId: ExperienceStableIdSchema,
    title: ExperienceDisplayTextSchema,
    subtitle: ExperienceOptionalSubtitleSchema,
    coverUrl: ExperienceOptionalCoverUrlSchema,
    currentVersion: ExperienceStableIdSchema,
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const ExperienceGameListResponseSchema = z.array(ExperienceGameSummarySchema);

export const ExperienceGameDetailResponseSchema = z
  .object({
    gameId: ExperienceStableIdSchema,
    title: ExperienceDisplayTextSchema,
    coverUrl: ExperienceOptionalCoverUrlSchema,
    currentVersion: ExperienceStableIdSchema,
    manifestUrl: ExperienceHttpUrlSchema,
  })
  .strict();

export type ExperienceReleaseStatus = z.infer<typeof ExperienceReleaseStatusSchema>;
export type ExperienceReleaseRequest = Omit<
  z.infer<typeof ExperienceReleaseRequestSchema>,
  "manifest"
> & {
  manifest: ExperienceJsonObject;
};
export type ExperienceReleaseResponse = z.infer<typeof ExperienceReleaseResponseSchema>;
export type ExperienceGameSummary = z.infer<typeof ExperienceGameSummarySchema>;
export type ExperienceGameListResponse = z.infer<typeof ExperienceGameListResponseSchema>;
export type ExperienceGameDetailResponse = z.infer<typeof ExperienceGameDetailResponseSchema>;
