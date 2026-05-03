/**
 * News list — server-side data layer.
 *
 * Owns upstream fetch, error tolerance, shape normalization, and the
 * merge with hardcoded static articles. The /news pages are async
 * server components and call this directly — there is no client-side
 * fetch, no public HTTP endpoint, and nothing for nginx to intercept.
 */

import "server-only";
import { getStaticArticles } from "./static-articles";
import type { NewsItem } from "./types";

const SUPPORTED_LANGS = new Set(["en-US", "zh-CN", "zh-HK"]);

const CONTENT_BASE = (process.env.JAVA_CONTENT_URL ?? "https://fizzdragon.com/content").replace(
  /\/+$/,
  ""
);
const UPSTREAM = `${CONTENT_BASE}/project/list/newsad`;
const BANNER_HOST = (
  process.env.NEXT_PUBLIC_BANNER_BASE_URL ??
  "https://fizzdragon-banner-sg.oss-ap-southeast-1.aliyuncs.com"
).replace(/\/+$/, "");

interface UpstreamItem {
  id: number;
  type?: string;
  title?: string;
  info?: string;
  url?: string;
  picLink?: string;
  createTime?: string;
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
  const picLink = raw.picLink ?? "";
  const cover = picLink
    ? picLink.startsWith("http")
      ? picLink
      : `${BANNER_HOST}/${picLink.replace(/^\/+/, "")}`
    : "";
  return {
    id: raw.id,
    type: raw.type ?? "news",
    title: raw.title ?? "",
    info: raw.info ?? "",
    cover,
    createTime: raw.createTime ?? new Date().toISOString(),
    isExternal: true,
    url: raw.url || undefined,
  };
}

function flatten(data: unknown): NewsItem[] {
  // Defensive: upstream sometimes returns malformed shapes (string
  // error bodies, sections that aren't arrays, items missing fields).
  // We never want to throw — worst case is "no live articles".
  if (!data || typeof data !== "object") return [];

  // Dedupe by both id AND url. Upstream `newsad` slices the same
  // article into multiple category sections and tends to assign a
  // fresh id per section, so id-only dedup misses cross-section
  // duplicates. Article url is the stable identity here.
  const seenIds = new Set<number>();
  const seenUrls = new Set<string>();
  const out: NewsItem[] = [];
  try {
    for (const arr of Object.values(data as Record<string, unknown>)) {
      if (!Array.isArray(arr)) continue;
      for (const raw of arr) {
        if (!raw || typeof raw !== "object") continue;
        const item = raw as UpstreamItem;
        if (typeof item.id !== "number") continue;
        // Drop garbage rows: live newsapi items only make sense if
        // they carry an external link. Title/cover-only entries are
        // filler.
        if (!item.url || item.url.trim() === "") continue;
        if (!item.title || item.title.trim() === "") continue;
        const urlKey = item.url.trim();
        if (seenIds.has(item.id) || seenUrls.has(urlKey)) continue;
        seenIds.add(item.id);
        seenUrls.add(urlKey);
        out.push(normalizeUpstream(item));
      }
    }
  } catch (err) {
    console.warn("[news] flatten failed, returning partial result:", err);
  }
  return out;
}

export async function getNewsList(rawLang: string): Promise<NewsItem[]> {
  const lang = SUPPORTED_LANGS.has(rawLang) ? rawLang : "en-US";

  // Upstream is flaky — wrap everything (network, parse, shape) so a
  // 500 / malformed body / non-JSON response can never bubble up.
  // Worst case we just serve the static articles (or an empty list on
  // production .cn).
  let live: NewsItem[] = [];
  console.log(`[news] fetching upstream lang=${lang} url=${UPSTREAM}`);
  try {
    const res = await fetch(UPSTREAM, {
      headers: { "accept-language": lang },
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
        live = flatten(json!.data);
        console.log(`[news] flattened live items=${live.length}`);
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
