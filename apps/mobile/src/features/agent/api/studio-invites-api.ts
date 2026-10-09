import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
export type StudioInviteScope = {
  kind: "workspace" | "project" | "story-project";
  id: string;
  name: string;
};
export type StudioInviteRole = "admin" | "producer" | "editor" | "reviewer" | "viewer";
export const inviteRoles = (scope: StudioInviteScope): StudioInviteRole[] =>
  scope.kind !== "story-project"
    ? ["admin", "editor", "viewer"]
    : ["producer", "editor", "reviewer", "viewer"];
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{32}$/);
const rowSchema = z.object({
  inviteId: z.string().uuid(),
  role: z.enum(["admin", "producer", "editor", "reviewer", "viewer"]),
  status: z.enum(["pending", "accepted", "revoked", "expired"]),
  createdAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }).nullable(),
});
export type StudioInvite = z.infer<typeof rowSchema>;
export type CreatedStudioInvite = Pick<StudioInvite, "inviteId" | "role" | "expiresAt"> & {
  token: string;
};
export class StudioInviteWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioInviteWriteError";
  }
}
function base(scope: StudioInviteScope) {
  z.string().uuid().parse(scope.id);
  if (scope.kind !== "workspace" && scope.kind !== "project" && scope.kind !== "story-project")
    throw new Error("Invalid sharing scope.");
  return `/${scope.kind === "workspace" ? "workspaces" : scope.kind === "project" ? "projects" : "story-projects"}/${scope.id}/invites`;
}
function current(generation: number, signal?: AbortSignal) {
  if (generation !== getAuthGeneration() || signal?.aborted)
    throw new Error("Studio invitation session expired or request cancelled.");
}
export async function listStudioInvites(
  scope: StudioInviteScope,
  generation: number,
  signal?: AbortSignal
) {
  current(generation, signal);
  const rows = z.array(rowSchema).parse(await api.get(base(scope), { service: "aurora", signal }));
  current(generation, signal);
  if (
    new Set(rows.map((row) => row.inviteId)).size !== rows.length ||
    rows.some((row) => !inviteRoles(scope).includes(row.role))
  )
    throw new Error("Invalid Studio invitation list.");
  return rows;
}
export async function createStudioInvite(
  scope: StudioInviteScope,
  generation: number,
  role: StudioInviteRole,
  expiresInDays: number | null,
  signal?: AbortSignal
): Promise<CreatedStudioInvite> {
  if (!inviteRoles(scope).includes(role)) throw new Error("Invalid invitation role.");
  z.number().int().min(1).max(30).nullable().parse(expiresInDays);
  // Listing checks current server admin permission before a non-idempotent write.
  await listStudioInvites(scope, generation, signal);
  current(generation, signal);
  try {
    const row = rowSchema
      .pick({ inviteId: true, role: true, expiresAt: true })
      .extend({ token: tokenSchema })
      .parse(await api.post(base(scope), { service: "aurora", data: { role, expiresInDays } }));
    current(generation);
    if (row.role !== role || (row.expiresAt === null) !== (expiresInDays === null))
      throw new Error("Invitation receipt mismatch.");
    return row;
  } catch (error) {
    throw new StudioInviteWriteError(error instanceof Error ? error.message : String(error));
  }
}
export async function revokeStudioInvite(
  scope: StudioInviteScope,
  generation: number,
  inviteId: string,
  signal?: AbortSignal
) {
  z.string().uuid().parse(inviteId);
  const rows = await listStudioInvites(scope, generation, signal);
  if (!rows.some((row) => row.inviteId === inviteId))
    throw new Error("Invitation changed. Refresh the list.");
  current(generation, signal);
  try {
    z.object({ revoked: z.literal(true) }).parse(
      await api.delete(`${base(scope)}/${inviteId}`, { service: "aurora", data: {} })
    );
    current(generation);
  } catch (error) {
    throw new StudioInviteWriteError(error instanceof Error ? error.message : String(error));
  }
}
export function studioInviteUrl(token: string, region: "global" | "cn") {
  tokenSchema.parse(token);
  return `https://${region === "cn" ? "studio.fizzspace.cn" : "studio.fizzdragon.com"}/invite/${token}`;
}
