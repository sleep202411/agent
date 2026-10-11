import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
import { caseCategory, caseResolution } from "./case-classification";
import { privateCase } from "./private-cases-api";
const id = z.string().uuid(),
  user = z.string().min(1).max(64);
const contextTask = z.object({
  id,
  crewId: z.string().min(1),
  createdByUserId: user,
  approvedByUserId: user.nullable(),
  assignees: z.array(z.object({ userId: user })),
  submissions: z.array(
    z.object({
      id,
      versionNumber: z.number().int().positive(),
      submittedByUserId: user,
      reviewedByUserId: user.nullable(),
    })
  ),
});
const current = (generation: number, signal: AbortSignal) => {
  signal.throwIfAborted();
  if (generation !== getAuthGeneration()) throw new Error("Case session expired.");
};
export async function fetchTaskCaseContext(
  crewId: string,
  taskId: string,
  generation: number,
  signal: AbortSignal
) {
  current(generation, signal);
  const [task, crew] = await Promise.all([
    api
      .get(`/crew-tasks/${id.parse(taskId)}`, { service: "aurora", signal, retry: false })
      .then((value) => contextTask.parse(value)),
    api
      .get(`/crews/${encodeURIComponent(z.string().min(1).max(64).parse(crewId))}`, {
        service: "aurora",
        signal,
        retry: false,
      })
      .then((value) => z.object({ id: z.string(), ownerUserId: user.nullable() }).parse(value)),
  ]);
  current(generation, signal);
  if (task.id !== taskId || task.crewId !== crewId || crew.id !== crewId)
    throw new Error("Case task scope mismatch.");
  if (new Set(task.submissions.map((s) => s.id)).size !== task.submissions.length)
    throw new Error("Duplicate submission evidence.");
  const participants = [
    ...new Set(
      [
        task.createdByUserId,
        task.approvedByUserId,
        crew.ownerUserId,
        ...task.assignees.map((a) => a.userId),
        ...task.submissions.flatMap((s) => [s.submittedByUserId, s.reviewedByUserId]),
      ].filter((s): s is string => !!s)
    ),
  ];
  return { participants, submissions: task.submissions };
}
export type TaskCaseContext = Awaited<ReturnType<typeof fetchTaskCaseContext>>;
export const taskCaseCommand = z.object({
  clientKey: id,
  category: caseCategory.optional(),
  desiredResolution: caseResolution.optional(),
  attachmentIds: z
    .array(id)
    .max(5)
    .refine((ids) => new Set(ids).size === ids.length, "Duplicate private evidence.")
    .optional(),
  respondentUserId: user,
  title: z.string().trim().min(1).max(180),
  message: z.string().trim().min(1).max(4000),
  submissionIds: z
    .array(id)
    .max(20)
    .refine((ids) => new Set(ids).size === ids.length, "Duplicate submission evidence."),
});
export type TaskCaseCommand = z.infer<typeof taskCaseCommand>;
export function taskCaseOutbox(taskId: string, userId: string, generation: number) {
  return pendingRequest(
    taskCaseCommand,
    generation,
    durableRecord("task-private-case", userId, id.parse(taskId))
  );
}
export async function openTaskCase(
  taskId: string,
  userId: string,
  generation: number,
  input: TaskCaseCommand,
  signal: AbortSignal
) {
  const request = taskCaseCommand.parse(input);
  current(generation, signal);
  if (request.respondentUserId === userId) throw new Error("Choose another task participant.");
  const row = privateCase.parse(
    await api.post(`/crew-tasks/${id.parse(taskId)}/disputes`, {
      service: "aurora",
      signal,
      retry: false,
      data: {
        id: request.clientKey,
        respondentUserId: request.respondentUserId,
        title: request.title,
        message: request.message,
        submissionIds: request.submissionIds,
        ...(request.category ? { category: request.category } : {}),
        ...(request.desiredResolution ? { desiredResolution: request.desiredResolution } : {}),
        ...(request.attachmentIds ? { attachmentIds: request.attachmentIds } : {}),
      },
    })
  );
  current(generation, signal);
  if (
    row.id !== request.clientKey ||
    row.taskId !== taskId ||
    row.openedByUserId !== userId ||
    row.respondentUserId !== request.respondentUserId ||
    row.title !== request.title ||
    (row.category ?? undefined) !== request.category ||
    (row.desiredResolution ?? undefined) !== request.desiredResolution
  )
    throw new Error("Case creation receipt mismatch.");
  return row;
}
