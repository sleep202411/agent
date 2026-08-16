import { z } from "zod";

/**
 * Provider-neutral contracts for realtime world models.
 *
 * A world model is not an image/video generation job: a durable World is
 * entered through a short-lived Session, producing a realtime Travel that can
 * later expose replay Artifacts. Provider adapters translate these concepts to
 * vendor endpoints; product code must never depend on those endpoint names.
 */

export const FAL_HAPPY_OYSTER_PROVIDER_KEY = "fal:happy-oyster" as const;
export const WorldModelProviderKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9-]+:[a-z0-9-]+$/);
export type WorldModelProviderKey = z.infer<typeof WorldModelProviderKeySchema>;

export const WorldModelStatusSchema = z.enum(["generating", "ready", "failed"]);
export type WorldModelStatus = z.infer<typeof WorldModelStatusSchema>;

export const WorldTravelStatusSchema = z.enum([
  "init",
  "pending",
  "running",
  "failed",
  "completed",
]);
export type WorldTravelStatus = z.infer<typeof WorldTravelStatusSchema>;

export const WorldStreamStatusSchema = z.enum([
  "DISCONNECTED",
  "CONNECTING",
  "CONNECTED",
  "PLAYING",
  "BUFFERING",
  "PAUSED",
  "RECONNECTING",
]);
export type WorldStreamStatus = z.infer<typeof WorldStreamStatusSchema>;

export const WorldReferenceSchema = z
  .object({
    firstFrameUrl: z.url().optional(),
    imageUrls: z.array(z.url()).max(10).default([]),
  })
  .strict();
export type WorldReference = z.infer<typeof WorldReferenceSchema>;

const WorldCreateBaseSchema = z.object({
  providerKey: WorldModelProviderKeySchema.default(FAL_HAPPY_OYSTER_PROVIDER_KEY),
  prompt: z.string().trim().min(1).max(20_000),
  eventStyle: z.enum(["normal", "dramatic"]).default("normal"),
  reference: WorldReferenceSchema.default({ imageUrls: [] }),
});

export const CreateWorldRequestSchema = WorldCreateBaseSchema.extend({
  mode: z.literal("adventure"),
  perspective: z.enum(["first_person", "third_person"]),
}).strict();
export type CreateWorldRequest = z.infer<typeof CreateWorldRequestSchema>;

