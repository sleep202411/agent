import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { isChinaRegion } from "@/config/app-env";
import { decisionPayout } from "./payout-decision-api";
import { earningAmountMinor } from "./earning-create-api";
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const minor = z
  .string()
  .regex(/^(0|[1-9]\d{0,18})$/)
  .refine((v) => /^(0|[1-9]\d{0,18})$/.test(v) && BigInt(v) <= 9_223_372_036_854_775_807n);
export function withholdingAmountMinor(value: string): string | undefined {
  return /^0(?:\.0{1,2})?$/.test(value.trim()) ? "0" : earningAmountMinor(value);
}
export const newPayout = z
  .object({
    crewMemberId: identifier,
    currency: z.enum(["USD", "CNY"]),
    amountMinor: minor,
    withholdingAmountMinor: minor,
    note: z.string().trim().max(10000).optional(),
    idempotencyKey: z.string().trim().min(8).max(80),
  })
  .strict()
  .refine(
    (data) =>
      /^(0|[1-9]\d{0,18})$/.test(data.amountMinor) &&
      /^(0|[1-9]\d{0,18})$/.test(data.withholdingAmountMinor) &&
      BigInt(data.amountMinor) > BigInt(data.withholdingAmountMinor),
    "Net payout must be positive"
  );
export type NewPayout = z.infer<typeof newPayout>;
export async function fetchPayoutCreateAccess(crewId: string, userId: string, signal: AbortSignal) {
  identifier.parse(crewId);
  const member = z
    .object({ userId: z.string(), permissions: z.array(z.string()) })
    .parse(await api.get(`/crews/${crewId}/members/me`, { service: "aurora", signal }));
  if (member.userId !== userId) throw new Error("Payout creation account mismatch");
  return member.permissions.includes("finance.payouts.create");
}
export async function createPayout(
  crewId: string,
  recipientUserId: string,
  input: NewPayout,
  userId: string,
  generation: number
) {
  identifier.parse(crewId);
  const data = newPayout.parse(input);
  if (generation !== getAuthGeneration()) throw new Error("Payout creation session expired");
  if (data.currency !== (isChinaRegion ? "CNY" : "USD"))
    throw new Error("Payout currency does not match this site");
  const result = decisionPayout
    .extend({
      crewMemberId: identifier,
      createdByUserId: z.string(),
      allocations: z.array(
        z.object({
          id: z.string().uuid(),
          amountMinor: minor.refine((v) => v !== "0"),
          earning: z.object({ id: z.string().uuid() }),
        })
      ),
    })
    .parse(await api.post(`/crews/${crewId}/payouts`, { service: "aurora", data }));
  if (generation !== getAuthGeneration()) throw new Error("Payout creation session expired");
  if (
    result.crewId !== crewId ||
    result.crewMemberId !== data.crewMemberId ||
    result.userId !== recipientUserId ||
    result.createdByUserId !== userId ||
    result.currency !== data.currency ||
    result.amountMinor !== data.amountMinor ||
    result.withholdingAmountMinor !== data.withholdingAmountMinor ||
    result.netAmountMinor !==
      String(BigInt(data.amountMinor) - BigInt(data.withholdingAmountMinor)) ||
    result.note !== (data.note || null)
  )
    throw new Error("Payout receipt mismatch. Refresh the ledger before continuing.");
  if (
    new Set(result.allocations.map((a) => a.id)).size !== result.allocations.length ||
    new Set(result.allocations.map((a) => a.earning.id)).size !== result.allocations.length ||
    result.allocations.reduce((sum, a) => sum + BigInt(a.amountMinor), 0n) !==
      BigInt(data.amountMinor)
  )
    throw new Error("Payout allocation mismatch. Refresh the ledger before continuing.");
  // A retry may find a payout already paid or voided; both retain their original allocations.
  return result;
}
