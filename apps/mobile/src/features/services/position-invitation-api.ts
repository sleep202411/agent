import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const invitation = z.object({
  id: z.string().uuid(),
  positionId: id,
  inviteeUserId: id,
  status: z.enum(["pending", "accepted", "declined", "revoked"]),
  expiresAt: z.string().datetime({ offset: true }),
  applicationId: id.nullable(),
});
const preview = invitation.extend({
  expired: z.boolean(),
  position: z.object({
    id,
    crewId: id,
    taskId: z.string().uuid().nullable(),
    positionType: z.string(),
    description: z.string(),
    experienceLevel: z.string(),
    requiredSkills: z.array(z.string()),
  }),
});
export type Invitation = z.infer<typeof invitation>;
export type InvitationPreview = z.infer<typeof preview>;
export const invitationDecision = z.discriminatedUnion("action", [
  z.object({ action: z.literal("decline") }).strict(),
  z
    .object({
      action: z.literal("accept"),
      message: z.string().trim().min(1).max(1000).nullable(),
      portfolioUrl: z
        .string()
        .trim()
        .url()
        .max(512)
        .refine((value) => ["https:", "http:"].includes(new URL(value).protocol))
        .nullable(),
    })
    .strict(),
]);
export type InvitationDecision = z.infer<typeof invitationDecision>;
export async function fetchPositionInvitations(
  userId: string,
  cursor: string | null,
  signal: AbortSignal
) {
  id.parse(userId);
  if (cursor) z.string().uuid().parse(cursor);
  const page = z
    .object({ items: z.array(invitation), nextCursor: z.string().uuid().nullable() })
    .parse(
      await api.get("/crew-position-invitations", {
        service: "aurora",
        signal,
        params: { limit: 20, ...(cursor ? { cursor } : {}) },
      })
    );
  if (
    page.items.some((row) => row.inviteeUserId !== userId || row.id === cursor) ||
    new Set(page.items.map((row) => row.id)).size !== page.items.length ||
    (page.nextCursor !== null &&
      (page.nextCursor === cursor || page.items.at(-1)?.id !== page.nextCursor))
  )
    throw new Error("Invitation account or pagination changed. Refresh to reload.");
  return page;
}
export async function fetchPositionInvitation(
  invitationId: string,
  userId: string,
  signal: AbortSignal
) {
  z.string().uuid().parse(invitationId);
  id.parse(userId);
  const row = preview.parse(
    await api.get(`/crew-position-invitations/${invitationId}`, { service: "aurora", signal })
  );
  if (row.id !== invitationId || row.inviteeUserId !== userId || row.positionId !== row.position.id)
    throw new Error("Invitation identity changed. Refresh to reload.");
  return row;
}
export async function decidePositionInvitation(
  row: InvitationPreview,
  userId: string,
  generation: number,
  decision: InvitationDecision,
  recovery = false
) {
  const reviewed = preview.parse(row),
    body = invitationDecision.parse(decision);
  if (
    reviewed.inviteeUserId !== userId ||
    reviewed.status !== "pending" ||
    (!recovery && (reviewed.expired || Date.parse(reviewed.expiresAt) <= Date.now()))
  )
    throw Object.assign(new Error("Invitation is no longer available for a response."), {
      status: 409,
    });
  if (generation !== getAuthGeneration()) throw new Error("Application session expired");
  const raw = await api.post(`/crew-position-invitations/${reviewed.id}/${body.action}`, {
    service: "aurora",
    ...(body.action === "accept"
      ? { data: { message: body.message, portfolioUrl: body.portfolioUrl } }
      : {}),
  });
  if (generation !== getAuthGeneration()) throw new Error("Application session expired");
  if (body.action === "decline") {
    const result = z.object({ id: z.string().uuid(), status: z.literal("declined") }).parse(raw);
    if (result.id !== reviewed.id)
      throw new Error("Invitation response could not be verified. Retry the same response.");
    return { status: "declined" as const };
  }
  // Accept may return the applicant's existing application, including on an idempotent retry.
  const result = z
    .object({
      id,
      crewId: id,
      positionId: id,
      applicantId: id,
      status: z.enum(["pending", "approved", "rejected"]),
    })
    .parse(raw);
  if (
    result.crewId !== reviewed.position.crewId ||
    result.positionId !== reviewed.positionId ||
    result.applicantId !== userId
  )
    throw new Error("Invitation response could not be verified. Retry the same response.");
  return { status: "accepted" as const, applicationId: result.id };
}
