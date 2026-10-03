/**
 * Shared news types — used by both the server-side `_data/news.ts`
 * data layer and the client card / detail components.
 *
 * `_data/news.ts#getNewsList` normalizes the upstream Java backend feed
 * and our hardcoded static articles into this single rendered shape,
 * which the news pages consume directly.
 */

export interface NewsItem {
  id: number;
  type: string;
  title: string;
  /** Short summary / lede paragraph. */
  info: string;
  /**
   * Fully-resolved cover image URL. Live items get the banner host
   * prepended server-side; static articles already carry a full URL.
   * Always safe to drop into `<img src>`.
   */
  cover: string;
  createTime: string;
  /**
   * `true` for live newsapi items that link to an external blog post —
   * clicking should `_blank` to `url`. `false` for our static articles —
   * clicking should route to `/news/[id]`.
   */
  isExternal: boolean;
  /** External URL — only meaningful when `isExternal === true`. */
  url?: string;
  /** Markdown body — only set on internal/static articles. */
  body?: string;
  /** Stable slug, only used by static articles. */
  slug?: string;
  author?: string;
  /**
   * Backend-managed tags from `/api/news`. Ids are "dirty" (mixed case /
   * prefixes); the frontend prepends its own "All" pill and switching a real
   * tag refetches `/api/news?tag=<id>` — the id never appears in a URL.
   */
  tags?: { id: string; label: string }[];
}

export const NEWS_PAGE_SIZE = 20;
export interface NewsFeedPage {
  items: NewsItem[];
  hasMore: boolean;
}
