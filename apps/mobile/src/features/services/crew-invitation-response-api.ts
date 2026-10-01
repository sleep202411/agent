import { isPresetPosition } from "@repo/shared/crew";
import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const uuid = z.string().uuid();
const invitation = z.object({
  id: uuid,
  crewId: id,
  inviteeUserId: id,
  positionCategory: z.string().refine(isPresetPosition).nullable().optional(),
  policyKeys: z.array(z.enum(["admin", "finance"])).optional(),
  status: z.enum(["pending", "accepted", "declined", "expired", "revoked"]),
  expiresAt: z.string().datetime({ offset: true }),
  crew: z.object({
    id,
    name: z.string(),
    tagline: z.string().nullable(),
    logo: z.string().nullable(),
  }),
  agreementRequest: z
    .object({
      title: z.string(),
      signerName: z.string(),
      signerEmail: z.string(),
      agreementId: uuid.nullable(),
      status: z.string().nullable(),
    })
    .nullable(),
});
export type CrewInvitationResponse = z.infer<typeof invitation>;
function current(generation: number, signal: AbortSignal) {
  if (signal.aborted || generation !== getAuthGeneration())
    throw new Error("Invitation session expired");
}
export async function fetchCrewInvitationResponse(
  invitationId: string,
  userId: string,
  generation: number,
  signal: AbortSignal
) {
  current(generation, signal);
  uuid.parse(invitationId);
  id.parse(userId);
  const row = invitation.parse(
    await api.get(`/crew-invitations/${invitationId}`, { service: "aurora", signal, retry: false })
  );
  current(generation, signal);
  if (row.id !== invitationId || row.inviteeUserId !== userId || row.crewId !== row.crew.id)
    throw new Error("Invitation identity mismatch");
  return row;
}
export async function respondToCrewInvitation(
  row: CrewInvitationResponse,
  userId: string,
  generation: number,
  action: "accept" | "decline",
  signal: AbortSignal
) {
  const reviewed = invitation.parse(row);
  z.enum(["accept", "decline"]).parse(action);
  const fresh = await fetchCrewInvitationResponse(reviewed.id, userId, generation, signal);
  if (
    fresh.crewId !== reviewed.crewId ||
    (fresh.positionCategory ?? null) !== (reviewed.positionCategory ?? null) ||
    [...(fresh.policyKeys ?? [])].sort().join() !==
      [...(reviewed.policyKeys ?? [])].sort().join() ||
    fresh.status !== "pending" ||
    Date.parse(fresh.expiresAt) <= Date.now()
  )
    throw new Error("This invitation is no longer pending or has expired.");
  current(generation, signal);
  const result = await api.post(`/crew-invitations/${reviewed.id}/${action}`, {
    service: "aurora",
    signal,
    retry: false,
  });
  current(generation, signal);
  if (action === "decline") z.object({ declined: z.literal(true) }).parse(result);
  else {
    const receipt = z.object({ accepted: z.literal(true), crewId: id, memberId: id }).parse(result);
    if (receipt.crewId !== reviewed.crewId) throw new Error("Invitation receipt mismatch");
  }
}
