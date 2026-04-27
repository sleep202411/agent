/**
 * News list endpoint.
 *
 * Server-side responsibilities:
 * 1. Fetch the upstream Java content feed and flatten its section-keyed
 *    shape into one deduped array.
 * 2. Normalize each item into the client-facing `NewsItem` shape:
 *      - `cover` is always a fully-resolved URL (banner host prepended)
 *      - `isExternal: true` for live newsapi items (they link out to a blog)
 *      - `isExternal: false` for our static articles (route to /news/[id])
 * 3. Prepend hardcoded `STATIC_ARTICLES`, sort newest-first.
 *
 * The client (and any future mobile / third-party consumer) receives one
 * normalized list and never has to know about hosts, paths, or sources.
 */

import { NextResponse, type NextRequest } from "next/server";
import { getStaticArticles } from "@/app/(site)/news/_data/static-articles";
import type { NewsItem } from "@/app/(site)/news/_data/types";

// Markdown files are loaded via node:fs in static-articles.ts.
export const runtime = "nodejs";

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

interface UpstreamResponse {
  code: number;
  data: Record<string, UpstreamItem[] | undefined>;
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
  // Defensive: upstream sometimes returns malformed shapes (string error
  // bodies, sections that aren't arrays, items missing fields). We never
  // want to throw — worst case is "no live articles".
  if (!data || typeof data !== "object") return [];

  const seen = new Set<number>();
  const out: NewsItem[] = [];
  try {
    for (const arr of Object.values(data as Record<string, unknown>)) {
      if (!Array.isArray(arr)) continue;
      for (const raw of arr) {
        if (!raw || typeof raw !== "object") continue;
        const item = raw as UpstreamItem;
        if (typeof item.id !== "number") continue;
        // Drop garbage rows: live newsapi items only make sense if they
        // carry an external link. Title/cover-only entries are filler.
        if (!item.url || item.url.trim() === "") continue;
        if (!item.title || item.title.trim() === "") continue;
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        out.push(normalizeUpstream(item));
      }
    }
  } catch (err) {
    console.warn("[/api/news] flatten failed, returning partial result:", err);
  }
  return out;
}

export async function GET(request: NextRequest) {
  // Locale via `?lang=` (preferred — comes from useLocale() on the client).
  // Fall back to the browser's accept-language, then en-US.
  const langParam = request.nextUrl.searchParams.get("lang");
  const acceptHeader = (request.headers.get("accept-language") ?? "").split(",")[0].trim();
  const lang = SUPPORTED_LANGS.has(langParam ?? "")
    ? langParam!
    : SUPPORTED_LANGS.has(acceptHeader)
      ? acceptHeader
      : "en-US";

  // Upstream is flaky — wrap everything (network, parse, shape) so a 500
  // / malformed body / non-JSON response can never bubble up. Worst case
  // we just serve the static articles (or an empty list on .cn).
  let live: NewsItem[] = [];
  try {
    const res = await fetch(UPSTREAM, {
      headers: { "accept-language": lang },
      next: { revalidate: 300 },
    });
    if (!res.ok) {
      console.warn(`[/api/news] upstream non-OK: ${res.status} ${res.statusText}`);
    } else {
      let json: UpstreamResponse | null = null;
      try {
        json = (await res.json()) as UpstreamResponse;
      } catch (err) {
        console.warn("[/api/news] upstream JSON parse failed:", err);
      }
      if (json && json.code === 200 && json.data) {
        live = flatten(json.data);
      } else if (json && json.code !== 200) {
        console.warn(`[/api/news] upstream code != 200:`, json.code);
      }
    }
  } catch (err) {
    console.warn("[/api/news] upstream fetch failed, falling back to static-only:", err);
  }

  // Hardcoded marketing articles only run on staging + production .com
  // (NEXT_PUBLIC_SITE_REGION === "global"). Production .cn (region "cn")
  // shows live newsapi feed only.
  const region = process.env.NEXT_PUBLIC_SITE_REGION ?? "global";
  const staticArticles = region === "cn" ? [] : getStaticArticles(lang);
  const merged = [...staticArticles, ...live].sort(
    (a, b) => new Date(b.createTime).getTime() - new Date(a.createTime).getTime()
  );

  return NextResponse.json({ articles: merged });
}
