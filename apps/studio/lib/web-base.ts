/**
 * Base URL of the legacy web app (apps/web — fizzdragon.com / fizzspace.cn) that
 * studio links out to for legacy projects, public profiles, and legal pages.
 *
 * Derived from the studio's OWN host (`studio.X` -> `X`), NOT the UI language: a
 * zh-CN user on the .com deployment must stay on .com, never be bounced to .cn.
 * On the server (no window) or in local dev (host has no dot) it falls back to
 * fizzdragon.com; the .com studio's client-derived value is identical, so there
 * is no hydration drift there.
 */
export function getWebBaseUrl(): string {
  if (typeof window !== "undefined") {
    const h = window.location.hostname;
    // CN: the web app for studio.fizzspace.cn lives at fizzstudio.fizzspace.cn
    // (the live CN host), NOT the bare apex the generic `studio.`-strip yields.
    if (h === "studio.fizzspace.cn") return "https://fizzstudio.fizzspace.cn";
    const host = h.replace(/^studio\./, "");
    if (host.includes(".")) return `https://${host}`;
  }
  return "https://fizzdragon.com";
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
 * (the deployment), `locale` kept in the PATH for the web app's i18n routing.
 */
export function buildWebHref(
  locale: string,
  path: (typeof WEB_PATHS)[keyof typeof WEB_PATHS]
): string {
  const safeLocale =
    locale === "zh-CN" || locale === "zh-HK" || locale === "en-US" ? locale : "en-US";
  return `${getWebBaseUrl()}/${safeLocale}${path}`;
}
