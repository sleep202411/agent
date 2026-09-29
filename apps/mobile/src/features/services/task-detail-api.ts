import { z } from "zod";
import { api } from "@/lib/api-client";
import { taskSubmission } from "./task-delivery-api";
import { taskOption } from "./task-options";
const date = z.string().datetime({ offset: true }).nullable();
export const taskDetailSchema = taskOption.extend({
  crewId: z.string().min(1),
  description: z.string(),
  submissions: z.array(taskSubmission),
  version: z.number().int().positive(),
  status: z.string().min(1),
  revisionLimit: z.number().int().nonnegative().nullable(),
  revisionRoundsUsed: z.number().int().nonnegative(),
  storyboardClipId: z.string().nullable().optional(),
  workflowState: z.object({ name: z.string().min(1) }),
  startAt: date,
  dueAt: date,
  labels: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
  assignees: z.array(z.object({ id: z.string().uuid(), userId: z.string().min(1) })),
});
export type TaskDetail = z.infer<typeof taskDetailSchema>;
export async function fetchTaskDetail(crewId: string, taskId: string, signal: AbortSignal) {
  z.string().min(1).max(64).parse(crewId);
  z.string().uuid().parse(taskId);
  const result = taskDetailSchema.parse(
    await api.get(`/crew-tasks/${encodeURIComponent(taskId)}`, { service: "aurora", signal })
  );
  if (result.id !== taskId || result.crewId !== crewId) throw new Error("Task scope mismatch");
  return result;
}
