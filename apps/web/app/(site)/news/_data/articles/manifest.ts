/**
 * Manifest for hardcoded news articles.
 *
 * Per-article metadata + a `dir` pointing at this folder's matching
 * subdirectory which holds one markdown file per locale:
 *
 *   articles/<dir>/en-US.md
 *   articles/<dir>/zh-CN.md  (optional; falls back to en-US)
 *   articles/<dir>/zh-HK.md  (optional; falls back to zh-CN, then en-US)
 *
 * Each markdown file has YAML-ish frontmatter:
 *
 *   ---
 *   title: ...
 *   summary: ...
 *   ---
 *
 *   # body markdown
 */

export interface ArticleMeta {
  /** Stable id; `1_000_000+` so they never collide with backend ids. */
  id: number;
  /** Folder name under `articles/` and used in URLs by humans. */
  slug: string;
  /** Folder under `articles/` (same as slug, but explicit so renames are local). */
  dir: string;
  cover: string;
  /** Fixed publish timestamp (ISO). Partner-stated dates — see 2026-05 Italy
   *  batch: posts dated 4–8 May, two per day. */
  publishedAt: string;
  author: string;
  /** Category slug — see _data/categories.ts. */
  category: string;
}

export const ARTICLE_MANIFEST: ArticleMeta[] = [
  {
    id: 1_000_001,
    slug: "ai-meets-cinema-italy",
    dir: "1-ai-meets-cinema-italy",
    cover: "https://static.fizzspace.cn/static/pc/article-1.jpg",
    publishedAt: "2026-05-08T14:00:00Z",
    author: "FizzDragon",
    category: "italy",
  },
  {
    id: 1_000_002,
    slug: "venice-film-festival-2025",
    dir: "2-venice-film-festival-2025",
    cover: "https://static.fizzspace.cn/static/pc/article-2.jpg",
    publishedAt: "2026-05-08T09:00:00Z",
    author: "FizzDragon",
    category: "italy",
  },
  {
    id: 1_000_003,
    slug: "cinecitta-to-cyberspace",
    dir: "3-cinecitta-to-cyberspace",
    cover: "https://static.fizzspace.cn/static/pc/article-3.jpg",
    publishedAt: "2026-05-07T14:00:00Z",
    author: "FizzDragon",
    category: "italy",
  },
  {
    id: 1_000_004,
    slug: "ai-help-italian-distributors",
    dir: "4-ai-help-italian-distributors",
    cover: "https://static.fizzspace.cn/static/pc/article-4.jpg",
    publishedAt: "2026-05-07T09:00:00Z",
    author: "FizzDragon",
    category: "italy",
  },
  {
    id: 1_000_005,
    slug: "rise-of-ai-actors",
    dir: "5-rise-of-ai-actors",
    cover: "https://static.fizzspace.cn/static/pc/article-5.jpg",
    publishedAt: "2026-05-06T14:00:00Z",
    author: "FizzDragon",
    category: "italy",
  },
  {
    id: 1_000_006,
    slug: "fizzdragon-bringing-aigc-italy",
    dir: "6-fizzdragon-bringing-aigc-italy",
    cover: "https://static.fizzspace.cn/static/pc/article-6.jpg",
    publishedAt: "2026-05-06T09:00:00Z",
    author: "FizzDragon",
    category: "italy",
  },
  {
    id: 1_000_007,
    slug: "education-italian-ai-creators",
    dir: "7-education-italian-ai-creators",
    cover: "https://static.fizzspace.cn/static/pc/article-7.jpg",
    publishedAt: "2026-05-05T14:00:00Z",
    author: "FizzDragon",
    category: "italy",
  },
  {
    id: 1_000_008,
    slug: "aigc-italian-heritage",
    dir: "8-aigc-italian-heritage",
    cover: "https://static.fizzspace.cn/static/pc/article-8.jpg",
    publishedAt: "2026-05-05T09:00:00Z",
    author: "FizzDragon",
    category: "italy",
  },
  {
    id: 1_000_009,
    slug: "economics-of-aigc",
    dir: "9-economics-of-aigc",
    cover: "https://static.fizzspace.cn/static/pc/article-9.jpg",
    publishedAt: "2026-05-04T14:00:00Z",
    author: "FizzDragon",
    category: "italy",
  },
  {
    id: 1_000_010,
    slug: "future-netflix-of-ai",
    dir: "10-future-netflix-of-ai",
    cover: "https://static.fizzspace.cn/static/pc/article-10.jpg",
    publishedAt: "2026-05-04T09:00:00Z",
    author: "FizzDragon",
    category: "italy",
  },
];
