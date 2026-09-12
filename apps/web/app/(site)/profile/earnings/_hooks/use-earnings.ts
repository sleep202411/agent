import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "@/src/lib/api";

export const EARNINGS_PAGE_SIZE = 10;

export type EarningsEntry = {
  id: string;
  kind: "story" | "ip";
  episodeId: string | null;
  workKey: string;
  workTitle: string | null;
  contentTitle: string | null;
  amount: string;
  sourceAmount: string | null;
  orderNo: string | null;
  transactionId: string;
  status: "posted";
  createdAt: string;
};
export type EarningsPage = {
  lifetimeEarned: string;
  withdrawableBalance: string;
  works: Array<{ key: string; kind: "story" | "ip"; title: string | null }>;
  entries: EarningsEntry[];
  nextCursor: string | null;
};
export function useEarnings(userId: string, locale: string, work: string, days: string) {
  return useInfiniteQuery({
    queryKey: ["creator-earnings", userId, locale, work, days, EARNINGS_PAGE_SIZE],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({ locale, days, limit: String(EARNINGS_PAGE_SIZE) });
      if (work !== "all") params.set("work", work);
      if (pageParam) params.set("cursor", pageParam);
      return api.get<EarningsPage>(`/aurora/creator-earnings?${params}`, { cache: "no-store" });
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: 30_000,
    retry: false,
  });
}

export function formatEarnings(value: string, locale: string) {
  return new Intl.NumberFormat(locale).format(BigInt(value));
}
