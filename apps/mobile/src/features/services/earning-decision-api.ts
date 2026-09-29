import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { earning } from "./crew-finance-api";
export const decisionEarning = earning.extend({ version: z.number().int().positive() });
export type DecisionEarning = z.infer<typeof decisionEarning>;
export type EarningDecision = "approve" | "reject" | "reverse";
export async function fetchEarningDecisionAccess(
  crewId: string,
  userId: string,
  signal: AbortSignal
) {
  z.string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .parse(crewId);
  const member = z
    .object({ userId: z.string(), permissions: z.array(z.string()) })
    .parse(await api.get(`/crews/${crewId}/members/me`, { service: "aurora", signal }));
  if (member.userId !== userId) throw new Error("Earning decision account mismatch");
  return {
    approve: member.permissions.includes("finance.earnings.approve"),
    reverse: member.permissions.includes("finance.earnings.reverse"),
  };
}
export async function decideEarning(
  record: DecisionEarning,
  action: EarningDecision,
  reason: string,
  userId: string,
  generation: number
) {
  const snapshot = decisionEarning.parse(record);
  z.enum(["approve", "reject", "reverse"]).parse(action);
  const explanation = z.string().trim().max(2000).parse(reason);
  if (
    (action === "reverse" ? snapshot.status !== "posted" : snapshot.status !== "pending") ||
    (action !== "approve" && !explanation)
  )
    throw new Error("Invalid earning decision or missing reason");
  if (generation !== getAuthGeneration()) throw new Error("Earning decision session expired");
  const result = decisionEarning
    .extend({
      approvedByUserId: z.string().nullable(),
      rejectedByUserId: z.string().nullable(),
      reversedByUserId: z.string().nullable(),
      rejectionReason: z.string().nullable(),
      reversalReason: z.string().nullable(),
    })
    .parse(
      await api.post(`/crew-earnings/${snapshot.id}/${action}`, {
        service: "aurora",
        data: {
          expectedVersion: snapshot.version,
          ...(action !== "approve" ? { reason: explanation } : {}),
        },
      })
    );
  if (generation !== getAuthGeneration()) throw new Error("Earning decision session expired");
  const expected = action === "approve" ? "posted" : action === "reject" ? "rejected" : "reversed";
  const actor =
    action === "approve"
      ? result.approvedByUserId
      : action === "reject"
        ? result.rejectedByUserId
        : result.reversedByUserId;
  if (
    result.id !== snapshot.id ||
    result.crewId !== snapshot.crewId ||
    result.userId !== snapshot.userId ||
    result.currency !== snapshot.currency ||
    result.amountMinor !== snapshot.amountMinor ||
    result.version !== snapshot.version + 1 ||
    result.status !== expected ||
    actor !== userId ||
    (action === "reject" && result.rejectionReason !== explanation) ||
    (action === "reverse" && result.reversalReason !== explanation)
  )
    throw new Error("Earning decision response mismatch. Refresh before continuing.");
  return result;
}
