import { z } from "zod";
import { taskMention } from "./task-mentions";
import { api } from "@/lib/api-client";
const date = z.string().datetime({ offset: true });
export const taskActivity = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  kind: z.string(),
  version: z.number().int().positive(),
  mentions: z.array(taskMention),
  payload: z.record(z.string(), z.unknown()),
  actorUserId: z.string().nullable(),
  body: z.string().nullable(),
  deletedAt: date.nullable(),
  editedAt: date.nullable(),
  createdAt: date,
  replyTo: z
    .object({ id: z.string().uuid(), body: z.string().nullable(), deleted: z.boolean() })
    .nullable(),
  attachments: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      mediaAssetId: z.string().uuid().nullable(),
      mediaKind: z.string().nullable(),
      contentType: z.string().nullable(),
    })
  ),
});
export type TaskActivity = z.infer<typeof taskActivity>;
export async function fetchTaskTimeline(
  taskId: string,
  cursor: string | null,
  signal: AbortSignal
) {
  z.string().uuid().parse(taskId);
  const result = z
    .object({ items: z.array(taskActivity), nextCursor: z.string().uuid().nullable() })
    .parse(
      await api.get(`/crew-tasks/${encodeURIComponent(taskId)}/timeline`, {
        service: "aurora",
        signal,
        params: { limit: 30, ...(cursor ? { cursor: z.string().uuid().parse(cursor) } : {}) },
      })
    );
  if (result.items.some((item) => item.taskId !== taskId))
    throw new Error("Task activity scope mismatch");
  return result;
}
export function taskActivityLabel(kind: string) {
  const labels = {
    "task.created": "created",
    "task.updated": "updated",
    "task.submitted": "submitted",
    "task.approved": "approved",
    "task.revision_requested": "revision",
    "commitment.accepted": "accepted",
    "commitment.at_risk": "risk",
    "commitment.withdrawn": "withdrawn",
    "commitment.handover": "handover",
  } as const;
  return `taskActivity.${Object.hasOwn(labels, kind) ? labels[kind as keyof typeof labels] : "changed"}` as const;
}

export function taskActivityNote(item: TaskActivity) {
  if (item.deletedAt || item.kind === "comment") return null;
  if (
    item.kind === "task.updated" &&
    item.payload.closureOutcome === "cancelled_without_financial_settlement"
  ) {
    const closure = item.payload.closure;
    return closure &&
      typeof closure === "object" &&
      "reason" in closure &&
      typeof closure.reason === "string"
      ? closure.reason
      : null;
  }
  return (item.kind.startsWith("commitment.") ||
    ["task.submitted", "task.approved", "task.revision_requested"].includes(item.kind)) &&
    typeof item.payload.note === "string"
    ? item.payload.note
    : null;
}
