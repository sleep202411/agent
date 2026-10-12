import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord, type DurableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
const id = z.string().uuid();
const user = z.string().min(1).max(64);
const score = z.number().int().min(1).max(5);
export const feedbackSchema = z.object({
  id,
  taskId: id,
  submissionId: id,
  authorUserId: user,
  subjectUserId: user,
  ratings: z.discriminatedUnion("direction", [
    z.object({
      direction: z.literal("creator"),
      productionAbility: score,
      understanding: score,
      communication: score,
    }),
    z.object({ direction: z.literal("manager"), managementAbility: score }),
  ]),
  comment: z.string(),
  publicOnProfile: z.boolean().optional(),
  response: z.string().nullable(),
  createdAt: z.string().datetime({ offset: true }),
  respondedAt: z.string().datetime({ offset: true }).nullable(),
});
export type TaskFeedback = z.infer<typeof feedbackSchema>;
const command = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("response"),
    clientKey: id,
    text: z.string().trim().min(3).max(2000),
  }),
  z.object({ kind: z.literal("appeal"), clientKey: id, text: z.string().trim().min(3).max(1000) }),
]);
export type FeedbackCommand = z.infer<typeof command>;
function current(generation: number, signal?: AbortSignal) {
  if (signal?.aborted || generation !== getAuthGeneration())
    throw new Error("Feedback session expired.");
}
export async function fetchTaskFeedback(
  userId: string,
  generation: number,
  cursor: string | null,
  signal: AbortSignal
) {
  current(generation, signal);
  user.parse(userId);
  const result = z.object({ items: z.array(feedbackSchema), nextCursor: id.nullable() }).parse(
    await api.get("/me/crew-task-feedback", {
      service: "aurora",
      signal,
      retry: false,
      params: { limit: 20, ...(cursor ? { cursor: id.parse(cursor) } : {}) },
    })
  );
  current(generation, signal);
  if (result.items.some((row) => row.authorUserId !== userId && row.subjectUserId !== userId))
    throw new Error("Feedback account mismatch.");
  if (
    new Set(result.items.map((row) => row.id)).size !== result.items.length ||
    (cursor && result.nextCursor === cursor)
  )
    throw new Error("Invalid feedback pagination.");
  return result;
}
export function feedbackOutbox(
  feedbackId: string,
  userId: string,
  generation: number,
  kind: FeedbackCommand["kind"],
  store: DurableRecord = durableRecord(`task-feedback-${kind}`, userId, id.parse(feedbackId))
) {
  return pendingRequest(
    command.refine((value) => value.kind === kind, "Feedback action mismatch."),
    generation,
    store
  );
}
export async function writeTaskFeedback(
  feedback: TaskFeedback,
  userId: string,
  generation: number,
  input: FeedbackCommand,
  signal: AbortSignal
) {
  const request = command.parse(input);
  feedbackSchema.parse(feedback);
  current(generation, signal);
  if (feedback.subjectUserId !== userId)
    throw new Error("Only the feedback subject can respond or appeal.");
  // Use personal history: former members retain these rights without task access.
  let cursor: string | null = null;
  const seen = new Set<string>();
  let fresh: TaskFeedback | undefined;
  do {
    const page = await fetchTaskFeedback(userId, generation, cursor, signal);
    fresh = page.items.find((row) => row.id === feedback.id);
    if (fresh) break;
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor)) throw new Error("Invalid feedback pagination.");
    if (cursor) seen.add(cursor);
  } while (cursor);
  if (!fresh || fresh.subjectUserId !== userId || fresh.taskId !== feedback.taskId)
    throw new Error("Feedback is no longer available.");
  current(generation, signal);
  if (request.kind === "response") {
    if (fresh.response !== null) {
      if (fresh.response !== request.text)
        throw new Error("A different response has already been recorded.");
      return { kind: "response" as const };
    }
    const saved = feedbackSchema.parse(
      await api.put(`/crew-task-feedback/${id.parse(feedback.id)}/response`, {
        service: "aurora",
        signal,
        retry: false,
        data: { response: request.text },
      })
    );
    current(generation, signal);
    if (
      saved.id !== feedback.id ||
      saved.subjectUserId !== userId ||
      saved.response !== request.text
    )
      throw new Error("Feedback receipt mismatch.");
    return { kind: "response" as const };
  }
  const saved = z.object({ feedbackId: id, dispute: z.object({ id }) }).parse(
    await api.post(`/crew-task-feedback/${id.parse(feedback.id)}/appeals`, {
      service: "aurora",
      signal,
      retry: false,
      data: { id: request.clientKey, reason: request.text },
    })
  );
  current(generation, signal);
  if (saved.feedbackId !== feedback.id || saved.dispute.id !== request.clientKey)
    throw new Error("Feedback appeal receipt mismatch.");
  return { kind: "appeal" as const, caseId: saved.dispute.id };
}
