import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
const counts = z
  .array(z.object({ taskId: z.string().uuid(), count: z.number().int().positive().safe() }))
  .refine(
    (rows) => new Set(rows.map((row) => row.taskId)).size === rows.length,
    "Duplicate unread task counts"
  );
export async function fetchTaskUnread(generation: number, signal: AbortSignal) {
  const current = () => {
    if (signal.aborted || generation !== getAuthGeneration())
      throw new Error("Task notification session expired");
  };
  current();
  const result = counts.parse(
    await api.get("/notifications/unread-crew-tasks", { service: "aurora", signal, retry: false })
  );
  current();
  return Object.fromEntries(result.map((row) => [row.taskId, row.count]));
}
