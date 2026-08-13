import { api } from "@/lib/api";

/**
 * Team-collaboration sharing fetchers — workspace (and later project) member
 * management over `/aurora/.../members`. Wraps the NestJS routes; `{code,data}`
 * is unwrapped by `api`.
 */

export type AssignableRole = "admin" | "editor" | "viewer";

/**
 * A Story project carries its own role ladder with story capabilities attached
 * to each rung, so it does not reuse the platform admin/editor/viewer set.
 */
export type AssignableStoryRole = "producer" | "editor" | "reviewer" | "viewer";

export type AssignableShareRole = AssignableRole | AssignableStoryRole;

export interface SharingMember {
  memberId: string;
  userId: string;
  nickname: string | null;
  avatar: string | null;
  role: "owner" | AssignableShareRole;
  status: string;
  accessScope?: "workspace" | "project_only";
  joinedAt: string | null;
  isOwner: boolean;
  isSelf: boolean;
}

export async function listWorkspaceMembers(workspaceId: string): Promise<SharingMember[]> {
  return api.get<SharingMember[]>(`/aurora/workspaces/${workspaceId}/members`);
}

export async function addWorkspaceMember(
  workspaceId: string,
  account: string,
  role: AssignableRole
): Promise<SharingMember> {
  return api.post<SharingMember>(`/aurora/workspaces/${workspaceId}/members`, {
    data: { account, role },
  });
}

export async function updateWorkspaceMemberRole(
  workspaceId: string,
  memberId: string,
  role: AssignableRole
): Promise<SharingMember> {
  return api.patch<SharingMember>(`/aurora/workspaces/${workspaceId}/members/${memberId}`, {
    data: { role },
  });
}

export async function removeWorkspaceMember(workspaceId: string, memberId: string): Promise<void> {
  await api.delete(`/aurora/workspaces/${workspaceId}/members/${memberId}`, { data: {} });
}

// ── Project members (per-project sharing) ──────────────────────────────────

export async function listProjectMembers(projectId: string): Promise<SharingMember[]> {
  return api.get<SharingMember[]>(`/aurora/projects/${projectId}/members`);
}

export async function addProjectMember(
  projectId: string,
  account: string,
  role: AssignableRole
): Promise<SharingMember> {
  return api.post<SharingMember>(`/aurora/projects/${projectId}/members`, {
    data: { account, role },
  });
}

export async function updateProjectMemberRole(
  projectId: string,
  memberId: string,
  role: AssignableRole
): Promise<SharingMember> {
  return api.patch<SharingMember>(`/aurora/projects/${projectId}/members/${memberId}`, {
    data: { role },
  });
}

export async function removeProjectMember(projectId: string, memberId: string): Promise<void> {
  await api.delete(`/aurora/projects/${projectId}/members/${memberId}`, { data: {} });
}

// ── Story-project members ──────────────────────────────────────────────────

export async function listStoryProjectMembers(projectId: string): Promise<SharingMember[]> {
  return api.get<SharingMember[]>(`/aurora/story-projects/${projectId}/members`);
}

export async function addStoryProjectMember(
  projectId: string,
  account: string,
  role: AssignableShareRole
): Promise<SharingMember> {
  return api.post<SharingMember>(`/aurora/story-projects/${projectId}/members`, {
    data: { account, role },
  });
}

export async function updateStoryProjectMemberRole(
  projectId: string,
  memberId: string,
  role: AssignableShareRole
): Promise<SharingMember> {
  return api.patch<SharingMember>(`/aurora/story-projects/${projectId}/members/${memberId}`, {
    data: { role },
  });
}

export async function removeStoryProjectMember(projectId: string, memberId: string): Promise<void> {
  await api.delete(`/aurora/story-projects/${projectId}/members/${memberId}`, { data: {} });
}

// ── Scope dispatch (workspace | project | story-project) ───────────────────

export type ShareScope =
  | { kind: "workspace"; id: string; name: string }
  | { kind: "project"; id: string; name: string }
  | { kind: "story-project"; id: string; name: string };

const PLATFORM_ROLES: readonly AssignableShareRole[] = ["admin", "editor", "viewer"];
const STORY_ROLES: readonly AssignableShareRole[] = ["producer", "editor", "reviewer", "viewer"];

