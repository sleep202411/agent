/**
 * News list — server-side data layer.
 *
 * Owns upstream fetch and normalization of published articles. The /news pages are async
 * server components and call this directly — there is no client-side
 * fetch, no public HTTP endpoint, and nothing for nginx to intercept.
 */

import "server-only";
import { env } from "@/src/env";
import { NEWS_PAGE_SIZE, type NewsItem, type NewsFeedPage } from "./types";

const SUPPORTED_LANGS = new Set(["en-US", "zh-CN", "zh-HK"]);

/**
 * Server-only required env. Which region's Java backend we read news from is
 * critical config: a silent default would let a misconfigured cell (e.g. .cn)
 * quietly read .com's data instead of failing. Fail loud — never default.
 */
function requireServerEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (value) return value;
  throw new Error(`Missing required environment variable: ${name}`);
}

const CONTENT_BASE = requireServerEnv("JAVA_CONTENT_URL").replace(/\/+$/, "");
// Public C-end endpoint (docs/news-module-backend-spec.md §5): anonymous,
// published-only, ordered by publishedAt desc, fields fall back to zh-CN via the
// `locale` param. Serves the admin-managed news table — replaces the legacy
// `/project/list/newsad` so admin edits actually surface on the site.
const UPSTREAM_BASE = `${CONTENT_BASE}/api/news`;
const BANNER_HOST = env.BANNER_BASE_URL.replace(/\/+$/, "");

// The "All" pill is inserted client-side — the backend has NO all-tag. This
// sentinel id means "no server-side tag filter"; a real tag id filters via
// `?tag=`. Kept here so the fetch layer and the client agree on the value.
export const ALL_TAG_ID = "all";

interface UpstreamTag {
  id: string;
  label?: string;
}
interface UpstreamItem {
  id: number;
  kind?: string; // "external" | "article"
  title?: string;
  summary?: string;
  url?: string;
  coverUrl?: string;
  author?: string;
  publishedAt?: string;
  tags?: UpstreamTag[];
  // Only the DETAIL endpoint (`/api/news/:id`) carries the full article body;
  // the list endpoint omits it. This is why the detail page must fetch the
  // single item rather than reuse a list card (which only has `summary`).
  body?: string;
}

// Upstream is in flux: legacy shape uses `code: 200` for success; the
// new shape uses `success: true`. Error bodies look like
// `{ success: false, code: "UNKNOWN_ERROR", message, data: null }`.
// Accept both success envelopes; preserve failures for recovery.
interface UpstreamResponse {
  code?: number | string;
  success?: boolean;
  message?: string;
  data?: unknown;
}

function isUpstreamSuccess(json: UpstreamResponse | null): boolean {
  if (!json) return false;
  if (json.success === true) return true;
  if (json.code === 200) return true;
  return false;
}

// Normalize upstream tags into the rendered `{ id, label }` shape, dropping
// entries with an empty id or label (defensive — same spirit as the mobile
// `mapTags`). Live items carry tags from Java.
function mapTags(raw?: UpstreamTag[]): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  for (const tag of raw ?? []) {
    const id = (tag?.id ?? "").trim();
    const label = (tag?.label ?? "").trim();
    if (id && label) out.push({ id, label });
  }
  return out;
}

function normalizeUpstream(raw: UpstreamItem): NewsItem {
  const coverUrl = raw.coverUrl ?? "";
  const cover = coverUrl
    ? coverUrl.startsWith("http")
      ? coverUrl
      : `${BANNER_HOST}/${coverUrl.replace(/^\/+/, "")}`
    : "";
  const isExternal = raw.kind === "external";
  const body = raw.body?.trim();
  const tags = mapTags(raw.tags);
  return {
    id: raw.id,
    type: raw.kind ?? "news",
    title: raw.title ?? "",
    info: raw.summary ?? "",
    cover,
    createTime: raw.publishedAt ?? new Date().toISOString(),
    isExternal,
    // External items jump to `url`; internal articles route to /news/:id.
    url: isExternal ? raw.url || undefined : undefined,
    // Present only on the detail endpoint's payload; undefined for list cards.
    ...(body ? { body } : {}),
    // Backend-managed tags for the main-feed filter bar. Only set when at least
    // one valid tag survives.
    ...(tags.length ? { tags } : {}),
    author: raw.author,
  };
}

