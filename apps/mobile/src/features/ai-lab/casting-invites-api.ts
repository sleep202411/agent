import { z } from "zod";
import { api } from "@/lib/api-client";
import { durableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
import { generationSession } from "./jobs-api";
import { getGenerationProject, type GenerationProject } from "./projects-api";
const id = z.string().uuid();
export const castingInvite = z.object({
  id,
  projectId: id,
  inviteeUserId: z.string().nullable(),
  inviteeContact: z.string().nullable(),
  status: z.enum(["pending", "accepted", "declined", "expired", "revoked"]),
  expiresAt: z.string().datetime({ offset: true }),
  createdAt: z.string().datetime({ offset: true }),
  respondedAt: z.string().nullable(),
});
export type CastingInvite = z.infer<typeof castingInvite>;
export const createdCastingInvite = z.object({
  id,
  token: z.string().regex(/^[A-Za-z0-9_-]{32}$/),
  expiresAt: z.string().datetime({ offset: true }),
});
export type CreatedCastingInvite = z.infer<typeof createdCastingInvite>;
export const castingRecipient = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("user"), value: z.string().trim().min(1).max(64) }),
  z.object({ mode: z.literal("contact"), value: z.string().trim().min(1).max(256) }),
]);
const base = z.object({ clientKey: id, workspaceId: id, projectId: id });
export const castingCommand = z.discriminatedUnion("action", [
  base.extend({ action: z.literal("create"), recipient: castingRecipient }),
  base.extend({ action: z.literal("revoke"), inviteId: id }),
]);
export type CastingCommand = z.infer<typeof castingCommand>;
export function castingBox(user: string, generation: number, project: GenerationProject) {
  return pendingRequest(
    castingCommand,
    generation,
    durableRecord("casting-invites", user, `${project.workspaceId}:${project.id}`)
  );
}
async function requireEditor(project: GenerationProject, generation: number, signal: AbortSignal) {
  generationSession(generation, signal);
  if (project.kind !== "platform" || project.projectId !== project.id)
    throw new Error("Casting invitations require a Creative project.");
  const fresh = await getGenerationProject(project.workspaceId, project, generation, signal);
  if (!fresh.canGenerate)
    throw new Error("Project editor permission is required to manage casting invitations.");
}
export async function listCastingInvites(
  project: GenerationProject,
  generation: number,
  signal: AbortSignal
) {
  await requireEditor(project, generation, signal);
  const rows = z.object({ items: z.array(castingInvite) }).parse(
    await api.get(`/projects/${project.id}/casting-invites`, {
      service: "aurora",
      signal,
      retry: false,
    })
  ).items;
  generationSession(generation, signal);
  if (
    rows.some((r) => r.projectId !== project.id) ||
    new Set(rows.map((r) => r.id)).size !== rows.length
  )
    throw new Error("Casting invitations do not match the selected project.");
  return rows;
}
/** No server request key: an uncertain create is retained for review and is never replayed. */
export async function writeCastingInvite(
  command: CastingCommand,
  user: string,
  generation: number,
  project: GenerationProject,
  signal: AbortSignal
) {
  generationSession(generation, signal);
  const intent = castingCommand.parse(command);
  if (intent.workspaceId !== project.workspaceId || intent.projectId !== project.id)
    throw new Error("Casting invitation project mismatch.");
  const box = castingBox(user, generation, project);
  if (box.read()) throw new Error("Review the pending casting change before submitting again.");
  const rows = await listCastingInvites(project, generation, signal);
  if (
    intent.action === "revoke" &&
    !rows.some((r) => r.id === intent.inviteId && r.status === "pending")
  )
    throw new Error("The invitation changed. Refresh and review its current status.");
  box.save(intent);
  let created: CreatedCastingInvite | undefined;
  if (intent.action === "create") {
    created = createdCastingInvite.parse(
      await api.post(`/projects/${project.id}/casting-invites`, {
        service: "aurora",
        signal,
        retry: false,
        data:
          intent.recipient.mode === "user"
            ? { inviteeUserId: intent.recipient.value }
            : { inviteeContact: intent.recipient.value },
      })
    );
    if (rows.some((r) => r.id === created!.id))
      throw new Error("Casting invitation receipt mismatch.");
  } else {
    z.object({ ok: z.literal(true) }).parse(
      await api.delete(`/projects/${project.id}/casting-invites/${intent.inviteId}`, {
        service: "aurora",
        signal,
        retry: false,
      })
    );
  }
  generationSession(generation, signal);
  box.clear(intent.clientKey);
  return created;
}
export function castingAcceptUrl(token: string, region: "global" | "cn") {
  createdCastingInvite.shape.token.parse(token);
  return `https://${region === "cn" ? "studio.fizzspace.cn" : "studio.fizzdragon.com"}/casting/accept?token=${encodeURIComponent(token)}`;
}
