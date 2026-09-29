import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { isChinaRegion } from "@/config/app-env";
import {
  fetchReviewApplication,
  reviewApplication,
  type ReviewApplication,
} from "./application-review-api";
import { terms } from "./application-terms-api";
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const proposalCurrency = isChinaRegion ? "CNY" : "USD";
export const termsProposal = z
  .object({
    expectedVersion: z.number().int().min(0).max(2147483646),
    scope: z.string().trim().min(1).max(10000),
    feeAmount: z.string().regex(/^(0|[1-9][0-9]{0,15})$/),
    currency: z.enum(["USD", "CNY"]),
    feePeriod: z.enum(["project", "episode", "month"]),
    revenueShareBp: z.number().int().min(0).max(5000),
    shareBasis: z.string().trim().min(1).max(5000).nullable(),
  })
  .strict()
  .refine((v) => v.revenueShareBp === 0 || v.shareBasis !== null);
export type TermsProposal = z.infer<typeof termsProposal>;
export function proposalMinor(value: string): string | null {
  if (!/^(0|[1-9][0-9]{0,13})(\.[0-9]{1,2})?$/.test(value.trim())) return null;
  const [whole, fraction = ""] = value.trim().split(".");
  return String(BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0")));
}
function current(generation: number) {
  if (generation !== getAuthGeneration()) throw new Error("Application session expired");
}
export async function fetchProposalContext(
  crewId: string,
  applicationId: string,
  generation: number,
  signal: AbortSignal
) {
  const review = await fetchReviewApplication(crewId, applicationId, generation, signal);
  // The application DTO has no taskId. Resolve its position, including later pages,
  // rather than allowing recurring fees on an unknown task-linked role.
  let cursor: string | null = null;
  const seen = new Set<string>();
  do {
    current(generation);
    const page = z
      .object({
        items: z.array(z.object({ id, crewId: id, taskId: z.string().uuid().nullable() })),
        nextCursor: id.nullable(),
      })
      .parse(
        await api.get(`/crews/${crewId}/positions`, {
          service: "aurora",
          signal,
          params: { limit: 100, ...(cursor ? { cursor } : {}) },
        })
      );
    current(generation);
    for (const row of page.items) {
      if (row.crewId !== crewId || seen.has(row.id))
        throw new Error("Position scope changed. Refresh to reload.");
      seen.add(row.id);
    }
    if (
      page.nextCursor !== null &&
      (page.nextCursor === cursor || page.items.at(-1)?.id !== page.nextCursor)
    )
      throw new Error("Position pagination changed. Refresh to reload.");
    const position = page.items.find((row) => row.id === review.app.positionId);
    if (position)
      return { ...review, taskLinked: position.taskId !== null, taskId: position.taskId };
    cursor = page.nextCursor;
  } while (cursor !== null && !signal.aborted);
  throw new Error("Application position is unavailable. Refresh to reload.");
}
export async function proposeApplicationTerms(
  app: ReviewApplication,
  taskLinked: boolean,
  input: TermsProposal,
  userId: string,
  generation: number
) {
  const reviewed = reviewApplication.parse(app),
    data = termsProposal.parse(input);
  id.parse(userId);
  current(generation);
  if (reviewed.applicantId === userId || reviewed.status !== "pending")
    throw new Error("Only reviewers can propose pending application terms.");
  if (data.currency !== proposalCurrency)
    throw new Error("Terms currency does not match this site.");
  if (taskLinked && (data.feePeriod !== "project" || BigInt(data.feeAmount) > 10_000_000_000n))
    throw new Error("Task recruitment requires a project fee within the task reward limit.");
  const result = terms.parse(
    await api.post(`/applications/${reviewed.id}/terms`, { service: "aurora", data })
  );
  current(generation);
  if (
    result.applicationId !== reviewed.id ||
    result.version !== data.expectedVersion + 1 ||
    result.proposedByUserId !== userId ||
    result.scope !== data.scope ||
    result.feeAmount !== data.feeAmount ||
    result.currency !== data.currency ||
    result.feePeriod !== data.feePeriod ||
    result.revenueShareBp !== data.revenueShareBp ||
    result.shareBasis !== data.shareBasis
  )
    throw new Error(
      "Proposal receipt could not be verified. Retry the same proposal or review the latest terms."
    );
  // Identical recovery may already have been confirmed by the applicant.
  return result;
}
