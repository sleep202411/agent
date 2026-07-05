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
  cn: "https://fizzstudio.fizzspace.cn",
  global: "https://fizzdragon.com",
};

export function getWebBaseUrl(siteRegion: SiteRegion): string {
  return WEB_BASE_BY_REGION[siteRegion];
}

/** Legacy web-app paths studio links out to (auth + legal pages). */
export const WEB_PATHS = {
  register: "/register",
  forgotPassword: "/forgot-password",
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
