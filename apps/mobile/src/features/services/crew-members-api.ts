import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const crewMember = z.object({
  id,
  crewId: id,
  userId: z.string().min(1).max(64),
  status: z.literal("active"),
  isOwner: z.boolean(),
  version: z.number().int().positive(),
  joinedAt: z.string().datetime({ offset: true }),
  positions: z.array(
    z.object({
      id,
      categoryKey: z.string().nullable(),
      title: z.string().nullable(),
      isPrimary: z.boolean(),
      sourcePositionId: id.nullable(),
    })
  ),
  policyKeys: z.array(z.enum(["admin", "finance"])),
});
export type CrewMember = z.infer<typeof crewMember>;
function current(generation: number, signal: AbortSignal) {
  if (generation !== getAuthGeneration() || signal.aborted)
    throw new Error("Crew member session expired or request cancelled.");
}
export async function fetchCrewMemberPage(
  crewId: string,
  userId: string,
  generation: number,
  cursor: string | null,
  signal: AbortSignal
) {
  id.parse(crewId);
  id.nullable().parse(cursor);
  current(generation, signal);
  const access = z
    .object({ userId: z.string(), permissions: z.array(z.string()) })
    .parse(await api.get(`/crews/${crewId}/members/me`, { service: "aurora", signal }));
  current(generation, signal);
  if (access.userId !== userId) throw new Error("Crew membership account mismatch.");
  if (!access.permissions.includes("members.view"))
    throw new Error("Crew member access is required.");
  const page = z
    .object({
      items: z.array(crewMember),
      nextCursor: id.nullable(),
      total: z.number().int().nonnegative(),
    })
    .parse(
      await api.get(`/crews/${crewId}/members`, {
        service: "aurora",
        signal,
        params: { limit: 50, ...(cursor ? { cursor } : {}) },
      })
    );
  current(generation, signal);
  if (
    page.items.some((m) => m.crewId !== crewId) ||
    new Set(page.items.map((m) => m.id)).size !== page.items.length ||
    new Set(page.items.map((m) => m.userId)).size !== page.items.length ||
    (cursor !== null && page.nextCursor === cursor)
  )
    throw new Error("Crew member page could not be verified. Refresh the directory.");
  return {
    ...page,
    canManageMembers: access.permissions.includes("members.manage"),
    canTransferOwnership: access.permissions.includes("ownership.transfer"),
    canManagePermissions: access.permissions.includes("members.permissions.manage"),
  };
}

/** Removal has no version parameter. Revalidate the captured member; server locking remains authoritative. */
export async function removeCrewMember(
  crewId: string,
  userId: string,
  generation: number,
  snapshot: CrewMember
) {
  const target = crewMember.parse(snapshot);
  if (target.crewId !== crewId) throw new Error("Crew member scope mismatch.");
  if (target.isOwner) throw new Error("Transfer ownership before removing the Crew owner.");
  const signal = new AbortController().signal;
  let cursor: string | null = null;
  const seen = new Set<string>();
  do {
    const page = await fetchCrewMemberPage(crewId, userId, generation, cursor, signal);
    if (!page.canManageMembers) throw new Error("Crew member management permission is required.");
    const fresh = page.items.find((m) => m.id === target.id);
    if (fresh) {
      if (fresh.userId !== target.userId || fresh.version !== target.version || fresh.isOwner)
        throw new Error("Crew member changed. Refresh before removing them.");
      current(generation, signal);
      await api.delete(`/crews/${crewId}/members/${target.id}`, { service: "aurora" });
      current(generation, signal);
      return;
    }
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor)) throw new Error("Crew member pagination did not advance.");
    if (cursor) seen.add(cursor);
  } while (cursor);
  throw new Error("Member is no longer active. Refresh the directory.");
}
