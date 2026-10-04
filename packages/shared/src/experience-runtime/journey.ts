import { z } from "zod";
import { utf8ByteLength } from "../zod-serialized-size.js";
import { ExperienceStableIdSchema, type ExperienceJsonObject } from "./common.js";

export const EXPERIENCE_JOURNEY_MAX_NODES = 1_024;
export const EXPERIENCE_JOURNEY_MAX_EDGES = 4_096;
export const EXPERIENCE_JOURNEY_MAX_ANCHORS = 1_024;
export const EXPERIENCE_JOURNEY_MAX_DELTA_ANCHORS = 64;
export const EXPERIENCE_JOURNEY_MAX_ANCHOR_BYTES = 128 * 1_024;
export const EXPERIENCE_JOURNEY_MAX_BYTES = 8 * 1_024 * 1_024;
export const EXPERIENCE_JOURNEY_MAX_DELTA_BYTES = 512 * 1_024;

/** Validate raw JSON before any recursive parse or serialization. */
function boundedJson(value: unknown, maxBytes: number, maxValues = 20_000, maxDepth = 24): boolean {
  const ancestors = new Set<object>();
  const pending: { value: unknown; depth: number; exit?: boolean }[] = [{ value, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const item = pending.pop()!;
    if (item.exit) {
      ancestors.delete(item.value as object);
      continue;
    }
    if (++count > maxValues || item.depth > maxDepth) return false;
    const current = item.value;
    if (current === null || typeof current === "boolean") continue;
    if (typeof current === "number") {
      if (!Number.isFinite(current)) return false;
      continue;
    }
    if (typeof current === "string") {
      if (current.length > maxBytes) return false;
      continue;
    }
    if (typeof current !== "object" || ancestors.has(current)) return false;
    const prototype = Object.getPrototypeOf(current);
    if (!Array.isArray(current) && prototype !== Object.prototype && prototype !== null)
      return false;
    ancestors.add(current);
    pending.push({ value: current, depth: item.depth, exit: true });
    for (const entry of Array.isArray(current) ? current : Object.values(current)) {
      pending.push({ value: entry, depth: item.depth + 1 });
    }
  }
  return utf8ByteLength(JSON.stringify(value)) <= maxBytes;
}

const SnapshotObjectSchema = z.custom<ExperienceJsonObject>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    boundedJson(value, EXPERIENCE_JOURNEY_MAX_ANCHOR_BYTES),
  "Journey snapshot must be bounded, finite JSON."
);

export const ExperienceJourneyEdgeSchema = z.union([
  z
    .object({
      fromSceneId: ExperienceStableIdSchema,
      bindingId: ExperienceStableIdSchema,
      routeId: ExperienceStableIdSchema,
      toSceneId: ExperienceStableIdSchema,
    })
    .strict(),
  z
    .object({
      fromSceneId: ExperienceStableIdSchema,
      bindingId: ExperienceStableIdSchema,
      routeId: ExperienceStableIdSchema,
      toEndingId: ExperienceStableIdSchema,
    })
    .strict(),
]);

export const ExperienceJourneyAccessRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("node"), sceneId: ExperienceStableIdSchema }).strict(),
  z
    .object({
      kind: z.literal("route"),
      sceneId: ExperienceStableIdSchema,
      bindingId: ExperienceStableIdSchema,
      routeId: ExperienceStableIdSchema,
    })
    .strict(),
]);

export const ExperienceJourneyAccessRefsSchema = z
  .array(ExperienceJourneyAccessRefSchema)
  .max(EXPERIENCE_JOURNEY_MAX_EDGES)
  .refine(
    (refs) => utf8ByteLength(JSON.stringify(refs)) <= EXPERIENCE_JOURNEY_MAX_ANCHOR_BYTES,
    "Access boundaries exceed their data limit."
  );
export const ExperienceJourneyPathSchema = z
  .array(ExperienceJourneyEdgeSchema)
  .min(1)
  .max(EXPERIENCE_JOURNEY_MAX_NODES)
  .refine(
    (path) => utf8ByteLength(JSON.stringify(path)) <= 256 * 1_024,
    "Exploration path exceeds its data limit."
  );

