/**
 * News API — Java backend public news endpoints (`GET /api/news`,
 * `GET /api/news/tags` on the `content` service).
 *
 * Anonymous, published-only, ordered by publishedAt desc. Title / summary /
 * cover / tag labels resolve for the requested `locale` with zh-CN fallback.
 * The "All" chip is frontend-only — omit `tag` for the unfiltered feed (do not
 * send `tag_all`).
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

/** Default page size from the public news API (`pageSize` default 20). */
export const NEWS_PAGE_SIZE = 20;

export type NewsFeedPage = {
  articles: NewsArticle[];
  total: number;
  page: number;
  pageSize: number;
};

export type FetchNewsFeedOptions = {
  /** Real backend tag id. Omit / empty for All (no server-side tag filter). */
  tag?: string;
  page?: number;
  pageSize?: number;
};

function mapTags(raw?: NewsTagDto[]): NewsTag[] {
  const out: NewsTag[] = [];
  for (const tag of raw ?? []) {
    const id = (tag?.id ?? "").trim();
    const label = (tag?.label ?? "").trim();
    if (id && label) out.push({ id, label });
  }
  return out;
}

function normalizeFeed(list: NewsItemDto[] | undefined): NewsArticle[] {
  const seen = new Set<string>();
  const out: NewsArticle[] = [];
  for (const raw of list ?? []) {
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

/**
 * One page of the published feed.
 * `GET /api/news?locale=&page=&pageSize=&tag?`
 */
export async function fetchNewsFeed(
  locale: AppLocale,
  options: FetchNewsFeedOptions = {}
): Promise<NewsFeedPage> {
  const filterTag = options.tag?.trim() ?? "";
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.max(1, options.pageSize ?? NEWS_PAGE_SIZE);

  const data = await api.get<NewsListDto>("/api/news", {
    service: "content",
    params: {
      locale,
      page,
      pageSize,
      ...(filterTag ? { tag: filterTag } : {}),
    },
  });

  const articles = normalizeFeed(data?.list);
  const total =
    typeof data?.total === "number" && Number.isFinite(data.total)
      ? Math.max(0, data.total)
      : articles.length;

  return { articles, total, page, pageSize };
}

/**
 * Enabled tags for the filter rail (`onlyWithNews=true` drops empty tags).
 * Does not include All — the UI prepends that chip itself.
 */
export async function fetchNewsTags(locale: AppLocale): Promise<NewsTag[]> {
  const data = await api.get<NewsTagDto[]>("/api/news/tags", {
    service: "content",
    params: { locale, onlyWithNews: true },
  });

  return mapTags(data ?? []);
}
