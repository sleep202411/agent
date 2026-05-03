/**
 * Locale rewrite proxy (Next.js 16).
 *
 * URL convention:
 * - All locales use a URL prefix: /en-US/crews, /zh-CN/crews, /zh-HK/crews
 * - Hitting an unprefixed path (/crews, /ips/123, /) 308-redirects to
 *   the default-locale prefix (/en-US/crews, /en-US/ips/123, /en-US).
 *
 * Proxy action:
 * - /zh-CN/crews → rewrite internally to /crews so Next routes to
 *   app/(site)/crews/page.tsx; URL in browser stays /zh-CN/crews.
 * - /en-US/crews → same: rewrite internally to /crews.
 * - /crews (no prefix) → 308 to /en-US/crews. Then the request above
 *   handles it.
 * - Paths that hit backend proxies (rewritten in next.config) are
 *   filtered out via the matcher.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isProtectedPath, SESSION_COOKIE_NAME } from "@/src/lib/auth/protected-paths";

const LOCALES = ["en-US", "zh-HK", "zh-CN"] as const;
const DEFAULT_LOCALE = "en-US";

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

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

  // No prefix → 308 redirect to /<DEFAULT_LOCALE><pathname>.
  if (matchedLocale === null) {
    const url = request.nextUrl.clone();
    url.pathname = `/${DEFAULT_LOCALE}${pathname === "/" ? "" : pathname}`;
    return NextResponse.redirect(url, 308);
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
  const headers = new Headers(request.headers);
  headers.set("x-locale", matchedLocale);

  const url = request.nextUrl.clone();
  url.pathname = rewrittenPathname;
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
