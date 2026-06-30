/**
 * News module domain types (admin-ui).
 *
 * Mirrors the legacy 资讯 model but on the platform's BCP-47 locales
 * (zh-CN / en-US / zh-HK, matching IP taxonomy) instead of the old cn/hk/en
 * short codes. Field-level i18n: title / summary / body / cover / video are
 * per-locale; kind / url / author / status / publishedAt / tags are shared.
 *
 * Backed by the Java 资讯 API (`/api/admin/news`) via lib/admin-news.ts —
 * reads are server-loaded in the page components, writes go through the
 * app/api/admin/news/* route handlers. See docs/news-module-backend-spec.md.
 */

/** Content locales a published article should carry (zh-CN is primary). */
export const NEWS_LOCALES = [
  { code: "zh-CN", short: "简", label: "简体中文", primary: true },
  { code: "en-US", short: "EN", label: "English", primary: false },
  { code: "zh-HK", short: "繁", label: "繁體中文", primary: false },
] as const;

export type NewsLocaleCode = (typeof NEWS_LOCALES)[number]["code"];

export const NEWS_PRIMARY_LOCALE: NewsLocaleCode = "zh-CN";

/** Internal article (own detail page) vs external link (opens a third-party URL). */
export type NewsKind = "article" | "external";

/** Draft (hidden) · Published (live) · Offline (kept but hidden). */
export type NewsStatus = "draft" | "published" | "offline";

/** Per-locale editorial content. Body is only meaningful for internal articles. */
export interface NewsLocaleContent {
  title: string;
  summary: string;
  body: string;
  coverUrl: string;
  videoUrl: string;
  /** External link for this locale — only used when kind === "external". The Java
   *  backend stores it per-locale under localized.<locale>.url. */
  url: string;
}

export interface NewsTag {
  id: string;
  label: Record<NewsLocaleCode, string>;
}

export interface NewsArticle {
  /** Opaque to the UI. The Java backend assigns a numeric id, stringified here. */
  id: string;
  kind: NewsKind;
  /** External link — shared across locales; only used when kind === "external". */
  url: string;
  author: string;
  status: NewsStatus;
  tagIds: string[];
  /** ISO timestamp; required before an article can go to "published". */
  publishedAt: string | null;
  localized: Record<NewsLocaleCode, NewsLocaleContent>;
  createdAt: string;
  updatedAt: string;
}

export function emptyNewsLocaleContent(): NewsLocaleContent {
  return { title: "", summary: "", body: "", coverUrl: "", videoUrl: "", url: "" };
}

export function emptyLocalizedContent(): Record<NewsLocaleCode, NewsLocaleContent> {
  return {
    "zh-CN": emptyNewsLocaleContent(),
    "en-US": emptyNewsLocaleContent(),
    "zh-HK": emptyNewsLocaleContent(),
  };
}

/** Whether a locale carries enough content to count as "translated". */
export function isLocaleFilled(content: NewsLocaleContent, kind: NewsKind): boolean {
  if (!content.title.trim()) return false;
  if (kind === "article" && !content.body.trim()) return false;
  return true;
}

export function newsStatusLabel(status: NewsStatus): string {
  return status === "published" ? "已发布" : status === "offline" ? "已下线" : "草稿";
}

export function newsStatusTone(status: NewsStatus): "success" | "muted" | "warn" {
  return status === "published" ? "success" : status === "offline" ? "warn" : "muted";
}

export function newsKindLabel(kind: NewsKind): string {
  return kind === "external" ? "外部链接" : "内部文章";
}

/**
 * Java stores a cover as either a full URL (most data, e.g. static.fizzspace.cn)
 * or a path relative to the static host (per the upload contract). Resolve both
 * to an absolute URL for <img>.
 */
const NEWS_STATIC_BASE_URL = "https://static.fizzspace.cn";

export function resolveCoverUrl(raw: string): string {
  const url = raw.trim();
  if (!url) return "";
  if (/^(https?:)?\/\//.test(url) || url.startsWith("data:") || url.startsWith("blob:")) {
    return url;
  }
  return `${NEWS_STATIC_BASE_URL}/${url.replace(/^\/+/, "")}`;
}
