import { z } from "zod";
import { durableRecord, type DurableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
import { taskCommentInput } from "./task-comment-api";
const schema = z
  .object({
    clientKey: z.string().min(1).max(64),
    comment: taskCommentInput,
    reply: z.object({ id: z.string().uuid(), body: z.string().max(10000).nullable() }).optional(),
  })
  .refine(
    (value) =>
      value.clientKey === value.comment.clientKey &&
      (value.reply?.id ?? null) === (value.comment.replyToId ?? null),
    "Comment recovery target mismatch"
  );
export function taskCommentOutbox(
  crewId: string,
  taskId: string,
  userId: string,
  generation: number,
  store: DurableRecord = durableRecord("task-comment", userId, JSON.stringify([crewId, taskId]))
) {
  return pendingRequest(schema, generation, store);
}
