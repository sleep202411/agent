import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { fetchTaskCommentAccess } from "./task-comment-api";
export async function deleteTask(
  task: { id: string; crewId: string; version: number },
  userId: string,
  generation: number
) {
  const snapshot = z
    .object({
      id: z.string().uuid(),
      crewId: z.string().min(1).max(64),
      version: z.number().int().positive(),
    })
    .parse(task);
  const current = () => {
    if (generation !== getAuthGeneration()) throw new Error("Task session expired");
  };
  current();
  const access = await fetchTaskCommentAccess(
    snapshot.crewId,
    userId,
    new AbortController().signal
  );
  current();
  if (!access.canManage) throw new Error("Task management permission is required.");
  await api.delete(`/crew-tasks/${snapshot.id}`, {
    service: "aurora",
    data: { expectedVersion: snapshot.version },
  });
  current();
}
