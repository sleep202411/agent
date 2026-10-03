import { api } from "@/lib/api";

/**
 * Server-backed project + collaborative-document resolution.
 *
 * A studio "project" is a server PlatformProject (under the user's personal
 * workspace); each project section owns one `canvas` StudioDocument.
 * These wrap the NestJS `/aurora/*` routes (satoken cookie auth, `{code,data}`
 * envelope unwrapped by `api`).
 */

export type WorkspaceRole = "owner" | "admin" | "billing" | "editor" | "viewer";

export interface WorkspaceRef {
  id: string;
  name: string;
  isDefault: boolean;
  accessScope?: "workspace" | "project_only";
  /** The current user's role in this workspace. */
  role?: WorkspaceRole;
  /** Additive access inherited from a linked production crew. */
  crewRole?: "viewer" | "editor";
  /** Team icon URL (preset or uploaded); null falls back to a letter avatar. */
  avatarUrl?: string | null;
  defaultProjectId: string | null;
}

export interface CreateWorkspaceInput {
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
  /** Free-form project description (shown/edited in the overview panel). */
  description?: string | null;
  /** The caller's effective role (present on getProject; gates the UI). */
  role?: ProjectRole;
  /** Explicit cover asset id; null means the thumbnail is auto-derived. */
  coverAssetId?: string | null;
  /** Explicit cover image, else the earliest image in the canvas asset library. */
  thumbnailUrl?: string | null;
  updatedAt: string;
}

export interface ModeDocumentRef {
  id: string;
  owner:
    | { kind: "platform_project"; projectId: string }
    | { kind: "story_project"; projectId: string };
  platformProjectId: string | null;
  storyProjectId: string | null;
  storyChapterId: string | null;
  workspaceId: string;
  sectionId: string | null;
  type: string;
  title: string;
  collaborationRoomId: string | null;
  currentSequence: number;
  snapshotSequence: number;
  /** The version the document currently points at (for the history "current" marker). */
  currentVersionId: string | null;
  /** Base64 compacted CRDT state (present once the doc has been compacted). */
  crdtStateBase64?: string;
  /** Detail payload only: materialized document snapshot for non-CRDT editors. */
  contentSnapshot?: Record<string, unknown> | null;
  version: number;
}

export interface CreateProjectInput {
  name: string;
  initialSectionTitle: string;
  projectType?: string;
  visibility?: "private" | "workspace" | "public";
  description?: string;
}

