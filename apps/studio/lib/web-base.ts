import type { SiteRegion } from "@/app/_components/region-provider";

/**
 * Base URL of the legacy web app (apps/web — fizzdragon.com / fizzspace.cn) that
 * studio links out to for legacy projects, public profiles, and legal pages.
 *
 * Keyed on the deployment CELL (SiteRegion from RegionProvider), NOT the host or
 * the UI language — the same env-driven signal (SITE_REGION) the rest of the app
 * uses to decide .cn vs global. Callers read it via `useSiteRegion()`.
 */
const WEB_BASE_BY_REGION: Record<SiteRegion, string> = {
  cn: "https://fizzdragon.fizzspace.cn",
  global: "https://fizzdragon.com",
};

export function getWebBaseUrl(siteRegion: SiteRegion): string {
  return WEB_BASE_BY_REGION[siteRegion];
}

/**
 * Legacy web-app paths studio links out to.
 *
 * `register` and `forgot-password` are gone as LINKS, not as features: the
 * shared sign-in dialog (`@repo/auth-flow`) registers in place on the code
 * path and runs the whole password reset itself, from its password step —
 * studio speaks the same `/user/(email/)reset/password` endpoints through
 * its own `/user/*` rewrite, so sending a user to another domain for either
 * one would be a round trip that buys nothing. Only the legal pages, which
 * genuinely live in the web app, are still linked out.
 */
export const WEB_PATHS = {
  terms: "/terms-of-service",
  privacy: "/privacy-policy",
} as const;

/**
 * Build an absolute link into the legacy web app: domain from {@link getWebBaseUrl}
 * (the cell), `locale` kept in the PATH for the web app's i18n routing.
 */
export function buildWebHref(
  siteRegion: SiteRegion,
  locale: string,
  path: (typeof WEB_PATHS)[keyof typeof WEB_PATHS]
): string {
  const safeLocale =
    locale === "zh-CN" || locale === "zh-HK" || locale === "en-US" ? locale : "en-US";
  return `${getWebBaseUrl(siteRegion)}/${safeLocale}${path}`;
}
