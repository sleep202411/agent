import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { amendment } from "./amendment-finance-api";
import { fetchApplicationTerms } from "./application-terms-api";
import { fetchProposalContext, termsProposal } from "./terms-proposal-api";
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const amendmentProposal = termsProposal
  .innerType()
  .extend({
    id: z.string().uuid(),
    expectedTaskVersion: z.number().int().positive(),
    reason: z.string().trim().min(3).max(4000),
    feePeriod: z.literal("project"),
  })
  .refine(
    (v) =>
      /^(0|[1-9][0-9]{0,15})$/.test(v.feeAmount) &&
      BigInt(v.feeAmount) <= 10_000_000_000n &&
      (v.revenueShareBp === 0 || v.shareBasis !== null)
  );
export type AmendmentProposal = z.infer<typeof amendmentProposal>;
export const applicationAmendment = amendment
  .extend({
    proposal: amendmentProposal,
    status: z.enum([
      "pending",
      "effective",
      "awaiting_settlement",
      "settlement_requested",
      "rejected",
      "withdrawn",
    ]),
  })
  .refine(
    (v) =>
      v.id === v.proposal.id &&
      (!["effective", "awaiting_settlement", "settlement_requested"].includes(v.status) ||
        !!v.confirmedAt)
  );
export type ApplicationAmendment = z.infer<typeof applicationAmendment>;
export type AmendmentScope = { applicationId: string; applicantId: string; taskId: string };
export type AmendmentDecision = "confirm" | "reject" | "withdraw";
function current(generation: number) {
  if (generation !== getAuthGeneration()) throw new Error("Amendment session expired");
}
function validateScope(scope: AmendmentScope) {
  id.parse(scope.applicationId);
  id.parse(scope.applicantId);
  z.string().uuid().parse(scope.taskId);
}
function matches(row: ApplicationAmendment, scope: AmendmentScope) {
  return (
    row.applicationId === scope.applicationId &&
    row.applicantId === scope.applicantId &&
    row.taskId === scope.taskId
  );
}
export async function fetchApplicationAmendments(
  scope: AmendmentScope,
  cursor: string | null,
  generation: number,
  signal: AbortSignal
) {
  validateScope(scope);
  if (cursor) z.string().uuid().parse(cursor);
  current(generation);
  const page = z
    .object({ items: z.array(applicationAmendment), nextCursor: z.string().uuid().nullable() })
    .parse(
      await api.get(`/applications/${scope.applicationId}/amendments`, {
        service: "aurora",
        signal,
        params: { limit: 20, ...(cursor ? { cursor } : {}) },
      })
    );
  current(generation);
  if (
    page.items.some((r) => !matches(r, scope) || r.id === cursor) ||
    new Set(page.items.map((r) => r.id)).size !== page.items.length ||
    (page.nextCursor !== null && page.items.at(-1)?.id !== page.nextCursor)
  )
    throw new Error("Amendment history scope or pagination changed. Refresh to reload.");
  return page;
}
export async function fetchAmendmentContext(
  crewId: string,
  applicationId: string,
  applicantId: string,
  taskId: string | undefined,
  userId: string,
  reviewer: boolean,
  generation: number,
  signal: AbortSignal
) {
  current(generation);
  id.parse(crewId);
  id.parse(applicationId);
  id.parse(applicantId);
  id.parse(userId);
  if (!reviewer) {
    if (userId !== applicantId || !taskId) throw new Error("Applicant task scope is required.");
    validateScope({ applicationId, applicantId, taskId });
    const history = await fetchApplicationTerms(applicationId, null, signal);
    current(generation);
    return {
      scope: { applicationId, applicantId, taskId },
      terms: history,
      canPropose: false,
      canWithdraw: false,
      taskVersion: null,
    };
  }
  const review = await fetchProposalContext(crewId, applicationId, generation, signal);
  if (review.app.applicantId !== applicantId || review.app.status !== "approved" || !review.taskId)
    throw new Error("Amendments require an approved task recruitment application.");
  const member = z
    .object({ userId: id, permissions: z.array(z.string()) })
    .parse(await api.get(`/crews/${crewId}/members/me`, { service: "aurora", signal }));
  current(generation);
  if (member.userId !== userId) throw new Error("Amendment account mismatch");
  const canWithdraw = member.permissions.includes("applications.review");
  const canPropose =
    canWithdraw && member.permissions.includes("tasks.manage") && userId !== applicantId;
  let taskVersion: number | null = null;
  if (canPropose) {
    const task = z
      .object({ id: z.string().uuid(), crewId: id, version: z.number().int().positive() })
      .parse(await api.get(`/crew-tasks/${review.taskId}`, { service: "aurora", signal }));
    current(generation);
    if (task.id !== review.taskId || task.crewId !== crewId)
      throw new Error("Amendment task scope mismatch");
    taskVersion = task.version;
  }
  return {
    scope: { applicationId, applicantId, taskId: review.taskId },
    terms: review.terms,
    canPropose,
    canWithdraw,
    taskVersion,
  };
}
export async function proposeAmendment(
  scope: AmendmentScope,
  input: AmendmentProposal,
  userId: string,
  generation: number
) {
  validateScope(scope);
  id.parse(userId);
  current(generation);
  const data = amendmentProposal.parse(input);
  if (userId === scope.applicantId)
    throw new Error("Creators cannot propose their own amendments.");
  const result = applicationAmendment.parse(
    await api.post(`/applications/${scope.applicationId}/amendments`, { service: "aurora", data })
  );
  current(generation);
  if (
    !matches(result, scope) ||
    result.id !== data.id ||
    result.proposedByUserId !== userId ||
    JSON.stringify(result.proposal) !== JSON.stringify(data)
  )
    throw new Error(
      "Amendment proposal receipt mismatch. Retry the identical proposal or refresh."
    );
  return result;
}
export function canDecideAmendment(
  row: ApplicationAmendment,
  userId: string,
  action: AmendmentDecision
) {
  return (
    ["pending", "awaiting_settlement"].includes(row.status) &&
    (action === "withdraw"
      ? row.proposedByUserId === userId
      : row.applicantId === userId && (action === "reject" || row.status === "pending"))
  );
}
export async function decideAmendment(
  record: ApplicationAmendment,
  userId: string,
  generation: number,
  action: AmendmentDecision
) {
  const row = applicationAmendment.parse(record);
  z.enum(["confirm", "reject", "withdraw"]).parse(action);
  id.parse(userId);
  current(generation);
  if (!canDecideAmendment(row, userId, action))
    throw new Error("This amendment action is unavailable.");
  const result = applicationAmendment.parse(
    await api.post(`/applications/${row.applicationId}/amendments/${row.id}/decision`, {
      service: "aurora",
      data: { action },
    })
  );
  current(generation);
  const allowed =
    action === "confirm"
      ? ["effective", "awaiting_settlement", "settlement_requested"]
      : [action === "reject" ? "rejected" : "withdrawn"];
  if (
    !matches(result, row) ||
    result.id !== row.id ||
    result.proposedByUserId !== row.proposedByUserId ||
    JSON.stringify(result.proposal) !== JSON.stringify(row.proposal) ||
    !allowed.includes(result.status) ||
    (action !== "confirm" && result.confirmedAt !== row.confirmedAt)
  )
    throw new Error("Amendment decision receipt mismatch. Retry the same decision or refresh.");
  return result;
}
