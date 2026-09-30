import { z } from "zod";
import { api } from "@/lib/api-client";
import { taskDetailSchema, type TaskDetail } from "./task-detail-api";
export const taskBriefInput = z
  .object({
    expectedVersion: z.number().int().positive(),
    title: z.string().trim().min(1).max(180),
    description: z.string().trim().max(10000),
  })
  .strict();
export async function updateTaskBrief(task: TaskDetail, value: z.infer<typeof taskBriefInput>) {
  z.string().uuid().parse(task.id);
  const data = taskBriefInput.parse(value);
  const result = taskDetailSchema.parse(
    await api.patch(`/crew-tasks/${task.id}`, { service: "aurora", data })
  );
  if (
    result.id !== task.id ||
    result.crewId !== task.crewId ||
    result.version !== data.expectedVersion + 1 ||
    result.title !== data.title ||
    result.description !== data.description
  )
    throw new Error("Task update acknowledgement mismatch. Refresh the task before trying again.");
  return result;
}
