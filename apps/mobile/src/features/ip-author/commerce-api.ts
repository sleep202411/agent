import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
const count = z.number().int().nonnegative();
const points = z.string().regex(/^\d+$/);
const balance = z.string().regex(/^-?\d+$/);
const reference = z.object({ id: z.string().uuid(), title: z.string(), status: z.string() });
const order = z.object({
  id: z.string().uuid(),
  ipId: z.string().uuid(),
  episodeId: z.string().uuid().nullable(),
  orderNo: z.string(),
  status: z.string(),
  targetType: z.enum(["ip", "episode"]),
  currency: z.literal("community_point"),
  totalAmount: points,
  createdAt: z.string().datetime({ offset: true }),
  ip: reference.nullable(),
  episode: reference.nullable(),
});
const overview = z.object({
  ip: reference,
  metrics: z.object({
    totalOrders: count,
    recognizedOrders: count,
    grossCommunityPoints: points,
    ordersLast7Days: count,
    grossCommunityPointsLast7Days: points,
    uniqueBuyers: count,
    activeEntitlements: count,
    pendingUnlocks: count,
  }),
  pricingHealth: z.object({
    status: z.enum(["ready", "attention", "blocked"]),
    bundlePriceActive: z.boolean(),
    activeEpisodePriceCount: count,
    pricedEpisodeCount: count,
    publishedEpisodeCount: count,
    freePreviewEpisodeCount: count,
    warnings: z.array(
      z.object({ code: z.string(), severity: z.enum(["blocker", "warning"]), message: z.string() })
    ),
  }),
  settlement: z.object({
    status: z.enum(["active", "not_configured"]),
    currency: z.literal("community_point"),
    saleShareBps: z.number().int().min(0).max(10000),
    ipLifetimeEarnings: balance,
    withdrawableBalance: balance,
    note: z.string(),
  }),
  recentOrders: z.array(order).max(12),
});
export type CommerceOverview = z.infer<typeof overview>;
export async function fetchCommerce(
  ipId: string,
  generation: number,
  locale: string,
  signal: AbortSignal
) {
  const check = () => {
    if (signal.aborted || getAuthGeneration() !== generation)
      throw new Error("IP editing session expired.");
  };
  check();
  z.string().uuid().parse(ipId);
  const value = overview.parse(
    await api.get(`/ip-commerce/me/ips/${ipId}/commerce`, {
      service: "aurora",
      params: { locale },
      signal,
      retry: false,
    })
  );
  check();
  if (
    value.ip.id !== ipId ||
    new Set(value.recentOrders.map((item) => item.id)).size !== value.recentOrders.length ||
    value.recentOrders.some(
      (item) =>
        item.ipId !== ipId ||
        (item.ip && item.ip.id !== ipId) ||
        (item.episode && item.episode.id !== item.episodeId)
    )
  )
    throw new Error("IP commerce identity mismatch.");
  return value;
}
export function formatCommercePoints(value: string, locale: string) {
  balance.parse(value);
  // Never convert community-point balances to Number: large balances must remain exact.
  return new Intl.NumberFormat(locale).format(BigInt(value));
}
