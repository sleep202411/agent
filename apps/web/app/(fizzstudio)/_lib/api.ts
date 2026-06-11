"use client";

/**
 * FizzStudio feature-local API layer.
 *
 * All calls go through /aurora/* → NestJS. Following the feature-local
 * convention from AGENTS.md: no shared service modules, each feature owns
 * its fetchers, types, and cache keys.
 */

import { api } from "@/src/lib/api";

// ─── Types ───────────────────────────────────────────────────────────────────

export type WorkspaceType = "personal" | "team";
export type WorkspaceStatus = "active" | "suspended" | "archived";
export type WorkspaceBillingMode = "member_pays" | "workspace_pool";
export type WorkspaceMemberRole = "owner" | "admin" | "editor" | "viewer" | "billing";

export interface FizzWorkspace {
  id: string;
  type: WorkspaceType;
  billingMode: WorkspaceBillingMode;
  status: WorkspaceStatus;
  name: string;
  slug: string | null;
  avatarUrl: string | null;
  description: string | null;
  ownerUserId: string;
  defaultProjectId: string | null;
  role: WorkspaceMemberRole | undefined;
  version: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export type ProjectStatus = "active" | "archived";
export type ProjectVisibility = "private" | "workspace" | "public";

export interface FizzProject {
  id: string;
  workspaceId: string;
  name: string;
  slug: string | null;
  projectType: string;
  status: ProjectStatus;
  visibility: ProjectVisibility;
  description: string | null;
  coverAssetId: string | null;
  createdById: string;
  updatedById: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

// ─── Workspace fetchers ───────────────────────────────────────────────────────

/**
 * Idempotent — creates the personal workspace if it doesn't exist yet.
 * Call once when the user first lands on FizzStudio. Safe to call multiple
 * times; returns the existing workspace if already present.
 */
export async function ensurePersonalWorkspace(): Promise<FizzWorkspace> {
  const res = await api.post<{ workspace: FizzWorkspace }>("/aurora/workspaces/personal/ensure");
  return res.workspace;
}

export async function listWorkspaces(): Promise<FizzWorkspace[]> {
  const res = await api.get<{ workspaces: FizzWorkspace[] }>("/aurora/workspaces");
  return res.workspaces;
}

export async function getWorkspace(workspaceId: string): Promise<FizzWorkspace> {
  const res = await api.get<{ workspace: FizzWorkspace }>(`/aurora/workspaces/${workspaceId}`);
  return res.workspace;
}

export async function createTeamWorkspace(input: {
  name: string;
  slug?: string;
  description?: string;
  avatarUrl?: string;
}): Promise<FizzWorkspace> {
  const res = await api.post<{ workspace: FizzWorkspace }>("/aurora/workspaces/team", {
    data: input,
  });
  return res.workspace;
}

export async function updateWorkspace(
  workspaceId: string,
  input: {
    name?: string;
    slug?: string | null;
    description?: string | null;
    avatarUrl?: string | null;
    expectedVersion?: number;
  }
): Promise<FizzWorkspace> {
  const res = await api.patch<{ workspace: FizzWorkspace }>(`/aurora/workspaces/${workspaceId}`, {
    data: input,
  });
  return res.workspace;
}

export async function deleteWorkspace(
  workspaceId: string,
  expectedVersion?: number
): Promise<{ deleted: boolean; workspaceId: string }> {
  const res = await api.delete<{ deleted: boolean; workspaceId: string }>(
    `/aurora/workspaces/${workspaceId}`,
    { data: { expectedVersion } }
  );
  return res;
}

// ─── Project fetchers ─────────────────────────────────────────────────────────

export async function listProjects(workspaceId: string): Promise<FizzProject[]> {
  const res = await api.get<{ projects: FizzProject[] }>(
    `/aurora/workspaces/${workspaceId}/projects`
  );
  return res.projects;
}

export async function getProject(projectId: string): Promise<FizzProject> {
  const res = await api.get<{ project: FizzProject }>(`/aurora/projects/${projectId}`);
  return res.project;
}

export async function createProject(
  workspaceId: string,
  input: {
    name: string;
    slug?: string;
    projectType?: string;
    visibility?: ProjectVisibility;
    description?: string;
  }
): Promise<FizzProject> {
  const res = await api.post<{ project: FizzProject }>(
    `/aurora/workspaces/${workspaceId}/projects`,
    { data: { projectType: "general", visibility: "private", ...input } }
  );
  return res.project;
}

export async function updateProject(
  projectId: string,
  input: {
    name?: string;
    description?: string | null;
    visibility?: ProjectVisibility;
    expectedVersion?: number;
  }
): Promise<FizzProject> {
  const res = await api.patch<{ project: FizzProject }>(`/aurora/projects/${projectId}`, {
    data: input,
  });
  return res.project;
}

export async function archiveProject(
  projectId: string,
  expectedVersion?: number
): Promise<{ archived: boolean; projectId: string }> {
  const res = await api.delete<{ archived: boolean; projectId: string }>(
    `/aurora/projects/${projectId}`,
    { data: { expectedVersion } }
  );
  return res;
}

// ─── Document types ───────────────────────────────────────────────────────────

export type DocumentType =
  | "brief"
  | "script"
  | "storyboard"
  | "shot_plan"
  | "timeline"
  | "asset_board"
  | "course_outline"
  | "gig_requirement";

export type DocumentStatus = "active" | "archived";

export interface FizzDocument {
  id: string;
  workspaceId: string;
  projectId: string;
  type: DocumentType;
  status: DocumentStatus;
  title: string;
  slug: string | null;
  schemaVersion: string;
  collaborationDialect: string;
  collaborationRoomId: string;
  currentSequence: number;
  currentVersionId: string | null;
  version: number;
  /** Present only on detail fetches (get / ensure). The storyboard JSON. */
  contentSnapshot?: unknown;
  createdById: string;
  updatedById: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface DocumentOperation {
  id: string;
  documentId: string;
  sequence: number;
  operationType: "patch" | "yjs_update" | "snapshot" | "comment" | "system";
  baseSequence: number | null;
  createdAt: string;
}

/**
 * Append a patch operation that materializes the full new content snapshot.
 * Returns the new operation (its `sequence` advances the document). The server
 * rejects with DOCUMENT_SEQUENCE_CONFLICT if `baseSequence` is stale.
 */
export async function appendDocumentPatch(
  documentId: string,
  input: {
    materializedContent: unknown;
    patch?: Record<string, unknown>;
    baseSequence: number;
    clientMutationId?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<DocumentOperation> {
  const res = await api.post<{ operation: DocumentOperation }>(
    `/aurora/documents/${documentId}/operations`,
    {
      data: {
        operationType: "patch",
        patch: input.patch ?? { kind: "snapshot" },
        materializedContent: input.materializedContent,
        baseSequence: input.baseSequence,
        clientMutationId: input.clientMutationId,
        metadata: input.metadata ?? {},
      },
    }
  );
  return res.operation;
}

// ─── Document fetchers ────────────────────────────────────────────────────────

export async function listDocuments(
  projectId: string,
  type?: DocumentType
): Promise<FizzDocument[]> {
  const res = await api.get<{ documents: FizzDocument[] }>(
    `/aurora/projects/${projectId}/documents`,
    { params: type ? { type } : undefined }
  );
  return res.documents;
}

/**
 * Idempotent — returns the project's primary storyboard document, creating
 * it on first open. "Documents" are internal plumbing; the user just enters
 * a project and lands on its storyboard with view-mode switching.
 */
export async function ensurePrimaryStoryboard(projectId: string): Promise<FizzDocument> {
  const res = await api.post<{ document: FizzDocument }>(
    `/aurora/projects/${projectId}/storyboard/ensure`
  );
  return res.document;
}

export async function getDocument(documentId: string): Promise<FizzDocument> {
  const res = await api.get<{ document: FizzDocument }>(`/aurora/documents/${documentId}`);
  return res.document;
}

export async function createDocument(
  projectId: string,
  input: { type: DocumentType; title: string }
): Promise<FizzDocument> {
  const res = await api.post<{ document: FizzDocument }>(
    `/aurora/projects/${projectId}/documents`,
    { data: input }
  );
  return res.document;
}

export async function updateDocument(
  documentId: string,
  input: {
    title?: string;
    status?: DocumentStatus;
    expectedVersion?: number;
  }
): Promise<FizzDocument> {
  const res = await api.patch<{ document: FizzDocument }>(`/aurora/documents/${documentId}`, {
    data: input,
  });
  return res.document;
}

export async function archiveDocument(
  documentId: string,
  expectedVersion?: number
): Promise<FizzDocument> {
  // Documents archive via status update (no separate DELETE endpoint)
  return updateDocument(documentId, { status: "archived", expectedVersion });
}
