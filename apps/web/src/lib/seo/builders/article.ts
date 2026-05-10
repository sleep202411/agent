import "server-only";

import type { Article, WithContext } from "schema-dts";

import { absoluteUrl, entityId } from "../canonical";
import { ORGANIZATION_ID } from "./organization";

export interface ArticleInput {
  /** Page URL (path or absolute). Will be resolved against the canonical host. */
  url: string;
  /** BCP-47 language tag — e.g. "en-US", "zh-CN". */
  inLanguage: string;
  /** Article headline. Limit ~110 chars (Google truncates beyond). */
  headline: string;
  /** 1–2 sentence summary. Plain text, no HTML. */
  description: string;
  /** Hero image URL — absolute or path; relative is fine. */
  image: string;
  /** ISO 8601 timestamps (e.g. `2026-05-10T18:00:00+08:00`). */
  datePublished: string;
  dateModified?: string;
  /** One or more authors. `Person` for real people, otherwise omit
   *  and the publisher (Organization) is implied. */
  authors?: { name: string; url?: string }[];
  /** Optional content keywords / tags. */
  keywords?: string[];
}

/**
 * schema.org Article for editorial content (News, Blog, IP write-ups).
 *
 * Why publisher references Organization @id rather than inlining:
 *   The root layout already emits a full Organization. Re-inlining
 *   would create a "second" Organization in crawler eyes. Cross-doc
 *   referencing via @id keeps the graph clean.
 *
 * Why we set `mainEntityOfPage` to the same URL:
 *   Tells crawlers "this Article object IS the canonical entity
 *   represented by the page" — avoids ambiguity when a page mixes
 *   multiple schema types (Article + BreadcrumbList + Person).
 */
export function buildArticle(input: ArticleInput): WithContext<Article> {
  const articleUrl = absoluteUrl(input.url);
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    "@id": entityId(input.url, "article"),
    url: articleUrl,
    mainEntityOfPage: { "@type": "WebPage", "@id": articleUrl },
    headline: input.headline,
    description: input.description,
    image: absoluteUrl(input.image),
    datePublished: input.datePublished,
    dateModified: input.dateModified ?? input.datePublished,
    inLanguage: input.inLanguage,
    publisher: { "@id": ORGANIZATION_ID },
    author: input.authors?.map((a) => ({
      "@type": "Person",
      name: a.name,
      ...(a.url ? { url: absoluteUrl(a.url) } : {}),
    })) ??
      // Fall back to the brand as author when no individual byline.
      [{ "@id": ORGANIZATION_ID }],
    ...(input.keywords && input.keywords.length > 0 ? { keywords: input.keywords.join(", ") } : {}),
  };
}
