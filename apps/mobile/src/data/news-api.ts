/**
 * News API — Java backend (NOT Nest). The web's news data layer fetches the
 * same upstream: `GET /content/project/list/newsad`. `/project/*` routes to the
 * `content` (Java) proxy in the mobile api-client.
 *
 * `data` is keyed by layout-placement sections (banner-Big, footer, …); the
 * same article appears across sections with different ids, so we dedupe by URL.
 * Items are EXTERNAL article links (open in a browser) — there is no internal
 * article body, so there is no News detail screen.
 */
import { appEnv, resolveAssetUrl } from "@/config";
import { api } from "@/lib/api-client";

import type { NewsArticle } from "./types";

type NewsItemDto = {
  id?: number | string;
  type?: string;
  title?: string;
  info?: string;
  url?: string;
  picLink?: string;
  createTime?: string;
};

function sourceFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "FizzDragon";
  }
}

function coverUrl(picLink?: string): string | undefined {
  return picLink ? resolveAssetUrl(picLink, appEnv.assets.bannerBaseUrl) : undefined;
}

function mapArticle(raw: NewsItemDto, url: string): NewsArticle {
  return {
    id: String(raw.id ?? url),
    title: (raw.title ?? "").trim(),
    excerpt: (raw.info ?? "").trim(),
    coverUrl: coverUrl(raw.picLink ?? undefined),
    source: sourceFromUrl(url),
    publishedLabel: (raw.createTime ?? "").slice(0, 10),
    url,
    category: raw.type ?? undefined,
  };
}

export async function fetchNewsFeed(): Promise<NewsArticle[]> {
  const data = await api.get<Record<string, NewsItemDto[]>>("/project/list/newsad", {
    service: "content",
  });

  const seen = new Set<string>();
  const out: NewsArticle[] = [];
  if (data && typeof data === "object") {
    for (const section of Object.values(data)) {
      if (!Array.isArray(section)) continue;
      for (const raw of section) {
        if (!raw || typeof raw !== "object") continue;
        const url = (raw.url ?? "").trim();
        const title = (raw.title ?? "").trim();
        if (!url || !title || seen.has(url)) continue;
        seen.add(url);
        out.push(mapArticle(raw, url));
      }
    }
  }

  // Newest first (publishedLabel is an ISO date prefix, lexically sortable).
  return out.sort((a, b) => b.publishedLabel.localeCompare(a.publishedLabel));
}
