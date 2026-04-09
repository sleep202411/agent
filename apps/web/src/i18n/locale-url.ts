/**
 * URL rewrite utilities for TanStack Router i18n.
 *
 * Default locale (zh-CN) has no URL prefix: /projects
 * Other locales get prefixed: /en-US/projects, /zh-HK/projects
 * API paths are ignored entirely.
 */

import { defaultLocale, isValidLocale, detectBrowserLocale, type Locale } from "./config";

// Module-level locale state — safe because this is a client-side SPA.
// deLocalizeUrl sets it on every navigation, localizeUrl reads it.
let currentLocale: Locale = typeof window !== "undefined" ? detectBrowserLocale() : defaultLocale;

export function getCurrentLocale(): Locale {
  return currentLocale;
}

export function setCurrentLocale(locale: string): void {
  if (isValidLocale(locale)) {
    currentLocale = locale;
  }
}

/** Paths that bypass locale handling (API routes, backend proxies) */
const IGNORED_PATH = /^\/(?:api|aurora|anon|studio|user|project|vedio|content)\//;

/** Strip locale prefix: /en-US/projects → /projects */
export function deLocalizeUrl(url: URL): URL {
  if (IGNORED_PATH.test(url.pathname)) return url;

  const segments = url.pathname.split("/").filter(Boolean);
  const first = segments[0];

  if (first && isValidLocale(first)) {
    currentLocale = first as Locale;
    url.pathname = "/" + segments.slice(1).join("/") || "/";
  }

  return url;
}

/** Add locale prefix: /projects → /en-US/projects (default locale stays clean) */
export function localizeUrl(url: URL): URL {
  if (IGNORED_PATH.test(url.pathname)) return url;

  if (currentLocale === defaultLocale) return url;

  url.pathname = `/${currentLocale}${url.pathname === "/" ? "" : url.pathname}`;
  return url;
}
