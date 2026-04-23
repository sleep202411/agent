"use client";

import type { AuthAction, AuthSuccessMessage } from "@/src/lib/auth/iframe-bridge";
import {
  ALLOWED_PARENT_ORIGINS,
  isEmbeddedMode,
  postAuthSuccess,
} from "@/src/lib/auth/iframe-bridge";
import type { AuthResult } from "@/src/lib/auth/api";
import { localeFromPathname, localizePath } from "@/src/i18n/locale-url";

/**
 * Decide what happens after a successful auth action.
 *
 * - Embedded (iframe host = fizzdragon-web): postMessage the token to
 *   the parent and stop. The host owns the "close iframe / redirect"
 *   decision.
 * - Standalone: navigate to the `redirect` query param if present +
 *   safe, otherwise fall back to the studio shell.
 */
export function handleAuthSuccess(action: AuthAction, result: AuthResult): void {
  if (typeof window === "undefined") return;

  if (isEmbeddedMode()) {
    postAuthSuccess(action, result);
    return;
  }

  // Derive locale from current URL (not browser pref) so that a user who
  // landed on /en-US/login stays in en-US after auth.
  const locale = localeFromPathname(window.location.pathname);
  const fallback = localizePath(action === "login" ? "/studio/projects" : "/login", locale);
  const redirect = readRedirectParam();
  window.location.assign(resolveRedirectTarget(redirect) ?? fallback);
}

/**
 * Read the `redirect` (or legacy `from`) query param. Mirrors the old
 * fizzdragon-web login page which accepted `?redirect=<url>`.
 */
function readRedirectParam(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("redirect") ?? params.get("from");
  } catch {
    return null;
  }
}

/**
 * Sanitize the `redirect` value into a safe URL to navigate to. Accepts:
 *   - relative paths ("/studio/...")
 *   - absolute URLs whose origin is either the current app or one of
 *     the whitelisted sibling origins (fizzdragon.com / fizzspace.cn /
 *     test.fizzdragon.com)
 * Returns `null` for anything else to stop open-redirect attacks.
 */
export function resolveRedirectTarget(redirect: string | null | undefined): string | null {
  if (!redirect) return null;
  const trimmed = redirect.trim();
  if (!trimmed) return null;

  // Relative path — must start with a single slash (reject protocol-relative "//host").
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed, window.location.origin);
    const allowed = [window.location.origin, ...ALLOWED_PARENT_ORIGINS];
    if (allowed.includes(parsed.origin)) {
      return parsed.toString();
    }
  } catch {
    /* malformed — fall through */
  }
  return null;
}

export type { AuthAction, AuthSuccessMessage };
