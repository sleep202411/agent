import { z } from "zod";
import { getAuthGeneration } from "@/auth/auth-store";
import { api } from "@/lib/api-client";
import { canCreateStudioProject } from "./studio-projects-api";
const projectSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.enum(["active", "archived"]),
  visibility: z.enum(["private", "workspace", "public"]),
  role: z.enum(["owner", "admin", "editor", "viewer"]).optional(),
  version: z.number().int().nonnegative(),
  coverAssetId: z.string().uuid().nullable().optional(),
  thumbnailUrl: z.string().nullable().optional(),
  updatedAt: z.string().datetime({ offset: true }),
});
export type PlatformProject = z.infer<typeof projectSchema>;
export const platformProjectDraft = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(5000),
});
export type PlatformProjectDraft = z.infer<typeof platformProjectDraft>;
function current(generation: number, signal?: AbortSignal) {
  if (generation !== getAuthGeneration() || signal?.aborted)
    throw new Error("Studio project session expired or request cancelled.");
}
const workspaceSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  isDefault: z.boolean(),
  status: z.enum(["active", "suspended", "archived"]),
  role: z.enum(["owner", "admin", "billing", "editor", "viewer"]).optional(),
  accessScope: z.enum(["workspace", "project_only"]).optional(),
  crewRole: z.enum(["viewer", "editor"]).optional(),
});
export async function loadPlatformProjects(
  workspaceId: string,
  generation: number,
  signal: AbortSignal
) {
  z.string().uuid().parse(workspaceId);
  current(generation, signal);
  const { projects } = z
    .object({ projects: z.array(projectSchema) })
    .parse(await api.get(`/workspaces/${workspaceId}/projects`, { service: "aurora", signal }));
  current(generation, signal);
  if (
    projects.some((p) => p.workspaceId !== workspaceId || p.status !== "active") ||
    new Set(projects.map((p) => p.id)).size !== projects.length
  )
    throw new Error("Studio project collection scope mismatch.");
  return projects;
}
export function canEditPlatformProject(project: PlatformProject) {
  return project.status === "active" && ["owner", "admin", "editor"].includes(project.role ?? "");
}
export class PlatformProjectWriteError extends Error {}
export async function createPlatformProject(
  workspaceId: string,
  draft: PlatformProjectDraft,
  initialSectionTitle: string,
  generation: number,
  signal?: AbortSignal
) {
  z.string().uuid().parse(workspaceId);
  const input = platformProjectDraft.parse(draft);
  const title = z.string().trim().min(1).max(160).parse(initialSectionTitle);
  current(generation, signal);
  const { workspace } = z
    .object({ workspace: workspaceSchema })
    .parse(await api.get(`/workspaces/${workspaceId}`, { service: "aurora", signal }));
  current(generation, signal);
  if (workspace.id !== workspaceId || !canCreateStudioProject(workspace))
    throw new Error("Workspace project creation permission is required.");
  try {
    const { project } = z.object({ project: projectSchema }).parse(
      await api.post(`/workspaces/${workspaceId}/projects`, {
        service: "aurora",
        data: { ...input, initialSectionTitle: title, visibility: "private" },
      })
    );
    current(generation);
    if (
      project.workspaceId !== workspaceId ||
      project.name !== input.name ||
      (project.description ?? "") !== input.description ||
      project.status !== "active" ||
      project.visibility !== "private"
    )
      throw new Error("Project creation receipt mismatch.");
    return project;
  } catch (e) {
    throw new PlatformProjectWriteError(e instanceof Error ? e.message : String(e));
  }
}
async function reviewed(snapshot: PlatformProject, generation: number, signal?: AbortSignal) {
  projectSchema.parse(snapshot);
  current(generation, signal);
  const { project } = z
    .object({ project: projectSchema })
    .parse(await api.get(`/projects/${snapshot.id}`, { service: "aurora", signal }));
  current(generation, signal);
  if (
    project.id !== snapshot.id ||
    project.workspaceId !== snapshot.workspaceId ||
    project.version !== snapshot.version ||
    project.status !== "active"
  )
    throw new Error("Project changed. Reload before saving.");
  return project;
}
export async function updatePlatformProject(
  snapshot: PlatformProject,
  draft: PlatformProjectDraft,
  generation: number,
  signal?: AbortSignal
) {
  const input = platformProjectDraft.parse(draft);
  const fresh = await reviewed(snapshot, generation, signal);
  if (!canEditPlatformProject(fresh)) throw new Error("Project editor permission is required.");
  try {
    const { project } = z.object({ project: projectSchema }).parse(
      await api.patch(`/projects/${fresh.id}`, {
        service: "aurora",
        data: {
          ...input,
          description: input.description || null,
          expectedVersion: fresh.version,
        },
      })
    );
    current(generation);
    if (
      project.id !== fresh.id ||
      project.workspaceId !== fresh.workspaceId ||
      project.version !== fresh.version + 1 ||
      project.name !== input.name ||
      (project.description ?? "") !== input.description ||
      project.status !== "active"
    )
      throw new Error("Project update receipt mismatch.");
    return project;
  } catch (e) {
    throw new PlatformProjectWriteError(e instanceof Error ? e.message : String(e));
  }
}
export async function archivePlatformProject(
  snapshot: PlatformProject,
  confirmation: string,
  generation: number,
  signal?: AbortSignal
) {
  if (confirmation !== snapshot.name)
    throw new Error("Enter the exact project name to confirm archiving.");
  const fresh = await reviewed(snapshot, generation, signal);
  if (fresh.role !== "owner") throw new Error("Project owner permission is required.");
  try {
    const result = z.object({ archived: z.literal(true), projectId: z.string().uuid() }).parse(
      await api.delete(`/projects/${fresh.id}`, {
        service: "aurora",
        data: { expectedVersion: fresh.version },
      })
    );
    current(generation);
    if (result.projectId !== fresh.id) throw new Error("Project archive receipt mismatch.");
  } catch (e) {
    throw new PlatformProjectWriteError(e instanceof Error ? e.message : String(e));
  }
}

export async function readPlatformProject(
  id: string,
  workspaceId: string,
  generation: number,
  signal: AbortSignal
) {
  z.string().uuid().parse(id);
  current(generation, signal);
  const { project } = z
    .object({ project: projectSchema })
    .parse(await api.get(`/projects/${id}`, { service: "aurora", signal }));
  current(generation, signal);
  if (project.id !== id || project.workspaceId !== workspaceId || project.status !== "active")
    throw new Error("Project is no longer available in this workspace.");
  return project;
}
export async function updatePlatformProjectCover(
  snapshot: PlatformProject,
  coverAssetId: string | null,
  generation: number,
  signal: AbortSignal
) {
  z.string().uuid().nullable().parse(coverAssetId);
  const fresh = await reviewed(snapshot, generation, signal);
  if (!canEditPlatformProject(fresh)) throw new Error("Project editor permission is required.");
  try {
    const { project } = z.object({ project: projectSchema }).parse(
      await api.patch(`/projects/${fresh.id}`, {
        service: "aurora",
        data: { coverAssetId, expectedVersion: fresh.version },
      })
    );
    current(generation);
    if (
      project.id !== fresh.id ||
      project.workspaceId !== fresh.workspaceId ||
      project.status !== "active" ||
      project.version !== fresh.version + 1 ||
      project.coverAssetId !== coverAssetId
    )
      throw new Error("Project cover receipt mismatch.");
    return project;
  } catch (e) {
    throw new PlatformProjectWriteError(e instanceof Error ? e.message : String(e));
  }
}
