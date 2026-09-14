import { webBaseUrl } from "@/config";

const LOCALE_PREFIX = /^(en-US|zh-CN|zh-HK)$/;

/**
 * apps/web path (no locale prefix) for the authenticated WebView.
 * Prefers the caller’s return URL when it is on this region’s origin.
 */
export function communityWebPath(returnUrl?: string): string {
  if (!returnUrl?.trim()) return "/";

  try {
    const parsed = new URL(returnUrl);
    const allowed = new URL(webBaseUrl);
    if (parsed.origin !== allowed.origin) return "/";

    const parts = parsed.pathname.split("/").filter(Boolean);
    const rest = LOCALE_PREFIX.test(parts[0] ?? "") ? parts.slice(1) : parts;
    const path = `/${rest.join("/")}`;
    return sanitizeAppWebPath(`${path === "/" ? "/" : path}${parsed.search}`);
  } catch {
    return "/";
  }
}

/** Route param from the paywall — only in-app relative paths. */
export function sanitizeAppWebPath(path?: string): string {
  if (!path?.startsWith("/") || path.startsWith("//") || path.includes("://")) {
    return "/";
  }
  return path;
}
