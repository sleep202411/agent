import { z } from "zod";
import { api } from "@/lib/api-client";
import { taskMention } from "./task-mentions";
import { taskActivity } from "./task-timeline-api";
export async function fetchTaskCommentAccess(crewId: string, userId: string, signal: AbortSignal) {
  z.string().min(1).max(64).parse(crewId);
  const membership = z.object({ userId: z.string(), permissions: z.array(z.string()) }).parse(
    await api.get(`/crews/${encodeURIComponent(crewId)}/members/me`, {
      service: "aurora",
      signal,
    })
  );
  if (membership.userId !== userId) throw new Error("Crew membership account mismatch");
  return {
    allowed: membership.permissions.includes("tasks.comment"),
    canManage: membership.permissions.includes("tasks.manage"),
  };
}
export const taskCommentInput = z
  .object({
    body: z.string().trim().max(10000),
    clientKey: z.string().trim().min(1).max(64),
    replyToId: z.string().uuid().optional(),
    mentions: z
      .array(taskMention)
      .max(20)
      .refine(
        (items) => new Set(items.map((item) => item.userId)).size === items.length,
        "Duplicate mention"
      )
      .optional(),
    attachments: z
      .array(
        z.discriminatedUnion("source", [
          z.object({ source: z.literal("asset"), assetNodeId: z.string().uuid() }),
          z.object({
            source: z.literal("upload"),
            mediaAssetId: z.string().uuid(),
            name: z
              .string()
              .trim()
              .min(1)
              .max(256)
              .refine((name) => name !== "." && name !== ".." && !name.includes("/")),
          }),
        ])
      )
      .max(10)
      .refine(
        (items) =>
          new Set(
            items.map((item) =>
              item.source === "asset" ? `asset:${item.assetNodeId}` : `upload:${item.mediaAssetId}`
            )
          ).size === items.length,
        "Duplicate attachment"
      )
      .optional(),
  })
  .refine(
    (input) => (input.mentions ?? []).every((item) => input.body.includes(`@${item.label}`)),
    "Mention missing from comment text"
  )
  .refine(
    (input) => input.body.length > 0 || !!input.attachments?.length,
    "A comment needs text or an attachment"
  );
export type TaskCommentInput = z.infer<typeof taskCommentInput>;
export async function postTaskComment(
  taskId: string,
  userId: string,
  input: z.infer<typeof taskCommentInput>
) {
  z.string().uuid().parse(taskId);
  const data = taskCommentInput.parse(input);
  if (data.mentions?.some((item) => item.userId === userId))
    throw new Error("You cannot mention yourself");
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
    (data.mentions?.length ?? 0) !== (result.mentions?.length ?? 0) ||
    (data.mentions ?? []).some(
      (mention, index) =>
        result.mentions?.[index]?.userId !== mention.userId ||
        result.mentions?.[index]?.label !== mention.label
    ) ||
    result.attachments.length !== (data.attachments?.length ?? 0) ||
    result.attachments.some((file, index) => {
      const sent = data.attachments?.[index];
      return (
        !sent ||
        (sent.source === "asset"
          ? file.id !== sent.assetNodeId
          : file.mediaAssetId !== sent.mediaAssetId)
      );
    }) ||
    (result.replyTo?.id ?? null) !== (data.replyToId ?? null)
  )
    throw new Error("Task comment acknowledgement mismatch");
  return result;
}

export async function removeTaskComment(commentId: string) {
  z.string().uuid().parse(commentId);
  await api.delete(`/crew-task-comments/${encodeURIComponent(commentId)}`, { service: "aurora" });
}

export const taskCommentEdit = z
  .object({
    expectedVersion: z.number().int().positive(),
    body: z.string().trim().min(1).max(10000),
    mentions: z
      .array(taskMention)
      .max(20)
      .refine(
        (items) => new Set(items.map((item) => item.userId)).size === items.length,
        "Duplicate mention"
      ),
  })
  .refine(
    (input) => input.mentions.every((item) => input.body.includes(`@${item.label}`)),
    "Mention missing from comment text"
  );
export type TaskCommentEdit = z.infer<typeof taskCommentEdit>;
export async function editTaskComment(taskId: string, commentId: string, input: TaskCommentEdit) {
  z.string().uuid().parse(taskId);
  z.string().uuid().parse(commentId);
  const data = taskCommentEdit.parse(input);
  const result = taskActivity.parse(
    await api.patch(`/crew-task-comments/${commentId}`, { service: "aurora", data })
  );
  if (
    result.id !== commentId ||
    result.taskId !== taskId ||
    result.kind !== "comment" ||
    result.deletedAt ||
    result.version !== data.expectedVersion + 1 ||
    result.body !== data.body ||
    result.mentions.length !== data.mentions.length ||
    result.mentions.some(
      (item, index) =>
        item.userId !== data.mentions[index]?.userId || item.label !== data.mentions[index]?.label
    )
  )
    throw new Error("Task comment edit acknowledgement mismatch");
  return result;
}
