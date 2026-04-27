/**
 * Pure formatters used by both server pages and client card components.
 * No I/O, no side effects, safe in any runtime.
 */

import type { NewsItem } from "./types";

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
