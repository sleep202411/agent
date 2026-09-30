import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  date = z.string().datetime({ offset: true }).nullable();
export const amendment = z.object({
  id: z.string().uuid(),
  applicationId: id,
  taskId: z.string().uuid(),
  proposedByUserId: id,
  applicantId: id,
  proposal: z.object({
    id: z.string().uuid(),
    expectedVersion: z.number().int().nonnegative(),
    expectedTaskVersion: z.number().int().positive(),
    scope: z.string(),
    feeAmount: z.string().regex(/^(0|[1-9]\d*)$/),
    currency: z.enum(["USD", "CNY"]),
    feePeriod: z.literal("project"),
    revenueShareBp: z.number().int().min(0).max(10000),
    shareBasis: z.string().nullable(),
    reason: z.string(),
  }),
  status: z.enum(["awaiting_settlement", "settlement_requested", "effective"]),
  confirmedAt: date,
  settledByUserId: id.nullable(),
  settledAt: date,
});
export type Amendment = z.infer<typeof amendment>;
export type AmendmentFilter = "awaiting_settlement" | "settlement_requested";
export async function fetchAmendmentAccess(crewId: string, userId: string, signal: AbortSignal) {
  id.parse(crewId);
  const member = z
    .object({ userId: id, permissions: z.array(z.string()) })
    .parse(await api.get(`/crews/${crewId}/members/me`, { service: "aurora", signal }));
  if (member.userId !== userId) throw new Error("Amendment finance account mismatch");
  return member.permissions.includes("finance.earnings.approve");
}
export async function fetchAmendments(
  crewId: string,
  status: AmendmentFilter,
  cursor: string | null,
  signal: AbortSignal
) {
  id.parse(crewId);
  z.enum(["awaiting_settlement", "settlement_requested"]).parse(status);
  if (cursor) z.string().uuid().parse(cursor);
  const page = z
    .object({ items: z.array(amendment), nextCursor: z.string().uuid().nullable() })
    .parse(
      await api.get(`/crews/${crewId}/application-amendments`, {
        service: "aurora",
        signal,
        params: { status, limit: 20, ...(cursor ? { cursor } : {}) },
      })
    );
  if (
    page.items.some(
      (row) => row.status !== status || row.proposal.id !== row.id || !row.confirmedAt
    ) ||
    new Set(page.items.map((r) => r.id)).size !== page.items.length ||
    (cursor !== null && page.nextCursor === cursor)
  )
    throw new Error("Amendment queue changed. Refresh to reload.");
  return page;
}
export async function settleAmendment(record: Amendment, generation: number) {
  const row = amendment.parse(record);
  if (row.status !== "awaiting_settlement" || !row.confirmedAt || row.settledAt)
    throw new Error("Creator-confirmed settlement is required.");
  if (generation !== getAuthGeneration()) throw new Error("Amendment session expired");
  const result = amendment.parse(
    await api.post(`/applications/${row.applicationId}/amendments/${row.id}/settle`, {
      service: "aurora",
    })
  );
  if (generation !== getAuthGeneration()) throw new Error("Amendment session expired");
  if (
    result.id !== row.id ||
    result.applicationId !== row.applicationId ||
    result.taskId !== row.taskId ||
    result.applicantId !== row.applicantId ||
    result.proposedByUserId !== row.proposedByUserId ||
    JSON.stringify(result.proposal) !== JSON.stringify(row.proposal) ||
    result.confirmedAt !== row.confirmedAt ||
    !["effective", "settlement_requested"].includes(result.status) ||
    !result.settledAt ||
    !result.settledByUserId
  )
    throw new Error("Settlement receipt does not match. Refresh before continuing.");
  return result;
}
