import { z } from "zod";
import { ContentGpsPointSchema, ContentGpsSearchRequestSchema } from "./content-gps.js";
import { SERVICE_CATEGORIES } from "./creator-service.js";

// Owner-declared service geography, separate from an IP's story location.
// This contract accepts city names only; provider coordinates are host-owned.
export const CreatorCitySchema = z
  .object({
    countryCode: z.string().regex(/^[A-Z]{2}$/),
    city: z.string().trim().min(1).max(150),
  })
  .strict();

export const CreatorLocationProfileSchema = z
  .object({
    basedIn: CreatorCitySchema.nullable(),
    serves: z.array(CreatorCitySchema).max(30),
    remote: z.boolean(),
    showOnMap: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.showOnMap && !value.basedIn)
      context.addIssue({
        code: "custom",
        path: ["basedIn"],
        message: "A studio city is required to appear on the map.",
      });
    const keys = value.serves.map(
      (place) => `${place.countryCode}:${place.city.normalize("NFKC").toLowerCase()}`
    );
    if (new Set(keys).size !== keys.length)
      context.addIssue({
        code: "custom",
        path: ["serves"],
        message: "Service cities must be unique.",
      });
  });

export const SaveCreatorLocationProfileSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedVersion: z.number().int().min(0).max(2147483646),
    profile: CreatorLocationProfileSchema,
  })
  .strict();

export type CreatorLocationProfile = z.infer<typeof CreatorLocationProfileSchema>;
export type SaveCreatorLocationProfile = z.infer<typeof SaveCreatorLocationProfileSchema>;

export const CreatorDiscoveryQuerySchema = z.strictObject({
  /** Virtual community group, never a geographic city or coordinate. */
  islandOnly: z.boolean().optional(),
  basedIn: CreatorCitySchema.nullable(),
  serves: CreatorCitySchema.nullable(),
  remoteOnly: z.boolean(),
  availableForWork: z.boolean(),
  category: z.enum(SERVICE_CATEGORIES).nullable(),
  text: z.string().trim().max(120),
});
export const CreatorDiscoveryRequestSchema = z.strictObject({
  requestId: z.uuid(),
  query: CreatorDiscoveryQuerySchema,
  limit: z.number().int().min(1).max(50).default(20),
  cursor: z
    .strictObject({
      afterId: z.string().min(1).max(64),
      queryId: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .nullable()
    .default(null),
  selectedCreatorId: z.string().min(1).max(64).nullable().default(null),
  map: ContentGpsSearchRequestSchema.shape.map.nullable().default(null),
});
export const CreatorDiscoveryCardSchema = z.strictObject({
  id: z.string().min(1).max(64),
  name: z.string(),
  avatarUrl: z.string(),
  openToWork: z.boolean(),
  matched: z.boolean(),
  basedIn: CreatorCitySchema.nullable(),
  serves: z.array(CreatorCitySchema).max(30),
  remote: z.boolean(),
  showOnMap: z.boolean(),
  point: ContentGpsPointSchema.extend({ precision: z.literal("city") }).nullable(),
  serviceCount: z.number().int().nonnegative(),
  matchingServiceCount: z.number().int().nonnegative(),
});
export const CreatorDiscoveryResultSchema = z.strictObject({
  requestId: z.uuid(),
  queryId: z.string().regex(/^[a-f0-9]{64}$/),
  query: CreatorDiscoveryQuerySchema,
  items: z.array(CreatorDiscoveryCardSchema).max(50),
  selected: CreatorDiscoveryCardSchema.nullable(),
  nextCursor: CreatorDiscoveryRequestSchema.shape.cursor,
  matchedCount: z.number().int().nonnegative().safe(),
  accessibleCount: z.number().int().nonnegative().safe(),
  requiresLogin: z.boolean(),
  island: z.strictObject({
    creatorCount: z.number().int().nonnegative().safe(),
    matchedCreatorCount: z.number().int().nonnegative().safe(),
  }),
  countScope: z.enum(["public_platform_creators_with_listed_services", "public_platform_creators"]),
  map: z
    .strictObject({
      viewport: ContentGpsSearchRequestSchema.shape.map,
      creatorCount: z.number().int().nonnegative().safe(),
      matchedCreatorCount: z.number().int().nonnegative().safe(),
      clusters: z
        .array(
          z.strictObject({
            cell: z.string(),
            matched: z.boolean(),
            count: z.number().int().positive(),
            creatorId: z.string().min(1).max(64).nullable(),
            latitude: z.number().min(-90).max(90),
            longitude: z.number().min(-180).max(180),
          })
        )
        .max(400),
      scope: z.literal("visible_creator_results"),
    })
    .nullable(),
});
export type CreatorDiscoveryRequest = z.infer<typeof CreatorDiscoveryRequestSchema>;
export type CreatorDiscoveryResult = z.infer<typeof CreatorDiscoveryResultSchema>;

export const CreatorGeocodeStateSchema = z
  .strictObject({
    version: z.number().int().nonnegative(),
    attemptId: z.uuid().nullable(),
    state: z.enum([
      "ineligible",
      "disabled",
      "missing",
      "expired",
      "dispatched",
      "uncertain",
      "resolved",
      "unresolved",
      "ambiguous",
    ]),
    point: ContentGpsPointSchema.extend({ precision: z.literal("city") }).nullable(),
  })
  .refine((value) => (value.state === "resolved") === (value.point !== null));
export type CreatorGeocodeState = z.infer<typeof CreatorGeocodeStateSchema>;

/** Public contributor relationships, independent of story-location coordinates. */
export const IpStudioRequestSchema = z.strictObject({
  requestId: z.uuid(),
  ipId: z.uuid(),
  locale: z.enum(["en-US", "zh-CN", "zh-HK"]),
  limit: z.number().int().min(1).max(50).default(20),
  cursor: CreatorDiscoveryRequestSchema.shape.cursor,
});
export const IpStudioResultSchema = z.strictObject({
  requestId: z.uuid(),
  ipId: z.uuid(),
  locale: IpStudioRequestSchema.shape.locale,
  queryId: z.string().regex(/^[a-f0-9]{64}$/),
  items: z
    .array(
      z.strictObject({
        studio: CreatorDiscoveryCardSchema,
        roles: z.array(z.strictObject({ role: z.string(), customRole: z.string().nullable() })),
      })
    )
    .max(50),
  nextCursor: IpStudioRequestSchema.shape.cursor,
  requiresLogin: z.boolean(),
});
export type IpStudioRequest = z.infer<typeof IpStudioRequestSchema>;
export type IpStudioResult = z.infer<typeof IpStudioResultSchema>;
