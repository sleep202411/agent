import { z } from "zod";
import { api } from "@/lib/api-client";
import { taskKindSchema } from "./task-kind-api";
import { taskDetailSchema } from "./task-detail-api";
export const taskCreateInput = z
  .object({
    customFieldValues: z
      .array(
        z
          .object({
            fieldId: z.string().uuid(),
            value: z.union([
              z.string().max(4000),
              z.number().finite(),
              z.boolean(),
              z.array(z.string().max(128)).max(50),
              z.null(),
            ]),
          })
          .strict()
      )
      .max(50)
      .refine(
        (rows) => new Set(rows.map((r) => r.fieldId)).size === rows.length,
        "Duplicate custom fields"
      )
      .optional(),
    taskKind: taskKindSchema.nullable().optional(),
    estimatePoints: z.number().int().min(0).max(1_000_000).nullable().optional(),
    revisionLimit: z.number().int().min(0).max(100).nullable().optional(),
    cycleId: z.string().uuid().nullable().optional(),
    episodeId: z.string().uuid().nullable().optional(),
    labelIds: z
      .array(z.string().uuid())
      .max(20)
      .refine((ids) => new Set(ids).size === ids.length, "Duplicate labels")
      .optional(),
    workflowStateId: z.string().uuid().optional(),
    title: z.string().trim().min(1).max(180),
    description: z.string().trim().max(10_000),
    priority: z.enum(["low", "normal", "high", "urgent"]),
    startAt: z.string().datetime({ offset: true }).nullable(),
    dueAt: z.string().datetime({ offset: true }).nullable(),
    parentId: z.string().uuid().nullable(),
    blockedByTaskIds: z
      .array(z.string().uuid())
      .max(50)
      .refine((ids) => new Set(ids).size === ids.length, "Duplicate blocking tasks"),
    assignees: z
      .array(
        z
          .object({ userId: z.string().trim().min(1).max(64), currency: z.enum(["CNY", "USD"]) })
          .strict()
      )
      .max(30),
  })
  .strict()
  .refine(
    (v) => new Set(v.assignees.map((a) => a.userId)).size === v.assignees.length,
    "Each member can only be assigned once."
  )
  .refine(
    (v) => !v.startAt || !v.dueAt || new Date(v.dueAt) >= new Date(v.startAt),
    "Task due date must be on or after its start date."
  );
export async function createTask(crewId: string, input: z.infer<typeof taskCreateInput>) {
  z.string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .parse(crewId);
  const data = taskCreateInput.parse(input);
  const result = taskDetailSchema
    .extend({
      customFieldValues: z
        .array(z.object({ fieldId: z.string().uuid(), value: z.unknown() }))
        .optional(),
      taskKind: taskKindSchema.nullable().optional(),
      workflowStateId: z.string().uuid().optional(),
      cycleId: z.string().uuid().nullable().optional(),
      episodeId: z.string().uuid().nullable().optional(),
    })
    .parse(
      await api.post(`/crews/${encodeURIComponent(crewId)}/tasks`, { service: "aurora", data })
    );
  const dateMatches = (a: string | null, b: string | null) =>
    a === null || b === null ? a === b : Date.parse(a) === Date.parse(b);
  const customMatches =
    data.customFieldValues === undefined ||
    (result.customFieldValues !== undefined &&
      result.customFieldValues.length ===
        data.customFieldValues.filter((row) => row.value !== null).length &&
      new Set(result.customFieldValues.map((row) => row.fieldId)).size ===
        result.customFieldValues.length &&
      data.customFieldValues.every((row) => {
        const found = result.customFieldValues!.find((v) => v.fieldId === row.fieldId);
        return row.value === null
          ? !found
          : !!found && JSON.stringify(row.value) === JSON.stringify(found.value);
      }));
  if (
    !customMatches ||
    result.crewId !== crewId ||
    (data.estimatePoints !== undefined && result.estimatePoints !== data.estimatePoints) ||
    (data.revisionLimit !== undefined && result.revisionLimit !== data.revisionLimit) ||
    (data.workflowStateId !== undefined && result.workflowStateId !== data.workflowStateId) ||
    (data.cycleId !== undefined && result.cycleId !== data.cycleId) ||
    (data.episodeId !== undefined && result.episodeId !== data.episodeId) ||
    (data.labelIds !== undefined &&
      (result.labels.length !== data.labelIds.length ||
        data.labelIds.some((id) => !result.labels.some((label) => label.id === id)))) ||
    (data.taskKind !== undefined && result.taskKind !== data.taskKind) ||
    result.title !== data.title ||
    result.description !== data.description ||
    result.priority !== data.priority ||
    !dateMatches(result.startAt, data.startAt) ||
    !dateMatches(result.dueAt, data.dueAt) ||
    (result.parent?.id ?? null) !== data.parentId ||
    result.blockedBy.length !== data.blockedByTaskIds.length ||
    data.blockedByTaskIds.some((id) => !result.blockedBy.some((task) => task.id === id)) ||
    result.assignees.length !== data.assignees.length ||
    data.assignees.some((a) => !result.assignees.some((item) => item.userId === a.userId))
  )
    throw new Error(
      "Task creation acknowledgement mismatch. Check the task list before creating another task."
    );
  return result;
}
