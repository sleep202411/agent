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
  /^\/certificates(\/|$)/,
  /^\/courses(\/|$)/,
  // Creator detail pages are public; the talent-market list remains
  // login-gated.
  /^\/creators\/[^/]+(\/|$)/,
  /^\/games(\/|$)/,
  /^\/news(\/|$)/,
  /^\/invite(\/|$)/,
  // A crew invite link is handed to someone who may not have an account yet.
  // The page itself prompts for sign-in before it will let anyone join.
  /^\/crew-invite\/[^/]+(\/|$)/,
  /^\/ips(\/|$)/,
  // Room-number detail links are public; keep nested management paths gated.
  /^\/ip\/[^/]+\/?$/,
  // TV consumes the same public IP catalog as the plaza.
  /^\/tv\/?$/,
  // Keep the frozen Jinling interactive-film showcase public. Published
  // StoryOS interactive films remain login-gated.
  /^\/play\/jinling-v2(\/|$)/,
  // Generic tag landing pages (e.g. competitions like SGWander) are public +
  // shareable; entries link to the public IP detail page.
  /^\/tags\/[^/]+(\/|$)/,
  // Deprecated public URL. Kept public only so the redirect to `/ips`
  // can run before auth gating.
  /^\/ip-commerce(\/|$)/,
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
