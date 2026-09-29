import { z } from "zod";
import { api } from "@/lib/api-client";
import { earning, payout, type FinanceView, type FinanceRow } from "./crew-finance-api";
const uuid = z.string().uuid(),
  date = z.string().datetime({ offset: true });
const task = z
  .object({ id: uuid, number: z.number().int().positive(), title: z.string() })
  .nullable();
const events = z.array(
  z.object({ id: uuid, actorUserId: z.string(), action: z.string(), createdAt: date })
);
const earningDetail = earning.extend({
  version: z.number().int().positive(),
  task,
  agreement: z.object({ id: uuid, status: z.string() }).nullable(),
  rejectionReason: z.string().nullable(),
  reversalReason: z.string().nullable(),
  postedAt: date.nullable(),
  rejectedAt: date.nullable(),
  reversedAt: date.nullable(),
  events,
});
const payoutDetail = payout.extend({
  paymentMethod: z.enum(["bank_transfer", "alipay", "wechat_pay", "paypal", "other"]).nullable(),
  paymentReference: z.string().nullable(),
  paymentProofUrl: z.string().nullable(),
  voidReason: z.string().nullable(),
  paidAt: date.nullable(),
  voidedAt: date.nullable(),
  allocations: z.array(
    z.object({
      id: uuid,
      amountMinor: z.string().regex(/^(0|[1-9]\d*)$/),
      earning: z.object({ id: uuid, title: z.string(), task }),
    })
  ),
  events,
});
export async function fetchFinanceDetail(
  crewId: string,
  view: FinanceView,
  selected: FinanceRow,
  signal: AbortSignal
) {
  z.enum(["earnings", "payouts"]).parse(view);
  uuid.parse(selected.id);
  const raw = await api.get(`/crew-${view}/${selected.id}`, { service: "aurora", signal });
  const record = view === "earnings" ? earningDetail.parse(raw) : payoutDetail.parse(raw);
  if (
    record.id !== selected.id ||
    record.crewId !== crewId ||
    record.currency !== selected.currency ||
    record.userId !== selected.userId ||
    new Set(record.events.map((event) => event.id)).size !== record.events.length
  )
    throw new Error("Finance detail scope mismatch");
  if (
    "allocations" in record &&
    new Set(record.allocations.map((row) => row.id)).size !== record.allocations.length
  )
    throw new Error("Duplicate payout allocations");
  return record;
}
export function financeProofUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
