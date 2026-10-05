import { TASK_PAYMENT_TERMS } from "@repo/shared/crew";
import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const date = z.string().datetime({ offset: true });
export const application = z.object({
  id,
  crewId: id,
  applicantId: id,
  crewName: z.string(),
  positionType: z.string(),
  taskId: z.string().uuid().nullable(),
  status: z.enum(["pending", "approved", "rejected"]),
  createdAt: date,
  ownerUserId: id.nullable().optional(),
  taskTitle: z.string().nullable().optional(),
  dueAt: date.nullable().optional(),
});
export type Application = z.infer<typeof application>;
export const terms = z.object({
  id: z.string().uuid(),
  applicationId: id,
  version: z.number().int().positive(),
  scope: z.string(),
  feeAmount: z.string().regex(/^(0|[1-9][0-9]{0,15})$/),
  currency: z.enum(["USD", "CNY"]),
  paymentTerms: z.enum(TASK_PAYMENT_TERMS).nullable().optional(),
  feePeriod: z.enum(["project", "episode", "month"]),
  revenueShareBp: z.number().int().min(0).max(5000),
  shareBasis: z.string().nullable(),
  proposedByUserId: id,
  createdAt: date,
  confirmedAt: date.nullable(),
});
export type Terms = z.infer<typeof terms>;
export async function fetchMyApplications(
  userId: string,
  cursor: string | null,
  signal: AbortSignal,
  scope: "sent" | "received" = "sent"
) {
  id.parse(userId);
  z.enum(["sent", "received"]).parse(scope);
  if (cursor) id.parse(cursor);
  const page = z.object({ items: z.array(application), nextCursor: id.nullable() }).parse(
    await api.get("/me/crew-applications", {
      service: "aurora",
      signal,
      params: {
        limit: 20,
        ...(scope === "received" ? { scope } : {}),
        ...(cursor ? { cursor } : {}),
      },
    })
  );
  if (
    page.items.some((r) =>
      scope === "sent" ? r.applicantId !== userId : r.ownerUserId !== userId
    ) ||
    new Set(page.items.map((r) => r.id)).size !== page.items.length ||
    (cursor !== null && page.nextCursor === cursor)
  )
    throw new Error("Application account or pagination changed. Refresh to reload.");
  return page;
}
export async function fetchApplicationTerms(
  applicationId: string,
  beforeVersion: number | null,
  signal: AbortSignal
) {
  id.parse(applicationId);
  if (beforeVersion !== null) z.number().int().positive().parse(beforeVersion);
  const page = z
    .object({
      currentVersion: z.number().int().nonnegative(),
      items: z.array(terms),
      nextBeforeVersion: z.number().int().positive().nullable(),
    })
    .parse(
      await api.get(`/applications/${applicationId}/terms`, {
        service: "aurora",
        signal,
        params: { limit: 20, ...(beforeVersion !== null ? { beforeVersion } : {}) },
      })
    );
  if (
    page.items.some(
      (r, i) =>
        r.applicationId !== applicationId ||
        r.version > page.currentVersion ||
        (beforeVersion !== null && r.version >= beforeVersion) ||
        (i > 0 && r.version >= page.items[i - 1]!.version)
    ) ||
    (beforeVersion === null &&
      page.currentVersion > 0 &&
      page.items[0]?.version !== page.currentVersion) ||
    (page.nextBeforeVersion !== null &&
      (page.items.at(-1)?.version !== page.nextBeforeVersion ||
        page.nextBeforeVersion === beforeVersion))
  )
    throw new Error("Terms history changed. Refresh and review the latest version.");
  return page;
}
export async function confirmApplicationTerms(
  app: Application,
  record: Terms,
  userId: string,
  generation: number
) {
  application.parse(app);
  const reviewed = terms.parse(record);
  if (
    app.applicantId !== userId ||
    app.id !== reviewed.applicationId ||
    app.status !== "pending" ||
    reviewed.confirmedAt
  )
    throw new Error("Only the applicant can confirm pending terms.");
  if (generation !== getAuthGeneration()) throw new Error("Application session expired");
  const result = terms.parse(
    await api.post(`/applications/${app.id}/terms/confirm`, {
      service: "aurora",
      data: { version: reviewed.version },
    })
  );
  if (generation !== getAuthGeneration()) throw new Error("Application session expired");
  if (
    !result.confirmedAt ||
    JSON.stringify({ ...result, confirmedAt: null }) !==
      JSON.stringify({ ...reviewed, confirmedAt: null })
  )
    throw new Error(
      "Confirmation could not be verified. Retry the same version or refresh to review."
    );
  return result;
}

const applicationThread = application.extend({
  positionId: id,
  ownerUserId: id.nullable(),
  taskTitle: z.string().nullable(),
  dueAt: date.nullable(),
});
export type ApplicationThread = z.infer<typeof applicationThread>;
export async function fetchApplicationThread(
  applicationId: string,
  userId: string,
  generation: number,
  signal: AbortSignal,
  participant: "applicant" | "either" = "applicant"
) {
  id.parse(applicationId);
  id.parse(userId);
  const current = () => {
    if (signal.aborted || generation !== getAuthGeneration())
      throw Error("Application session expired");
  };
  current();
  const result = applicationThread.parse(
    await api.get(`/applications/${applicationId}`, {
      service: "aurora",
      credentials: "include",
      retry: false,
      signal,
    })
  );
  current();
  if (result.id !== applicationId || (participant === "applicant" && result.applicantId !== userId))
    throw Error("Application account changed. Refresh to reload.");
  return result;
}

/** Accept precisely the reviewed offer. The server makes same-version retries idempotent. */
export async function acceptApplicationOffer(
  app: ApplicationThread,
  record: Terms,
  userId: string,
  generation: number
) {
  const reviewedApp = applicationThread.parse(app),
    reviewed = terms.parse(record);
  if (
    reviewedApp.applicantId !== userId ||
    reviewed.applicationId !== reviewedApp.id ||
    reviewedApp.status !== "pending"
  )
    throw Error("Only the applicant can accept a pending offer.");
  const current = () => {
    if (generation !== getAuthGeneration()) throw Error("Application session expired");
  };
  current();
  const receipt = z
    .object({ id, crewId: id, positionId: id, applicantId: id, status: z.literal("approved") })
    .parse(
      await api.post(`/applications/${reviewedApp.id}/accept-offer`, {
        service: "aurora",
        credentials: "include",
        retry: false,
        data: { version: reviewed.version },
      })
    );
  current();
  if (
    receipt.id !== reviewedApp.id ||
    receipt.crewId !== reviewedApp.crewId ||
    receipt.positionId !== reviewedApp.positionId ||
    receipt.applicantId !== userId
  )
    throw Error("Offer acceptance could not be verified. Refresh the application.");
  const page = await fetchApplicationTerms(reviewedApp.id, null, new AbortController().signal);
  current();
  const confirmed = page.items.find((row) => row.version === reviewed.version);
  if (
    !confirmed?.confirmedAt ||
    JSON.stringify({ ...confirmed, confirmedAt: null }) !==
      JSON.stringify({ ...reviewed, confirmedAt: null })
  )
    throw Error("Offer acceptance could not be verified. Refresh the application.");
  return confirmed;
}
