import { z } from "zod";
import { api } from "@/lib/api-client";
import { taskActivity } from "./task-timeline-api";
export async function fetchTaskCommentPermission(
  crewId: string,
  userId: string,
  signal: AbortSignal
) {
  z.string().min(1).max(64).parse(crewId);
  const membership = z.object({ userId: z.string(), permissions: z.array(z.string()) }).parse(
    await api.get(`/crews/${encodeURIComponent(crewId)}/members/me`, {
      service: "aurora",
      signal,
    })
  );
  if (membership.userId !== userId) throw new Error("Crew membership account mismatch");
  return membership.permissions.includes("tasks.comment");
}
export const taskCommentInput = z.object({
  body: z.string().trim().min(1).max(10000),
  clientKey: z.string().trim().min(1).max(64),
  replyToId: z.string().uuid().optional(),
});
export async function postTaskComment(
  taskId: string,
  userId: string,
  input: z.infer<typeof taskCommentInput>
) {
  z.string().uuid().parse(taskId);
  const data = taskCommentInput.parse(input);
  const result = taskActivity.parse(
    await api.post(`/crew-tasks/${encodeURIComponent(taskId)}/comments`, {
      service: "aurora",
      data,
    })
  );
  if (
    result.taskId !== taskId ||
    result.actorUserId !== userId ||
    result.kind !== "comment" ||
    (result.replyTo?.id ?? null) !== (data.replyToId ?? null)
  )
    throw new Error("Task comment acknowledgement mismatch");
  return result;
}
