/**
 * Locale rewrite proxy (Next.js 16).
 *
 * URL convention:
 * - All locales use a URL prefix: /en-US/crews, /zh-CN/crews, /zh-HK/crews
 * - Hitting an unprefixed path (/crews, /ips/123, /) redirects to a
 *   locale-prefixed version. The chosen locale follows this precedence:
 *     1. `NEXT_LOCALE` cookie — set by the language switcher; this is
 *        the user's explicit choice and survives across sessions.
 *     2. `Accept-Language` request header — first supported language
 *        from the browser's preference list.
 *     3. `DEFAULT_LOCALE` (en-US).
 *   We use 307 (not 308) for these so the redirect target can change
 *   when the cookie is updated; 308 is permanent and intermediaries
 *   are allowed to cache it forever.
 *
 * Proxy action:
 * - /zh-CN/crews → rewrite internally to /crews so Next routes to
 *   app/(site)/crews/page.tsx; URL in browser stays /zh-CN/crews.
 * - /en-US/crews → same: rewrite internally to /crews.
 * - /crews (no prefix) → 307 to /<chosen>/crews. Then the request
 *   above handles it.
 * - Paths that hit backend proxies (rewritten in next.config) are
 *   filtered out via the matcher.
 *
 * Studio host routing:
 * - When the request host is in `STUDIO_HOSTS` (currently only
 *   `studio.fizzdragon.com`), the root path lands on /art-studio rather
 *   than the marketing homepage — the whole point of the dedicated
 *   subdomain. Other paths are served as-is for now (a user landing on
 *   studio.fizzdragon.com/ips/123 will see the marketing IP detail);
 *   tighten that later if/when studio fully extracts to its own app.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isProtectedPath, SESSION_COOKIE_NAME } from "@/src/lib/auth/protected-paths";

const LOCALES = ["en-US", "zh-HK", "zh-CN"] as const;
type SupportedLocale = (typeof LOCALES)[number];
const DEFAULT_LOCALE: SupportedLocale = "en-US";
const LOCALE_COOKIE_NAME = "NEXT_LOCALE";

function isSupportedLocale(value: string): value is SupportedLocale {
  return (LOCALES as readonly string[]).includes(value);
}

// Hosts that should land visitors on /art-studio when they hit the
// root path. Only the canonical `studio.fizzdragon.com` is in here on
// purpose — staging, CN, or the legacy `fizzstudio.*` aliases get
// added explicitly when their nginx is wired up, no wildcard.
const STUDIO_HOSTS = new Set<string>(["studio.fizzdragon.com"]);

function isStudioHost(request: NextRequest): boolean {
  const host = request.headers.get("host")?.toLowerCase().split(":")[0];
  return host != null && STUDIO_HOSTS.has(host);
}

/**
 * Pick the redirect target locale for an unprefixed request.
 *
 * Cookie wins because it's an explicit user action; Accept-Language
 * is a fallback for first-time visitors with no cookie. Falling
 * through to DEFAULT_LOCALE means the user gets *something* readable
 * even if both signals are missing or unsupported.
 */
