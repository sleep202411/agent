/**
 * Locale rewrite proxy (Next.js 16).
 *
 * URL convention:
 * - zh-CN (default): no prefix — /crews, /ip/123
 * - en-US, zh-HK:    prefix — /en-US/crews, /zh-HK/ip/123
 *
 * Proxy action:
 * - Request for /en-US/crews → internally rewrite to /crews (so Next.js routes to app/crews/page.tsx),
 *   attach x-locale header, keep URL visible in browser
 * - Request for /crews (no prefix) → locale = default zh-CN, no rewrite, attach x-locale header
 * - Paths that hit backend proxies (rewritten in next.config) are matched out via matcher
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const LOCALES = ["en-US", "zh-HK"] as const; // non-default locales that carry URL prefix
const DEFAULT_LOCALE = "zh-CN";

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Extract locale prefix
  let locale: string = DEFAULT_LOCALE;
  let rewrittenPathname = pathname;

  for (const candidate of LOCALES) {
    if (pathname === `/${candidate}` || pathname.startsWith(`/${candidate}/`)) {
      locale = candidate;
      rewrittenPathname = pathname.slice(candidate.length + 1) || "/";
      break;
    }
  }

  // Build request headers with resolved locale for downstream server components
  const headers = new Headers(request.headers);
  headers.set("x-locale", locale);

  // If URL carried a locale prefix → rewrite internally (URL stays the same in browser)
  if (rewrittenPathname !== pathname) {
    const url = request.nextUrl.clone();
    url.pathname = rewrittenPathname;
    url.search = search;
    return NextResponse.rewrite(url, { request: { headers } });
  }

  // No prefix — just pass through with locale header attached
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: [
    // Skip Next internals, static assets, and API proxy paths
    "/((?!_next|api|aurora|user|project|anon|vedio|newsapi|.*\\..*).*)",
  ],
};
