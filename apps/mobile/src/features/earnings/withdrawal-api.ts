import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";

const currency = z.enum(["USD", "CNY"]);
const money = z.string().regex(/^(0|[1-9]\d*)$/);
export const withdrawalRecipient = z.object({
  fullName: z.string().trim().min(1).max(200),
  accountNumber: z.string().trim().min(1).max(120),
  address: z.string().trim().min(1).max(1000),
  swift: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/),
  branchAddress: z.string().trim().min(1).max(1000),
});
export const withdrawalCommand = z.object({
  requestId: z.string().uuid(),
  currency,
  percentageBps: z.number().int().min(1).max(10000),
  expectedAvailableAmountMinor: z
    .string()
    .regex(/^[1-9]\d*$/)
    .refine((value) => BigInt(value) <= 9223372036854775807n),
  recipient: withdrawalRecipient,
});
export type WithdrawalCommand = z.infer<typeof withdrawalCommand>;
export type WithdrawalRecipient = z.infer<typeof withdrawalRecipient>;
const balance = z.object({
  currency,
  confirmedAmountMinor: money,
  availableAmountMinor: money,
  reservedAmountMinor: money,
  paidAmountMinor: money,
});
export type WithdrawalBalance = z.infer<typeof balance>;
const receipt = z.object({
  id: z.string().uuid(),
  currency,
  amountMinor: money,
  percentageBps: z.number().int().min(1).max(10000),
  status: z.enum(["pending", "processing", "paid", "rejected", "cancelled"]),
  createdAt: z.string().datetime({ offset: true }),
});
const historyRow = receipt.extend({
  paidAt: z.string().datetime({ offset: true }).nullable(),
  hasPaymentProof: z.boolean(),
  resolutionReason: z.string().nullable(),
});
export type Withdrawal = z.infer<typeof historyRow>;
export function withdrawalPreview(available: string, percentage: string) {
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(percentage) || !/^\d+$/.test(available)) return null;
  const [whole, fraction = ""] = percentage.split(".");
  const percentageBps = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (percentageBps < 1 || percentageBps > 10000) return null;
  const amount = (BigInt(available) * BigInt(percentageBps)) / 10000n;
  if (amount <= 0n || BigInt(available) > 9223372036854775807n) return null;
  return { percentageBps, amountMinor: String(amount) };
}
export function assertWithdrawalSession(generation: number, signal?: AbortSignal) {
  if (getAuthGeneration() !== generation || signal?.aborted)
    throw Error("Withdrawal session expired.");
}
export async function fetchWithdrawalBalances(generation: number, signal: AbortSignal) {
  assertWithdrawalSession(generation, signal);
  const result = z.array(balance).parse(
    await api.get("/me/withdrawals/balances", {
      service: "aurora",
      cache: "no-store",
      retry: false,
      signal,
    })
  );
  assertWithdrawalSession(generation, signal);
  if (new Set(result.map((row) => row.currency)).size !== result.length)
    throw Error("Withdrawal balance mismatch.");
  return result;
}
export async function fetchWithdrawalHistory(
  generation: number,
  cursor: string | null,
  signal: AbortSignal
) {
  assertWithdrawalSession(generation, signal);
  const result = z
    .object({ items: z.array(historyRow), nextCursor: z.string().uuid().nullable() })
    .parse(
      await api.get("/me/withdrawals", {
        service: "aurora",
        cache: "no-store",
        retry: false,
        signal,
        params: cursor ? { cursor: z.string().uuid().parse(cursor) } : {},
      })
    );
  assertWithdrawalSession(generation, signal);
  return result;
}
export async function fetchWithdrawalRecipient(generation: number, signal: AbortSignal) {
  assertWithdrawalSession(generation, signal);
  const result = z
    .object({ recipient: withdrawalRecipient })
    .nullable()
    .parse(
      await api.get("/me/withdrawals/recipient", {
        service: "aurora",
        cache: "no-store",
        retry: false,
        signal,
      })
    );
  assertWithdrawalSession(generation, signal);
  return result?.recipient ?? null;
}
export async function requestWithdrawal(
  input: WithdrawalCommand,
  generation: number,
  signal: AbortSignal
) {
  assertWithdrawalSession(generation, signal);
  const request = withdrawalCommand.parse(input);
  const amount =
    (BigInt(request.expectedAvailableAmountMinor) * BigInt(request.percentageBps)) / 10000n;
  if (amount <= 0n) throw Error("Withdrawal amount is less than one minor currency unit.");
  const result = receipt.parse(
    await api.post("/me/withdrawals", {
      service: "aurora",
      retry: false,
      signal,
      data: request,
    })
  );
  assertWithdrawalSession(generation, signal);
  if (
    result.currency !== request.currency ||
    result.percentageBps !== request.percentageBps ||
    result.amountMinor !== String(amount)
  )
    throw Error("Withdrawal receipt mismatch.");
  return result;
}
export async function fetchWithdrawalProof(id: string, generation: number, signal: AbortSignal) {
  assertWithdrawalSession(generation, signal);
  const result = z
    .object({ url: z.string().url(), expiresAt: z.string().datetime({ offset: true }) })
    .parse(
      await api.post(`/me/withdrawals/${z.string().uuid().parse(id)}/payment-proof/download`, {
        service: "aurora",
        retry: false,
        signal,
      })
    );
  assertWithdrawalSession(generation, signal);
  const url = new URL(result.url);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    Date.parse(result.expiresAt) <= Date.now()
  )
    throw Error("Payment proof link is invalid or expired.");
  return result.url;
}
