"use client";
import { z } from "zod";
import { useTranslations } from "@/src/i18n/i18n";
import { formatCrewMoney, type CrewLedgerCurrency } from "@/src/lib/crew-money";
const TrendSchema = z.object({
  timezone: z.literal("UTC"),
  from: z.string().datetime(),
  through: z.string().datetime(),
  days: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        amountMinor: z.string().regex(/^-?\d{1,80}$/),
      })
    )
    .length(30),
});
export function postedProfitShare(value: unknown): string | undefined {
  const result = z
    .array(z.object({ sourceType: z.string(), amountMinor: z.string().regex(/^-?\d{1,80}$/) }))
    .safeParse(value);
  if (!result.success) return undefined;
  return result.data
    .filter((row) => row.sourceType === "revenue_share")
    .reduce((sum, row) => sum + BigInt(row.amountMinor), 0n)
    .toString();
}
export function earningTrendGeometry(input: unknown) {
  const parsed = TrendSchema.safeParse(input);
  if (!parsed.success) return null;
  const data = parsed.data;
  if (data.from > data.through) return null;
  for (let i = 0; i < data.days.length; i++) {
    const expected = new Date(data.from);
    expected.setUTCDate(expected.getUTCDate() + i);
    if (data.days[i]!.date !== expected.toISOString().slice(0, 10)) return null;
  }
  if (data.days.at(-1)!.date !== data.through.slice(0, 10)) return null;
  const values = data.days.map((day) => BigInt(day.amountMinor));
  const min = values.reduce((a, b) => (a < b ? a : b), 0n),
    max = values.reduce((a, b) => (a > b ? a : b), 0n);
  const range = max - min || 1n;
  const y = (value: bigint) => 140 - Number(((value - min) * 12000n) / range) / 100;
  const points = values.map((value, i) => `${20 + (i * 560) / 29},${y(value)}`).join(" ");
  return { data, points, baseline: y(0n), min: min.toString(), max: max.toString() };
}
export function EarningTrend({
  value,
  failed = false,
  loading = false,
  locale,
  currency,
}: {
  value: unknown;
  failed?: boolean;
  loading?: boolean;
  locale: string;
  currency: CrewLedgerCurrency;
}) {
  const t = useTranslations("crewFinanceDashboard");
  const graph = failed ? null : earningTrendGeometry(value);
  const money = (amount: string) => formatCrewMoney(amount, locale, currency);
  const date = (day: string) =>
    new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC" }).format(
      new Date(`${day}T00:00:00Z`)
    );
  return (
    <section aria-label={t("trend")} className="my-6 rounded-xl bg-white/[0.025] p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t("trend")}</h3>
        <span className="text-xs text-muted-foreground">{t("period")}</span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{t("basis")}</p>
      {!graph ? (
        <p role="status" className="py-8 text-sm text-muted-foreground">
          {t(loading ? "loading" : "unavailable")}
        </p>
      ) : (
        <>
          <div className="mt-5 flex gap-2">
            <div className="flex w-24 shrink-0 break-all flex-col justify-between py-4 text-xs text-muted-foreground">
              <span>{money(graph.max)}</span>
              <span>{money(graph.min)}</span>
            </div>
            <svg
              role="img"
              aria-label={t("trend")}
              viewBox="0 0 600 160"
              className="h-44 min-w-0 flex-1"
              preserveAspectRatio="none"
            >
              <line
                x1="20"
                x2="580"
                y1={graph.baseline}
                y2={graph.baseline}
                stroke="currentColor"
                opacity="0.15"
              />
              <polygon
                points={`20,${graph.baseline} ${graph.points} 580,${graph.baseline}`}
                fill="#FFD84D"
                opacity="0.08"
              />
              <polyline
                points={graph.points}
                fill="none"
                stroke="#FFD84D"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          </div>
          <div className="flex justify-between pl-24 text-xs text-muted-foreground">
            <span>{date(graph.data.days[0]!.date)}</span>
            <span>{date(graph.data.days.at(-1)!.date)}</span>
          </div>
          <details className="mt-4 text-xs">
            <summary className="cursor-pointer text-muted-foreground">{t("dailyAmounts")}</summary>
            <table className="mt-3 w-full text-left">
              <thead>
                <tr>
                  <th className="py-2">{t("date")}</th>
                  <th className="text-right">{t("amount")}</th>
                </tr>
              </thead>
              <tbody>
                {graph.data.days.map((day) => (
                  <tr key={day.date} className="border-t border-white/5">
                    <td className="py-2">{date(day.date)}</td>
                    <td className="text-right">{money(day.amountMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </section>
  );
}
