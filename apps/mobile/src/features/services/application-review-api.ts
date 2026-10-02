import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { fetchApplicationTerms } from "./application-terms-api";
import { fetchApplicationInterview } from "./application-interview-api";
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const date = z.string().datetime({ offset: true });
export const reviewApplication = z.object({
  id,
  crewId: id,
  positionId: id,
  applicantId: id,
  message: z.string().nullable(),
  portfolioUrl: z.string().nullable(),
  expectedCompensation: z
    .object({
      amount: z.number().finite().nonnegative(),
      currency: z.string(),
      period: z.string().nullable(),
    })
    .nullable(),
  availableStartDate: z.string().nullable(),
  yearsExperience: z.number().int().nonnegative().nullable(),
  status: z.enum(["pending", "approved", "rejected"]),
  createdAt: date,
  reviewedAt: date.nullable(),
  reviewerId: id.nullable(),
});
export type ReviewApplication = z.infer<typeof reviewApplication>;
export type ReviewStatus = ReviewApplication["status"];
function current(generation: number) {
  if (generation !== getAuthGeneration()) throw new Error("Crew session expired");
}
export async function fetchReviewApplications(
  crewId: string,
  generation: number,
  status: ReviewStatus,
  cursor: string | null,
  signal: AbortSignal
) {
  id.parse(crewId);
  if (cursor) id.parse(cursor);
  reviewApplication.shape.status.parse(status);
  current(generation);
  const page = z.object({ items: z.array(reviewApplication), nextCursor: id.nullable() }).parse(
    await api.get(`/crews/${crewId}/applications`, {
      service: "aurora",
      signal,
      params: { limit: 20, status, ...(cursor ? { cursor } : {}) },
    })
  );
  current(generation);
  if (
    page.items.some((row) => row.crewId !== crewId || row.status !== status || row.id === cursor) ||
    new Set(page.items.map((row) => row.id)).size !== page.items.length ||
    (page.nextCursor !== null && page.items.at(-1)?.id !== page.nextCursor)
  )
    throw new Error("Application scope or pagination changed. Refresh to reload.");
  return page;
}
export async function fetchReviewApplication(
  crewId: string,
  applicationId: string,
  generation: number,
  signal: AbortSignal
) {
  id.parse(crewId);
  id.parse(applicationId);
  current(generation);
  const app = reviewApplication.extend({ taskId: z.string().uuid().nullable() }).parse(
    await api.get(`/applications/${applicationId}`, {
      service: "aurora",
      signal,
      cache: "no-store",
    })
  );
  current(generation);
  if (app.crewId !== crewId || app.id !== applicationId)
    throw new Error("Application identity changed. Refresh to reload.");
  const [terms, interview] = await Promise.all([
    fetchApplicationTerms(applicationId, null, signal),
    fetchApplicationInterview(applicationId, null, signal),
  ]);
  current(generation);
  return { app, terms, interview };
}
export function canApproveReview(
  review: Awaited<ReturnType<typeof fetchReviewApplication>>,
  userId: string
) {
  const latest = review.terms.items.find((row) => row.version === review.terms.currentVersion);
  return (
    review.app.status === "pending" &&
    review.app.applicantId !== userId &&
    review.interview.applicationStatus === "pending" &&
    !["proposed", "confirmed"].includes(review.interview.state) &&
    (review.terms.currentVersion === 0 || !!latest?.confirmedAt)
  );
}
export async function decideReviewApplication(
  app: ReviewApplication,
  userId: string,
  generation: number,
  action: "approve" | "reject"
) {
  const reviewed = reviewApplication.parse(app);
  id.parse(userId);
  z.enum(["approve", "reject"]).parse(action);
  current(generation);
  if (reviewed.status !== "pending" || (action === "approve" && reviewed.applicantId === userId))
    throw new Error("This application cannot be reviewed.");
  const result = reviewApplication.parse(
    await api.post(`/applications/${reviewed.id}/${action}`, { service: "aurora" })
  );
  current(generation);
  if (
    result.id !== reviewed.id ||
    result.crewId !== reviewed.crewId ||
    result.positionId !== reviewed.positionId ||
    result.applicantId !== reviewed.applicantId ||
    result.status !== (action === "approve" ? "approved" : "rejected") ||
    result.reviewerId !== userId ||
    !result.reviewedAt
  )
    throw new Error(
      "Application decision could not be verified. Refresh to check its status before another action."
    );
  return result;
}
