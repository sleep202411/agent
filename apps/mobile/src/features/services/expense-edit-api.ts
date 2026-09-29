import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { expenseDefinition, expenseRecord } from "./crew-expenses-api";
export const expenseSaveInput = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    definition: expenseDefinition
      .extend({
        category: z.string().trim().max(120),
        purpose: z.string().trim().max(2000),
        evidenceNote: z.string().trim().max(4000),
      })
      .strict(),
  })
  .strict();
export type ExpenseSaveInput = z.infer<typeof expenseSaveInput>;
export function expenseAmount(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(text))
    throw new Error("Enter an amount with at most two decimal places.");
  const [whole, fraction = ""] = text.split(".");
  const minor = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (minor > 999999999999999n) throw new Error("Expense amount exceeds the supported limit.");
  return minor.toString();
}
export async function saveExpense(
  crewId: string,
  userId: string,
  id: string,
  input: ExpenseSaveInput,
  generation: number
) {
  z.string()
    .regex(/^[A-Za-z0-9_-]{1,128}$/)
    .parse(crewId);
  z.string().uuid().parse(id);
  const data = expenseSaveInput.parse(input);
  if (generation !== getAuthGeneration()) throw new Error("Expense session expired");
  const saved = expenseRecord
    .omit({ submissionStatus: true, submittedAt: true })
    .parse(await api.post(`/crews/${crewId}/expense-drafts/${id}`, { service: "aurora", data }));
  if (generation !== getAuthGeneration()) throw new Error("Expense session expired");
  if (
    saved.crewId !== crewId ||
    saved.claimantUserId !== userId ||
    saved.id !== id ||
    saved.version !== data.expectedVersion + 1 ||
    JSON.stringify(saved.definition) !== JSON.stringify(data.definition)
  )
    throw new Error("Expense receipt does not match. Refresh before editing again.");
  return { ...saved, submissionStatus: null, submittedAt: null };
}
