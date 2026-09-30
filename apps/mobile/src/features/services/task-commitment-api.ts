import { z } from "zod";
import { api } from "@/lib/api-client";
const date = z.string().datetime({ offset: true }).nullable();
const record = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  assignmentId: z.string().uuid(),
  userId: z.string().min(1),
  status: z.enum(["accepted", "at_risk", "withdrawn"]),
  promisedDueAt: date,
  acceptedAt: date,
  reason: z.string(),
  releasedAt: date,
  handoverNote: z.string().nullable(),
});
const listed = record.extend({
  currentAssignment: z.boolean(),
  overdue: z.boolean(),
  deadlineChanged: z.boolean(),
});
export type TaskCommitment = z.infer<typeof listed>;
const page = z.object({ records: z.array(listed) });
function parsePage(taskId: string, value: unknown) {
  const result = page.parse(value);
  if (result.records.some((item) => item.taskId !== taskId))
    throw new Error("Task commitment scope mismatch");
  return result.records;
}
export async function fetchTaskCommitments(taskId: string, signal: AbortSignal) {
  z.string().uuid().parse(taskId);
  return parsePage(
    taskId,
    await api.get(`/crew-tasks/${taskId}/commitments`, { service: "aurora", signal })
  );
}
const input = z
  .object({
    expectedVersion: z.number().int().positive(),
    action: z.enum(["accept", "at_risk", "withdraw"]),
    reason: z.string().trim().max(2000),
  })
  .refine(
    (value) => value.action === "accept" || value.reason.length >= 3,
    "Explain the risk or withdrawal"
  );
export type CommitmentAction = z.infer<typeof input>;
export async function setTaskCommitment(taskId: string, userId: string, value: CommitmentAction) {
  z.string().uuid().parse(taskId);
  const data = input.parse(value);
  const result = parsePage(
    taskId,
    await api.post(`/crew-tasks/${taskId}/commitments`, { service: "aurora", data })
  );
  const status =
    data.action === "accept" ? "accepted" : data.action === "withdraw" ? "withdrawn" : "at_risk";
  if (
    !result.some(
      (item) =>
        item.userId === userId &&
        item.currentAssignment &&
        item.status === status &&
        item.reason === data.reason
    )
  )
    throw new Error("Task commitment acknowledgement mismatch");
  return result;
}
export async function closeTaskHandover(taskId: string, id: string, note: string) {
  z.string().uuid().parse(taskId);
  z.string().uuid().parse(id);
  const data = { note: z.string().trim().min(3).max(2000).parse(note) };
  const result = record.parse(
    await api.post(`/crew-commitments/${id}/handover`, { service: "aurora", data })
  );
  if (
    result.id !== id ||
    result.taskId !== taskId ||
    !result.releasedAt ||
    result.handoverNote !== data.note
  )
    throw new Error("Task handover acknowledgement mismatch");
  return result;
}
