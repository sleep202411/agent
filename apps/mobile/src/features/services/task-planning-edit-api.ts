import { z } from "zod";
import { api } from "@/lib/api-client";
import { taskDetailSchema, type TaskDetail } from "./task-detail-api";
import type { TaskPlanningDraft } from "./task-planning-fields";
const ref = z.object({ id: z.string().uuid(), name: z.string().min(1) });
const planningSnapshotSchema = taskDetailSchema
  .extend({
    cycleId: z.string().uuid().nullable(),
    cycle: ref.nullable(),
    episodeId: z.string().uuid().nullable(),
    episode: z
      .object({
        id: z.string().uuid(),
        number: z.number().int().positive(),
        title: z.string().min(1),
      })
      .nullable(),
  })
  .refine(
    (task) =>
      task.cycleId === (task.cycle?.id ?? null) && task.episodeId === (task.episode?.id ?? null),
    "Task planning reference mismatch"
  );
export type PlanningSnapshot = z.infer<typeof planningSnapshotSchema>;
export const planningEditInput = z
  .object({
    expectedVersion: z.number().int().positive(),
    cycleId: z.string().uuid().nullable().optional(),
    episodeId: z.string().uuid().nullable().optional(),
    labelIds: z
      .array(z.string().uuid())
      .max(20)
      .refine((ids) => new Set(ids).size === ids.length, "Duplicate labels")
      .optional(),
  })
  .strict()
  .refine(
    (data) =>
      data.cycleId !== undefined || data.episodeId !== undefined || data.labelIds !== undefined,
    "No planning changes"
  );
export function planningDraft(task: PlanningSnapshot): TaskPlanningDraft {
  return {
    labels: task.labels,
    cycle: task.cycle,
    episode: task.episode
      ? { id: task.episode.id, name: `${task.episode.number} · ${task.episode.title}` }
      : null,
  };
}
export function planningChanges(task: PlanningSnapshot, draft: TaskPlanningDraft) {
  const cycleId = draft.cycle?.id ?? null,
    episodeId = draft.episode?.id ?? null;
  const ids = draft.labels.map((label) => label.id);
  return planningEditInput.safeParse({
    expectedVersion: task.version,
    ...(cycleId !== task.cycleId ? { cycleId } : {}),
    ...(episodeId !== task.episodeId ? { episodeId } : {}),
    ...(ids.length !== task.labels.length ||
    ids.some((id) => !task.labels.some((label) => label.id === id))
      ? { labelIds: ids }
      : {}),
  });
}
export async function fetchTaskPlanning(task: TaskDetail, signal: AbortSignal) {
  z.string().uuid().parse(task.id);
  const result = planningSnapshotSchema.parse(
    await api.get(`/crew-tasks/${task.id}`, { service: "aurora", signal })
  );
  if (result.id !== task.id || result.crewId !== task.crewId || result.version !== task.version)
    throw new Error("Task changed. Refresh before editing planning.");
  return result;
}
export async function updateTaskPlanning(
  task: PlanningSnapshot,
  value: z.infer<typeof planningEditInput>
) {
  z.string().uuid().parse(task.id);
  const data = planningEditInput.parse(value);
  if (data.expectedVersion !== task.version) throw new Error("Task planning version mismatch");
  const result = planningSnapshotSchema.parse(
    await api.patch(`/crew-tasks/${task.id}`, { service: "aurora", data })
  );
  const cycleId = data.cycleId === undefined ? task.cycleId : data.cycleId;
  const episodeId = data.episodeId === undefined ? task.episodeId : data.episodeId;
  const labels = data.labelIds ?? task.labels.map((label) => label.id);
  if (
    result.id !== task.id ||
    result.crewId !== task.crewId ||
    result.version !== data.expectedVersion + 1 ||
    result.cycleId !== cycleId ||
    result.episodeId !== episodeId ||
    result.labels.length !== labels.length ||
    labels.some((id) => !result.labels.some((label) => label.id === id))
  )
    throw new Error("Planning acknowledgement mismatch. Refresh the task before trying again.");
  return result;
}