export interface ProjectSectionRef {
  id: string;
  projectId: string;
  title: string;
  rank: number;
  version: number;
  canvasDocumentId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSectionsCollection {
  projectVersion: number;
  sections: ProjectSectionRef[];
}

/** Idempotent — the user's default workspace, created on first call. */
export async function ensureDefaultWorkspace(signal?: AbortSignal): Promise<WorkspaceRef> {
  const data = await api.post<{ workspace: WorkspaceRef }>("/aurora/workspaces/default/ensure", {
    signal,
  });
  return data.workspace;
}

/** Every workspace the user belongs to, with their role. */
export async function listWorkspaces(signal?: AbortSignal): Promise<WorkspaceRef[]> {
  const data = await api.get<{ workspaces: WorkspaceRef[] }>("/aurora/workspaces", { signal });
  return data.workspaces;
}

/** Create a workspace (the user becomes its owner). */
export async function createWorkspace(
  input: CreateWorkspaceInput,
  signal?: AbortSignal
): Promise<WorkspaceRef> {
  const data = await api.post<{ workspace: WorkspaceRef }>("/aurora/workspaces", {
    data: input,
    signal,
  });
  return data.workspace;
}

/** Rename / edit a workspace Returns the updated ref. */
export async function updateWorkspace(
  workspaceId: string,
  input: { name?: string; description?: string | null },
  signal?: AbortSignal
): Promise<WorkspaceRef> {
  const data = await api.patch<{ workspace: WorkspaceRef }>(`/aurora/workspaces/${workspaceId}`, {
    data: input,
    signal,
  });
  return data.workspace;
}

/** Soft-delete a workspace (owner only). */
export async function deleteWorkspace(workspaceId: string, signal?: AbortSignal): Promise<void> {
  await api.delete(`/aurora/workspaces/${workspaceId}`, { data: {}, signal });
}

export async function listProjects(
  workspaceId: string,
  signal?: AbortSignal
): Promise<ProjectRef[]> {
  const data = await api.get<{ projects: ProjectRef[] }>(
    `/aurora/workspaces/${workspaceId}/projects`,
    { signal }
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

export async function getProject(projectId: string, signal?: AbortSignal): Promise<ProjectRef> {
  const data = await api.get<{ project: ProjectRef }>(`/aurora/projects/${projectId}`, { signal });
  return data.project;
}

export async function listProjectSections(projectId: string): Promise<ProjectSectionsCollection> {
  return api.get<ProjectSectionsCollection>(`/aurora/projects/${projectId}/sections`);
}

export async function createProjectSection(
  projectId: string,
  input: { title: string; expectedProjectVersion: number }
): Promise<ProjectSectionsCollection> {
  return api.post<ProjectSectionsCollection>(`/aurora/projects/${projectId}/sections`, {
    data: input,
  });
}

export async function updateProjectSection(
  projectId: string,
  sectionId: string,
  input: { title: string; expectedVersion: number }
): Promise<ProjectSectionsCollection> {
  return api.patch<ProjectSectionsCollection>(
    `/aurora/projects/${projectId}/sections/${sectionId}`,
    { data: input }
  );
}

export async function reorderProjectSections(
  projectId: string,
  input: { sectionIds: string[]; expectedProjectVersion: number }
): Promise<ProjectSectionsCollection> {
  return api.put<ProjectSectionsCollection>(`/aurora/projects/${projectId}/sections/order`, {
    data: input,
  });
}

export async function archiveProjectSection(
  projectId: string,
  sectionId: string,
  input: { expectedProjectVersion: number; expectedSectionVersion: number }
): Promise<ProjectSectionsCollection> {
  return api.post<ProjectSectionsCollection>(
    `/aurora/projects/${projectId}/sections/${sectionId}/archive`,
    { data: input }
  );
}

export async function renameProject(projectId: string, name: string): Promise<ProjectRef> {
  const data = await api.patch<{ project: ProjectRef }>(`/aurora/projects/${projectId}`, {
    data: { name },
  });
  return data.project;
}

/**
 * Edit project metadata. `name` matches the header's inline rename; `null`
 * for coverAssetId/description clears them (the thumbnail falls back to the
 * auto-derived canvas-first-image). Omitted fields are left untouched.
 */
export async function updateProject(
  projectId: string,
  input: { name?: string; coverAssetId?: string | null; description?: string | null }
): Promise<ProjectRef> {
  const data = await api.patch<{ project: ProjectRef }>(`/aurora/projects/${projectId}`, {
    data: input,
  });
  return data.project;
}

/** Soft-deletes (archives) the project; it drops out of the active list. */
export async function deleteProject(projectId: string): Promise<void> {
  await api.delete(`/aurora/projects/${projectId}`, { data: {} });
}

/** Resolves a project-wide document for non-section-managed modes. */
export async function ensureModeDocument(
  projectId: string,
  type: string,
  signal?: AbortSignal
): Promise<ModeDocumentRef> {
  const data = await api.post<{ document: ModeDocumentRef }>(
    `/aurora/projects/${projectId}/documents/${type}/ensure`,
    { signal }
  );
  return data.document;
}

/** Story's canvas and storyboard are two projections of this same document. */
export async function ensureStoryCanvasDocument(
  storyProjectId: string,
  signal?: AbortSignal
): Promise<ModeDocumentRef> {
  const data = await api.post<{ document: ModeDocumentRef }>(
    `/aurora/story-projects/${storyProjectId}/documents/canvas/ensure`,
    { signal }
  );
  return data.document;
}

/** One chapter's free-form screenplay — the chapter pipeline's source. */
export async function ensureStoryScriptDocument(
  storyProjectId: string,
  storyChapterId: string,
  signal?: AbortSignal
): Promise<ModeDocumentRef> {
  const data = await api.post<{ document: ModeDocumentRef }>(
    `/aurora/story-projects/${storyProjectId}/chapters/${storyChapterId}/documents/script/ensure`,
    { signal }
  );
  return data.document;
}

export async function getDocument(documentId: string): Promise<ModeDocumentRef> {
  const data = await api.get<{ document: ModeDocumentRef }>(`/aurora/documents/${documentId}`);
  return data.document;
}

export async function updateDocumentSnapshot(
  documentId: string,
  input: {
    title?: string;
    contentSnapshot: Record<string, unknown>;
    expectedVersion?: number;
  }
): Promise<ModeDocumentRef> {
  const data = await api.patch<{ document: ModeDocumentRef }>(`/aurora/documents/${documentId}`, {
    data: input,
  });
  return data.document;
}
