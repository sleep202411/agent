import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const managedPosition = z.object({
  id,
  crewId: id,
  taskId: z.string().uuid().nullable(),
  positionType: z.string(),
  status: z.enum(["open", "full", "frozen"]),
  targetCount: z.number().int().nonnegative(),
  recruitedCount: z.number().int().nonnegative(),
});
export type ManagedPosition = z.infer<typeof managedPosition>;
const invitation = z.object({
  id: z.string().uuid(),
  positionId: id,
  inviteeUserId: id,
  status: z.enum(["pending", "accepted", "declined", "revoked"]),
  expiresAt: z.string().datetime({ offset: true }),
  applicationId: id.nullable(),
});
export type ManagedInvitation = z.infer<typeof invitation>;
function current(generation: number) {
  if (generation !== getAuthGeneration()) throw new Error("Crew session expired");
}
export async function requireInvitationManager(
  crewId: string,
  userId: string,
  generation: number,
  signal?: AbortSignal
) {
  id.parse(crewId);
  id.parse(userId);
  current(generation);
  const member = z
    .object({ userId: id, permissions: z.array(z.string()) })
    .parse(await api.get(`/crews/${crewId}/members/me`, { service: "aurora", signal }));
  current(generation);
  if (member.userId !== userId || !member.permissions.includes("openings.manage"))
    throw Object.assign(new Error("Crew invitation management permission is required."), {
      status: 403,
    });
}
export async function fetchManagedPositions(
  crewId: string,
  userId: string,
  generation: number,
  cursor: string | null,
  signal: AbortSignal
) {
  if (cursor) id.parse(cursor);
  await requireInvitationManager(crewId, userId, generation, signal);
  const page = z.object({ items: z.array(managedPosition), nextCursor: id.nullable() }).parse(
    await api.get(`/crews/${crewId}/positions`, {
      service: "aurora",
      signal,
      params: { limit: 20, ...(cursor ? { cursor } : {}) },
    })
  );
  current(generation);
  if (
    page.items.some((row) => row.crewId !== crewId || row.id === cursor) ||
    new Set(page.items.map((row) => row.id)).size !== page.items.length ||
    (page.nextCursor !== null && page.items.at(-1)?.id !== page.nextCursor)
  )
    throw new Error("Position pagination changed. Refresh to reload.");
  return page;
}
export async function fetchManagedInvitations(
  position: ManagedPosition,
  userId: string,
  generation: number,
  cursor: string | null,
  signal: AbortSignal
) {
  managedPosition.parse(position);
  if (cursor) z.string().uuid().parse(cursor);
  await requireInvitationManager(position.crewId, userId, generation, signal);
  const page = z
    .object({ items: z.array(invitation), nextCursor: z.string().uuid().nullable() })
    .parse(
      await api.get(`/crew-positions/${position.id}/invitations`, {
        service: "aurora",
        signal,
        params: { limit: 20, ...(cursor ? { cursor } : {}) },
      })
    );
  current(generation);
  if (
    page.items.some((row) => row.positionId !== position.id || row.id === cursor) ||
    new Set(page.items.map((row) => row.id)).size !== page.items.length ||
    (page.nextCursor !== null && page.items.at(-1)?.id !== page.nextCursor)
  )
    throw new Error("Invitation pagination changed. Refresh to reload.");
  return page;
}
export async function lookupInvitee(contact: string, generation: number) {
  current(generation);
  const value = contact.trim();
  const params = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    ? { email: value.toLowerCase() }
    : /^\+?\d[\d\s-]{5,32}$/.test(value)
      ? { phone: value }
      : null;
  if (!params || value.length > 254)
    throw new Error("Enter a valid email address or phone number.");
  const user = z
    .object({ userId: id, nickname: z.string() })
    .parse(await api.get("/users/lookup", { service: "aurora", params }));
  current(generation);
  return user;
}
export async function createManagedInvitation(
  position: ManagedPosition,
  userId: string,
  generation: number,
  inviteeUserId: string,
  expiresInDays: number
) {
  managedPosition.parse(position);
  id.parse(inviteeUserId);
  z.number().int().min(1).max(30).parse(expiresInDays);
  current(generation);
  if (
    inviteeUserId === userId ||
    !position.taskId ||
    position.status !== "open" ||
    position.recruitedCount >= position.targetCount
  )
    throw new Error("Choose another creator and an open task recruitment position.");
  // The server rechecks openings.manage and position eligibility atomically. No automatic POST retry.
  const result = invitation.parse(
    await api.post(`/crew-positions/${position.id}/invitations`, {
      service: "aurora",
      data: { inviteeUserId, expiresInDays },
    })
  );
  current(generation);
  if (
    result.positionId !== position.id ||
    result.inviteeUserId !== inviteeUserId ||
    result.status !== "pending"
  )
    throw new Error("Invitation creation could not be verified. Review the invitation list.");
  return result;
}
export async function revokeManagedInvitation(
  position: ManagedPosition,
  row: ManagedInvitation,
  generation: number
) {
  managedPosition.parse(position);
  invitation.parse(row);
  current(generation);
  if (row.positionId !== position.id || row.status !== "pending")
    throw new Error("Invitation is no longer pending.");
  const result = z
    .object({ id: z.string().uuid(), status: z.literal("revoked") })
    .parse(await api.post(`/crew-position-invitations/${row.id}/revoke`, { service: "aurora" }));
  current(generation);
  if (result.id !== row.id)
    throw new Error("Invitation revocation could not be verified. Retry the same invitation.");
  return result;
}
