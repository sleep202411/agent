/**
 * Preview store — a session-scoped, in-memory stand-in for the `/api/admin/news`
 * backend that doesn't exist yet. Seeded from SAMPLE_NEWS so the full-page
 * create/edit flow persists across client navigations during a session (a full
 * page reload resets it).
 *
 * TODO(backend): replace these calls with envelope requests once the endpoints
 * land — `listNews` -> GET, `getNews` -> GET /:id, `upsertNews` -> POST/PATCH,
 * `deleteNews` -> DELETE /:id. The call sites already await them.
 */

import { SAMPLE_NEWS, SAMPLE_NEWS_TAGS, type NewsArticle, type NewsTag } from "./types";

let articles: NewsArticle[] = SAMPLE_NEWS.map((a) => ({ ...a }));
const tags: NewsTag[] = SAMPLE_NEWS_TAGS.map((t) => ({ ...t }));

export function listNews(): NewsArticle[] {
  return articles;
}

export function listNewsTags(): NewsTag[] {
  return tags;
}

export function getNews(id: string): NewsArticle | undefined {
  return articles.find((article) => article.id === id);
}

export function upsertNews(article: NewsArticle): void {
  const index = articles.findIndex((item) => item.id === article.id);
  if (index >= 0) {
    articles = articles.map((item) => (item.id === article.id ? article : item));
  } else {
    articles = [article, ...articles];
  }
}

export function deleteNews(id: string): void {
  articles = articles.filter((article) => article.id !== id);
}

export function newNewsId(): string {
  return `n_${Date.now().toString(36)}`;
}
