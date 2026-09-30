import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { inviteRoles, type StudioInviteRole, type StudioInviteScope } from "./studio-invites-api";
export type StudioMemberScope = StudioInviteScope;
const memberSchema = z.object({
  memberId: z.string().uuid(),
  userId: z.string().min(1),
  nickname: z.string().nullable(),
  role: z.enum(["owner", "billing", "admin", "producer", "editor", "reviewer", "viewer"]),
  status: z.literal("active"),
  accessScope: z.enum(["workspace", "project_only"]).optional(),
  isOwner: z.boolean(),
  isSelf: z.boolean(),
});
export type StudioMember = z.infer<typeof memberSchema>;
export type StudioMembersState = {
  members: StudioMember[];
  canAdd: boolean;
  canRemove: boolean;
  canEdit: boolean;
};
function path(scope: StudioMemberScope) {
  z.string().uuid().parse(scope.id);
  if (scope.kind !== "workspace" && scope.kind !== "project" && scope.kind !== "story-project")
    throw new Error("Invalid member scope.");
  return `/${scope.kind === "workspace" ? "workspaces" : scope.kind === "project" ? "projects" : "story-projects"}/${scope.id}`;
}
function current(generation: number, signal?: AbortSignal) {
  if (signal?.aborted || generation !== getAuthGeneration())
    throw new Error("Studio member session expired or request cancelled.");
}
export async function fetchStudioMembers(
  scope: StudioMemberScope,
  generation: number,
  signal?: AbortSignal
): Promise<StudioMembersState> {
  current(generation, signal);
  const base = path(scope);
  let canAdd = false,
    canEdit = false;
  const detail = await api.get(base, { service: "aurora", signal });
  current(generation, signal);
  if (scope.kind === "workspace") {
    const { workspace } = z
      .object({
        workspace: z.object({
          id: z.string().uuid(),
          status: z.enum(["active", "suspended", "archived"]),
          role: z.string().optional(),
          accessScope: z.string().optional(),
        }),
      })
      .parse(detail);
    if (workspace.id !== scope.id) throw new Error("Workspace scope mismatch.");
    canAdd =
      workspace.status === "active" &&
      workspace.accessScope === "workspace" &&
      ["owner", "admin"].includes(workspace.role ?? "");
    canEdit = canAdd && workspace.role === "owner";
  } else if (scope.kind === "project") {
    const { project } = z
      .object({
        project: z.object({
          id: z.string().uuid(),
          status: z.enum(["active", "archived"]),
          role: z.enum(["owner", "admin", "editor", "viewer"]).optional(),
        }),
      })
      .parse(detail);
    if (project.id !== scope.id) throw new Error("Project scope mismatch.");
    canAdd = project.status === "active" && ["owner", "admin"].includes(project.role ?? "");
    canEdit = canAdd;
  } else {
    const project = z
      .object({
        id: z.string().uuid(),
        status: z.enum(["active", "archived"]),
        capabilities: z.array(z.string()),
      })
      .parse(detail);
    if (project.id !== scope.id) throw new Error("Story project scope mismatch.");
    canAdd = project.status === "active" && project.capabilities.includes("story.admin");
    canEdit = canAdd;
  }
  const members = z
    .array(memberSchema)
    .parse(await api.get(`${base}/members`, { service: "aurora", signal }));
  current(generation, signal);
  const roles =
    scope.kind === "workspace"
      ? ["owner", "billing", ...inviteRoles(scope)]
      : ["owner", ...inviteRoles(scope)];
  if (
    new Set(members.map((m) => m.memberId)).size !== members.length ||
    new Set(members.map((m) => m.userId)).size !== members.length ||
    members.some((m) => !roles.includes(m.role) || m.isOwner !== (m.role === "owner"))
  )
    throw new Error("Invalid Studio member list.");
  return { members, canAdd, canRemove: canAdd, canEdit };
}
export type StudioMemberChange =
  | { kind: "add"; account: string; role: StudioInviteRole }
  | { kind: "role"; member: StudioMember; role: StudioInviteRole }
  | { kind: "remove"; member: StudioMember };
export class StudioMemberWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioMemberWriteError";
  }
}
export async function changeStudioMember(
  scope: StudioMemberScope,
  generation: number,
  change: StudioMemberChange,
  signal?: AbortSignal
) {
  if (change.kind !== "remove" && !inviteRoles(scope).includes(change.role))
    throw new Error("Invalid member role.");
  const account = change.kind === "add" ? change.account.trim() : "";
  if (
    change.kind === "add" &&
    (account.length < 3 ||
      account.length > 120 ||
      !(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account) || /^\+?[0-9][0-9\s-]{5,19}$/.test(account)))
  )
    throw new Error("Enter a valid email or phone number.");
  const fresh = await fetchStudioMembers(scope, generation, signal);
  if (
    !(change.kind === "add"
      ? fresh.canAdd
      : change.kind === "role"
        ? fresh.canEdit
        : fresh.canRemove)
  )
    throw new Error("Studio member management permission is required.");
  if (change.kind !== "add") {
    const member = fresh.members.find((m) => m.memberId === change.member.memberId);
    if (
      !member ||
      member.userId !== change.member.userId ||
      member.role !== change.member.role ||
      member.accessScope !== change.member.accessScope
    )
      throw new Error("Member changed. Refresh before continuing.");
    if (member.isOwner) throw new Error("The owner cannot be changed or removed.");
    if (
      change.kind === "remove" &&
      scope.kind === "workspace" &&
      member.accessScope === "project_only"
    )
      throw new Error("Remove this person from their projects instead.");
  }
  current(generation, signal);
  const base = `${path(scope)}/members`;
  // These endpoints offer no compare-and-set version. The server remains authoritative at write time.
  try {
    if (change.kind === "remove") {
      z.object({ removed: z.literal(true) }).parse(
        await api.delete(`${base}/${change.member.memberId}`, { service: "aurora", data: {} })
      );
    } else {
      const raw =
        change.kind === "add"
          ? await api.post(base, { service: "aurora", data: { account, role: change.role } })
          : await api.patch(`${base}/${change.member.memberId}`, {
              service: "aurora",
              data: { role: change.role },
            });
      const member = memberSchema.parse(raw);
      if (
        member.role !== change.role ||
        member.isOwner ||
        (change.kind === "role" &&
          (member.memberId !== change.member.memberId || member.userId !== change.member.userId))
      )
        throw new Error("Member change receipt mismatch.");
    }
    current(generation);
  } catch (e) {
    throw new StudioMemberWriteError(e instanceof Error ? e.message : String(e));
  }
}
