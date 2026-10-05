import { TASK_PAYMENT_TERMS } from "@repo/shared/crew";
import { z } from "zod";

export const taskCompensationShape = {
  paymentTerms: z.enum(TASK_PAYMENT_TERMS).nullable().optional(),
  rewardUsdMinor: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
  profitShareBps: z.number().int().min(0).max(10_000).nullable().optional(),
};
/** Parse display units exactly; never round a user's financial terms. */
export function parseCompensation(value: string, max: number): number | null {
  const text = value.trim();
  if (!text) return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error("Use up to two decimal places.");
  const [whole, fraction = ""] = text.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor) || minor > max)
    throw new Error("Amount exceeds the allowed limit.");
  return minor;
}
export function compensationText(value: number | null | undefined): string {
  return value == null ? "" : `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`;
}
