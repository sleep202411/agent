import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { payout } from "./crew-finance-api";
import { financeProofUrl } from "./crew-finance-detail-api";
export const decisionPayout = payout.extend({ version: z.number().int().positive() });
export type DecisionPayout = z.infer<typeof decisionPayout>;
export const payoutMethods = ["bank_transfer", "alipay", "wechat_pay", "paypal", "other"] as const;
export const payoutDecisionInput = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("pay"),
      paymentMethod: z.enum(payoutMethods),
      paymentReference: z.string().trim().min(1).max(180),
      paymentProofUrl: z
        .string()
        .trim()
        .max(1024)
        .refine((value) => financeProofUrl(value) !== null)
        .optional(),
    })
    .strict(),
  z.object({ action: z.literal("void"), reason: z.string().trim().min(1).max(2000) }).strict(),
]);
export async function fetchPayoutDecisionAccess(
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
  if (member.userId !== userId) throw new Error("Payout decision account mismatch");
  return member.permissions.includes("finance.payouts.manage");
}
export async function decidePayout(
  record: DecisionPayout,
  input: z.infer<typeof payoutDecisionInput>,
  userId: string,
  generation: number
) {
  const snapshot = decisionPayout.parse(record),
    parsed = payoutDecisionInput.parse(input),
    { action, ...fields } = parsed;
  if (snapshot.status !== "pending") throw new Error("Only pending payouts can be changed");
  if (generation !== getAuthGeneration()) throw new Error("Payout decision session expired");
  const result = decisionPayout
    .extend({
      paymentMethod: z.enum(payoutMethods).nullable(),
      paymentReference: z.string().nullable(),
      paymentProofUrl: z.string().nullable(),
      paidByUserId: z.string().nullable(),
      voidedByUserId: z.string().nullable(),
      voidReason: z.string().nullable(),
    })
    .parse(
      await api.post(`/crew-payouts/${snapshot.id}/${action}`, {
        service: "aurora",
        data: { expectedVersion: snapshot.version, ...fields },
      })
    );
  if (generation !== getAuthGeneration()) throw new Error("Payout decision session expired");
  if (
    result.id !== snapshot.id ||
    result.crewId !== snapshot.crewId ||
    result.userId !== snapshot.userId ||
    result.currency !== snapshot.currency ||
    result.amountMinor !== snapshot.amountMinor ||
    result.netAmountMinor !== snapshot.netAmountMinor ||
    result.withholdingAmountMinor !== snapshot.withholdingAmountMinor ||
    result.version !== snapshot.version + 1 ||
    result.status !== (action === "pay" ? "paid" : "voided") ||
    (parsed.action === "pay" &&
      (result.paidByUserId !== userId ||
        result.paymentMethod !== parsed.paymentMethod ||
        result.paymentReference !== parsed.paymentReference ||
        result.paymentProofUrl !== (parsed.paymentProofUrl ?? null))) ||
    (parsed.action === "void" &&
      (result.voidedByUserId !== userId || result.voidReason !== parsed.reason))
  )
    throw new Error("Payout decision response mismatch. Refresh before continuing.");
  return result;
}