function pickRedirectLocale(request: NextRequest): SupportedLocale {
  const cookieValue = request.cookies.get(LOCALE_COOKIE_NAME)?.value;
  if (cookieValue && isSupportedLocale(cookieValue)) return cookieValue;

  const accept = request.headers.get("accept-language");
  if (accept) {
    // Parse "zh-CN,zh;q=0.9,en;q=0.8" — sort entries by their q-weight
    // (default 1.0) and return the first one that maps to a supported
    // locale. We accept exact matches and a couple of regional aliases
    // (zh-TW → zh-HK, plain `zh` → zh-CN) so common browser settings
    // do the right thing without explicit user action.
    const ranked = accept
      .split(",")
      .map((entry) => {
        const [tag, ...params] = entry.trim().split(";");
        const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
        const weight = q ? Number.parseFloat(q.slice(2)) : 1;
        return { tag: tag.trim(), weight: Number.isFinite(weight) ? weight : 0 };
      })
      .filter((e) => e.tag.length > 0)
      .sort((a, b) => b.weight - a.weight);

    for (const { tag } of ranked) {
      if (isSupportedLocale(tag)) return tag;
      // Region aliases.
      if (tag === "zh-TW" || tag === "zh-Hant") return "zh-HK";
      if (tag === "zh" || tag.startsWith("zh-")) return "zh-CN";
      const base = tag.split("-")[0];
      if (base === "en") return "en-US";
    }
  }

  return DEFAULT_LOCALE;
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const studioHost = isStudioHost(request);

  // Try to extract a locale prefix.
  let matchedLocale: string | null = null;
  let rewrittenPathname = pathname;

  for (const candidate of LOCALES) {
    if (pathname === `/${candidate}` || pathname.startsWith(`/${candidate}/`)) {
      matchedLocale = candidate;
      rewrittenPathname = pathname.slice(candidate.length + 1) || "/";
      break;
    }
  }

  // No prefix → 307 redirect to /<picked-locale><pathname>. Cookie /
  // Accept-Language can change between requests, so the redirect must
  // not be cached as permanent. URL stays clean on studio host — the
  // /art-studio prefix is applied internally below via rewrite, not
  // surfaced in the address bar.
  if (matchedLocale === null) {
    const target = pickRedirectLocale(request);
    const url = request.nextUrl.clone();
    url.pathname = `/${target}${pathname === "/" ? "" : pathname}`;
    return NextResponse.redirect(url, 307);
  }

  // Auth gate: protected paths without a session cookie 307 to /login
  // with the original (locale-prefixed) path stashed in `?redirect=`.
  // Public paths fall through unchanged.
  if (isProtectedPath(rewrittenPathname) && !request.cookies.get(SESSION_COOKIE_NAME)) {
    const url = request.nextUrl.clone();
    url.pathname = `/${matchedLocale}/login`;
    url.search = "";
    url.searchParams.set("redirect", `${pathname}${search}`);
    return NextResponse.redirect(url, 307);
  }

  // Prefix present → rewrite to the unprefixed path internally and
  // attach x-locale header for server components.
  //
  // Studio-host rewrite: the WHOLE studio subdomain IS art-studio, so
  // transparently prepend `/art-studio` to the internal path. URL bar
  // stays clean (e.g. studio.fizzdragon.com/zh-CN/projects/<id>),
  // Next.js routes to app/(studio)/art-studio/projects/<id>/page.tsx.
  //
  // The check for an already-prefixed path keeps the verbose URL form
  // (e.g. ...zh-CN/art-studio/settings) working too — bookmarks and
  // back-references shouldn't double-prefix into /art-studio/art-studio/.
  //
  // Paths the art-studio tree doesn't define (e.g. /faq, /ips) 404 on
  // the studio host by design — those belong to the marketing domain.
  let internalPathname = rewrittenPathname;
  if (studioHost && !rewrittenPathname.startsWith("/art-studio")) {
    internalPathname = `/art-studio${rewrittenPathname === "/" ? "" : rewrittenPathname}`;
  }

  const headers = new Headers(request.headers);
  headers.set("x-locale", matchedLocale);

  const url = request.nextUrl.clone();
  url.pathname = internalPathname;
  url.search = search;
  return NextResponse.rewrite(url, { request: { headers } });
}

export const config = {
  matcher: [
    // Skip Next internals, static assets, and API proxy paths. We DO
    // run the locale proxy on legacy paths (`/pages/*` etc.) now that
    // legacy renders inside the platform's `(site)` layout via a
    // catch-all page — they need the locale prefix to land in that
    // layout. The iframe-internal URL `/__legacy/*` is excluded
    // because that path is rewritten directly to public/legacy.html
    // by next.config; locale wrapping there would corrupt the
    // pathname the legacy bundle reads.
    //
    // `content` / `studio` / `test1` / `test2` are the env-specific
    // path prefixes prepended by `applyApiPrefix()` (see api-client.ts)
    // when `NEXT_PUBLIC_API_CONTENT_PREFIX` / `NEXT_PUBLIC_API_STUDIO_PREFIX`
    // are set per environment. Excluding all four means the locale
    // proxy never wraps Java API calls regardless of which env the
    // bundle was built for.
    "/((?!_next|api|aurora|user|project|anon|vedio|newsapi|content|studio|test1|test2|__legacy|.*\\..*).*)",
  ],
};
