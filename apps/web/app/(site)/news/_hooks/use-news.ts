/**
 * News feature data layer.
 *
 * The client hits our own /api/news route, which server-side merges the
 * upstream Java content feed with our hardcoded static articles and
 * returns one normalized `NewsItem[]`. Items already carry a fully-
 * resolved `cover` URL plus an `isExternal` flag — the page just routes
 * accordingly.
 */

"use client";

import { useQuery } from "@tanstack/react-query";
import { useLocale } from "@/src/i18n/i18n";
import type { NewsItem } from "../_data/types";

export type { NewsItem } from "../_data/types";

// ─── Helpers ──────────────────────────────────────────

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

/** Where a card should link — internal detail page or external blog. */
export function articleHref(item: NewsItem): string {
  if (item.isExternal && item.url) return item.url;
  return `/news/${item.id}`;
}

// ─── Fetcher / hooks ──────────────────────────────────

async function fetchNewsList(lang: string): Promise<NewsItem[]> {
  const res = await fetch(`/api/news?lang=${encodeURIComponent(lang)}`);
  if (!res.ok) return [];
  const json = (await res.json()) as { articles: NewsItem[] };
  return json.articles ?? [];
}

export const newsKeys = {
  all: ["news"] as const,
  list: (lang: string) => ["news", "list", lang] as const,
};

export function useNewsList() {
  const locale = useLocale();
  return useQuery<NewsItem[]>({
    queryKey: newsKeys.list(locale),
    queryFn: () => fetchNewsList(locale),
    staleTime: 1000 * 60 * 5,
  });
}

/** Look up a single internal item by id from the cached list. */
export function useNewsItem(id: number) {
  const { data, isLoading } = useNewsList();
  const item = data?.find((a) => a.id === id);
  return { item, all: data ?? [], isLoading };
}
