import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { fetchMentionMembers } from "../services/task-mentions";
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const user = z.string().trim().min(1).max(64);
const uuid = z.string().uuid();
const mode = z.enum(["inherit", "restricted"]);
export const assetPermission = z.enum(["view", "upload", "edit", "manage"]);
const grant = z.object({ userId: user, permission: assetPermission }).strict();
export type AssetGrant = z.infer<typeof grant>;
const grants = z
  .array(grant)
  .max(500)
  .refine(
    (v) => new Set(v.map((g) => g.userId)).size === v.length,
    "Duplicate permission recipients."
  );
export const permissionSnapshot = z
  .object({
    accessMode: mode,
    permissionVersion: z.number().int().positive(),
    effectivePermission: assetPermission,
    canManage: z.boolean(),
    grants: z.array(z.object({ userId: user, permission: assetPermission })),
  })
  .superRefine((v, ctx) => {
    if (
      v.canManage !== (v.effectivePermission === "manage") ||
      new Set(v.grants.map((g) => g.userId)).size !== v.grants.length ||
      (v.accessMode === "inherit" && v.grants.length)
    )
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Inconsistent asset permissions." });
  });
export type PermissionSnapshot = z.infer<typeof permissionSnapshot>;
const event = z.object({
  id: uuid,
  crewId: identifier,
  nodeId: uuid,
  actorUserId: user,
  action: z.literal("permissions_updated"),
  previousMode: mode,
  nextMode: mode,
  previousVersion: z.number().int().positive(),
  nextVersion: z.number().int().positive(),
  previousGrants: grants,
  nextGrants: grants,
  createdAt: z.string().datetime({ offset: true }),
});
export type PermissionEvent = z.infer<typeof event>;
function current(generation: number, signal?: AbortSignal) {
  if (generation !== getAuthGeneration() || signal?.aborted)
    throw new Error("Asset permission session expired or request cancelled.");
}
async function authorize(crewId: string, userId: string, generation: number, signal: AbortSignal) {
  identifier.parse(crewId);
  user.parse(userId);
  current(generation, signal);
  const member = z
    .object({ userId: user, permissions: z.array(z.string()) })
    .parse(await api.get(`/crews/${crewId}/members/me`, { service: "aurora", signal }));
  current(generation, signal);
  if (member.userId !== userId) throw new Error("Crew membership account mismatch.");
  if (!member.permissions.includes("assets.view"))
    throw new Error("Crew asset access is required.");
  return member;
}
export async function fetchAssetPermissions(
  crewId: string,
  userId: string,
  generation: number,
  nodeId: string,
  signal: AbortSignal
) {
  uuid.parse(nodeId);
  const member = await authorize(crewId, userId, generation, signal);
  const permissions = permissionSnapshot.parse(
    await api.get(`/crews/${crewId}/assets/${nodeId}/permissions`, { service: "aurora", signal })
  );
  current(generation, signal);
  return { permissions, globalManage: member.permissions.includes("assets.manage") };
}
export async function fetchAssetPermissionMembers(
  crewId: string,
  userId: string,
  generation: number,
  signal: AbortSignal
) {
  await authorize(crewId, userId, generation, signal);
  const ids = new Set<string>(),
    cursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = await fetchMentionMembers(crewId, cursor, signal);
    current(generation, signal);
    for (const row of page.items) {
      if (ids.has(row.userId))
        throw new Error("Crew membership changed. Refresh before editing permissions.");
      ids.add(row.userId);
    }
    cursor = page.nextCursor;
    if (cursor && cursors.has(cursor)) throw new Error("Crew member pagination did not advance.");
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return [...ids];
}
export async function fetchAssetPermissionEvents(
  crewId: string,
  userId: string,
  generation: number,
  nodeId: string,
  signal: AbortSignal
) {
  const { permissions } = await fetchAssetPermissions(crewId, userId, generation, nodeId, signal);
  if (!permissions.canManage) throw new Error("Asset manage permission is required.");
  const rows = z
    .array(event)
    .max(50)
    .parse(
      await api.get(`/crews/${crewId}/assets/${nodeId}/permissions/events`, {
        service: "aurora",
        signal,
      })
    );
  current(generation, signal);
  if (
    new Set(rows.map((r) => r.id)).size !== rows.length ||
    rows.some(
      (r) => r.crewId !== crewId || r.nodeId !== nodeId || r.nextVersion !== r.previousVersion + 1
    )
  )
    throw new Error("Asset permission history scope mismatch.");
  return rows;
}
export async function saveAssetPermissions(
  crewId: string,
  userId: string,
  generation: number,
  nodeId: string,
  snapshot: PermissionSnapshot,
  input: { accessMode: "inherit" | "restricted"; grants: AssetGrant[] }
) {
  const original = permissionSnapshot.parse(snapshot);
  const draft = z.object({ accessMode: mode, grants }).strict().parse(input);
  if (draft.accessMode === "inherit" && draft.grants.length)
    throw new Error("Inherited access cannot have explicit grants.");
  const signal = new AbortController().signal;
  const fresh = await fetchAssetPermissions(crewId, userId, generation, nodeId, signal);
  if (!fresh.permissions.canManage) throw new Error("Asset manage permission is required.");
  if (fresh.permissions.permissionVersion !== original.permissionVersion)
    throw new Error("Asset permissions changed. Refresh before saving.");
  if (draft.accessMode === "restricted") {
    const members = await fetchAssetPermissionMembers(crewId, userId, generation, signal);
    if (draft.grants.some((g) => !members.includes(g.userId)))
      throw new Error("Every permission recipient must be an active Crew member.");
    // Server preserves a delegated manager's own grant in restricted mode.
    if (!fresh.globalManage) {
      draft.grants = draft.grants.filter((g) => g.userId !== userId);
      draft.grants.push({ userId, permission: "manage" });
    }
    grants.parse(draft.grants);
  }
  current(generation);
  const result = permissionSnapshot.parse(
    await api.put(`/crews/${crewId}/assets/${nodeId}/permissions`, {
      service: "aurora",
      data: { ...draft, expectedVersion: original.permissionVersion },
    })
  );
  current(generation);
  if (
    result.accessMode !== draft.accessMode ||
    result.permissionVersion !== original.permissionVersion + 1 ||
    result.grants.length !== draft.grants.length ||
    result.grants.some(
      (g) => !draft.grants.some((d) => d.userId === g.userId && d.permission === g.permission)
    )
  )
    throw new Error("Permission update could not be verified. Refresh before retrying.");
  return result;
}
