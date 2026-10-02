import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
export { parseCrewInviteLink } from "./crew-invite-link";
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{32}$/);
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const previewSchema = z.object({
  scope: z.enum(["crew", "crew_community"]),
  crewId: id,
  targetName: z.string().min(1),
  logo: z.string().nullable(),
  tagline: z.string().nullable(),
  memberCount: z.number().int().nonnegative(),
  status: z.enum(["active", "revoked", "expired", "exhausted"]),
  expiresAt: z.string().datetime({ offset: true }).nullable(),
});
export type CrewInvitePreview = z.infer<typeof previewSchema>;
const targetSchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("crew"), crewId: id, memberId: id, targetName: z.string() }),
  z.object({
    scope: z.literal("crew_community"),
    crewId: id,
    conversationId: id,
    targetName: z.string(),
  }),
]);
export type CrewInviteTarget = z.infer<typeof targetSchema>;
function current(generation: number, signal?: AbortSignal) {
  if (signal?.aborted || generation !== getAuthGeneration())
    throw new Error("Invitation session expired or request cancelled.");
}
export async function previewCrewInvite(token: string, generation: number, signal?: AbortSignal) {
  tokenSchema.parse(token);
  current(generation, signal);
  const value = previewSchema.parse(
    await api.get("/invites/preview", {
      service: "aurora",
      params: { token },
      signal,
      retry: false,
    })
  );
  current(generation, signal);
  return value;
}
export function canAcceptCrewInvite(value: CrewInvitePreview) {
  return (
    value.status === "active" &&
    (value.expiresAt === null || Date.parse(value.expiresAt) > Date.now())
  );
}
export class CrewInviteAcceptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrewInviteAcceptError";
  }
}
export async function acceptCrewInvite(
  token: string,
  reviewed: CrewInvitePreview,
  generation: number,
  signal?: AbortSignal,
  recover = false
): Promise<CrewInviteTarget> {
  const fresh = await previewCrewInvite(token, generation, signal);
  if (
    fresh.scope !== reviewed.scope ||
    fresh.crewId !== reviewed.crewId ||
    fresh.targetName !== reviewed.targetName ||
    fresh.expiresAt !== reviewed.expiresAt
  )
    throw new Error("Invitation changed. Preview the link again before joining.");
  // Server redemption is idempotent per link/account. An explicit recovery may
  // retrieve a committed membership even after that redemption exhausted the link.
  if (!recover && !canAcceptCrewInvite(fresh))
    throw new Error("This invitation is no longer available.");
  current(generation, signal);
  try {
    const target = targetSchema.parse(
      await api.post("/invites/accept", {
        service: "aurora",
        data: { token },
        retry: false,
      })
    );
    current(generation, signal);
    if (target.scope !== fresh.scope || target.crewId !== fresh.crewId)
      throw new Error("Invitation acceptance could not be verified.");
    return target;
  } catch (error) {
    throw new CrewInviteAcceptError(error instanceof Error ? error.message : String(error));
  }
}
export function crewInviteTargetRoute(value: CrewInviteTarget) {
  const target = targetSchema.parse(value);
  return target.scope === "crew"
    ? `/crew-tasks/${target.crewId}`
    : `/conversation/${target.conversationId}`;
}
