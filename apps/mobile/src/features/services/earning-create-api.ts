import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { isChinaRegion } from "@/config/app-env";
import { decisionEarning } from "./earning-decision-api";
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const manualEarningSources = [
  "milestone_bonus",
  "revenue_share",
  "discretionary_bonus",
  "adjustment",
] as const;
export function earningAmountMinor(value: string): string | undefined {
  if (!/^(?:0|[1-9]\d{0,16})(?:\.\d{1,2})?$/.test(value.trim())) return undefined;
  const [whole, fraction = ""] = value.trim().split(".");
  const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return amount > 0n && amount <= 9_223_372_036_854_775_807n ? String(amount) : undefined;
}
export const newEarning = z
  .object({
    crewMemberId: identifier,
    sourceType: z.enum(manualEarningSources),
    title: z.string().trim().min(1).max(180),
    description: z.string().trim().max(10000).optional(),
    currency: z.enum(["USD", "CNY"]),
    amountMinor: z
      .string()
      .regex(/^[1-9]\d{0,18}$/)
      .refine((v) => /^[1-9]\d{0,18}$/.test(v) && BigInt(v) <= 9_223_372_036_854_775_807n),
    idempotencyKey: z.string().trim().min(8).max(80),
  })
  .strict();
export type NewEarning = z.infer<typeof newEarning>;
export async function fetchEarningCreateAccess(
  crewId: string,
  userId: string,
  signal: AbortSignal
) {
  identifier.parse(crewId);
  const member = z
    .object({ userId: z.string(), permissions: z.array(z.string()) })
    .parse(await api.get(`/crews/${crewId}/members/me`, { service: "aurora", signal }));
  if (member.userId !== userId) throw new Error("Earning creation account mismatch");
  return member.permissions.includes("finance.earnings.create");
}
export async function createEarning(
  crewId: string,
  recipientUserId: string,
  input: NewEarning,
  userId: string,
  generation: number
) {
  identifier.parse(crewId);
  const data = newEarning.parse(input);
  if (generation !== getAuthGeneration()) throw new Error("Earning creation session expired");
  if (data.currency !== (isChinaRegion ? "CNY" : "USD"))
    throw new Error("Earning currency does not match this site");
  const result = decisionEarning
    .extend({ crewMemberId: identifier, createdByUserId: z.string() })
    .parse(await api.post(`/crews/${crewId}/earnings`, { service: "aurora", data }));
  if (generation !== getAuthGeneration()) throw new Error("Earning creation session expired");
  if (
    result.crewId !== crewId ||
    result.crewMemberId !== data.crewMemberId ||
    result.userId !== recipientUserId ||
    result.createdByUserId !== userId ||
    result.currency !== data.currency ||
    result.amountMinor !== data.amountMinor ||
    result.sourceType !== data.sourceType ||
    result.title !== data.title ||
    result.description !== (data.description || null)
  )
    throw new Error("Earning receipt mismatch. Refresh the ledger before continuing.");
  // A retry can return an earning already approved or rejected since its original creation.
  return result;
}
