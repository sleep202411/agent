/**
 * Locale helpers for Next.js.
 *
 * Default locale (en-US) has no URL prefix: /projects
 * Other locales get prefixed: /zh-CN/projects, /zh-HK/projects
 *
 * URL-level rewriting is handled by `proxy.ts` at the network layer.
 * This module exposes helpers for client-side code that needs to know the
 * current locale or build locale-aware hrefs.
 */

import { defaultLocale, isValidLocale, detectBrowserLocale, type Locale } from "./config";

// Module-level locale state — safe because it's read/written only on the client.
let currentLocale: Locale = typeof window !== "undefined" ? detectBrowserLocale() : defaultLocale;

export function getCurrentLocale(): Locale {
  return currentLocale;
}

export function setCurrentLocale(locale: string): void {
  if (isValidLocale(locale)) {
    currentLocale = locale;
  }
}

/** Paths that bypass locale handling (API routes, backend proxies, static files) */
const IGNORED_PATH = /^\/(?:api|aurora|anon|studio|user|project|vedio|newsapi|_next)\//;

/** Extract locale prefix from a pathname, or return `defaultLocale` if none. */
export function localeFromPathname(pathname: string): Locale {
  if (IGNORED_PATH.test(pathname)) return defaultLocale;
  const first = pathname.split("/").filter(Boolean)[0];
  if (first && isValidLocale(first)) return first;
  return defaultLocale;
}

/** Strip locale prefix: /en-US/projects → /projects */
export function stripLocalePrefix(pathname: string): string {
  if (IGNORED_PATH.test(pathname)) return pathname;
  const segments = pathname.split("/").filter(Boolean);
  const first = segments[0];
  if (first && isValidLocale(first)) {
    return "/" + segments.slice(1).join("/");
  }
  return pathname;
}

/** Add locale prefix: /projects → /en-US/projects (default locale stays clean) */
export function localizePath(pathname: string, locale: Locale = currentLocale): string {
  if (IGNORED_PATH.test(pathname)) return pathname;
  if (locale === defaultLocale) return pathname;
  if (pathname === "/") return `/${locale}`;
  return `/${locale}${pathname}`;
}
