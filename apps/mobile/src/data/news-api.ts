/**
 * News API — Java backend public news endpoint (`GET /api/news` on the
 * `content` service), the same admin-managed store the web /news page reads
 * (docs/news-module-backend-spec.md §5). Replaces the legacy layout-placement
 * feed `/project/list/newsad`.
 *
 * The list is published-only, ordered by publishedAt desc; title/summary/cover
 * and tag labels are resolved server-side for the requested `locale` with
 * zh-CN fallback. There is NO public tag-list endpoint (tags are admin-only,
 * `/api/admin/news/tags`) — tag rails must derive from the tags present on
 * the fetched items.
 */
import { appEnv, resolveAssetUrl, type AppLocale } from "@/config";
import { api } from "@/lib/api-client";

import type { NewsArticle, NewsTag } from "./types";

type NewsTagDto = {
  id?: string;
  label?: string;
};

type NewsItemDto = {
  id?: number | string;
  kind?: string;
  url?: string;
  author?: string;
  publishedAt?: string;
  tags?: NewsTagDto[];
  title?: string;
  summary?: string;
  coverUrl?: string;
};

type NewsListDto = {
  total?: number;
  list?: NewsItemDto[];
};

// Returns the full published set today (~72 items); revisit with real
// pagination if the catalogue ever outgrows this (same note as the web).
const FEED_PAGE_SIZE = 100;

function mapTags(raw?: NewsTagDto[]): NewsTag[] {
  const out: NewsTag[] = [];
  for (const tag of raw ?? []) {
    const id = (tag?.id ?? "").trim();
    const label = (tag?.label ?? "").trim();
    if (id && label) out.push({ id, label });
  }
  return out;
}

export async function fetchNewsFeed(locale: AppLocale): Promise<NewsArticle[]> {
  const data = await api.get<NewsListDto>("/api/news", {
    service: "content",
    params: { locale, pageSize: FEED_PAGE_SIZE },
  });

  const seen = new Set<string>();
  const out: NewsArticle[] = [];
  for (const raw of data?.list ?? []) {
    if (!raw || typeof raw !== "object") continue;
    const id = raw.id === undefined || raw.id === null ? "" : String(raw.id);
    const title = (raw.title ?? "").trim();
    const url = (raw.url ?? "").trim() || undefined;
    const kind = raw.kind === "article" ? "article" : "external";
    if (!id || !title || seen.has(id)) continue;
    // An external item is a bare link — without a URL there is nothing to open.
    if (kind === "external" && !url) continue;
    seen.add(id);

    out.push({
      id,
      kind,
      title,
      excerpt: (raw.summary ?? "").trim(),
      coverUrl: raw.coverUrl
        ? resolveAssetUrl(raw.coverUrl, appEnv.assets.bannerBaseUrl)
        : undefined,
      publishedLabel: (raw.publishedAt ?? "").slice(0, 10),
      url: kind === "external" ? url : undefined,
      tags: mapTags(raw.tags),
    });
  }

  // Upstream already orders by publishedAt desc — keep server order.
  return out;
}
