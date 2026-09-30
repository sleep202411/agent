import { z } from "zod";
import { api } from "@/lib/api-client";
const crew = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const expenseDefinition = z.object({
  category: z.string().max(120),
  purpose: z.string().max(2000),
  occurredOn: z.string().date().nullable(),
  currency: z.enum(["USD", "CNY"]),
  amountMinor: z
    .string()
    .regex(/^(0|[1-9][0-9]{0,14})$/)
    .nullable(),
  evidenceNote: z.string().max(4000),
  receiptIds: z
    .array(z.string().uuid())
    .max(10)
    .refine((ids) => new Set(ids).size === ids.length)
    .optional(),
});
export const expenseRecord = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  crewId: crew,
  claimantUserId: z.string().min(1),
  definition: expenseDefinition,
  createdAt: z.string().datetime({ offset: true }),
  submissionStatus: z.enum(["pending", "approved", "rejected"]).nullable(),
  submittedAt: z.string().datetime({ offset: true }).nullable(),
});
export type ExpenseRecord = z.infer<typeof expenseRecord>;
export async function fetchExpenses(
  crewId: string,
  userId: string,
  after: string | null,
  signal: AbortSignal
) {
  crew.parse(crewId);
  if (after) z.string().uuid().parse(after);
  const page = z
    .object({ items: z.array(expenseRecord), nextCursor: z.string().uuid().nullable() })
    .parse(
      await api.get(`/crews/${crewId}/expense-drafts`, {
        service: "aurora",
        signal,
        params: { limit: 30, ...(after ? { after } : {}) },
      })
    );
  if (
    page.items.some((r) => r.crewId !== crewId || r.claimantUserId !== userId) ||
    new Set(page.items.map((r) => r.id)).size !== page.items.length ||
    (after !== null && page.nextCursor === after)
  )
    throw new Error("Expense scope or pagination changed. Refresh to reload.");
  return page;
}
export async function fetchExpenseHistory(
  crewId: string,
  userId: string,
  draftId: string,
  beforeVersion: number | null,
  signal: AbortSignal
) {
  crew.parse(crewId);
  z.string().uuid().parse(draftId);
  if (beforeVersion !== null) z.number().int().positive().parse(beforeVersion);
  const page = z
    .object({ items: z.array(expenseRecord), nextCursor: z.number().int().positive().nullable() })
    .parse(
      await api.get(`/crews/${crewId}/expense-drafts/${draftId}/history`, {
        service: "aurora",
        signal,
        params: { limit: 30, ...(beforeVersion !== null ? { beforeVersion } : {}) },
      })
    );
  if (
    page.items.some(
      (r) =>
        r.id !== draftId ||
        r.crewId !== crewId ||
        r.claimantUserId !== userId ||
        (beforeVersion !== null && r.version >= beforeVersion)
    ) ||
    new Set(page.items.map((r) => r.version)).size !== page.items.length ||
    (page.nextCursor !== null &&
      (!page.items.length || page.nextCursor !== page.items[page.items.length - 1]?.version))
  )
    throw new Error("Expense history scope or pagination changed. Refresh to reload.");
  return page;
}
export async function fetchExpenseReceipt(
  crewId: string,
  draftId: string,
  receiptId: string,
  signal: AbortSignal
) {
  crew.parse(crewId);
  z.string().uuid().parse(draftId);
  z.string().uuid().parse(receiptId);
  const response = z.object({ url: z.string().url() }).parse(
    await api.get(`/crews/${crewId}/expense-drafts/${draftId}/receipts/${receiptId}/read`, {
      service: "aurora",
      signal,
    })
  );
  const url = new URL(response.url);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Invalid receipt link");
  return response.url;
}
