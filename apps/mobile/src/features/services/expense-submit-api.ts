import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { expenseRecord, type ExpenseRecord } from "./crew-expenses-api";
export function canSubmitExpense(record: ExpenseRecord) {
  const d = record.definition;
  return (
    record.submissionStatus === null &&
    !!d.category.trim() &&
    !!d.purpose.trim() &&
    !!d.occurredOn &&
    d.amountMinor !== null &&
    BigInt(d.amountMinor) > 0n
  );
}
export async function submitExpense(record: ExpenseRecord, userId: string, generation: number) {
  const snapshot = expenseRecord.parse(record);
  if (snapshot.claimantUserId !== userId || !canSubmitExpense(snapshot))
    throw new Error("Complete and save this draft before submitting it for review.");
  if (generation !== getAuthGeneration()) throw new Error("Expense submission session expired");
  const result = z
    .object({
      draftId: z.string().uuid(),
      draftVersion: z.number().int().positive(),
      status: z.enum(["pending", "approved", "rejected"]),
      submittedAt: z.string().datetime({ offset: true }),
    })
    .parse(
      await api.post(`/crews/${snapshot.crewId}/expense-drafts/${snapshot.id}/submit`, {
        service: "aurora",
        data: { expectedVersion: snapshot.version },
      })
    );
  if (generation !== getAuthGeneration()) throw new Error("Expense submission session expired");
  if (result.draftId !== snapshot.id || result.draftVersion !== snapshot.version)
    throw new Error("Expense submission receipt does not match. Refresh the claims list.");
  return result;
}
