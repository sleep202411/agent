import { z } from "zod";
import { api } from "@/lib/api-client";
import { taskDetailSchema, type TaskDetail } from "./task-detail-api";
export async function fetchTaskReviewPermission(
  crewId: string,
  userId: string,
  signal: AbortSignal
) {
  z.string().min(1).max(64).parse(crewId);
  const member = z.object({ userId: z.string(), permissions: z.array(z.string()) }).parse(
    await api.get(`/crews/${encodeURIComponent(crewId)}/members/me`, {
      service: "aurora",
      signal,
    })
  );
  if (member.userId !== userId) throw new Error("Crew membership account mismatch");
  return member.permissions.includes("tasks.review");
}
const input = z
  .object({
    expectedSubmissionId: z.string().uuid(),
    decision: z.enum(["approve", "request_revision"]),
    note: z.string().trim().max(5000),
    revisionDueAt: z.string().datetime({ offset: true }).optional(),
    bindAssetNodeId: z.string().uuid().optional(),
  })
  .refine(
    (v) => v.decision === "approve" || v.note.length > 0,
    "Revision instructions are required"
  )
  .refine(
    (v) => !v.revisionDueAt || v.decision === "request_revision",
    "Only revisions can extend a deadline"
  );
export type TaskReviewInput = z.infer<typeof input>;
export function revisionDeadline(
  value: string,
  dueAt: string | null,
  now: number
): string | undefined {
  if (!value.trim()) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Invalid revision deadline");
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const date = new Date(year, month - 1, day, hour, minute);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute ||
    date.getTime() <= now ||
    (dueAt && date.getTime() <= new Date(dueAt).getTime())
  )
    throw new Error("Invalid revision deadline");
  return date.toISOString();
}
export function primaryVideo(task: TaskDetail) {
  const submission = task.submissions[0],
    videos = submission?.assets.filter((a) => a.contentType?.startsWith("video/")) ?? [];
  const answers = submission?.professionalDelivery?.answers ?? {};
  for (const key of ["video_with_subtitle", "final_video", "video_without_subtitle"]) {
    const value = answers[key],
      id = Array.isArray(value) ? value[0] : value;
    if (videos.some((a) => a.id === id)) return id;
  }
  return videos[0]?.id;
}
export async function reviewTask(taskId: string, crewId: string, value: TaskReviewInput) {
  z.string().uuid().parse(taskId);
  const data = input.parse(value);
  const result = taskDetailSchema.parse(
    await api.post(`/crew-tasks/${taskId}/review`, { service: "aurora", data })
  );
  const submission = result.submissions.find((s) => s.id === data.expectedSubmissionId);
  if (
    result.id !== taskId ||
    result.crewId !== crewId ||
    result.status !== (data.decision === "approve" ? "approved" : "revision_requested") ||
    !submission?.reviewedAt ||
    submission.reviewNote !== data.note
  )
    throw new Error("Task review acknowledgement mismatch");
  return result;
}
