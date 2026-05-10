import "server-only";

/**
 * Canonical brand URL — every JSON-LD object's `url` / `image` /
 * `@id` field resolves against this constant, NOT against the
 * current request host. Reason: the .com and .cn deployments serve
 * the same brand; pointing both at fizzdragon.com lets search
 * engines and AI engines de-duplicate them as one entity. The .cn
 * mirror is surfaced via Organization.sameAs so the link graph is
 * still discoverable.
 *
 * Bumping this requires a migration plan — every absolute URL
 * baked into structured data so far has to be re-emitted on
 * crawl, and the old @id becomes a stale alias.
 */
export const CANONICAL_HOST = "https://fizzdragon.com";

/**
 * Build an absolute URL against the canonical host. Idempotent on
 * already-absolute URLs so callers can pass through OSS / CDN URLs
 * without thinking about whether they got prefixed.
 */
export function absoluteUrl(pathOrUrl: string): string {
  if (!pathOrUrl) return CANONICAL_HOST;
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
    return pathOrUrl;
  }
  const path = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  return `${CANONICAL_HOST}${path}`;
}

/**
 * Build a locale-prefixed canonical URL. Mirrors `localizePath` from
 * `src/i18n/locale-url.ts` but resolves against the canonical host
 * — use this in JSON-LD `url` fields so different-locale variants
 * of the same content get distinct canonical URLs.
 */
export function localeCanonicalUrl(path: string, locale: string): string {
  const normalised = path.startsWith("/") ? path : `/${path}`;
  return `${CANONICAL_HOST}/${locale}${normalised}`;
}

/**
 * Stable @id factory. schema.org @id fields work as cross-document
 * references — two pages emitting `{ "@id": "https://.../#org" }`
 * are guaranteed to talk about the same entity.
 *
 * Format: `{canonical-host}/{path}#{fragment}`. The fragment scopes
 * the entity inside the URL so one URL can carry multiple entities
 * (e.g. an article URL hosting both Article and BreadcrumbList).
 */
export function entityId(path: string, fragment: string): string {
  return `${absoluteUrl(path)}#${fragment}`;
}

/**
 * Common fragments used across builders.
 */
export const FRAGMENTS = {
  organization: "org",
  website: "website",
  webpage: "webpage",
  breadcrumb: "breadcrumb",
  article: "article",
  creativeWork: "work",
  course: "course",
  person: "person",
  video: "video",
  faq: "faq",
} as const;
