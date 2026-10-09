import { z } from "zod";

/** Content GPS contracts. These schemas do not activate extraction or backfill.
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

/** Normalized search input. Callers resolve defaults before validation;
 * matching/ranking belongs to the catalogue service.
 */
export const ContentGpsQuerySchema = z.strictObject({
  schemaVersion: z.literal(1),
  locale: z.enum(["en-US", "zh-CN", "zh-HK"]),
  location: z
    .strictObject({
      kind: z.enum(["story_setting", "production_origin"]),
      // Opaque catalogue place keys returned by search facets. A label key
      // identifies a declared place name, not a verified administrative boundary.
      placeIds: z.array(z.string().trim().min(1).max(310)).min(1).max(8),
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
  genreCodes: z.array(Id).max(8),
  moodPreferences: z.array(z.string().trim().min(1).max(100)).max(8),
});
export const ContentGpsSearchRequestSchema = z.strictObject({
  requestId: z.uuid(),
  query: ContentGpsQuerySchema,
  cursor: z
    .strictObject({ afterId: z.uuid(), queryId: z.string().regex(/^[a-f0-9]{64}$/) })
    .nullable()
    .default(null),
  limit: z.number().int().min(1).max(50).default(20),
  selectedIpId: z.uuid().nullable().default(null),
  placeSearch: z.string().trim().max(100).default(""),
  // Display scope only. Moving the map does not change the matching criteria.
  map: z
    .strictObject({
      coordinateSystem: z.enum(["WGS84", "GCJ02"]),
      west: z.number().min(-180).max(180),
      east: z.number().min(-180).max(180),
      south: z.number().min(-90).max(90),
      north: z.number().min(-90).max(90),
    })
    .refine((v) => v.south < v.north && v.west !== v.east, "Empty map viewport"),
});
export type ContentGpsSearchRequest = z.infer<typeof ContentGpsSearchRequestSchema>;
const SearchCount = z.number().int().nonnegative().safe();
export const ContentGpsSearchCardSchema = z.strictObject({
  id: z.uuid(),
  creatorId: Id,
  title: z.string(),
  roomNumber: z.string().regex(/^[0-9]{1,19}$/),
  summary: z.string(),
  coverUrl: z.string().nullable(),
  matched: z.boolean(),
  locationSource: z.enum(["owner", "analysis", "unknown"]),
  locations: z
    .array(
      z.strictObject({
        id: Id,
        placeId: z.string().max(310),
        kind: z.enum(["story_setting", "production_origin"]),
        label: z.string().max(300),
        status: z.enum(["resolved", "unresolved", "ambiguous", "fictional"]),
        point: ContentGpsPointSchema.omit({ provider: true, providerPlaceId: true })
          .extend({
            provider: Id.optional(),
            providerPlaceId: Id.nullable().optional(),
          })
          .nullable(),
      })
    )
    .max(100),
  eras: z
    .array(
      z.strictObject({
        calendar: z.literal("proleptic_gregorian_astronomical"),
        startYear: z.number().int().safe(),
        endYear: z.number().int().safe(),
      })
    )
    .max(100),
  // A public episode satisfying the duration condition; the IP list is not
  // expanded into one result per episode. Playback still checks existing rights.
  episode: z
    .strictObject({ id: z.uuid(), durationSeconds: z.number().int().nullable() })
    .nullable(),
});
export const ContentGpsSearchResultSchema = z.strictObject({
  requestId: z.uuid(),
  queryId: z.string().regex(/^[a-f0-9]{64}$/),
  query: ContentGpsQuerySchema,
  nextCursor: z
    .strictObject({ afterId: z.uuid(), queryId: z.string().regex(/^[a-f0-9]{64}$/) })
    .nullable(),
  items: z.array(ContentGpsSearchCardSchema).max(50),
  selected: ContentGpsSearchCardSchema.nullable(),
  matchedCount: SearchCount,
  accessibleCount: SearchCount,
  countScope: z.literal("accessible_ips_with_published_translation"),
  mapScope: ContentGpsSearchRequestSchema.shape.map,
  mapIpCount: SearchCount,
  mapMatchedIpCount: SearchCount,
  places: z
    .array(
      z.strictObject({
        id: z.string().max(310),
        kind: z.enum(["story_setting", "production_origin"]),
        label: z.string().max(300),
        ipCount: SearchCount,
      })
    )
    .max(500),
  placeCount: SearchCount,
  placesTruncated: z.boolean(),
  clusters: z
    .array(
      z.strictObject({
        cell: z.string(),
        matched: z.boolean(),
        pointCount: SearchCount,
        ipCount: SearchCount,
        ipId: z.uuid().nullable(),
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
      })
    )
    .max(400),
});
export type ContentGpsSearchResult = z.infer<typeof ContentGpsSearchResultSchema>;
/** Initial defaults approved by the user on 2026-10-01. */
export const CONTENT_GPS_SEARCH_DEFAULTS = {
  locationKind: "story_setting",
  eraRelation: "overlaps",
  durationUnit: "episode",
  unknownDuration: "exclude",
} as const;

export type ContentGpsMetadata = z.infer<typeof ContentGpsMetadataSchema>;
export type ContentGpsQuery = z.infer<typeof ContentGpsQuerySchema>;

/** Worker boundary: callers supply authorized, versioned source text. No source
 * URL is fetched by the worker, and this assertion does not grant public access. */
export const ContentGpsExtractionRequestSchema = z
  .strictObject({
    ipId: z.uuid(),
    locale: z.enum(["en-US", "zh-CN", "zh-HK"]),
    analysisVersion: Id,
    analyzedAt: z.iso.datetime(),
    sources: z
      .array(
        ContentGpsEvidenceSchema.extend({
          sourceType: z.enum(["ip_localization", "episode_localization"]),
          visibilityAtAnalysis: z.literal("public"),
          text: z.string().min(1).max(20000),
        })
      )
      .max(100),
  })
  .superRefine((request, ctx) => {
    if (new Set(request.sources.map((source) => source.id)).size !== request.sources.length)
      ctx.addIssue({ code: "custom", path: ["sources"], message: "Duplicate source IDs" });
    if (request.sources.reduce((length, source) => length + source.text.length, 0) > 60000)
      ctx.addIssue({
        code: "custom",
        path: ["sources"],
        message: "Source text exceeds extraction limit",
      });
  });
const ExtractionCitation = z.strictObject({
  sourceId: Id,
  start: z.number().int().nonnegative().safe(),
  end: z.number().int().positive().safe(),
  text: z.string().min(1).max(20000),
});
/** The model can identify places, never choose coordinates, IDs or review state. */
export const ContentGpsExtractionClaimsSchema = z.strictObject({
  locations: z
    .array(
      z.strictObject({
        kind: z.enum(["story_setting", "production_origin"]),
        label: z.string().trim().min(1).max(300),
        status: z.enum(["unresolved", "ambiguous", "fictional"]),
        citations: z.array(ExtractionCitation).min(1).max(20),
      })
    )
    .max(100),
  eras: z
    .array(
      z
        .strictObject({
          calendar: z.literal("proleptic_gregorian_astronomical"),
          startYear: z.number().int().safe(),
          endYear: z.number().int().safe(),
          citations: z.array(ExtractionCitation).min(1).max(20),
        })
        .refine((era) => era.startYear <= era.endYear, "Reversed era interval")
    )
    .max(100),
});
export type ContentGpsExtractionRequest = z.infer<typeof ContentGpsExtractionRequestSchema>;

/** Owner-only suggestion projection. Quotes are re-derived from the current
 * authorized public source snapshot; this is never a public search payload. */
export const ContentGpsOwnerSuggestionsSchema = z.strictObject({
  state: z.enum(["ready", "missing", "ineligible", "unconfigured"]),
  analysisVersion: Id.nullable(),
  analyzedAt: z.iso.datetime().nullable(),
  ownerVersion: z.number().int().nonnegative(),
  locations: z
    .array(
      z
        .strictObject({
          id: Id,
          kind: z.enum(["story_setting", "production_origin"]),
          label: z.string().min(1).max(300),
          status: z.enum(["resolved", "unresolved", "ambiguous", "fictional"]),
          point: ContentGpsPointSchema.nullable(),
          evidence: z
            .array(
              z.strictObject({
                sourceType: z.enum(["ip_localization", "episode_localization"]),
                field: z.enum(["summary", "description"]),
                quote: z.string().min(1).max(20000),
              })
            )
            .min(1)
            .max(20),
        })
        .refine(
          (value) => (value.status === "resolved") === (value.point !== null),
          "Coordinates require a resolved location"
        )
    )
    .max(100),
});
export type ContentGpsOwnerSuggestions = z.infer<typeof ContentGpsOwnerSuggestionsSchema>;
