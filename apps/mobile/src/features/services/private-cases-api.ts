import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
const id = z.string().uuid(),
  user = z.string().min(1).max(64),
  date = z.string().datetime({ offset: true });
export const privateCase = z.object({
  id,
  taskId: id,
  openedByUserId: user,
  respondentUserId: user,
  title: z.string(),
  status: z.enum(["open", "in_review", "resolved", "appealed"]),
  ownerAdminId: z.string().nullable(),
  version: z.number().int().positive(),
  createdAt: date,
  updatedAt: date,
});
export const privateCaseView = z.enum(["all", "initiated", "responses"]);
export type PrivateCaseView = z.infer<typeof privateCaseView>;
export type PrivateCase = z.infer<typeof privateCase>;
const event = z.object({
  id,
  version: z.number().int().positive(),
  actorId: user,
  actorKind: z.string(),
  action: z.string(),
  message: z.string(),
  submissionIds: z.array(id),
  attachmentIds: z.array(id),
  createdAt: date,
});
const history = privateCase.extend({
  events: z.array(event),
  nextBeforeVersion: z.number().int().positive().nullable(),
});
export type CaseHistory = z.infer<typeof history>;
function current(generation: number, signal: AbortSignal) {
  if (signal.aborted || generation !== getAuthGeneration())
    throw new Error("Case session expired.");
}
function participant(row: PrivateCase, userId: string) {
  if (row.openedByUserId !== userId && row.respondentUserId !== userId)
    throw new Error("Case participant mismatch.");
}
export async function fetchPrivateCases(
  userId: string,
  generation: number,
  beforeId: string | null,
  signal: AbortSignal,
  view: PrivateCaseView = "all"
) {
  current(generation, signal);
  user.parse(userId);
  privateCaseView.parse(view);
  const page = z.object({ items: z.array(privateCase), nextBeforeId: id.nullable() }).parse(
    await api.get("/crew-disputes", {
      service: "aurora",
      signal,
      retry: false,
      params: {
        limit: 20,
        ...(view !== "all" ? { view } : {}),
        ...(beforeId ? { beforeId: id.parse(beforeId) } : {}),
      },
    })
  );
  current(generation, signal);
  page.items.forEach((row) => {
    participant(row, userId);
    if (
      (view === "initiated" && row.openedByUserId !== userId) ||
      (view === "responses" && row.respondentUserId !== userId)
    )
      throw new Error("Case view mismatch.");
  });
  if (
    new Set(page.items.map((row) => row.id)).size !== page.items.length ||
    (beforeId && page.nextBeforeId === beforeId)
  )
    throw new Error("Invalid case pagination.");
  return page;
}
export async function fetchPrivateCase(
  caseId: string,
  userId: string,
  generation: number,
  beforeVersion: number | null,
  signal: AbortSignal
) {
  current(generation, signal);
  const row = history.parse(
    await api.get(`/crew-disputes/${id.parse(caseId)}`, {
      service: "aurora",
      signal,
      retry: false,
      params: { limit: 20, ...(beforeVersion ? { beforeVersion } : {}) },
    })
  );
  current(generation, signal);
  participant(row, userId);
  if (row.id !== caseId) throw new Error("Case identity mismatch.");
  if (
    new Set(row.events.map((e) => e.id)).size !== row.events.length ||
    new Set(row.events.map((e) => e.version)).size !== row.events.length ||
    row.events.some(
      (e) => e.version > row.version || (beforeVersion !== null && e.version >= beforeVersion)
    ) ||
    (row.nextBeforeVersion !== null &&
      ((beforeVersion !== null && row.nextBeforeVersion >= beforeVersion) ||
        !row.events.some((e) => e.version === row.nextBeforeVersion)))
  )
    throw new Error("Invalid case history pagination.");
  return row;
}
export const caseCommand = z.object({
  clientKey: id,
  expectedVersion: z.number().int().positive().max(2147483646),
  action: z.enum(["message", "appeal"]),
  attachmentIds: z.array(id).max(20).default([]),
  message: z.string().trim().min(1).max(4000),
});
export type CaseCommand = z.infer<typeof caseCommand>;
export function caseOutbox(caseId: string, userId: string, generation: number) {
  return pendingRequest(
    caseCommand,
    generation,
    durableRecord("private-case-event", userId, id.parse(caseId))
  );
}
export async function writePrivateCase(
  caseId: string,
  userId: string,
  generation: number,
  input: CaseCommand,
  signal: AbortSignal
) {
  const request = caseCommand.parse(input);
  current(generation, signal);
  // Revalidate participation, but retain the original version/key: the server checks
  // idempotent retries before version conflicts, including already-applied appeals.
  const before = await fetchPrivateCase(caseId, userId, generation, null, signal);
  current(generation, signal);
  const saved = privateCase.parse(
    await api.post(`/crew-disputes/${id.parse(caseId)}/events`, {
      service: "aurora",
      signal,
      retry: false,
      data: {
        requestKey: request.clientKey,
        expectedVersion: request.expectedVersion,
        action: request.action,
        message: request.message,
        submissionIds: [],
        ...(request.attachmentIds.length ? { attachmentIds: request.attachmentIds } : {}),
      },
    })
  );
  current(generation, signal);
  participant(saved, userId);
  if (
    saved.id !== caseId ||
    saved.taskId !== before.taskId ||
    saved.openedByUserId !== before.openedByUserId ||
    saved.respondentUserId !== before.respondentUserId ||
    saved.version <= request.expectedVersion
  )
    throw new Error("Case receipt mismatch.");
  return saved;
}