/** Entry state only: a nested journey is deliberately not a permitted field. */
export const ExperienceJourneyAnchorSchema = z
  .object({
    sceneId: ExperienceStableIdSchema,
    state: SnapshotObjectSchema,
    events: z.array(SnapshotObjectSchema).max(256),
    playback: SnapshotObjectSchema.optional(),
    requiredAccessRefs: ExperienceJourneyAccessRefsSchema.default([]),
  })
  .strict()
  .refine(
    (value) =>
      !Object.hasOwn(value.state, "journey") &&
      (!value.playback || !Object.hasOwn(value.playback, "journey")),
    "Journey snapshots cannot contain nested exploration."
  )
  .refine(
    (value) => boundedJson(value, EXPERIENCE_JOURNEY_MAX_ANCHOR_BYTES),
    "Journey entry snapshot is too large."
  );

export const ExperienceJourneyWatchedMediaSchema = z
  .object({
    sceneId: ExperienceStableIdSchema,
    rendererInstanceId: ExperienceStableIdSchema,
    sequenceIndex: z.number().int().nonnegative(),
    assetId: ExperienceStableIdSchema,
    mediaSignature: z.string().min(1).max(128),
    watchedUntilMs: z.number().finite().nonnegative(),
  })
  .strict();

const JourneyMetadataObjectSchema = z
  .object({
    version: z.literal(1),
    signature: z.string().min(1).max(128),
    visitedNodeIds: z.array(ExperienceStableIdSchema).max(EXPERIENCE_JOURNEY_MAX_NODES),
    traversedEdges: z.array(ExperienceJourneyEdgeSchema).max(EXPERIENCE_JOURNEY_MAX_EDGES),
    // Actual uninterrupted routes, so router merges cannot invent a walked path.
    traversedPaths: z.array(ExperienceJourneyPathSchema).max(EXPERIENCE_JOURNEY_MAX_EDGES),
    watchedMedia: z.array(ExperienceJourneyWatchedMediaSchema).max(EXPERIENCE_JOURNEY_MAX_EDGES),
    activeAccessRefs: ExperienceJourneyAccessRefsSchema.default([]),
  })
  .strict();

export const ExperienceJourneyMetadataSchema = JourneyMetadataObjectSchema;

export const ExperienceJourneySchema = JourneyMetadataObjectSchema.extend({
  anchors: z.array(ExperienceJourneyAnchorSchema).max(EXPERIENCE_JOURNEY_MAX_ANCHORS),
})
  .strict()
  .refine(
    (value) => boundedJson(value, EXPERIENCE_JOURNEY_MAX_BYTES, EXPERIENCE_JOURNEY_MAX_BYTES, 28),
    "Journey exceeds its data limit."
  );

/** Upserts only changed entry anchors; progress writes need not resend history. */
export const ExperienceJourneyDeltaSchema = z
  .object({
    version: z.literal(1),
    signature: z.string().min(1).max(128),
    addedVisitedNodeIds: z.array(ExperienceStableIdSchema).max(EXPERIENCE_JOURNEY_MAX_NODES),
    addedTraversedEdges: z.array(ExperienceJourneyEdgeSchema).max(EXPERIENCE_JOURNEY_MAX_EDGES),
    addedTraversedPaths: z.array(ExperienceJourneyPathSchema).max(EXPERIENCE_JOURNEY_MAX_EDGES),
    addedWatchedMedia: z
      .array(ExperienceJourneyWatchedMediaSchema)
      .max(EXPERIENCE_JOURNEY_MAX_EDGES),
    anchors: z.array(ExperienceJourneyAnchorSchema).max(EXPERIENCE_JOURNEY_MAX_DELTA_ANCHORS),
    activeAccessRefs: ExperienceJourneyAccessRefsSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      boundedJson(
        value,
        EXPERIENCE_JOURNEY_MAX_DELTA_BYTES,
        EXPERIENCE_JOURNEY_MAX_DELTA_BYTES,
        28
      ),
    "Journey update exceeds its data limit."
  );

export type ExperienceJourneyEdge = z.infer<typeof ExperienceJourneyEdgeSchema>;
export type ExperienceJourneyAnchor = z.infer<typeof ExperienceJourneyAnchorSchema>;
export type ExperienceJourneyMetadata = z.infer<typeof ExperienceJourneyMetadataSchema>;
export type ExperienceJourney = z.infer<typeof ExperienceJourneySchema>;
export type ExperienceJourneyDelta = z.infer<typeof ExperienceJourneyDeltaSchema>;
export type ExperienceJourneyWatchedMedia = z.infer<typeof ExperienceJourneyWatchedMediaSchema>;
export type ExperienceJourneyAccessRef = z.infer<typeof ExperienceJourneyAccessRefSchema>;
