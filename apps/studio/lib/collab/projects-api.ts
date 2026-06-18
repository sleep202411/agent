import { api } from "@/lib/api";

/**
 * Server-backed project + collaborative-document resolution.
 *
 * A studio "project" is a server PlatformProject (under the user's personal
 * workspace); its canvas is the project's primary `canvas` PlatformDocument.
 * These wrap the NestJS `/aurora/*` routes (satoken cookie auth, `{code,data}`
 * envelope unwrapped by `api`).
 */

export type WorkspaceRole = "owner" | "admin" | "billing" | "editor" | "viewer";

export interface WorkspaceRef {
  id: string;
  name: string;
  type: "personal" | "team";
  /** The current user's role in this workspace. */
  role?: WorkspaceRole;
  /** Team icon URL (preset or uploaded); null falls back to a letter avatar. */
  avatarUrl?: string | null;
  defaultProjectId: string | null;
}

export interface CreateTeamWorkspaceInput {
  name: string;
  description?: string;
  avatarUrl?: string;
}

export type ProjectRole = "owner" | "admin" | "editor" | "viewer";

export interface ProjectRef {
  id: string;
  workspaceId: string;
  name: string;
  status: "active" | "archived";
  visibility: "private" | "workspace" | "public";
  /** The caller's effective role (present on getProject; gates the UI). */
  role?: ProjectRole;
  updatedAt: string;
}

export interface ModeDocumentRef {
  id: string;
  projectId: string;
  workspaceId: string;
  type: string;
  title: string;
  collaborationRoomId: string | null;
  currentSequence: number;
  snapshotSequence: number;
  /** The version the document currently points at (for the history "current" marker). */
  currentVersionId: string | null;
  /** Base64 compacted CRDT state (present once the doc has been compacted). */
  crdtStateBase64?: string;
  version: number;
}

export interface CreateProjectInput {
  name: string;
  visibility?: "private" | "workspace" | "public";
  description?: string;
}

/** Idempotent — the user's personal workspace, created on first call. */
export async function ensurePersonalWorkspace(): Promise<WorkspaceRef> {
  const data = await api.post<{ workspace: WorkspaceRef }>("/aurora/workspaces/personal/ensure");
  return data.workspace;
}

/** Every workspace the user belongs to (personal + teams), with their role. */
export async function listWorkspaces(): Promise<WorkspaceRef[]> {
  const data = await api.get<{ workspaces: WorkspaceRef[] }>("/aurora/workspaces");
  return data.workspaces;
}

/** Create a shared team workspace (the user becomes its owner). */
export async function createTeamWorkspace(input: CreateTeamWorkspaceInput): Promise<WorkspaceRef> {
  const data = await api.post<{ workspace: WorkspaceRef }>("/aurora/workspaces/team", {
    data: input,
  });
  return data.workspace;
}

/** Rename / edit a workspace (team rename, etc.). Returns the updated ref. */
export async function updateWorkspace(
  workspaceId: string,
  input: { name?: string; description?: string | null }
): Promise<WorkspaceRef> {
  const data = await api.patch<{ workspace: WorkspaceRef }>(`/aurora/workspaces/${workspaceId}`, {
    data: input,
  });
  return data.workspace;
}

/** Soft-delete a team workspace (owner only). */
export async function deleteWorkspace(workspaceId: string): Promise<void> {
  await api.delete(`/aurora/workspaces/${workspaceId}`, { data: {} });
}

export async function listProjects(workspaceId: string): Promise<ProjectRef[]> {
  const data = await api.get<{ projects: ProjectRef[] }>(
    `/aurora/workspaces/${workspaceId}/projects`
  );
  return data.projects;
}

export async function createProject(
  workspaceId: string,
  input: CreateProjectInput
): Promise<ProjectRef> {
  const data = await api.post<{ project: ProjectRef }>(
    `/aurora/workspaces/${workspaceId}/projects`,
    { data: input }
  );
  return data.project;
}

export async function getProject(projectId: string): Promise<ProjectRef> {
  const data = await api.get<{ project: ProjectRef }>(`/aurora/projects/${projectId}`);
  return data.project;
}

export async function renameProject(projectId: string, name: string): Promise<ProjectRef> {
  const data = await api.patch<{ project: ProjectRef }>(`/aurora/projects/${projectId}`, {
    data: { name },
  });
  return data.project;
}

/** Soft-deletes (archives) the project; it drops out of the active list. */
export async function deleteProject(projectId: string): Promise<void> {
  await api.delete(`/aurora/projects/${projectId}`, { data: {} });
}

/**
 * Idempotent — the project's primary document of a given mode (`type`), created
 * on first open. This is the multi-mode resolution primitive; each mode resolves
 * its own document this way.
 */
export async function ensureModeDocument(
  projectId: string,
  type: string
): Promise<ModeDocumentRef> {
  const data = await api.post<{ document: ModeDocumentRef }>(
    `/aurora/projects/${projectId}/documents/${type}/ensure`
  );
  return data.document;
}

/** Idempotent — the project's primary `canvas` document. */
export function ensureCanvasDocument(projectId: string): Promise<ModeDocumentRef> {
  return ensureModeDocument(projectId, "canvas");
}
