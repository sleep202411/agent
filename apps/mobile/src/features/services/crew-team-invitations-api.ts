import { z } from "zod";
import { parsePublicUserId } from "@repo/shared/user-id-codec";
import { isPresetPosition } from "@repo/shared/crew";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord } from "@/lib/durable-record";
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const uuid = z.string().uuid();
const policy = z.enum(["admin", "finance"]);
function validRecipient(account: string, lookupBy?: "contact" | "userId") {
  return lookupBy === "userId"
    ? parsePublicUserId(account) !== null
    : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account) || /^\+?\d[\d\s-]{5,32}$/.test(account);
}
export const teamInvitationInput = z
  .object({
    account: z.string().trim().min(1).max(120),
    lookupBy: z.enum(["contact", "userId"]).optional(),
    positionCategory: z.string().refine(isPresetPosition).optional(),
    policyKeys: z
      .array(policy)
      .max(2)
      .refine((v) => new Set(v).size === v.length),
    expiresInDays: z.number().int().min(1).max(30),
    agreement: z
      .object({
        title: z.string().trim().min(1).max(180),
        signerName: z.string().trim().min(1).max(128),
        signerEmail: z.string().trim().email().max(320),
      })
      .optional(),
  })
  .strict()
  .refine((input) => validRecipient(input.account, input.lookupBy), {
    path: ["account"],
    message: "Enter a valid contact or public user ID for the selected lookup mode.",
  });
