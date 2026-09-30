import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { fetchTaskCommentAccess } from "./task-comment-api";
export const taskLabelInput = z
  .object({
    name: z.string().trim().min(1).max(64),
    description: z.string().trim().max(240),
    color: z
      .string()
      .trim()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .transform((v) => v.toLowerCase()),
  })
  .strict();
export type TaskLabelInput = z.infer<typeof taskLabelInput>;
export const managedLabel = taskLabelInput
  .extend({
    id: z.string().uuid(),
    crewId: z.string().min(1).max(64),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strip();
export type ManagedLabel = z.infer<typeof managedLabel>;
function current(generation: number) {
  if (generation !== getAuthGeneration()) throw new Error("Task label session expired");
}
async function authorize(crewId: string, userId: string, generation: number, signal: AbortSignal) {
  z.string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .parse(crewId);
  current(generation);
  const access = await fetchTaskCommentAccess(crewId, userId, signal);
  current(generation);
  if (signal.aborted) throw new Error("Task label request cancelled");
  if (!access.canManage) throw new Error("Task management permission is required.");
}
export async function fetchManagedLabels(
  crewId: string,
  userId: string,
  generation: number,
  signal: AbortSignal
) {
  await authorize(crewId, userId, generation, signal);
  const { labels } = z
    .object({ labels: z.array(managedLabel) })
    .parse(await api.get(`/crews/${crewId}/task-project`, { service: "aurora", signal }));
  current(generation);
  if (signal.aborted) throw new Error("Task label request cancelled");
  if (
    labels.some((row) => row.crewId !== crewId) ||
    new Set(labels.map((row) => row.id)).size !== labels.length
  )
    throw new Error("Task label scope mismatch");
  return labels;
}
export function labelChanges(label: ManagedLabel, value: TaskLabelInput) {
  const input = taskLabelInput.parse(value);
  return Object.fromEntries(
    Object.entries(input).filter(([key, value]) => value !== label[key as keyof TaskLabelInput])
  ) as Partial<TaskLabelInput>;
}
export async function createTaskLabel(
  crewId: string,
  userId: string,
  generation: number,
  value: TaskLabelInput
) {
  const input = taskLabelInput.parse(value);
  const labels = await fetchManagedLabels(crewId, userId, generation, new AbortController().signal);
  if (labels.some((row) => row.name === input.name))
    throw new Error("A task label with this name already exists.");
  current(generation);
  const result = managedLabel.parse(
    await api.post(`/crews/${crewId}/task-labels`, { service: "aurora", data: input })
  );
  current(generation);
  if (
    result.crewId !== crewId ||
    labels.some((row) => row.id === result.id) ||
    Object.keys(labelChanges(result, input)).length
  )
    throw new Error(
      "Task label creation could not be verified. Refresh the list before trying again."
    );
  return result;
}
export async function updateTaskLabel(
  snapshot: ManagedLabel,
  userId: string,
  generation: number,
  value: TaskLabelInput
) {
  const label = managedLabel.parse(snapshot),
    changes = labelChanges(label, value);
  current(generation);
  if (!Object.keys(changes).length) return label;
  await authorize(label.crewId, userId, generation, new AbortController().signal);
  const result = managedLabel.parse(
    await api.patch(`/crew-task-labels/${label.id}`, {
      service: "aurora",
      data: { ...changes, expectedUpdatedAt: label.updatedAt },
    })
  );
  current(generation);
  if (
    result.id !== label.id ||
    result.crewId !== label.crewId ||
    result.updatedAt === label.updatedAt ||
    Object.entries(changes).some(([key, v]) => result[key as keyof TaskLabelInput] !== v)
  )
    throw new Error(
      "Task label update could not be verified. Refresh the list before trying again."
    );
  return result;
}
export async function deleteTaskLabel(snapshot: ManagedLabel, userId: string, generation: number) {
  const label = managedLabel.parse(snapshot);
  const labels = await fetchManagedLabels(
    label.crewId,
    userId,
    generation,
    new AbortController().signal
  );
  const fresh = labels.find((row) => row.id === label.id);
  if (
    !fresh ||
    fresh.updatedAt !== label.updatedAt ||
    Object.keys(
      labelChanges(fresh, { name: label.name, color: label.color, description: label.description })
    ).length
  )
    throw new Error("Task label changed. Refresh and review it before deleting.");
  current(generation);
  // DELETE has no version contract. The server removes assignments and view filters atomically.
  await api.delete(`/crew-task-labels/${label.id}`, { service: "aurora" });
  current(generation);
}
