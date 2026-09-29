import { z } from "zod";
import { api } from "@/lib/api-client";
import { taskDetailSchema, type TaskDetail } from "./task-detail-api";
const inputSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    parentId: z.string().uuid().nullable(),
    blockedByTaskIds: z
      .array(z.string().uuid())
      .max(50)
      .refine((ids) => new Set(ids).size === ids.length, "Duplicate blocking tasks"),
  })
  .strict();
export async function updateTaskRelationships(
  task: TaskDetail,
  value: z.infer<typeof inputSchema>
) {
  z.string().uuid().parse(task.id);
  const data = inputSchema.parse(value);
  if (data.parentId === task.id || data.blockedByTaskIds.includes(task.id))
    throw new Error("A task cannot be its own parent or blocker.");
  const result = taskDetailSchema.parse(
    await api.patch(`/crew-tasks/${task.id}`, { service: "aurora", data })
  );
  if (
    result.id !== task.id ||
    result.crewId !== task.crewId ||
    result.version !== data.expectedVersion + 1 ||
    (result.parent?.id ?? null) !== data.parentId ||
    result.blockedBy.length !== data.blockedByTaskIds.length ||
    data.blockedByTaskIds.some((id) => !result.blockedBy.some((item) => item.id === id))
  )
    throw new Error(
      "Task relationship acknowledgement mismatch. Refresh the task before trying again."
    );
  return result;
}