/** The roles a given scope can actually assign — drives the role pickers. */
export function rolesForScope(scope: ShareScope): readonly AssignableShareRole[] {
  return scope.kind === "story-project" ? STORY_ROLES : PLATFORM_ROLES;
}

/** Least-privilege default, so sharing never over-grants by accident. */
export function defaultRoleForScope(scope: ShareScope): AssignableShareRole {
  return scope.kind === "story-project" ? "viewer" : "editor";
}

export function listMembers(scope: ShareScope): Promise<SharingMember[]> {
  if (scope.kind === "workspace") return listWorkspaceMembers(scope.id);
  if (scope.kind === "story-project") return listStoryProjectMembers(scope.id);
  return listProjectMembers(scope.id);
}

export function addMember(
  scope: ShareScope,
  account: string,
  role: AssignableShareRole
): Promise<SharingMember> {
  if (scope.kind === "workspace") {
    return addWorkspaceMember(scope.id, account, role as AssignableRole);
  }
  if (scope.kind === "story-project") {
    return addStoryProjectMember(scope.id, account, role);
  }
  return addProjectMember(scope.id, account, role as AssignableRole);
}

export function updateMemberRole(
  scope: ShareScope,
  memberId: string,
  role: AssignableShareRole
): Promise<SharingMember> {
  if (scope.kind === "workspace") {
    return updateWorkspaceMemberRole(scope.id, memberId, role as AssignableRole);
  }
  if (scope.kind === "story-project") {
    return updateStoryProjectMemberRole(scope.id, memberId, role);
  }
  return updateProjectMemberRole(scope.id, memberId, role as AssignableRole);
}

export function removeMember(scope: ShareScope, memberId: string): Promise<void> {
  if (scope.kind === "workspace") return removeWorkspaceMember(scope.id, memberId);
  if (scope.kind === "story-project") return removeStoryProjectMember(scope.id, memberId);
  return removeProjectMember(scope.id, memberId);
}

// ── Invite links (token) ───────────────────────────────────────────────────

/** Returned once at creation — the raw token never comes back on a later list. */
export interface CreatedInvite {
  inviteId: string;
  token: string;
  role: string;
  expiresAt: string;
}

/** A pending link as listed to an admin (no raw token). */
export interface ShareInvite {
  inviteId: string;
  role: string;
  status: string;
  createdAt: string;
  expiresAt: string;
}

export interface InvitePreview {
  scope: "workspace" | "project" | "story-project";
  targetName: string;
  role: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: string;
}

export type AcceptedInvite =
  | { scope: "workspace"; workspaceId: string; targetName: string }
  | { scope: "project"; projectId: string; targetName: string }
  | { scope: "story-project"; storyProjectId: string; targetName: string };

function scopeBase(scope: ShareScope): string {
  if (scope.kind === "workspace") return `/aurora/workspaces/${scope.id}/invites`;
  if (scope.kind === "story-project") return `/aurora/story-projects/${scope.id}/invites`;
  return `/aurora/projects/${scope.id}/invites`;
}

export function listInvites(scope: ShareScope): Promise<ShareInvite[]> {
  return api.get<ShareInvite[]>(scopeBase(scope));
}

export function createInvite(
  scope: ShareScope,
  role: AssignableShareRole,
  expiresInDays = 7
): Promise<CreatedInvite> {
  return api.post<CreatedInvite>(scopeBase(scope), { data: { role, expiresInDays } });
}

export async function revokeInvite(scope: ShareScope, inviteId: string): Promise<void> {
  await api.delete(`${scopeBase(scope)}/${inviteId}`, { data: {} });
}

/** Scope-agnostic accept-flow (token resolves to either scope server-side). */
export function previewInvite(token: string): Promise<InvitePreview> {
  return api.get<InvitePreview>("/aurora/invites/preview", { params: { token } });
}

export function acceptInvite(token: string): Promise<AcceptedInvite> {
  return api.post<AcceptedInvite>("/aurora/invites/accept", { data: { token } });
}

/** Build the shareable URL from the current origin — never hardcode a host. */
export function inviteUrl(token: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/invite/${token}`;
}