export type TeamInvitationInput = z.infer<typeof teamInvitationInput>;
export const teamInvitation = z.object({
  id: uuid,
  crewId: id,
  inviteeUserId: id,
  invitedByUserId: id,
  positionCategory: z.string().refine(isPresetPosition).nullable(),
  policyKeys: z.array(policy),
  status: z.enum(["pending", "accepted", "declined", "expired", "revoked"]),
  expiresAt: z.string().datetime({ offset: true }),
  createdAt: z.string().datetime({ offset: true }),
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
export type TeamInvitation = z.infer<typeof teamInvitation>;
const attempt = z.object({
  input: teamInvitationInput,
  inviteeUserId: id,
  nickname: z.string(),
  startedAt: z.string().datetime(),
});
export type TeamInvitationAttempt = z.infer<typeof attempt>;
function current(generation: number, signal?: AbortSignal) {
  if (generation !== getAuthGeneration() || signal?.aborted)
    throw new Error("Crew invitation session expired.");
}
export function teamInvitationPending(crewId: string, userId: string, generation: number) {
  id.parse(crewId);
  id.parse(userId);
  const storage = durableRecord("crew-team-invitation", userId, crewId);
  const read = () => {
    current(generation);
    const raw = storage.read();
    return raw && raw !== "null" ? attempt.parse(JSON.parse(raw)) : null;
  };
  return {
    read,
    save(value: TeamInvitationAttempt) {
      current(generation);
      if (read()) throw new Error("Review the previous invitation before sending another.");
      storage.write(JSON.stringify(attempt.parse(value)));
    },
    clear() {
      current(generation);
      storage.write("null");
    },
  };
}
export async function teamInvitationAccess(
  crewId: string,
  userId: string,
  generation: number,
  signal: AbortSignal
) {
  id.parse(crewId);
  id.parse(userId);
  current(generation, signal);
  const member = z
    .object({ userId: id, permissions: z.array(z.string()) })
    .parse(
      await api.get(`/crews/${crewId}/members/me`, { service: "aurora", signal, retry: false })
    );
  current(generation, signal);
  if (member.userId !== userId || !member.permissions.includes("members.invite"))
    throw new Error("Crew invitation permission is required.");
  return {
    positions: member.permissions.includes("members.manage"),
    policies: member.permissions.includes("members.permissions.manage"),
  };
}
export async function fetchTeamInvitations(
  crewId: string,
  userId: string,
  generation: number,
  cursor: string | null,
  signal: AbortSignal
) {
  uuid.nullable().parse(cursor);
  const access = await teamInvitationAccess(crewId, userId, generation, signal);
  const page = z
    .object({
      items: z.array(teamInvitation),
      nextCursor: uuid.nullable(),
      total: z.number().int().nonnegative(),
    })
    .parse(
      await api.get(`/crews/${crewId}/invitations`, {
        service: "aurora",
        signal,
        retry: false,
        params: { limit: 30, ...(cursor ? { cursor } : {}) },
      })
    );
  current(generation, signal);
  if (
    page.items.some(
      (row) => row.crewId !== crewId || row.status !== "pending" || row.id === cursor
    ) ||
    new Set(page.items.map((row) => row.id)).size !== page.items.length ||
    (page.nextCursor && page.items.at(-1)?.id !== page.nextCursor)
  )
    throw new Error("Invitations changed. Refresh the list.");
  return { ...page, access };
}
export async function lookupTeamInvitee(
  crewId: string,
  userId: string,
  generation: number,
  account: string,
  signal: AbortSignal,
  lookupBy?: "contact" | "userId"
) {
  const value = z.string().trim().min(1).max(120).parse(account);
  if (!validRecipient(value, lookupBy)) throw new Error("Invalid invitation recipient.");
  await teamInvitationAccess(crewId, userId, generation, signal);
  const target = z.object({ userId: id, nickname: z.string(), isCrewMember: z.boolean() }).parse(
    await api.get(lookupBy === "userId" ? "/users/by-id" : "/users/lookup", {
      service: "aurora",
      signal,
      retry: false,
      params: {
        ...(lookupBy === "userId" ? { id: value, idFormat: "public" } : { account: value }),
        checkCrewId: crewId,
      },
    })
  );
  current(generation, signal);
  if (target.isCrewMember || target.userId === userId)
    throw new Error("This person is already a Crew member.");
  return target;
}
export async function createTeamInvitation(
  crewId: string,
  userId: string,
  generation: number,
  input: TeamInvitationInput,
  reviewedUserId: string,
  signal: AbortSignal
) {
  const data = teamInvitationInput.parse(input);
  const access = await teamInvitationAccess(crewId, userId, generation, signal);
  if ((data.positionCategory && !access.positions) || (data.policyKeys.length && !access.policies))
    throw new Error("Permission to assign the selected position or access has changed.");
  const target = await lookupTeamInvitee(
    crewId,
    userId,
    generation,
    data.account,
    signal,
    data.lookupBy
  );
  if (target.userId !== reviewedUserId)
    throw new Error("The account lookup changed. Review the recipient again.");
  current(generation, signal);
  const pending = teamInvitationPending(crewId, userId, generation);
  pending.save({
    input: data,
    inviteeUserId: target.userId,
    nickname: target.nickname,
    startedAt: new Date().toISOString(),
  });
  // No server idempotency key. A lost response remains durable and is never automatically resent.
  const receipt = teamInvitation.parse(
    await api.post(`/crews/${crewId}/invitations`, {
      service: "aurora",
      signal,
      retry: false,
      data,
    })
  );
  current(generation, signal);
  const agreement = data.agreement;
  if (
    receipt.crewId !== crewId ||
    receipt.inviteeUserId !== target.userId ||
    receipt.invitedByUserId !== userId ||
    receipt.status !== "pending" ||
    receipt.positionCategory !== (data.positionCategory ?? null) ||
    [...receipt.policyKeys].sort().join() !== [...data.policyKeys].sort().join() ||
    (agreement
      ? !receipt.agreementRequest ||
        receipt.agreementRequest.title !== agreement.title ||
        receipt.agreementRequest.signerName !== agreement.signerName ||
        receipt.agreementRequest.signerEmail.toLowerCase() !== agreement.signerEmail.toLowerCase()
      : receipt.agreementRequest !== null)
  )
    throw new Error("Invitation receipt could not be verified. Review pending invitations.");
  pending.clear();
  return receipt;
}
export async function revokeTeamInvitation(
  crewId: string,
  userId: string,
  generation: number,
  row: TeamInvitation,
  signal: AbortSignal
) {
  const target = teamInvitation.parse(row);
  if (target.crewId !== crewId || target.status !== "pending")
    throw new Error("Invitation scope or status changed.");
  await teamInvitationAccess(crewId, userId, generation, signal);
  z.object({ revoked: z.literal(true) }).parse(
    await api.delete(`/crew-invitations/${target.id}`, { service: "aurora", signal, retry: false })
  );
  current(generation, signal);
}