export const WorldModelWorldSchema = z
  .object({
    id: z.uuid(),
    storyProjectId: z.uuid(),
    providerKey: WorldModelProviderKeySchema,
    mode: z.literal("adventure"),
    status: WorldModelStatusSchema,
    name: z.string().nullable(),
    prompt: z.string(),
    firstFrameUrl: z.url().nullable(),
    error: z.object({ code: z.string(), message: z.string() }).strict().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type WorldModelWorld = z.infer<typeof WorldModelWorldSchema>;

export const CreateWorldSessionRequestSchema = z
  .object({
    tokenSeconds: z.int().min(30).max(1_800).default(60),
    maxExperienceSeconds: z.union([z.literal(60), z.literal(90), z.literal(120)]).optional(),
  })
  .strict();
export type CreateWorldSessionRequest = z.infer<typeof CreateWorldSessionRequestSchema>;

export const WorldSessionConnectionSchema = z
  .object({
    apiBaseUrl: z.url(),
    ticket: z.string().min(1),
    token: z.string().min(1),
    tokenExpiresIn: z.number().positive(),
  })
  .strict();
export type WorldSessionConnection = z.infer<typeof WorldSessionConnectionSchema>;

export const WorldSessionSchema = z
  .object({
    id: z.uuid(),
    worldId: z.uuid(),
    providerKey: WorldModelProviderKeySchema,
    heartbeatIntervalSeconds: z.number().positive(),
    sessionTimeoutSeconds: z.number().positive(),
    maxExperienceSeconds: z.union([z.literal(60), z.literal(90), z.literal(120)]).nullable(),
    connection: WorldSessionConnectionSchema,
  })
  .strict();
export type WorldSession = z.infer<typeof WorldSessionSchema>;

export const BindWorldTravelRequestSchema = z
  .object({ providerTravelId: z.string().trim().min(1).max(2_048) })
  .strict();
export type BindWorldTravelRequest = z.infer<typeof BindWorldTravelRequestSchema>;

export const BoundWorldTravelSchema = z
  .object({
    id: z.uuid(),
    sessionId: z.uuid(),
    worldId: z.uuid(),
    status: WorldTravelStatusSchema,
  })
  .strict();
export type BoundWorldTravel = z.infer<typeof BoundWorldTravelSchema>;

export const WorldSessionHeartbeatSchema = z
  .object({ alive: z.boolean(), heartbeatIntervalSeconds: z.number().positive() })
  .strict();
export type WorldSessionHeartbeat = z.infer<typeof WorldSessionHeartbeatSchema>;

export const ReportWorldTravelStatusRequestSchema = z
  .object({
    streamStatus: WorldStreamStatusSchema.optional(),
    streamStatusChangedAtMs: z.int().nonnegative().optional(),
  })
  .strict()
  .refine(
    (value) => value.streamStatusChangedAtMs === undefined || value.streamStatus !== undefined,
    {
      message: "streamStatus is required when streamStatusChangedAtMs is provided.",
      path: ["streamStatus"],
    }
  );
export type ReportWorldTravelStatusRequest = z.infer<typeof ReportWorldTravelStatusRequestSchema>;

export const RefreshWorldSessionTokenRequestSchema = z
  .object({ tokenSeconds: z.int().min(30).max(1_800).default(60) })
  .strict();
export type RefreshWorldSessionTokenRequest = z.infer<typeof RefreshWorldSessionTokenRequestSchema>;

export const RefreshWorldSessionTokenResponseSchema = z
  .object({
    token: z.string().min(1),
    tokenExpiresIn: z.number().positive(),
    apiBaseUrl: z.url(),
  })
  .strict();
export type RefreshWorldSessionTokenResponse = z.infer<
  typeof RefreshWorldSessionTokenResponseSchema
>;

export const CloseWorldSessionRequestSchema = z
  .object({ travelCompleted: z.boolean().default(false) })
  .strict();
export type CloseWorldSessionRequest = z.infer<typeof CloseWorldSessionRequestSchema>;

export const WorldTravelStatusResponseSchema = z
  .object({
    id: z.uuid(),
    worldId: z.uuid(),
    status: WorldTravelStatusSchema,
    rtcStatus: z.string().nullable(),
    updatedAt: z.string().nullable(),
  })
  .strict();
export type WorldTravelStatusResponse = z.infer<typeof WorldTravelStatusResponseSchema>;

export const WorldReplayVariantSchema = z
  .object({
    url: z.url(),
    status: z.string(),
    resolution: z.string().nullable(),
  })
  .strict();

export const WorldTravelArtifactsSchema = z
  .object({
    travelId: z.uuid(),
    composeStatus: z.enum(["ready", "partial", "processing"]),
    video: z.record(z.string(), WorldReplayVariantSchema).nullable(),
  })
  .strict();
export type WorldTravelArtifacts = z.infer<typeof WorldTravelArtifactsSchema>;

export const WorldModelCapabilitiesSchema = z
  .object({
    providerKey: WorldModelProviderKeySchema,
    displayName: z.string(),
    perspectives: z.array(z.enum(["first_person", "third_person"])),
    maxAdventureSeconds: z.array(z.union([z.literal(60), z.literal(90), z.literal(120)])),
    supportsRealtimeAudio: z.boolean(),
    supportsMovementCommands: z.boolean(),
    available: z.boolean(),
  })
  .strict();
export type WorldModelCapabilities = z.infer<typeof WorldModelCapabilitiesSchema>;
