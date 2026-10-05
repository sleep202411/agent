import { TASK_PAYMENT_TERMS } from "@repo/shared/crew";
import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
export { parseCrewInviteLink } from "./crew-invite-link";
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{32}$/);
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const taskOffer = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  title: z.string(),
  description: z.string().nullable(),
  dueAt: z.string().datetime({ offset: true }).nullable(),
  requiredSkills: z.array(z.string()),
  paymentTerms: z.enum(TASK_PAYMENT_TERMS).nullable(),
  rewardUsdMinor: z.number().int().nonnegative().safe().nullable(),
  profitShareBps: z.number().int().min(0).max(10000).nullable(),
});
const previewSchema = z.object({
  task: taskOffer.nullish(),
  acceptedHref: z.string().nullable().optional(),
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
  z.object({
    scope: z.literal("crew"),
    crewId: id,
    memberId: id,
    targetName: z.string(),
    workspaceHref: z.string().optional(),
  }),
  z.object({
    scope: z.literal("crew_community"),
    crewId: id,
    conversationId: id,
    targetName: z.string(),
  }),
]);
export type CrewInviteTarget = z.infer<typeof targetSchema>;
function invitedTask(href: string | undefined | null, crewId: string) {
  if (!href) return undefined;
  const url = new URL(href, "https://mobile.invalid");
  if (
    url.origin !== "https://mobile.invalid" ||
    url.pathname !== `/crews/${crewId}/workspace` ||
    url.hash
  )
    throw Error("Invalid task invitation destination.");
  if (!url.search) return undefined;
  if (
    url.searchParams.get("tab") !== "tasks" ||
    url.searchParams.getAll("task").length !== 1 ||
    [...url.searchParams.keys()].some((key) => key !== "tab" && key !== "task")
  )
    throw Error("Invalid task invitation destination.");
  return z.string().uuid().parse(url.searchParams.get("task"));
}
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
  if (value.acceptedHref) invitedTask(value.acceptedHref, value.crewId);
  if (value.scope !== "crew" && (value.task || value.acceptedHref))
    throw Error("Invitation scope mismatch.");
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
  if (fresh.task && JSON.stringify(fresh.task) !== JSON.stringify(reviewed.task))
    throw Error("Task invitation terms changed. Preview the link again.");
  const expectedTask = reviewed.task?.id ?? invitedTask(reviewed.acceptedHref, reviewed.crewId);
  const recoveredTask = invitedTask(fresh.acceptedHref, fresh.crewId);
  if (recoveredTask && expectedTask && recoveredTask !== expectedTask)
    throw Error("Task invitation destination changed.");
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
    if (target.scope === "crew") {
      const taskId = invitedTask(target.workspaceHref, target.crewId);
      if (taskId !== (expectedTask ?? recoveredTask))
        throw Error("Task invitation acceptance could not be verified.");
    }
    return target;
  } catch (error) {
    throw new CrewInviteAcceptError(error instanceof Error ? error.message : String(error));
  }
}
export function crewInviteTargetRoute(value: CrewInviteTarget) {
  const target = targetSchema.parse(value);
  const taskId =
    target.scope === "crew" ? invitedTask(target.workspaceHref, target.crewId) : undefined;
  return target.scope === "crew"
    ? `/crew-tasks/${target.crewId}${taskId ? `?task=${taskId}` : ""}`
    : `/conversation/${target.conversationId}`;
}
