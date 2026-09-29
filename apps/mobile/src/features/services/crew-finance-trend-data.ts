import { z } from "zod";
const amount = z.string().regex(/^-?(0|[1-9]\d{0,79})$/);
const trend = z.object({
  timezone: z.literal("UTC"),
  from: z.string().datetime(),
  through: z.string().datetime(),
  days: z
    .array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), amountMinor: amount }))
    .length(30),
});
/** Scale integer minor units before converting pixel coordinates to Number. */
export function financeTrendGeometry(input: unknown) {
  const result = trend.safeParse(input);
  if (!result.success) return null;
  const data = result.data,
    start = Date.parse(data.from),
    end = Date.parse(data.through);
  if (start > end || new Date(start).toISOString().slice(11) !== "00:00:00.000Z") return null;
  for (let i = 0; i < 30; i++)
    if (data.days[i]!.date !== new Date(start + i * 86400000).toISOString().slice(0, 10))
      return null;
  if (data.days[29]!.date !== data.through.slice(0, 10)) return null;
  const values = data.days.map((day) => BigInt(day.amountMinor));
  const min = values.reduce((a, b) => (a < b ? a : b), 0n),
    max = values.reduce((a, b) => (a > b ? a : b), 0n),
    range = max - min || 1n;
  const y = (value: bigint) => 140 - Number(((value - min) * 12000n) / range) / 100;
  return {
    data,
    min: min.toString(),
    max: max.toString(),
    baseline: y(0n),
    points: values.map((value, i) => `${20 + (i * 560) / 29},${y(value)}`).join(" "),
  };
}
export function financeProfitShare(input: unknown): string | undefined {
  const result = z
    .array(z.object({ sourceType: z.string(), amountMinor: amount }))
    .safeParse(input);
  if (!result.success) return undefined;
  return result.data
    .filter((row) => row.sourceType === "revenue_share")
    .reduce((sum, row) => sum + BigInt(row.amountMinor), 0n)
    .toString();
}
