import { fetchTaskDetail } from "./task-detail-api";
import { fetchTaskCommentAccess } from "./task-comment-api";
import { z } from "zod";
import { getAuthGeneration } from "@/auth/auth-store";
import { api } from "@/lib/api-client";
import { durableRecord } from "@/lib/durable-record";
import { teamInvitationAccess } from "./crew-team-invitations-api";
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const policy = z.enum(["admin", "finance"]);
const policies = z
  .array(policy)
  .max(2)
  .refine((v) => new Set(v).size === v.length);
export const crewLinkInput = z
  .object({
    kind: z.enum(["member", "community"]),
    taskId: z.string().uuid().optional(),
    taskVersion: z.number().int().positive().optional(),
    policyKeys: policies,
    expiresInDays: z.number().int().min(1).max(365).optional(),
    maxUses: z.number().int().min(1).max(500).optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.taskId
        ? v.taskVersion !== undefined &&
          v.kind === "member" &&
          v.maxUses === 1 &&
          v.policyKeys.length === 0
        : v.taskVersion === undefined,
    "Task invitations require one use and unchanged task terms."
  )
  .refine(
    (v) => v.kind !== "community" || v.policyKeys.length === 0,
    "Community links cannot grant Crew permissions."
  );
export type CrewLinkInput = z.infer<typeof crewLinkInput>;
const rowSchema = z.object({
  taskId: z.string().uuid().nullish(),
  taskVersion: z.number().int().positive().nullish(),
  id: z.string().uuid(),
  crewId: id,
  kind: z.enum(["member", "community"]),
  policyKeys: policies,
  maxUses: z.number().int().min(1).max(500).nullable(),
  useCount: z.number().int().nonnegative(),
  expiresAt: z.string().datetime({ offset: true }).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  createdByUserId: id,
  state: z.enum(["active", "expired", "exhausted", "revoked"]),
});
export type CrewLink = z.infer<typeof rowSchema>;
const attemptSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("create"), input: crewLinkInput, startedAt: z.string().datetime() }),
  z.object({ kind: z.literal("revoke"), link: rowSchema, startedAt: z.string().datetime() }),
]);
export type CrewLinkAttempt = z.infer<typeof attemptSchema>;
function current(generation: number, signal?: AbortSignal) {
  if (generation !== getAuthGeneration() || signal?.aborted)
    throw new Error("Crew invitation session expired.");
}
export function crewLinkPending(
  crewId: string,
  userId: string,
  generation: number,
  taskId?: string
) {
  id.parse(crewId);
  id.parse(userId);
  const storage = durableRecord(
    "crew-invite-link",
    userId,
    taskId ? `${crewId}:${z.string().uuid().parse(taskId)}` : crewId
  );
  const read = () => {
    current(generation);
    const raw = storage.read();
    return raw && raw !== "null" ? attemptSchema.parse(JSON.parse(raw)) : null;
  };
  return {
    read,
    save(value: CrewLinkAttempt) {
      current(generation);
      if (read()) throw new Error("Review the previous link request before trying again.");
      storage.write(JSON.stringify(attemptSchema.parse(value)));
    },
    clear() {
      current(generation);
      storage.write("null");
    },
  };
}
export async function fetchCrewLinks(
  crewId: string,
  userId: string,
  generation: number,
  signal: AbortSignal,
  taskId?: string
) {
  const access = await teamInvitationAccess(crewId, userId, generation, signal);
  const links = z
    .array(rowSchema)
    .max(50)
    .parse(
      await api.get(`/crews/${crewId}/invite-links`, { service: "aurora", signal, retry: false })
    );
  current(generation, signal);
  if (
    links.some(
      (v) =>
        v.crewId !== crewId ||
        v.state === "revoked" ||
        (v.kind === "community" && v.policyKeys.length)
    ) ||
    new Set(links.map((v) => v.id)).size !== links.length
  )
    throw new Error("Invitation link list could not be verified. Refresh the list.");
  return {
    links: links.filter((link) => (taskId ? link.taskId === taskId : !link.taskId)),
    access,
  };
}
export async function createCrewLink(
  crewId: string,
  userId: string,
  generation: number,
  input: CrewLinkInput,
  signal: AbortSignal
) {
  const data = crewLinkInput.parse(input);
  const access = await teamInvitationAccess(crewId, userId, generation, signal);
  if (data.policyKeys.length && !access.policies)
    throw new Error("Permission to grant Crew access has changed.");
  if (data.taskId) {
    const [task, taskAccess] = await Promise.all([
      fetchTaskDetail(crewId, data.taskId, signal),
      fetchTaskCommentAccess(crewId, userId, signal),
    ]);
    if (
      !taskAccess.canManage ||
      task.version !== data.taskVersion ||
      task.isRecruiting !== false ||
      task.assignees.length ||
      ["submitted", "approved", "cancelled"].includes(task.status)
    )
      throw Error("Task invitation is unavailable. Refresh the task before inviting.");
  }
  current(generation, signal);
  const pending = crewLinkPending(crewId, userId, generation, data.taskId);
  pending.save({ kind: "create", input: data, startedAt: new Date().toISOString() });
  const receipt = rowSchema.extend({ token: z.string().regex(/^[A-Za-z0-9_-]{32}$/) }).parse(
    await api.post(`/crews/${crewId}/invite-links`, {
      service: "aurora",
      data,
      signal,
      retry: false,
    })
  );
  current(generation, signal);
  if (
    (receipt.taskId ?? undefined) !== data.taskId ||
    (receipt.taskVersion ?? undefined) !== data.taskVersion ||
    receipt.crewId !== crewId ||
    receipt.createdByUserId !== userId ||
    receipt.kind !== data.kind ||
    receipt.state !== "active" ||
    receipt.useCount !== 0 ||
    receipt.maxUses !== (data.maxUses ?? null) ||
    [...receipt.policyKeys].sort().join() !== [...data.policyKeys].sort().join() ||
    (data.expiresInDays === undefined
      ? receipt.expiresAt !== null
      : receipt.expiresAt === null ||
        Math.abs(
          Date.parse(receipt.expiresAt) -
            Date.parse(receipt.createdAt) -
            data.expiresInDays * 86400000
        ) > 60000)
  )
    throw new Error(
      "Link creation could not be verified. Review the link list before another attempt."
    );
  pending.clear();
  return receipt;
}
export async function revokeCrewLink(
  crewId: string,
  userId: string,
  generation: number,
  link: CrewLink,
  signal: AbortSignal
) {
  const row = rowSchema.parse(link);
  if (row.crewId !== crewId || row.state === "revoked")
    throw new Error("Invitation link scope or status changed.");
  await teamInvitationAccess(crewId, userId, generation, signal);
  current(generation, signal);
  const pending = crewLinkPending(crewId, userId, generation, row.taskId ?? undefined);
  pending.save({ kind: "revoke", link: row, startedAt: new Date().toISOString() });
  await api.delete(`/crews/${crewId}/invite-links/${row.id}`, {
    service: "aurora",
    signal,
    retry: false,
  });
  current(generation, signal);
  pending.clear();
}
export function crewLinkUrl(token: string, region: "global" | "cn") {
  z.string()
    .regex(/^[A-Za-z0-9_-]{32}$/)
    .parse(token);
  return `${region === "cn" ? "https://fizzdragon.fizzspace.cn" : "https://fizzdragon.com"}/crew-invite/${token}`;
}
