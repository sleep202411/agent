import { z } from "zod";
import { api } from "@/lib/api-client";
import { taskDetailSchema } from "./task-detail-api";
import { taskCreateInput } from "./task-create-api";
import { taskWorkflowSchema } from "./task-workflow-api";
import type { TaskDraft, TaskDraftInput } from "./task-draft-session";

const named = z.object({ id: z.string().uuid(), name: z.string() });
const editTask = taskDetailSchema.extend({
  computeBudgetPoints: z.number().int().nonnegative().nullable().optional(),
  workflowStateId: z.string().uuid(),
  workflowState: taskWorkflowSchema,
  cycleId: z.string().uuid().nullable(),
  cycle: named.nullable(),
  episodeId: z.string().uuid().nullable(),
  episode: z.object({ id: z.string().uuid(), title: z.string() }).nullable(),
  customFieldValues: z.array(z.object({ fieldId: z.string().uuid(), value: z.unknown() })),
  assignees: z.array(
    z.object({
      userId: z.string(),
      currency: z.enum(["USD", "CNY"]),
      rewardAmountMinor: z.number().int().nonnegative().nullable(),
    })
  ),
});
export type TaskEditSnapshot = z.infer<typeof editTask>;
export async function fetchTaskEdit(crewId: string, taskId: string, signal: AbortSignal) {
  z.string().uuid().parse(taskId);
  const task = editTask.parse(
    await api.get(`/crew-tasks/${taskId}`, { service: "aurora", signal })
  );
  if (task.id !== taskId || task.crewId !== crewId) throw Error("Task scope mismatch");
  return task;
}
export function taskEditDraft(task: TaskEditSnapshot): Extract<TaskDraft, { kind: "task" }> {
  const input = taskCreateInput.parse({
    title: task.title,
    description: task.description,
    priority: task.priority,
    computeBudgetPoints: task.computeBudgetPoints,
    workflowStateId: task.workflowStateId,
    taskKind: task.taskKind,
    startAt: task.startAt,
    dueAt: task.dueAt,
    parentId: task.parent?.id ?? null,
    cycleId: task.cycleId,
    episodeId: task.episodeId,
    blockedByTaskIds: task.blockedBy.map((x) => x.id),
    labelIds: task.labels.map((x) => x.id),
    customFieldValues: task.customFieldValues,
    contractAssetNodeId: task.contractAssetNodeId,
    requiredSkills: task.requiredSkills,
    positionRole: task.positionRole,
    estimatePoints: task.estimatePoints,
    revisionLimit: task.revisionLimit,
    paymentTerms: task.paymentTerms,
    rewardCurrency: task.rewardCurrency,
    rewardUsdMinor: task.rewardUsdMinor,
    profitShareBps: task.profitShareBps,
    assignees: task.assignees.map(({ userId, currency }) => ({ userId, currency })),
  });
  return {
    id: 0,
    kind: "task",
    state: "staged",
    input,
    review: {
      context: [],
      customFields: [],
      assignees: task.assignees.map((x) => x.userId),
      editor: {
        planning: {
          labels: task.labels,
          cycle: task.cycle,
          episode: task.episode ? { id: task.episode.id, name: task.episode.title } : null,
        },
        workflow: task.workflowState,
        parent: task.parent,
        blockers: task.blockedBy,
        assignees: task.assignees.map((x) => ({ userId: x.userId, label: x.userId })),
      },
    },
  };
}
export async function saveTaskEdit(task: TaskEditSnapshot, input: TaskDraftInput) {
  const original = taskEditDraft(task).input;
  const parsed = taskCreateInput.parse(input);
  const changed: Record<string, unknown> = Object.fromEntries(
    Object.entries(parsed).filter(
      ([key, value]) =>
        key !== "rewardCurrency" &&
        JSON.stringify(value) !== JSON.stringify(original[key as keyof TaskDraftInput])
    )
  );
  if (!Object.keys(changed).length) return task;
  // Preserve existing per-assignee amounts when another assignee is added/removed.
  if (changed.assignees)
    changed.assignees = parsed.assignees.map(
      (row) => task.assignees.find((x) => x.userId === row.userId) ?? row
    );
  const result = editTask.parse(
    await api.patch(`/crew-tasks/${task.id}`, {
      service: "aurora",
      data: { ...changed, expectedVersion: task.version },
    })
  );
  if (result.id !== task.id || result.crewId !== task.crewId || result.version !== task.version + 1)
    throw Error("Task update acknowledgement mismatch. Reopen the task before retrying.");
  const acknowledged = taskEditDraft(result).input;
  const comparable = (value: unknown): string => {
    if (Array.isArray(value)) return JSON.stringify(value.map(comparable).sort());
    if (value && typeof value === "object")
      return JSON.stringify(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, val]) => [key, comparable(val)])
      );
    return JSON.stringify(value);
  };
  for (const key of Object.keys(changed) as (keyof TaskDraftInput)[]) {
    const expected = parsed[key],
      actual = acknowledged[key];
    const same =
      (key === "dueAt" || key === "startAt") && expected && actual
        ? Date.parse(String(expected)) === Date.parse(String(actual))
        : comparable(expected) === comparable(actual);
    if (!same)
      throw Error("Task update acknowledgement mismatch. Reopen the task before retrying.");
  }
  return result;
}