function parseList(data: unknown): NewsItem[] {
  // /api/news returns a single flat `data.list` (published-only, already
  // deduped + ordered by publishedAt). Defensive: tolerate malformed shapes —
  // Skip malformed entries without losing other valid articles.
  if (!data || typeof data !== "object") return [];
  const list = (data as { list?: unknown }).list;
  if (!Array.isArray(list)) return [];

  const seenIds = new Set<number>();
  const out: NewsItem[] = [];
  try {
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as UpstreamItem;
      if (typeof item.id !== "number") continue;
      if (!item.title || item.title.trim() === "") continue;
      if (seenIds.has(item.id)) continue;
      seenIds.add(item.id);
      out.push(normalizeUpstream(item));
    }
  } catch (err) {
    console.warn("[news] parseList failed, returning partial result:", err);
  }
  return out;
}

/** Preserve upstream failures so pages can distinguish unavailable content from an empty feed. */
async function readNews(path: string, allowMissing = false): Promise<unknown> {
  const res = await fetch(`${UPSTREAM_BASE}${path}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (allowMissing && res.status === 404) return null;
  const raw = await res.text();
  let json: (UpstreamResponse & { msg?: string }) | null = null;
  try {
    json = JSON.parse(raw);
  } catch {
    /* Report the upstream body below. */
  }
  if (!res.ok || !isUpstreamSuccess(json)) {
    const detail = json?.message || json?.msg || (!json ? raw.trim() : "");
    throw new Error(detail || `News request failed (${res.status})`);
  }
  return json!.data;
}

export async function getNewsPage(rawLang: string, tag?: string): Promise<NewsFeedPage> {
  const lang = SUPPORTED_LANGS.has(rawLang) ? rawLang : "en-US";
  const filterTag = tag && tag !== ALL_TAG_ID ? tag.trim() : "";
  const data = await readNews(
    `?locale=${encodeURIComponent(lang)}&page=1&pageSize=${NEWS_PAGE_SIZE}${
      filterTag ? `&tag=${encodeURIComponent(filterTag)}` : ""
    }`
  );
  if (!data || typeof data !== "object" || !Array.isArray((data as { list?: unknown }).list)) {
    throw new Error("News service returned an invalid article list.");
  }
  return {
    items: parseList(data).sort(
      (a, b) => new Date(b.createTime).getTime() - new Date(a.createTime).getTime()
    ),
    hasMore: (data as { list: unknown[] }).list.length >= NEWS_PAGE_SIZE,
  };
}
export async function getNewsList(rawLang: string, tag?: string): Promise<NewsItem[]> {
  return (await getNewsPage(rawLang, tag)).items;
}

export async function getNewsItem(id: number, rawLang: string): Promise<NewsItem | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const lang = SUPPORTED_LANGS.has(rawLang) ? rawLang : "en-US";
  const data = await readNews(`/${id}?locale=${encodeURIComponent(lang)}`, true);
  if (data == null) return null;
  const raw = data as UpstreamItem;
  if (
    typeof raw !== "object" ||
    raw.id !== id ||
    typeof raw.title !== "string" ||
    !raw.title.trim()
  ) {
    throw new Error("News service returned an invalid article.");
  }
  return normalizeUpstream(raw);
}

export async function getNewsTags(rawLang: string): Promise<{ id: string; label: string }[]> {
  const lang = SUPPORTED_LANGS.has(rawLang) ? rawLang : "en-US";
  const data = await readNews(`/tags?locale=${encodeURIComponent(lang)}&onlyWithNews=true`);
  if (!Array.isArray(data)) throw new Error("News service returned an invalid tag list.");
  return data.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const label = typeof raw.label === "string" ? raw.label.trim() : "";
    return id && label ? [{ id, label }] : [];
  });
}
