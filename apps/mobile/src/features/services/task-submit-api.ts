import { getAuthGeneration } from "@/auth/auth-store";
import { z } from "zod";
import { api } from "@/lib/api-client";
import { type DeliveryTemplate } from "./task-delivery-api";
import { taskDetailSchema, type TaskDetail } from "./task-detail-api";

const answersSchema = z.record(
  z.string(),
  z.union([z.string().trim().max(5000), z.array(z.string().uuid()).max(100)])
);
const inputSchema = z
  .object({
    note: z.string().trim().max(5000),
    assetNodeIds: z
      .array(z.string().uuid())
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length, "Duplicate submitted assets"),
    deliveryFolderId: z.string().uuid().optional(),
    professionalDelivery: z
      .object({
        categoryId: z.string().uuid(),
        version: z.number().int().positive(),
        answers: answersSchema,
      })
      .strict()
      .optional(),
  })
  .strict();
export type TaskSubmitInput = z.infer<typeof inputSchema>;
export type DeliveryAnswers = z.infer<typeof answersSchema>;

export async function fetchTaskSubmitPermission(
  task: TaskDetail,
  userId: string,
  signal: AbortSignal
) {
  z.string().min(1).max(64).parse(task.crewId);
  const member = z.object({ userId: z.string(), permissions: z.array(z.string()) }).parse(
    await api.get(`/crews/${encodeURIComponent(task.crewId)}/members/me`, {
      service: "aurora",
      signal,
    })
  );
  if (member.userId !== userId) throw new Error("Crew membership account mismatch");
  return (
    member.permissions.includes("tasks.submit_assigned") &&
    (member.permissions.includes("tasks.manage") ||
      task.assignees.some((a) => a.userId === userId)) &&
    ["open", "in_progress", "revision_requested"].includes(task.status)
  );
}

/** Validate against the fetched revision; the server rechecks it inside its transaction. */
export function validateTaskSubmission(value: TaskSubmitInput, template: DeliveryTemplate | null) {
  const input = inputSchema.parse(value);
  const delivery = input.professionalDelivery;
  if (!template) {
    if (delivery)
      throw new Error("This task has no professional delivery template. Refresh the task.");
    return input;
  }
  if (
    !delivery ||
    delivery.categoryId !== template.categoryId ||
    delivery.version !== template.version
  )
    throw new Error("The professional delivery template changed or is missing. Refresh the task.");
  const fields = new Map(template.definition.fields.map((field) => [field.key, field]));
  if (Object.keys(delivery.answers).some((key) => !fields.has(key)))
    throw new Error("Unknown professional delivery field.");
  const attached = new Set(input.assetNodeIds);
  for (const field of fields.values()) {
    const answer = delivery.answers[field.key];
    if (answer === undefined) {
      if (field.required) throw new Error(`Required delivery field: ${field.label}`);
      continue;
    }
    if (field.type === "text") {
      if (typeof answer !== "string" || (field.required && !answer.trim()))
        throw new Error(`Text is required for delivery field: ${field.label}`);
    } else if (
      !Array.isArray(answer) ||
      (field.required && !answer.length) ||
      answer.some((id) => !attached.has(id)) ||
      new Set(answer).size !== answer.length
    ) {
      throw new Error(`Select submitted attachments for delivery field: ${field.label}`);
    }
  }
  return input;
}

export async function submitTask(
  task: TaskDetail,
  userId: string,
  value: TaskSubmitInput,
  template: DeliveryTemplate | null
) {
  z.string().uuid().parse(task.id);
  const data = validateTaskSubmission(value, template);
  const result = taskDetailSchema.parse(
    await api.post(`/crew-tasks/${task.id}/submissions`, {
      service: "aurora",
      data,
    })
  );
  const previousIds = new Set(task.submissions.map((s) => s.id));
  const created = result.submissions.filter((s) => !previousIds.has(s.id));
  const submission = created[0];
  if (
    result.id !== task.id ||
    result.crewId !== task.crewId ||
    result.status !== "submitted" ||
    created.length !== 1 ||
    !submission ||
    submission.submittedByUserId !== userId ||
    submission.note !== data.note ||
    !sameDeliveryAnswers(data.professionalDelivery, submission.professionalDelivery) ||
    submission.assets.length !== data.assetNodeIds.length ||
    data.assetNodeIds.some((id) => !submission.assets.some((a) => a.id === id))
  )
    throw new Error(
      "Task submission acknowledgement mismatch. Refresh the task before trying again."
    );
  return result;
}

const folderSchema = z.object({
  id: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  name: z.string(),
  effectivePermission: z.enum(["view", "upload", "edit", "manage"]),
});
export type DeliveryFolder = z.infer<typeof folderSchema>;
export async function fetchDeliveryFolders(crewId: string, signal: AbortSignal) {
  z.string().min(1).max(64).parse(crewId);
  return z
    .array(folderSchema)
    .parse(
      await api.get(`/crews/${encodeURIComponent(crewId)}/assets/folders`, {
        service: "aurora",
        signal,
      })
    )
    .filter((folder) => folder.effectivePermission !== "view");
}

function sameDeliveryAnswers(
  expected: TaskSubmitInput["professionalDelivery"],
  actual: TaskDetail["submissions"][number]["professionalDelivery"]
) {
  if (!expected) return actual === null;
  if (!actual || actual.categoryId !== expected.categoryId || actual.version !== expected.version)
    return false;
  const keys = Object.keys(expected.answers);
  return (
    Object.keys(actual.answers).length === keys.length &&
    keys.every((key) => {
      const a = expected.answers[key],
        b = actual.answers[key];
      return Array.isArray(a)
        ? Array.isArray(b) && a.length === b.length && a.every((id, i) => id === b[i])
        : a === b;
    })
  );
}

/** The server reuses the assigned folder or creates the task's automatic folder atomically. */
export async function ensureTaskDeliveryFolder(
  taskId: string,
  crewId: string,
  generation: number,
  signal: AbortSignal
) {
  z.string().uuid().parse(taskId);
  const current = () => {
    if (signal.aborted || generation !== getAuthGeneration())
      throw Error("Task delivery session expired.");
  };
  current();
  const result = z
    .object({
      id: z.string().uuid(),
      crewId: z.string(),
      deliveryFolder: z.object({ id: z.string().uuid(), name: z.string() }),
    })
    .parse(
      await api.put(`/crew-tasks/${taskId}/delivery-folder`, {
        service: "aurora",
        data: { deliveryFolderId: null },
        signal,
        retry: false,
      })
    );
  current();
  if (result.id !== taskId || result.crewId !== crewId)
    throw Error("Task delivery folder scope mismatch.");
  return result.deliveryFolder;
}
