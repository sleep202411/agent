import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
export { parseStudioInviteLink } from "../studio-invite-link";
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{32}$/);
const targetFields = { workspaceId: z.string().uuid(), targetName: z.string() };
const targetSchema = z.discriminatedUnion("scope", [
  z.object({ ...targetFields, scope: z.literal("workspace") }),
  z.object({ ...targetFields, scope: z.literal("project"), projectId: z.string().uuid() }),
  z.object({
    ...targetFields,
    scope: z.literal("story-project"),
    storyProjectId: z.string().uuid(),
  }),
]);
export type StudioInviteTarget = z.infer<typeof targetSchema>;
const previewSchema = z.object({
  scope: z.enum(["workspace", "project", "story-project"]),
  targetName: z.string(),
  role: z.enum(["admin", "producer", "editor", "reviewer", "viewer"]),
  status: z.enum(["pending", "accepted", "revoked", "expired"]),
  expiresAt: z.string().datetime({ offset: true }).nullable(),
  existingAccess: targetSchema.nullable(),
  currentRole: z.string().optional(),
});
export type StudioInvitePreview = z.infer<typeof previewSchema>;

function current(generation: number, signal?: AbortSignal) {
  if (signal?.aborted || generation !== getAuthGeneration())
    throw new Error("Invitation session expired or request cancelled.");
}
export async function previewStudioInvite(token: string, generation: number, signal?: AbortSignal) {
  tokenSchema.parse(token);
  current(generation, signal);
  const result = previewSchema.parse(
    await api.get("/invites/preview", { service: "aurora", params: { token }, signal })
  );
  current(generation, signal);
  const roles =
    result.scope === "story-project"
      ? ["producer", "editor", "reviewer", "viewer"]
      : ["admin", "editor", "viewer"];
  if (
    !roles.includes(result.role) ||
    (result.existingAccess &&
      (result.existingAccess.scope !== result.scope ||
        result.existingAccess.targetName !== result.targetName))
  )
    throw new Error("Invitation preview scope mismatch.");
  return result;
}
export function canAcceptStudioInvite(preview: StudioInvitePreview) {
  return (
    !preview.existingAccess &&
    preview.status === "pending" &&
    (preview.expiresAt === null || Date.parse(preview.expiresAt) > Date.now())
  );
}
export class StudioInviteAcceptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioInviteAcceptError";
  }
}
export async function acceptStudioInvite(
  token: string,
  reviewed: StudioInvitePreview,
  generation: number,
  signal?: AbortSignal
): Promise<StudioInviteTarget> {
  const fresh = await previewStudioInvite(token, generation, signal);
  // Changes in the offered membership require a new explicit review.
  if (
    fresh.scope !== reviewed.scope ||
    fresh.targetName !== reviewed.targetName ||
    fresh.role !== reviewed.role ||
    fresh.expiresAt !== reviewed.expiresAt
  )
    throw new Error("Invitation changed. Preview the link again before joining.");
  if (reviewed.existingAccess && !fresh.existingAccess)
    throw new Error("Your access changed. Preview the invitation again.");
  if (fresh.existingAccess) return fresh.existingAccess;
  if (!canAcceptStudioInvite(fresh)) throw new Error("This invitation is no longer available.");
  current(generation, signal);
  try {
    const target = targetSchema.parse(
      await api.post("/invites/accept", { service: "aurora", data: { token } })
    );
    current(generation);
    if (target.scope !== fresh.scope || target.targetName !== fresh.targetName)
      throw new Error("Invitation acceptance could not be verified.");
    return target;
  } catch (error) {
    throw new StudioInviteAcceptError(error instanceof Error ? error.message : String(error));
  }
}
export function studioInviteTargetUrl(target: StudioInviteTarget, region: "global" | "cn") {
  const checked = targetSchema.parse(target);
  const origin = region === "cn" ? "https://studio.fizzspace.cn" : "https://studio.fizzdragon.com";
  const path =
    checked.scope === "project"
      ? `/project/${checked.projectId}`
      : checked.scope === "story-project"
        ? `/story-studio/projects/${checked.storyProjectId}/canvas`
        : "/canvas";
  return `${origin}${path}?ws=${checked.workspaceId}`;
}

/** Native destination after the invitation receipt has been checked. */
export function studioInviteTargetRoute(target: StudioInviteTarget) {
  const checked = targetSchema.parse(target);
  if (checked.scope === "project")
    return `/studio-project?projectId=${checked.projectId}&workspaceId=${checked.workspaceId}`;
  if (checked.scope === "story-project")
    return `/agent/${checked.storyProjectId}?mode=story&title=${encodeURIComponent(checked.targetName)}`;
  return `/studio-projects?workspaceId=${checked.workspaceId}`;
}
