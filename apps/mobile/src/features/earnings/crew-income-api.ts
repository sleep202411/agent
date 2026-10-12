import { z } from "zod";
import { api } from "@/lib/api-client";
import { earning, payout } from "@/features/services/crew-finance-api";
const money = z.string().regex(/^-?(0|[1-9]\d*)$/);
export const incomeFiltersSchema = z
  .object({
    status: earning.shape.status.optional(),
    sourceType: earning.shape.sourceType.optional(),
    recordedFrom: z.string().date().optional(),
    recordedThrough: z.string().date().optional(),
  })
  .refine(
    (value) =>
      !value.recordedFrom || !value.recordedThrough || value.recordedFrom <= value.recordedThrough
  );
export type IncomeFilters = z.infer<typeof incomeFiltersSchema>;
const sourceTotal = z.object({
  sourceType: earning.shape.sourceType,
  amountMinor: money,
  count: z.number().int().nonnegative(),
});
const group = z.object({ amountMinor: money, count: z.number().int().nonnegative() });
const earnings = z.object({
  items: z.array(
    earning.extend({
      postedAt: z.string().nullable(),
      crew: z.object({ id: z.string(), name: z.string() }).nullable().optional(),
      revenueDistribution: z
        .object({
          id: z.string().uuid(),
          revenueReference: z.string(),
          confirmedAt: z.string(),
          contract: z.object({ id: z.string().uuid(), filename: z.string() }),
          shareBps: z.number().int().min(0).max(10000).nullable(),
        })
        .nullable()
        .optional(),
      task: z.object({ number: z.number(), title: z.string() }).nullable(),
    })
  ),
  nextCursor: z.string().uuid().nullable(),
  summary: z.object({
    byStatus: z.object({ pending: group, posted: group, rejected: group, reversed: group }),
    postedDaily: z.unknown().optional(),
    postedThisMonthAmountMinor: money.optional(),
    postedBySource: z.array(sourceTotal).optional(),
  }),
});
const payouts = z.object({
  items: z.array(
    payout.extend({
      paidAt: z.string().nullable(),
      paymentReference: z.string().nullable(),
      voidReason: z.string().nullable(),
      allocations: z.array(
        z.object({ id: z.string(), amountMinor: money, earning: z.object({ title: z.string() }) })
      ),
    })
  ),
  nextCursor: z.string().uuid().nullable(),
  summary: z.object({
    confirmedAmountMinor: money,
    reservedAmountMinor: money,
    paidAmountMinor: money,
    availableAmountMinor: money,
    byStatus: z.array(
      z.object({
        status: z.enum(["pending", "paid", "voided"]),
        amountMinor: money,
        netAmountMinor: money,
      })
    ),
  }),
});
export type IncomeView = "earnings" | "payouts";
export type IncomeRow =
  | z.infer<typeof earnings>["items"][number]
  | z.infer<typeof payouts>["items"][number];
export type IncomePage = {
  items: IncomeRow[];
  nextCursor: string | null;
  summary: { key: string; amount: string }[];
  postedDaily?: unknown;
  postedBySource?: z.infer<typeof sourceTotal>[];
};
export async function fetchCrewIncome(
  userId: string,
  currency: "USD" | "CNY",
  view: IncomeView,
  crewId: string,
  cursor: string | null,
  signal: AbortSignal,
  filters: IncomeFilters = {}
): Promise<IncomePage> {
  if (!userId) throw new Error("Sign in to view income");
  const selectedFilters = view === "earnings" ? incomeFiltersSchema.parse(filters) : {};
  const raw = await api.get(`/me/crew-${view}`, {
    service: "aurora",
    signal,
    retry: false,
    params: {
      currency,
      limit: 50,
      ...(crewId ? { crewId } : {}),
      ...(cursor ? { cursor } : {}),
      ...selectedFilters,
    },
  });
  const page = view === "earnings" ? earnings.parse(raw) : payouts.parse(raw);
  if (
    page.items.some(
      (item) =>
        item.userId !== userId ||
        item.currency !== currency ||
        (crewId && item.crewId !== crewId) ||
        (view === "earnings" &&
          ((selectedFilters.status && item.status !== selectedFilters.status) ||
            (selectedFilters.sourceType &&
              "sourceType" in item &&
              item.sourceType !== selectedFilters.sourceType) ||
            (selectedFilters.recordedFrom &&
              new Date(item.createdAt).toISOString().slice(0, 10) < selectedFilters.recordedFrom) ||
            (selectedFilters.recordedThrough &&
              new Date(item.createdAt).toISOString().slice(0, 10) >
                selectedFilters.recordedThrough)))
    )
  )
    throw new Error("Personal crew income mismatch");
  if ("postedDaily" in page.summary || view === "earnings") {
    const summary = (page as z.infer<typeof earnings>).summary;
    return {
      items: page.items,
      nextCursor: page.nextCursor,
      postedDaily: summary.postedDaily,
      postedBySource: summary.postedBySource,
      summary: [
        ...(summary.postedThisMonthAmountMinor !== undefined
          ? [
              {
                key: "crewPersonalIncome.postedThisMonth",
                amount: summary.postedThisMonthAmountMinor,
              },
            ]
          : []),
        ...Object.entries(summary.byStatus).map(([key, value]) => ({
          key: `crewPersonalIncome.${key}`,
          amount: value.amountMinor,
        })),
      ],
    };
  }
  const summary = (page as z.infer<typeof payouts>).summary;
  return {
    items: page.items,
    nextCursor: page.nextCursor,
    summary: [
      ...(
        [
          ["confirmed", "confirmedAmountMinor"],
          ["reserved", "reservedAmountMinor"],
          ["grossPaid", "paidAmountMinor"],
          ["available", "availableAmountMinor"],
        ] as const
      ).map(([key, field]) => ({ key: `crewPersonalPayouts.${key}`, amount: summary[field] })),
      ...(["pending", "paid", "voided"] as const).flatMap((status) => {
        const value = summary.byStatus.find((item) => item.status === status);
        return [
          { key: `crewPersonalPayouts.${status}`, amount: value?.netAmountMinor ?? "0" },
          { key: `crewPersonalPayouts.gross`, amount: value?.amountMinor ?? "0" },
        ];
      }),
    ],
  };
}
