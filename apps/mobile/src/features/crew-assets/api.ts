import { z } from "zod";
import { api } from "@/lib/api-client";
const uuid = z.string().uuid();
const crewIdSchema = z.string().trim().min(1).max(64);
const node = z.object({
  id: uuid,
  parentId: uuid.nullable(),
  name: z.string().min(1),
  kind: z.enum(["folder", "file"]),
  status: z.literal("active"),
  effectivePermission: z.enum(["view", "upload", "edit", "manage"]),
  media: z
    .object({
      id: uuid,
      kind: z.enum(["image", "video", "audio", "document", "other"]),
      contentType: z.string(),
      sizeBytes: z.number().nonnegative().nullable(),
    })
    .nullable(),
});
export type CrewAsset = z.infer<typeof node>;
export const assetQuerySchema = z.object({
  parentId: uuid.optional(),
  source: z.enum(["all", "recent", "favorites"]).default("all"),
  query: z.string().trim().max(256).optional(),
  sort: z.enum(["modified", "name", "size"]).default("modified"),
});
export type AssetQuery = z.input<typeof assetQuerySchema>;
export async function fetchCrewAssets(
  crewId: string,
  query: AssetQuery,
  cursor: string | null,
  signal: AbortSignal
) {
  const parsed = assetQuerySchema.parse(query);
  const result = z
    .object({
      items: z.array(node),
      parentId: uuid.nullable(),
      source: z.enum(["all", "recent", "favorites"]),
      nextCursor: uuid.nullable(),
    })
    .parse(
      await api.get(`/crews/${encodeURIComponent(crewIdSchema.parse(crewId))}/assets`, {
        service: "aurora",
        signal,
        params: { ...parsed, limit: 50, ...(cursor ? { cursor: uuid.parse(cursor) } : {}) },
      })
    );
  if (
    result.source !== parsed.source ||
    result.parentId !== (parsed.source === "all" ? (parsed.parentId ?? null) : null)
  )
    throw new Error("Crew asset view mismatch");
  // ACL filtering can produce zero visible items while nextCursor is non-null.
  // Keep that cursor so callers can continue to accessible files further on.
  return result;
}
export async function fetchCrewAssetContext(crewId: string, signal: AbortSignal) {
  return z
    .object({
      storageAvailable: z.boolean(),
      maxUploadBytes: z.number().int().positive(),
      capabilities: z.object({ view: z.boolean(), upload: z.boolean() }),
    })
    .parse(
      await api.get(`/crews/${encodeURIComponent(crewIdSchema.parse(crewId))}/assets/context`, {
        service: "aurora",
        signal,
      })
    );
}
export async function fetchCrewAssetAccess(assetId: string, signal: AbortSignal) {
  const expected = uuid.parse(assetId);
  const result = z
    .object({
      assetId: uuid,
      variantKey: z.literal("original"),
      url: z.string().url(),
      expiresAt: z.string().datetime({ offset: true }).nullable(),
    })
    .parse(
      await api.get(`/media/assets/${encodeURIComponent(expected)}/access`, {
        service: "aurora",
        signal,
        params: { variantKey: "original" },
      })
    );
  const url = new URL(result.url);
  if (
    result.assetId !== expected ||
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("Invalid media access response");
  if (result.expiresAt && Date.parse(result.expiresAt) <= Date.now())
    throw new Error("Media access has expired; retry to refresh it");
  // Request on demand; do not persist signed URLs or add app credentials to them.
  return result;
}
