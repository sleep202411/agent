/**
 * News feature data layer.
 *
 * The backend exposes a single list endpoint (/newsapi/project/list/newsad)
 * keyed by section ("banner-Big", "banner-Small", "s-<name>-Title",
 * "s-<name>-Small", "footer", …). There is no detail endpoint — each item
 * carries an external `url`. The detail page reuses the same list query
 * and looks the item up by id.
 */

"use client";

import { useQuery } from "@tanstack/react-query";

// ─── Types ────────────────────────────────────────────

export interface NewsItem {
  id: number;
  type: string;
  title: string;
  info: string;
  url: string;
  picLink: string;
  createTime: string;
}

export interface NewsData {
  "banner-Big"?: NewsItem[];
  "banner-Small"?: NewsItem[];
  footer?: NewsItem[];
  [key: string]: NewsItem[] | undefined;
}

// ─── Constants ────────────────────────────────────────

const IMG_BASE = "https://banner.fizzspace.cn";
const API_URL = "/newsapi/project/list/newsad";

// ─── Helpers ──────────────────────────────────────────

export function imgUrl(picLink: string): string {
  if (!picLink) return "";
  return `${IMG_BASE}/${picLink}`;
}

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Flatten every section into a single id→item map for detail lookup. */
export function flattenItems(data: NewsData | undefined): Map<number, NewsItem> {
  const map = new Map<number, NewsItem>();
  if (!data) return map;
  for (const arr of Object.values(data)) {
    if (!arr) continue;
    for (const item of arr) {
      if (!map.has(item.id)) map.set(item.id, item);
    }
  }
  return map;
}

/** Parse `s-<name>-Title` / `s-<name>-Small` pairs into named sections. */
export function parseSections(
  data: NewsData
): { name: string; title: string; items: NewsItem[] }[] {
  const sections: { name: string; title: string; items: NewsItem[] }[] = [];
  const seen = new Set<string>();

  for (const key of Object.keys(data)) {
    if (!key.startsWith("s-") || !key.endsWith("-Title")) continue;
    const name = key.replace("s-", "").replace("-Title", "");
    if (seen.has(name)) continue;
    seen.add(name);

    const titleItems = data[`s-${name}-Title`] ?? [];
    const smallItems = data[`s-${name}-Small`] ?? [];
    if (smallItems.length === 0) continue;

    sections.push({
      name,
      title: titleItems[0]?.title ?? name,
      items: smallItems.slice(0, 2),
    });
  }
  return sections;
}

// ─── Fetcher / hooks ──────────────────────────────────

async function fetchNewsData(): Promise<NewsData> {
  const res = await fetch(API_URL);
  if (!res.ok) return {};
  const json = (await res.json()) as { code: number; data: NewsData };
  if (json.code !== 200 || !json.data) return {};
  return json.data;
}

export const newsKeys = {
  all: ["news"] as const,
  list: ["news", "list"] as const,
};

export function useNewsData() {
  return useQuery<NewsData>({
    queryKey: newsKeys.list,
    queryFn: fetchNewsData,
    staleTime: 1000 * 60 * 5,
  });
}

/** Look up a single item by id from the cached list data. */
export function useNewsItem(id: number) {
  const { data, isLoading } = useNewsData();
  const item = data ? flattenItems(data).get(id) : undefined;
  return { item, data, isLoading };
}
