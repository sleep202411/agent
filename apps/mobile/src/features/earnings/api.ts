import { z } from "zod";
import { api } from "@/lib/api-client";
import type { AppLocale } from "@/config";
export type EarningsPeriod = "all" | "30" | "90";
const amount = z.string().regex(/^-?\d+$/);
const entry = z.object({
  id: z.string(),
  kind: z.enum(["story", "ip"]),
  episodeId: z.string().nullable(),
  workKey: z.string(),
  workTitle: z.string().nullable(),
  contentTitle: z.string().nullable(),
  amount,
  sourceAmount: amount.nullable(),
  orderNo: z.string().nullable(),
  transactionId: z.string(),
  status: z.literal("posted"),
  createdAt: z.string().datetime(),
});
const page = z.object({
  lifetimeEarned: amount,
  withdrawableBalance: amount,
  works: z.array(
    z.object({ key: z.string(), kind: z.enum(["story", "ip"]), title: z.string().nullable() })
  ),
  entries: z.array(entry),
  nextCursor: z.string().min(1).nullable(),
});
export type EarningsPage = z.infer<typeof page>;
export type EarningsEntry = z.infer<typeof entry>;
export const formatEarnings = (value: string, locale: string) =>
  new Intl.NumberFormat(locale).format(BigInt(value));
export async function fetchEarnings(
  locale: AppLocale,
  work: string,
  days: EarningsPeriod,
  cursor: string | null,
  signal: AbortSignal
) {
  return page.parse(
    await api.get("/creator-earnings", {
      service: "aurora",
      signal,
      retry: false,
      cache: "no-store",
      params: {
        locale,
        days,
        limit: 10,
        ...(work === "all" ? {} : { work }),
        ...(cursor ? { cursor } : {}),
      },
    })
  );
}
