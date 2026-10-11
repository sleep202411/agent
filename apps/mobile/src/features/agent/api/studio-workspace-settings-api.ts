import { z } from "zod";
import { appEnv } from "@/config/app-env";
import { workspaceIconPresets, workspaceIconUrl, workspaceUploadedIcon } from "../workspace-icons";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
const workspaceSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  isDefault: z.boolean(),
  status: z.enum(["active", "suspended", "archived"]),
  version: z.number().int().nonnegative(),
  role: z.string().optional(),
  accessScope: z.string().optional(),
});
export type StudioWorkspaceSettings = z.infer<typeof workspaceSchema>;
export const workspaceDraftSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500),
  icon: z.enum(workspaceIconPresets).optional(),
  customIcon: workspaceUploadedIcon.optional(),
});
export type StudioWorkspaceDraft = z.infer<typeof workspaceDraftSchema>;
export function canEditWorkspace(workspace: StudioWorkspaceSettings) {
  return (
    workspace.status === "active" &&
    workspace.accessScope === "workspace" &&
    ["owner", "admin"].includes(workspace.role ?? "")
  );
}
export function canDeleteWorkspace(workspace: StudioWorkspaceSettings) {
  return canEditWorkspace(workspace) && workspace.role === "owner" && !workspace.isDefault;
}
function current(generation: number, signal?: AbortSignal) {
  if (signal?.aborted || generation !== getAuthGeneration())
    throw new Error("Workspace session expired or request cancelled.");
}
export async function fetchWorkspaceSettings(id: string, generation: number, signal?: AbortSignal) {
  z.string().uuid().parse(id);
  current(generation, signal);
  const { workspace } = z
    .object({ workspace: workspaceSchema })
    .parse(await api.get(`/workspaces/${id}`, { service: "aurora", signal }));
  current(generation, signal);
  if (workspace.id !== id) throw new Error("Workspace scope mismatch.");
  return workspace;
}
export class WorkspaceSettingsWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceSettingsWriteError";
  }
}
export async function createStudioWorkspace(draft: StudioWorkspaceDraft, generation: number) {
  const { icon, customIcon, ...details } = workspaceDraftSchema.parse(draft);
  const input = {
    ...details,
    ...(customIcon
      ? { avatarUrl: customIcon }
      : icon
        ? { avatarUrl: workspaceIconUrl(icon, appEnv.appRegion) }
        : {}),
  };
  current(generation);
  try {
    const { workspace } = z
      .object({ workspace: workspaceSchema })
      .parse(await api.post("/workspaces", { service: "aurora", data: input }));
    current(generation);
    if (
      (input.avatarUrl !== undefined && workspace.avatarUrl !== input.avatarUrl) ||
      workspace.name !== input.name ||
      (workspace.description ?? "") !== input.description ||
      workspace.status !== "active" ||
      workspace.isDefault
    )
      throw new Error("Workspace creation receipt mismatch.");
    return workspace;
  } catch (e) {
    throw new WorkspaceSettingsWriteError(e instanceof Error ? e.message : String(e));
  }
}
async function reviewed(
  snapshot: StudioWorkspaceSettings,
  generation: number,
  deleting: boolean,
  signal?: AbortSignal
) {
  const fresh = await fetchWorkspaceSettings(snapshot.id, generation, signal);
  if (!(deleting ? canDeleteWorkspace(fresh) : canEditWorkspace(fresh)))
    throw new Error("Workspace management permission is required.");
  if (fresh.version !== snapshot.version)
    throw new Error("Workspace changed. Reload its current settings before saving.");
  return fresh;
}
export async function updateStudioWorkspace(
  snapshot: StudioWorkspaceSettings,
  draft: StudioWorkspaceDraft,
  generation: number,
  signal?: AbortSignal
) {
  const { icon, customIcon, ...details } = workspaceDraftSchema.parse(draft);
  const input = {
    ...details,
    ...(customIcon
      ? { avatarUrl: customIcon }
      : icon
        ? { avatarUrl: workspaceIconUrl(icon, appEnv.appRegion) }
        : {}),
  };
  const fresh = await reviewed(snapshot, generation, false, signal);
  current(generation, signal);
  try {
    const { workspace } = z.object({ workspace: workspaceSchema }).parse(
      await api.patch(`/workspaces/${fresh.id}`, {
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
      workspace.id !== fresh.id ||
      workspace.version !== fresh.version + 1 ||
      (input.avatarUrl !== undefined && workspace.avatarUrl !== input.avatarUrl) ||
      workspace.name !== input.name ||
      (workspace.description ?? "") !== input.description
    )
      throw new Error("Workspace update receipt mismatch.");
    return workspace;
  } catch (e) {
    throw new WorkspaceSettingsWriteError(e instanceof Error ? e.message : String(e));
  }
}
export async function deleteStudioWorkspace(
  snapshot: StudioWorkspaceSettings,
  confirmation: string,
  generation: number,
  signal?: AbortSignal
) {
  if (confirmation !== snapshot.name)
    throw new Error("Enter the exact workspace name to confirm deletion.");
  const fresh = await reviewed(snapshot, generation, true, signal);
  current(generation, signal);
  try {
    const result = z.object({ deleted: z.literal(true), workspaceId: z.string().uuid() }).parse(
      await api.delete(`/workspaces/${fresh.id}`, {
        service: "aurora",
        data: { expectedVersion: fresh.version },
      })
    );
    current(generation);
    if (result.workspaceId !== fresh.id) throw new Error("Workspace deletion receipt mismatch.");
  } catch (e) {
    throw new WorkspaceSettingsWriteError(e instanceof Error ? e.message : String(e));
  }
}
