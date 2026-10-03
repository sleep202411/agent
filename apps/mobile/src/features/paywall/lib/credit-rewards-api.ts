import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";

const campaignSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  computeCreditAmount: z.number().int().nonnegative(),
  endsAt: z.string().nullable(),
  claimed: z.boolean(),
});
const grantSchema = z.object({
  grantType: z.literal("compute_credits"),
  currency: z.literal("compute_point"),
  amount: z.string().regex(/^\d+$/),
  workspaceId: z.string().uuid(),
});
export type CreditCampaign = z.infer<typeof campaignSchema>;
export const voucherCodeSchema = z.string().trim().min(3).max(40);
function current(generation: number, signal: AbortSignal) {
  if (signal.aborted || generation !== getAuthGeneration())
    throw Error("Credit rewards session expired or request cancelled.");
}
export async function listCreditCampaigns(generation: number, signal: AbortSignal) {
  current(generation, signal);
  const response = await api.get("/billing/campaigns/active", {
    service: "aurora",
    cache: "no-store",
    signal,
  });
  current(generation, signal);
  return z.object({ items: z.array(campaignSchema) }).parse(response).items;
}
/** Server deduplicates by campaign/user or voucher/user, including lost-response recovery. */
export async function claimCreditCampaign(id: string, generation: number, signal: AbortSignal) {
  z.string().uuid().parse(id);
  current(generation, signal);
  const response = await api.post(`/billing/campaigns/${encodeURIComponent(id)}/claim`, {
    service: "aurora",
    data: {},
    signal,
    retry: false,
  });
  current(generation, signal);
  return z.object({ granted: grantSchema, alreadyClaimed: z.boolean() }).parse(response);
}
export async function redeemCreditVoucher(code: string, generation: number, signal: AbortSignal) {
  const value = voucherCodeSchema.parse(code);
  current(generation, signal);
  const response = await api.post("/billing/vouchers/redeem", {
    service: "aurora",
    data: { code: value },
    signal,
    retry: false,
  });
  current(generation, signal);
  return z.object({ granted: grantSchema, alreadyRedeemed: z.boolean() }).parse(response);
}
