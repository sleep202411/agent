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

export async function listWorkspaceMembers(
  workspaceId: string,
  signal?: AbortSignal
): Promise<SharingMember[]> {
  return api.get<SharingMember[]>(`/aurora/workspaces/${workspaceId}/members`, { signal });
}

export async function addWorkspaceMember(
  workspaceId: string,
  account: string,
  role: AssignableRole,
  signal?: AbortSignal
): Promise<SharingMember> {
  return api.post<SharingMember>(`/aurora/workspaces/${workspaceId}/members`, {
    signal,
    data: { account, role },
  });
}

export async function updateWorkspaceMemberRole(
  workspaceId: string,
  memberId: string,
  role: AssignableRole,
  signal?: AbortSignal
): Promise<SharingMember> {
  return api.patch<SharingMember>(`/aurora/workspaces/${workspaceId}/members/${memberId}`, {
    signal,
    data: { role },
  });
}

export async function removeWorkspaceMember(
  workspaceId: string,
  memberId: string,
  signal?: AbortSignal
): Promise<void> {
  await api.delete(`/aurora/workspaces/${workspaceId}/members/${memberId}`, { signal, data: {} });
}

// ── Project members (per-project sharing) ──────────────────────────────────

export async function listProjectMembers(
  projectId: string,
  signal?: AbortSignal
): Promise<SharingMember[]> {
  return api.get<SharingMember[]>(`/aurora/projects/${projectId}/members`, { signal });
}

export async function addProjectMember(
  projectId: string,
  account: string,
  role: AssignableRole,
  signal?: AbortSignal
): Promise<SharingMember> {
  return api.post<SharingMember>(`/aurora/projects/${projectId}/members`, {
    signal,
    data: { account, role },
  });
}

export async function updateProjectMemberRole(
  projectId: string,
  memberId: string,
  role: AssignableRole,
  signal?: AbortSignal
): Promise<SharingMember> {
  return api.patch<SharingMember>(`/aurora/projects/${projectId}/members/${memberId}`, {
    signal,
    data: { role },
  });
}

export async function removeProjectMember(
  projectId: string,
  memberId: string,
  signal?: AbortSignal
): Promise<void> {
  await api.delete(`/aurora/projects/${projectId}/members/${memberId}`, { signal, data: {} });
}

// ── Story-project members ──────────────────────────────────────────────────

export async function listStoryProjectMembers(
  projectId: string,
  signal?: AbortSignal
): Promise<SharingMember[]> {
  return api.get<SharingMember[]>(`/aurora/story-projects/${projectId}/members`, { signal });
}

export async function addStoryProjectMember(
  projectId: string,
  account: string,
  role: AssignableShareRole,
  signal?: AbortSignal
): Promise<SharingMember> {
  return api.post<SharingMember>(`/aurora/story-projects/${projectId}/members`, {
    signal,
    data: { account, role },
  });
}

export async function updateStoryProjectMemberRole(
  projectId: string,
  memberId: string,
  role: AssignableShareRole,
  signal?: AbortSignal
): Promise<SharingMember> {
  return api.patch<SharingMember>(`/aurora/story-projects/${projectId}/members/${memberId}`, {
    signal,
    data: { role },
  });
}

export async function removeStoryProjectMember(
  projectId: string,
  memberId: string,
  signal?: AbortSignal
): Promise<void> {
  await api.delete(`/aurora/story-projects/${projectId}/members/${memberId}`, { signal, data: {} });
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

export function listMembers(scope: ShareScope, signal?: AbortSignal): Promise<SharingMember[]> {
  if (scope.kind === "workspace") return listWorkspaceMembers(scope.id, signal);
  if (scope.kind === "story-project") return listStoryProjectMembers(scope.id, signal);
  return listProjectMembers(scope.id, signal);
}

export function addMember(
  scope: ShareScope,
  account: string,
  role: AssignableShareRole,
  signal?: AbortSignal
): Promise<SharingMember> {
  if (scope.kind === "workspace") {
    return addWorkspaceMember(scope.id, account, role as AssignableRole, signal);
  }
  if (scope.kind === "story-project") {
    return addStoryProjectMember(scope.id, account, role, signal);
  }
  return addProjectMember(scope.id, account, role as AssignableRole, signal);
}

export function updateMemberRole(
  scope: ShareScope,
  memberId: string,
  role: AssignableShareRole,
  signal?: AbortSignal
): Promise<SharingMember> {
  if (scope.kind === "workspace") {
    return updateWorkspaceMemberRole(scope.id, memberId, role as AssignableRole, signal);
  }
  if (scope.kind === "story-project") {
    return updateStoryProjectMemberRole(scope.id, memberId, role, signal);
  }
  return updateProjectMemberRole(scope.id, memberId, role as AssignableRole, signal);
}

export function removeMember(
  scope: ShareScope,
  memberId: string,
  signal?: AbortSignal
): Promise<void> {
  if (scope.kind === "workspace") return removeWorkspaceMember(scope.id, memberId, signal);
  if (scope.kind === "story-project") return removeStoryProjectMember(scope.id, memberId, signal);
  return removeProjectMember(scope.id, memberId, signal);
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
  existingAccess: AcceptedInvite | null;
  scope: "workspace" | "project" | "story-project";
  targetName: string;
  role: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: string;
}

export type AcceptedInvite =
  | { scope: "workspace"; workspaceId: string; targetName: string }
  | { scope: "project"; projectId: string; workspaceId: string; targetName: string }
  | { scope: "story-project"; storyProjectId: string; workspaceId: string; targetName: string };

function scopeBase(scope: ShareScope): string {
  if (scope.kind === "workspace") return `/aurora/workspaces/${scope.id}/invites`;
  if (scope.kind === "story-project") return `/aurora/story-projects/${scope.id}/invites`;
  return `/aurora/projects/${scope.id}/invites`;
}

export function listInvites(scope: ShareScope, signal?: AbortSignal): Promise<ShareInvite[]> {
  return api.get<ShareInvite[]>(scopeBase(scope), { signal });
}

export function createInvite(
  scope: ShareScope,
  role: AssignableShareRole,
  expiresInDays = 7,
  signal?: AbortSignal
): Promise<CreatedInvite> {
  return api.post<CreatedInvite>(scopeBase(scope), { signal, data: { role, expiresInDays } });
}

export async function revokeInvite(
  scope: ShareScope,
  inviteId: string,
  signal?: AbortSignal
): Promise<void> {
  await api.delete(`${scopeBase(scope)}/${inviteId}`, { signal, data: {} });
}

/** Scope-agnostic accept-flow (token resolves to either scope server-side). */
export function previewInvite(token: string, signal?: AbortSignal): Promise<InvitePreview> {
  return api.get<InvitePreview>("/aurora/invites/preview", { params: { token }, signal });
}

export function acceptInvite(token: string, signal?: AbortSignal): Promise<AcceptedInvite> {
  return api.post<AcceptedInvite>("/aurora/invites/accept", { data: { token }, signal });
}

/** Build the shareable URL from the current origin — never hardcode a host. */
export function inviteUrl(token: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/invite/${token}`;
}
