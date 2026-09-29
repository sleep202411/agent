import { z } from "zod";
import { financeProfitShare } from "./crew-finance-trend-data";
import { api } from "@/lib/api-client";
const money = z.string().regex(/^-?(0|[1-9]\d*)$/);
const uuid = z.string().uuid();
const currency = z.enum(["USD", "CNY"]);
export const earningStatuses = ["pending", "posted", "rejected", "reversed"] as const;
export const payoutStatuses = ["pending", "paid", "voided"] as const;
export type FinanceView = "earnings" | "payouts";
export type FinanceScope = "mine" | "crew";
const base = z.object({
  id: uuid,
  crewId: z.string(),
  userId: z.string(),
  currency,
  amountMinor: money,
  createdAt: z.string().datetime({ offset: true }),
});
export const earning = base.extend({
  title: z.string(),
  description: z.string().nullable(),
  sourceType: z.enum([
    "task_reward",
    "contract_compensation",
    "milestone_bonus",
    "revenue_share",
    "discretionary_bonus",
    "adjustment",
  ]),
  status: z.enum(earningStatuses),
});
export const payout = base.extend({
  netAmountMinor: money,
  withholdingAmountMinor: money,
  note: z.string().nullable(),
  status: z.enum(payoutStatuses),
});
const amountGroup = z.object({ count: z.number().int().nonnegative(), amountMinor: money });
const earningsPage = z.object({
  items: z.array(earning),
  nextCursor: uuid.nullable(),
  summary: z.object({
    byStatus: z.object({
      pending: amountGroup,
      posted: amountGroup,
      rejected: amountGroup,
      reversed: amountGroup,
    }),
    postedThisMonthAmountMinor: money,
    postedDaily: z.unknown().optional(),
    postedBySource: z.unknown().optional(),
  }),
});
const payoutsPage = z.object({
  items: z.array(payout),
  nextCursor: uuid.nullable(),
  summary: z.object({
    confirmedAmountMinor: money,
    availableAmountMinor: money,
    reservedAmountMinor: money,
    paidAmountMinor: money,
  }),
});
export type FinanceRow = {
  id: string;
  userId: string;
  currency: "CNY" | "USD";
  amountMinor: string;
  createdAt: string;
  status: (typeof earningStatuses)[number] | (typeof payoutStatuses)[number];
  title: string;
  description: string | null;
  sourceType?: z.infer<typeof earning>["sourceType"];
  netAmountMinor?: string;
  withholdingAmountMinor?: string;
};
export type FinancePage = {
  postedDaily?: unknown;
  profitShare?: string;
  items: FinanceRow[];
  nextCursor: string | null;
  summary: {
    label: "posted" | "pending" | "month" | "available" | "reserved" | "paid";
    amount: string;
  }[];
};
export async function fetchFinanceAccess(crewId: string, userId: string, signal: AbortSignal) {
  z.string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .parse(crewId);
  const member = z
    .object({ userId: z.string(), permissions: z.array(z.string()) })
    .parse(await api.get(`/crews/${crewId}/members/me`, { service: "aurora", signal }));
  if (member.userId !== userId) throw new Error("Crew finance account mismatch");
  return member.permissions.includes("finance.ledger.view");
}
export async function fetchFinancePage(
  crewId: string,
  userId: string,
  input: {
    view: FinanceView;
    scope: FinanceScope;
    currency: "USD" | "CNY";
    status: string;
    cursor: string | null;
  },
  signal: AbortSignal
): Promise<FinancePage> {
  z.string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .parse(crewId);
  z.enum(["earnings", "payouts"]).parse(input.view);
  z.enum(["mine", "crew"]).parse(input.scope);
  currency.parse(input.currency);
  if (input.cursor) uuid.parse(input.cursor);
  if (input.status !== "all")
    (input.view === "earnings" ? z.enum(earningStatuses) : z.enum(payoutStatuses)).parse(
      input.status
    );
  const raw = await api.get(`/crews/${crewId}/${input.view}`, {
    service: "aurora",
    signal,
    params: {
      scope: input.scope,
      currency: input.currency,
      limit: 50,
      ...(input.status !== "all" ? { status: input.status } : {}),
      ...(input.cursor ? { cursor: input.cursor } : {}),
    },
  });
  const page = input.view === "earnings" ? earningsPage.parse(raw) : payoutsPage.parse(raw);
  if (
    page.items.some(
      (row) =>
        row.crewId !== crewId ||
        row.currency !== input.currency ||
        (input.scope === "mine" && row.userId !== userId) ||
        (input.status !== "all" && row.status !== input.status)
    ) ||
    new Set(page.items.map((row) => row.id)).size !== page.items.length ||
    (input.cursor !== null && page.nextCursor === input.cursor)
  )
    throw new Error("Crew finance page mismatch");
  const items: FinanceRow[] = page.items.map((row) =>
    "title" in row ? row : { ...row, title: "", description: row.note }
  );
  if ("byStatus" in page.summary)
    return {
      items,
      postedDaily: page.summary.postedDaily,
      profitShare: financeProfitShare(page.summary.postedBySource),
      nextCursor: page.nextCursor,
      summary: [
        { label: "posted", amount: page.summary.byStatus.posted.amountMinor },
        { label: "pending", amount: page.summary.byStatus.pending.amountMinor },
        { label: "month", amount: page.summary.postedThisMonthAmountMinor },
      ],
    };
  return {
    items,
    nextCursor: page.nextCursor,
    summary: [
      { label: "posted", amount: page.summary.confirmedAmountMinor },
      { label: "available", amount: page.summary.availableAmountMinor },
      { label: "reserved", amount: page.summary.reservedAmountMinor },
      { label: "paid", amount: page.summary.paidAmountMinor },
    ],
  };
}
export function formatFinanceMoney(value: string, currency: "USD" | "CNY") {
  money.parse(value);
  const n = BigInt(value),
    abs = n < 0n ? -n : n;
  return `${currency} ${n < 0n ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
}
