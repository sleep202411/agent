/**
 * News list — server-side data layer.
 *
 * Owns upstream fetch, error tolerance, shape normalization, and the
 * merge with hardcoded static articles. The /news pages are async
 * server components and call this directly — there is no client-side
 * fetch, no public HTTP endpoint, and nothing for nginx to intercept.
 */

import "server-only";
import { env } from "@/src/env";
import { getStaticArticles } from "./static-articles";
import type { NewsItem } from "./types";

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
// Accept both successes; treat anything else as empty.
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

function normalizeUpstream(raw: UpstreamItem): NewsItem {
  const coverUrl = raw.coverUrl ?? "";
  const cover = coverUrl
    ? coverUrl.startsWith("http")
      ? coverUrl
      : `${BANNER_HOST}/${coverUrl.replace(/^\/+/, "")}`
    : "";
  const isExternal = raw.kind === "external";
  const body = raw.body?.trim();
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
    author: raw.author,
  };
}

function parseList(data: unknown): NewsItem[] {
  // /api/news returns a single flat `data.list` (published-only, already
  // deduped + ordered by publishedAt). Defensive: tolerate malformed shapes —
  // worst case is "no live articles", never a throw.
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

export async function getNewsList(rawLang: string): Promise<NewsItem[]> {
  const lang = SUPPORTED_LANGS.has(rawLang) ? rawLang : "en-US";

  // Upstream is flaky — wrap everything (network, parse, shape) so a
  // 500 / malformed body / non-JSON response can never bubble up.
  // Worst case we just serve the static articles (or an empty list on
  // production .cn).
  // Server-side locale fallback is done by the backend via the `locale` param.
  // pageSize=100 returns the full published set today (73); revisit with real
  // pagination if the catalogue ever outgrows that.
  const url = `${UPSTREAM_BASE}?locale=${encodeURIComponent(lang)}&pageSize=100`;
  let live: NewsItem[] = [];
  console.log(`[news] fetching upstream lang=${lang} url=${url}`);
  try {
    const res = await fetch(url, {
      next: { revalidate: 300 },
    });
    console.log(`[news] upstream status=${res.status} ${res.statusText}`);
    if (!res.ok) {
      console.warn(`[news] upstream non-OK: ${res.status} ${res.statusText}`);
    } else {
      let json: UpstreamResponse | null = null;
      try {
        json = (await res.json()) as UpstreamResponse;
        // Truncate to keep stdout readable when upstream returns dozens
        // of articles. First 2000 chars is enough to see envelope shape
        // + a couple of items.
        const preview = JSON.stringify(json).slice(0, 2000);
        console.log(`[news] upstream body (truncated 2000):`, preview);
      } catch (err) {
        console.warn("[news] upstream JSON parse failed:", err);
      }
      if (isUpstreamSuccess(json) && json!.data) {
        live = parseList(json!.data);
        console.log(`[news] parsed live items=${live.length}`);
      } else if (json) {
        console.warn(
          `[news] upstream not OK — success=${json.success} code=${json.code} message=${json.message}`
        );
      }
    }
  } catch (err) {
    console.warn("[news] upstream fetch failed, falling back to static-only:", err);
  }

  // Hardcoded marketing articles only run on staging + production .com
  // (NEXT_PUBLIC_SITE_REGION === "global"). Production .cn (region
  // "cn") shows the live newsapi feed only.
  const region = process.env.NEXT_PUBLIC_SITE_REGION ?? "global";
  const staticArticles = region === "cn" ? [] : getStaticArticles(lang);
  return [...staticArticles, ...live].sort(
    (a, b) => new Date(b.createTime).getTime() - new Date(a.createTime).getTime()
  );
}

/**
 * Fetch a single live article WITH its body from the detail endpoint
 * `GET /api/news/:id` — the list endpoint omits the body, so a detail page that
 * reuses a list card can only ever show the summary. Returns null when the id
 * is not a live article (unknown id, unpublished, or an upstream failure); the
 * caller falls back to the static-article set for our hardcoded posts.
 */
export async function getNewsItem(id: number, rawLang: string): Promise<NewsItem | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const lang = SUPPORTED_LANGS.has(rawLang) ? rawLang : "en-US";
  const url = `${UPSTREAM_BASE}/${id}?locale=${encodeURIComponent(lang)}`;
  try {
    const res = await fetch(url, { next: { revalidate: 300 } });
    if (!res.ok) {
      console.warn(`[news] detail upstream non-OK id=${id}: ${res.status}`);
      return null;
    }
    const json = (await res.json().catch(() => null)) as UpstreamResponse | null;
    if (!isUpstreamSuccess(json) || !json!.data) return null;
    // The detail payload is the item object directly under `data` (not a list).
    const raw = json!.data as UpstreamItem;
    if (!raw || typeof raw !== "object" || typeof raw.id !== "number") return null;
    if (!raw.title || raw.title.trim() === "") return null;
    return normalizeUpstream(raw);
  } catch (err) {
    console.warn(`[news] detail fetch failed id=${id}:`, err);
    return null;
  }
}
