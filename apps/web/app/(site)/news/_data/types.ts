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
  /** Category slug for static articles (see _data/categories.ts). Live items: undefined. */
  category?: string;
  /**
   * Backend-managed tags for the main-feed tag filter bar. Live items carry
   * these from Java (`/api/news`); static articles have none (undefined). Ids
   * are "dirty" (mixed case / prefixes) and are used only for client-side
   * filtering against the backend tag list — never in a URL.
   */
  tags?: { id: string; label: string }[];
}
