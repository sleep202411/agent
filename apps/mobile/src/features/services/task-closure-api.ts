import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { fetchTaskCommentAccess } from "./task-comment-api";
export const taskClosureInput = z
  .object({
    requestId: z.string().uuid(),
    expectedVersion: z.number().int().positive(),
    reason: z.string().trim().min(1).max(4000),
  })
  .strict();
export type TaskClosureInput = z.infer<typeof taskClosureInput>;
export async function closeTask(
  task: { id: string; crewId: string },
  userId: string,
  generation: number,
  value: TaskClosureInput
) {
  z.string().uuid().parse(task.id);
  const data = taskClosureInput.parse(value);
  const current = () => {
    if (generation !== getAuthGeneration()) throw new Error("Task session expired");
  };
  current();
  const access = await fetchTaskCommentAccess(task.crewId, userId, new AbortController().signal);
  current();
  if (!access.canManage)
    throw Object.assign(new Error("Task management permission is required."), { status: 403 });
  const result = z
    .object({
      id: z.string().uuid(),
      crewId: z.string(),
      status: z.literal("cancelled"),
      version: z.number().int().positive(),
    })
    .parse(await api.post(`/crew-tasks/${task.id}/close`, { service: "aurora", data }));
  current();
  // Idempotent recovery returns the current task, which may have a newer version.
  if (
    result.id !== task.id ||
    result.crewId !== task.crewId ||
    result.version <= data.expectedVersion
  )
    throw new Error("Task cancellation could not be verified. Retry the same request.");
  return result;
}
