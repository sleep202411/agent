/**
 * Client-side news fetch for the tag filter.
 *
 * Runs in the browser and hits the same-origin `/content/*` proxy (→ Java
 * Content), so it works behind Azure Front Door. This deliberately replaces a
 * React Server Action: a Server Action POST + its Origin/Host check is rejected
 * through Front Door ("Invalid Server Actions request"), which crashed the page.
 * A plain GET to a stable URL has none of that fragility.
 *
 * Normalization mirrors the server `_data/news.ts` (feature-local duplication is
 * the project convention — see apps/web/AGENTS.md). Covers are usually absolute
 * already; a relative key gets the banner host prepended. NEXT_PUBLIC_* is
 * inlined at build time so it is available client-side.
 */

import { NEWS_PAGE_SIZE, type NewsItem, type NewsFeedPage } from "./types";

const BANNER_HOST = (process.env.NEXT_PUBLIC_BANNER_BASE_URL ?? "").replace(/\/+$/, "");

interface UpstreamTag {
  id: string;
  label?: string;
}
interface UpstreamItem {
  id: number;
  kind?: string;
  title?: string;
  summary?: string;
  url?: string;
  coverUrl?: string;
  author?: string;
  publishedAt?: string;
  tags?: UpstreamTag[];
}

function mapTags(raw?: UpstreamTag[]): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  for (const tag of raw ?? []) {
    const id = (tag?.id ?? "").trim();
    const label = (tag?.label ?? "").trim();
    if (id && label) out.push({ id, label });
  }
  return out;
}

function normalize(raw: UpstreamItem): NewsItem {
  const coverUrl = raw.coverUrl ?? "";
  const cover = coverUrl
    ? coverUrl.startsWith("http")
      ? coverUrl
      : `${BANNER_HOST}/${coverUrl.replace(/^\/+/, "")}`
    : "";
  const isExternal = raw.kind === "external";
  const tags = mapTags(raw.tags);
  return {
    id: raw.id,
    type: raw.kind ?? "news",
    title: raw.title ?? "",
    info: raw.summary ?? "",
    cover,
    createTime: raw.publishedAt ?? new Date().toISOString(),
    isExternal,
    url: isExternal ? raw.url || undefined : undefined,
    ...(tags.length ? { tags } : {}),
    author: raw.author,
  };
}

/**
 * Fetch the published feed filtered by a real backend tag id. Throws on any
 * non-OK / malformed response — the caller (news-list) wraps this in try/catch
 * so a failure degrades to a toast, never a page crash.
 */
export async function fetchNewsPage(
  locale: string,
  tag: string,
  page = 1,
  signal?: AbortSignal
): Promise<NewsFeedPage> {
  if (!Number.isSafeInteger(page) || page < 1) throw new Error("Invalid news page.");
  const params = new URLSearchParams({
    locale,
    page: String(page),
    pageSize: String(NEWS_PAGE_SIZE),
  });
  if (tag && tag !== "all") params.set("tag", tag);
  const res = await fetch(`/content/api/news?${params}`, { cache: "no-store", signal });
  const raw = await res.text();
  let json: {
    code?: number | string;
    success?: boolean;
    message?: string;
    msg?: string;
    data?: { list?: unknown };
  } | null = null;
  try {
    json = JSON.parse(raw);
  } catch {
    /* Preserve a plain-text upstream error. */
  }
  if (!res.ok || !json || (json.success !== true && json.code !== 200)) {
    throw new Error(
      json?.message || json?.msg || (!json && raw.trim()) || `News request failed (${res.status})`
    );
  }
  if (!Array.isArray(json.data?.list))
    throw new Error("News service returned an invalid article list.");
  const list = json.data.list;

  const seen = new Set<number>();
  const out: NewsItem[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as UpstreamItem;
    if (typeof item.id !== "number") continue;
    if (!item.title || item.title.trim() === "") continue;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(normalize(item));
  }
  return {
    items: out.sort((a, b) => new Date(b.createTime).getTime() - new Date(a.createTime).getTime()),
    hasMore: list.length >= NEWS_PAGE_SIZE,
  };
}
