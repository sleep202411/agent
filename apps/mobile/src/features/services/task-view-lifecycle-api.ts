import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { fetchTaskCommentAccess } from "./task-comment-api";
import {
  changedViewSettings,
  editableView,
  fetchViewEditProject,
  settingsOf,
  viewSettings,
  type EditableView,
} from "./task-view-edit-api";
export const newViewInput = z
  .object({ name: z.string().trim().min(1).max(80), layout: z.enum(["list", "board"]) })
  .strict();
export type NewViewInput = z.infer<typeof newViewInput>;
function current(generation: number) {
  if (generation !== getAuthGeneration()) throw new Error("Task view session expired");
}
export async function fetchViewLifecycleContext(
  crewId: string,
  viewId: string,
  userId: string,
  generation: number,
  signal: AbortSignal
) {
  z.string().uuid().parse(viewId);
  z.string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .parse(crewId);
  current(generation);
  const access = await fetchTaskCommentAccess(crewId, userId, signal);
  current(generation);
  if (signal.aborted) throw new Error("Task view request cancelled");
  if (!access.canManage) throw new Error("Task management permission is required.");
  const project = await fetchViewEditProject(crewId, signal);
  current(generation);
  if (signal.aborted) throw new Error("Task view request cancelled");
  const view = project.views.find((row) => row.id === viewId);
  if (!view) throw new Error("Task view is no longer available. Return to the list and refresh.");
  const fallback =
    project.views.find((row) => row.id !== view.id && row.isSystem) ??
    project.views.find((row) => row.id !== view.id);
  return { view, fallbackId: fallback?.id, viewIds: project.views.map((row) => row.id) };
}
async function freshContext(snapshot: EditableView, userId: string, generation: number) {
  const view = editableView.parse(snapshot);
  const context = await fetchViewLifecycleContext(
    view.crewId,
    view.id,
    userId,
    generation,
    new AbortController().signal
  );
  if (
    context.view.updatedAt !== view.updatedAt ||
    context.view.isSystem !== view.isSystem ||
    Object.keys(changedViewSettings(context.view, settingsOf(view))).length
  )
    throw new Error("Task view changed. Return to the list and review it again.");
  return context;
}
export function copiedViewSettings(source: EditableView, value: NewViewInput) {
  const input = newViewInput.parse(value);
  const settings = settingsOf(editableView.parse(source));
  return viewSettings.parse({
    ...settings,
    ...input,
    groupBy: input.layout === "board" || settings.groupBy === "none" ? "status" : settings.groupBy,
  });
}
export async function createTaskView(
  source: EditableView,
  value: NewViewInput,
  userId: string,
  generation: number
) {
  const data = copiedViewSettings(source, value);
  const context = await freshContext(source, userId, generation);
  current(generation);
  const result = editableView.parse(
    await api.post(`/crews/${source.crewId}/task-views`, { service: "aurora", data })
  );
  current(generation);
  if (
    result.crewId !== source.crewId ||
    result.isSystem ||
    context.viewIds.includes(result.id) ||
    Object.keys(changedViewSettings(result, data)).length
  )
    throw new Error(
      "New task view could not be verified. Return to the list before creating another."
    );
  return result;
}
export async function deleteTaskView(snapshot: EditableView, userId: string, generation: number) {
  const view = editableView.parse(snapshot);
  current(generation);
  if (view.isSystem) throw new Error("Built-in planning views cannot be deleted.");
  const context = await freshContext(view, userId, generation);
  if (!context.fallbackId) throw new Error("Keep at least one task view.");
  current(generation);
  // Server rechecks permissions and protects system views. DELETE has no version parameter.
  await api.delete(`/crew-task-views/${view.id}`, { service: "aurora" });
  current(generation);
  return context.fallbackId;
}
