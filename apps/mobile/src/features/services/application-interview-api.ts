import { parseScheduleDate } from "./task-schedule-api";
import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const date = z.string().datetime({ offset: true });
const state = z.enum(["not_started", "proposed", "confirmed", "completed", "cancelled"]);
const event = z.object({
  id: z.string().uuid(),
  applicationId: id,
  version: z.number().int().positive(),
  requestKey: z.string().uuid(),
  actorUserId: id,
  action: z.enum(["schedule", "confirm", "complete", "cancel", "message"]),
  state,
  scheduledAt: date.nullable(),
  message: z.string(),
  createdAt: date,
});
export const interviewUpdate = z
  .object({
    expectedVersion: z.number().int().min(0).max(2147483646),
    requestKey: z.string().uuid(),
    action: z.enum(["confirm", "cancel", "message", "schedule", "complete"]),
    scheduledAt: date.optional(),
    message: z.string().trim().min(1).max(4000),
  })
  .strict()
  .refine(
    (value) => (value.action === "schedule") === (value.scheduledAt !== undefined),
    "Only scheduling supplies an interview time."
  );
export type InterviewUpdate = z.infer<typeof interviewUpdate>;
export async function fetchApplicationInterview(
  applicationId: string,
  beforeVersion: number | null,
  signal: AbortSignal
) {
  id.parse(applicationId);
  if (beforeVersion !== null) z.number().int().positive().parse(beforeVersion);
  const page = z
    .object({
      applicationStatus: z.enum(["pending", "approved", "rejected"]),
      canUpdate: z.boolean(),
      canMessage: z.boolean(),
      version: z.number().int().nonnegative(),
      state,
      scheduledAt: date.nullable(),
      items: z.array(event),
      nextBeforeVersion: z.number().int().positive().nullable(),
    })
    .parse(
      await api.get(`/applications/${applicationId}/interview`, {
        service: "aurora",
        signal,
        params: { limit: 20, ...(beforeVersion === null ? {} : { beforeVersion }) },
      })
    );
  if (
    page.canUpdate !== (page.applicationStatus === "pending") ||
    (page.applicationStatus === "pending" && !page.canMessage) ||
    (page.applicationStatus === "rejected" && page.canMessage) ||
    page.items.some(
      (row, i) =>
        row.applicationId !== applicationId ||
        row.version > page.version ||
        (beforeVersion !== null && row.version >= beforeVersion) ||
        (i > 0 && row.version >= page.items[i - 1]!.version)
    ) ||
    new Set(page.items.map((row) => row.id)).size !== page.items.length ||
    (beforeVersion === null &&
      page.version > 0 &&
      (page.items[0]?.version !== page.version ||
        page.items[0]?.state !== page.state ||
        page.items[0]?.scheduledAt !== page.scheduledAt)) ||
    (page.version === 0 && (page.state !== "not_started" || page.scheduledAt !== null)) ||
    (page.nextBeforeVersion !== null &&
      (page.items.at(-1)?.version !== page.nextBeforeVersion ||
        page.nextBeforeVersion === beforeVersion))
  )
    throw new Error("Interview history changed. Refresh to reload.");
  return page;
}
export async function updateApplicationInterview(
  applicationId: string,
  userId: string,
  generation: number,
  input: InterviewUpdate
) {
  id.parse(applicationId);
  id.parse(userId);
  const body = interviewUpdate.parse(input);
  if (generation !== getAuthGeneration()) throw new Error("Application session expired");
  const result = event.parse(
    await api.post(`/applications/${applicationId}/interview`, { service: "aurora", data: body })
  );
  if (generation !== getAuthGeneration()) throw new Error("Application session expired");
  if (
    result.applicationId !== applicationId ||
    result.actorUserId !== userId ||
    result.requestKey !== body.requestKey ||
    result.version !== body.expectedVersion + 1 ||
    result.action !== body.action ||
    result.message !== body.message ||
    (body.action === "confirm" && result.state !== "confirmed") ||
    (body.action === "cancel" && result.state !== "cancelled") ||
    (body.action === "complete" && result.state !== "completed") ||
    (body.action === "schedule" &&
      (result.state !== "proposed" ||
        !result.scheduledAt ||
        Date.parse(result.scheduledAt) !== Date.parse(body.scheduledAt!)))
  )
    throw new Error("Interview update could not be verified. Retry the same request.");
  return result;
}

export function futureInterviewTime(value: string) {
  const scheduledAt = parseScheduleDate(value, null);
  if (!scheduledAt || Date.parse(scheduledAt) <= Date.now())
    throw new Error("Interview time must be in the future.");
  return scheduledAt;
}
