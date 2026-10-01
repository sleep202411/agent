import { z } from "zod";

/** Preparatory contracts only: no active API, extraction, policy defaults or backfill.
 * Evidence IDs are internal references, never permission to expose source material.
 * Consumers must enforce live publication/access and provider usage constraints.
 */
const Id = z.string().trim().min(1).max(200);
const EvidenceIds = z
  .array(Id)
  .min(1)
  .refine((ids) => new Set(ids).size === ids.length, "Duplicate evidence references");
export const ContentGpsPointSchema = z.strictObject({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  coordinateSystem: z.enum(["WGS84", "GCJ02"]),
  precision: z.enum(["country", "region", "city", "place"]),
  provider: Id,
  providerPlaceId: Id.nullable(),
});
const LocationBase = {
  id: Id,
  kind: z.enum(["story_setting", "production_origin"]),
  label: z.string().trim().min(1).max(300),
  evidenceIds: EvidenceIds,
};
export const ContentGpsLocationSchema = z.discriminatedUnion("status", [
  z.strictObject({ ...LocationBase, status: z.literal("resolved"), point: ContentGpsPointSchema }),
  z.strictObject({
    ...LocationBase,
    status: z.enum(["ambiguous", "fictional", "unresolved"]),
    point: z.null(),
  }),
]);
export const ContentGpsEraSchema = z
  .strictObject({
    // Explicit chronology avoids silently deciding historical year-zero conventions.
    calendar: z.literal("proleptic_gregorian_astronomical"),
    startYear: z.number().int().safe(),
    endYear: z.number().int().safe(),
    evidenceIds: EvidenceIds,
  })
  .refine((era) => era.startYear <= era.endYear, {
    message: "Reversed era interval",
    path: ["endYear"],
  });
export const ContentGpsEvidenceSchema = z.strictObject({
  id: Id,
  sourceType: z.enum([
    "ip_localization",
    "episode_localization",
    "authorized_document",
    "manual_correction",
  ]),
  sourceId: Id,
  sourceVersion: Id,
  locator: z.string().trim().min(1).max(500),
  // This records provenance, not an authorization grant. Recheck before display.
  visibilityAtAnalysis: z.enum(["public", "restricted"]),
});
export const ContentGpsMetadataSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    ipId: z.uuid(),
    sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    analysisVersion: Id,
    analyzedAt: z.iso.datetime(),
    locationCoverage: z.enum(["identified", "unknown"]),
    locations: z.array(ContentGpsLocationSchema),
    eras: z.array(ContentGpsEraSchema),
    evidence: z.array(ContentGpsEvidenceSchema),
    review: z.discriminatedUnion("status", [
      z.strictObject({ status: z.literal("unreviewed") }),
      z.strictObject({
        status: z.enum(["confirmed", "corrected"]),
        reviewerId: Id,
        reviewedAt: z.iso.datetime(),
      }),
    ]),
  })
  .superRefine((data, ctx) => {
    if ((data.locationCoverage === "identified") !== data.locations.length > 0)
      ctx.addIssue({
        code: "custom",
        path: ["locationCoverage"],
        message: "Coverage must agree with identified locations",
      });
    for (const key of ["locations", "evidence"] as const) {
      const ids = data[key].map((item) => item.id);
      if (new Set(ids).size !== ids.length)
        ctx.addIssue({ code: "custom", path: [key], message: "Duplicate IDs" });
    }
    const known = new Set(data.evidence.map((item) => item.id));
    for (const key of ["locations", "eras"] as const)
      data[key].forEach((item, index) => {
        if (item.evidenceIds.some((id) => !known.has(id)))
          ctx.addIssue({
            code: "custom",
            path: [key, index, "evidenceIds"],
            message: "Missing source evidence",
          });
      });
  });

/** Draft search input. Callers must supply product semantics explicitly;
 * this schema neither approves those choices nor implements matching/ranking.
 */
export const ContentGpsQuerySchema = z.strictObject({
  schemaVersion: z.literal(1),
  locale: z.enum(["en-US", "zh-CN", "zh-HK"]),
  location: z
    .strictObject({
      kind: z.enum(["story_setting", "production_origin"]),
      placeIds: z.array(Id).min(1),
      relation: z.enum(["any", "all"]),
    })
    .nullable(),
  era: z
    .strictObject({
      calendar: z.literal("proleptic_gregorian_astronomical"),
      startYear: z.number().int().safe(),
      endYear: z.number().int().safe(),
      relation: z.enum(["overlaps", "contained"]),
    })
    .refine((value) => value.startYear <= value.endYear, "Reversed era interval")
    .nullable(),
  duration: z
    .strictObject({
      unit: z.enum(["film", "episode"]),
      maxSeconds: z.number().int().positive().safe(),
      unknown: z.enum(["exclude", "include_labelled"]),
    })
    .nullable(),
  genreCodes: z.array(Id),
  moodPreferences: z.array(z.string().trim().min(1).max(100)),
});
export type ContentGpsMetadata = z.infer<typeof ContentGpsMetadataSchema>;
export type ContentGpsQuery = z.infer<typeof ContentGpsQuerySchema>;
