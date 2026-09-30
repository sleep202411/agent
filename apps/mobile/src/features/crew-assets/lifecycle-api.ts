import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { organizationNode, fetchOrganizationNode, type OrganizationNode } from "./organization-api";
const uuid = z.string().uuid();
export const trashedAsset = organizationNode.extend({
  status: z.literal("trashed"),
  trashedAt: z.string().datetime({ offset: true }),
});
export type TrashedAsset = z.infer<typeof trashedAsset>;
function current(generation: number, signal?: AbortSignal) {
  if (generation !== getAuthGeneration() || signal?.aborted)
    throw new Error("Asset lifecycle session expired or request cancelled.");
}
async function authorize(crewId: string, userId: string, generation: number, signal: AbortSignal) {
  z.string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .parse(crewId);
  current(generation, signal);
  const member = z
    .object({ userId: z.string(), permissions: z.array(z.string()) })
    .parse(await api.get(`/crews/${crewId}/members/me`, { service: "aurora", signal }));
  current(generation, signal);
  if (member.userId !== userId) throw new Error("Crew membership account mismatch.");
  if (!member.permissions.includes("assets.view"))
    throw new Error("Crew asset access is required.");
}
export async function fetchAssetTrash(
  crewId: string,
  userId: string,
  generation: number,
  cursor: string | null,
  signal: AbortSignal
) {
  uuid.nullable().parse(cursor);
  await authorize(crewId, userId, generation, signal);
  const result = z
    .object({
      items: z.array(trashedAsset),
      source: z.literal("trash"),
      parentId: z.null(),
      nextCursor: uuid.nullable(),
    })
    .parse(
      await api.get(`/crews/${crewId}/assets`, {
        service: "aurora",
        signal,
        params: { source: "trash", sort: "modified", limit: 50, ...(cursor ? { cursor } : {}) },
      })
    );
  current(generation, signal);
  if (
    new Set(result.items.map((r) => r.id)).size !== result.items.length ||
    (cursor !== null && result.nextCursor === cursor)
  )
    throw new Error("Asset trash pagination did not advance.");
  return result;
}
function unchanged(a: OrganizationNode | TrashedAsset, b: OrganizationNode | TrashedAsset) {
  return (
    a.id === b.id &&
    a.updatedAt === b.updatedAt &&
    a.parentId === b.parentId &&
    a.name === b.name &&
    a.kind === b.kind &&
    a.media?.id === b.media?.id
  );
}
export async function trashOrganizationAsset(
  crewId: string,
  userId: string,
  generation: number,
  snapshot: OrganizationNode
) {
  const original = organizationNode.parse(snapshot);
  const fresh = await fetchOrganizationNode(
    crewId,
    userId,
    generation,
    original.id,
    new AbortController().signal
  );
  if (!unchanged(original, fresh))
    throw new Error("Asset changed. Refresh before moving it to Trash.");
  if (!["edit", "manage"].includes(fresh.effectivePermission))
    throw new Error("Asset edit permission is required.");
  current(generation);
  // No conditional version parameter exists. Server rechecks access and serializes the tree operation.
  await api.delete(`/crews/${crewId}/assets/${original.id}`, { service: "aurora" });
  current(generation);
}
async function freshTrashed(
  crewId: string,
  userId: string,
  generation: number,
  snapshot: TrashedAsset
) {
  const original = trashedAsset.parse(snapshot),
    seen = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = await fetchAssetTrash(
      crewId,
      userId,
      generation,
      cursor,
      new AbortController().signal
    );
    const fresh = page.items.find((r) => r.id === original.id);
    if (fresh) {
      if (!unchanged(original, fresh) || fresh.trashedAt !== original.trashedAt)
        throw new Error("Trashed asset changed. Refresh before continuing.");
      return fresh;
    }
    cursor = page.nextCursor;
    if (cursor) {
      if (seen.has(cursor)) throw new Error("Asset trash pagination did not advance.");
      seen.add(cursor);
    }
  } while (cursor);
  throw new Error("Asset is no longer in this Trash view. Refresh before continuing.");
}
export async function restoreOrganizationAsset(
  crewId: string,
  userId: string,
  generation: number,
  snapshot: TrashedAsset
) {
  const fresh = await freshTrashed(crewId, userId, generation, snapshot);
  if (!["edit", "manage"].includes(fresh.effectivePermission))
    throw new Error("Asset edit permission is required.");
  current(generation);
  const result = organizationNode.parse(
    await api.post(`/crews/${crewId}/assets/${fresh.id}/restore`, { service: "aurora" })
  );
  current(generation);
  if (
    result.id !== fresh.id ||
    result.parentId !== fresh.parentId ||
    result.name !== fresh.name ||
    result.kind !== fresh.kind ||
    result.media?.id !== fresh.media?.id
  )
    throw new Error("Asset restoration could not be verified. Refresh before retrying.");
  return result;
}
export async function permanentlyDeleteOrganizationAsset(
  crewId: string,
  userId: string,
  generation: number,
  snapshot: TrashedAsset
) {
  const fresh = await freshTrashed(crewId, userId, generation, snapshot);
  if (fresh.effectivePermission !== "manage")
    throw new Error("Asset manage permission is required for permanent deletion.");
  current(generation);
  await api.delete(`/crews/${crewId}/assets/${fresh.id}/permanent`, { service: "aurora" });
  current(generation);
}
