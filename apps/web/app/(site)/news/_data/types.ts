/**
 * Shared news types — kept in a non-"use client" module so the
 * Next.js API route can import them on the server.
 *
 * The shape here is the **client-facing** shape returned by /api/news.
 * The route normalizes both the upstream Java backend feed and our
 * hardcoded static articles into this single form.
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
}
