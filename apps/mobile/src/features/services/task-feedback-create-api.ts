import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
import { fetchTaskDetail, type TaskDetail } from "./task-detail-api";
import { feedbackSchema, fetchTaskFeedback, type TaskFeedback } from "./task-feedback-api";
export const feedbackCreation = z.object({
  clientKey: z.string().uuid(),
  submissionId: z.string().uuid(),
  subjectUserId: z.string().min(1).max(64),
  ratings: feedbackSchema.shape.ratings,
  comment: z.string().trim().max(2000),
  // Requests saved before public reviews were introduced remain private on retry.
  publicOnProfile: z.boolean().optional(),
});
export type FeedbackCreation = z.infer<typeof feedbackCreation>;
export function feedbackTarget(task: TaskDetail, userId: string) {
  const latest = task.submissions.reduce<TaskDetail["submissions"][number] | undefined>(
    (a, b) => (!a || b.versionNumber > a.versionNumber ? b : a),
    undefined
  );
  if (
    task.status !== "approved" ||
    !latest?.reviewedAt ||
    !latest.reviewedByUserId ||
    latest.reviewedByUserId === latest.submittedByUserId
  )
    return null;
  if (latest.reviewedByUserId === userId)
    return {
      submissionId: latest.id,
      subjectUserId: latest.submittedByUserId,
      direction: "creator" as const,
    };
  if (latest.submittedByUserId === userId)
    return {
      submissionId: latest.id,
      subjectUserId: latest.reviewedByUserId,
      direction: "manager" as const,
    };
  return null;
}
export function creationOutbox(taskId: string, userId: string, generation: number) {
  return pendingRequest(
    feedbackCreation,
    generation,
    durableRecord("task-feedback-create", userId, z.string().uuid().parse(taskId))
  );
}
export async function createTaskFeedback(
  crewId: string,
  taskId: string,
  userId: string,
  generation: number,
  input: FeedbackCreation,
  signal: AbortSignal
) {
  const request = feedbackCreation.parse(input);
  const current = () => {
    if (signal.aborted || getAuthGeneration() !== generation)
      throw new Error("Feedback session expired.");
  };
  current();
  const matches = (row: TaskFeedback) =>
    row.taskId === taskId &&
    row.authorUserId === userId &&
    row.subjectUserId === request.subjectUserId &&
    row.submissionId === request.submissionId &&
    row.comment === request.comment &&
    (row.publicOnProfile ?? false) === (request.publicOnProfile ?? false) &&
    JSON.stringify(row.ratings) === JSON.stringify(request.ratings);
  let cursor: string | null = null;
  const seen = new Set<string>();
  do {
    const page = await fetchTaskFeedback(userId, generation, cursor, signal);
    const existing = page.items.find(
      (row) =>
        row.taskId === taskId &&
        row.authorUserId === userId &&
        row.subjectUserId === request.subjectUserId
    );
    if (existing) {
      if (!matches(existing))
        throw new Error("Different feedback has already been recorded for this task.");
      return existing;
    }
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor)) throw new Error("Invalid feedback pagination.");
    if (cursor) seen.add(cursor);
  } while (cursor);
  const task = await fetchTaskDetail(crewId, taskId, signal);
  current();
  const target = feedbackTarget(task, userId);
  if (
    !target ||
    target.submissionId !== request.submissionId ||
    target.subjectUserId !== request.subjectUserId ||
    target.direction !== request.ratings.direction
  )
    throw new Error(
      "The approved submission or feedback participants have changed. Refresh this task."
    );
  const saved = feedbackSchema.parse(
    await api.post(`/crew-tasks/${taskId}/feedback`, {
      service: "aurora",
      signal,
      retry: false,
      data: {
        subjectUserId: request.subjectUserId,
        ratings: request.ratings,
        comment: request.comment,
        publicOnProfile: request.publicOnProfile ?? false,
      },
    })
  );
  current();
  if (!matches(saved)) throw new Error("Feedback receipt mismatch.");
  return saved;
}
