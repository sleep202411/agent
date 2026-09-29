import { z } from "zod";
import { api } from "@/lib/api-client";
import { taskOption } from "./task-options";
const date = z.string().datetime({ offset: true }).nullable();
const schema = taskOption.extend({
  crewId: z.string().min(1),
  description: z.string(),
  version: z.number().int().positive(),
  status: z.string().min(1),
  workflowState: z.object({ name: z.string().min(1) }),
  startAt: date,
  dueAt: date,
  labels: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
  assignees: z.array(z.object({ id: z.string().uuid(), userId: z.string().min(1) })),
});
export type TaskDetail = z.infer<typeof schema>;
export async function fetchTaskDetail(crewId: string, taskId: string, signal: AbortSignal) {
  z.string().min(1).max(64).parse(crewId);
  z.string().uuid().parse(taskId);
  const result = schema.parse(
    await api.get(`/crew-tasks/${encodeURIComponent(taskId)}`, { service: "aurora", signal })
  );
  if (result.id !== taskId || result.crewId !== crewId) throw new Error("Task scope mismatch");
  return result;
}
