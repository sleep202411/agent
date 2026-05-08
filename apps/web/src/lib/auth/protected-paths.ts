/**
 * Single source of truth for which paths require login.
 *
 * Both `proxy.ts` (server-side gate) and `<AuthGate>` /
 * `<AuthInterceptor>` (client-side fallbacks) consume this module.
 *
 * Model: **default-deny (whitelist).** Anything not in
 * `PUBLIC_PATTERNS` is treated as protected. New routes inherit
 * protection without ceremony — fail-closed beats fail-open for
 * auth, since a forgotten allow-list entry just shows a login
 * prompt while a forgotten protect-list entry leaks data.
 *
 * Conventions
 * ───────────
 * - Patterns run on the LOCALE-STRIPPED pathname (e.g. `/profile`,
 *   `/studio/projects`), not on `/en-US/profile`. Add the locale
 *   prefix back at redirect time.
 * - Use `(\/|$)` (not just `/?`) so `/profile-public` doesn't
 *   accidentally match `/^\/profile/`.
 */

const PUBLIC_PATTERNS: RegExp[] = [
  /^\/$/,
  // Auth flow itself — must be public to break the redirect loop.
  /^\/login(\/|$)/,
  /^\/register(\/|$)/,
  /^\/forgot-password(\/|$)/,
  /^\/reset-password(\/|$)/,
  // Marketing / discovery surfaces.
  /^\/about(\/|$)/,
  /^\/courses(\/|$)/,
  /^\/news(\/|$)/,
  /^\/invite(\/|$)/,
  /^\/ips(\/|$)/,
  // Legal pages.
  /^\/privacy-policy(\/|$)/,
  /^\/terms-of-service(\/|$)/,
  /^\/refund-policy(\/|$)/,
  // Legacy fizzdragon-web catch-all. The bundled uni-app handles its
  // own login redirects; treating /pages/* as public lets it through.
  /^\/pages(\/|$)/,
];

export function isProtectedPath(pathname: string): boolean {
  return !PUBLIC_PATTERNS.some((r) => r.test(pathname));
}

/**
 * Cookie name set by the Java backend on successful login (Sa-Token).
 * Confirmed via `src/lib/auth/api.ts` and the legacy fizzdragon-web's
 * `getCookieValue('satoken')` reads. Centralized here so middleware
 * and any other auth-aware code reference one constant.
 */
export const SESSION_COOKIE_NAME = "satoken";
