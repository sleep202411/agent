"use client";

import type { AuthResult } from "@/src/lib/auth/api";
import { localeFromPathname, localizePath } from "@/src/i18n/locale-url";

export type AuthAction = "login" | "register" | "reset";

/**
 * Decide what happens after a successful auth action.
 *
 * - register / reset: bounce to /login so the user signs in with the
 *   credentials they just set.
 * - login: navigate to `?redirect=<safe>` if present, else the
 *   localized homepage.
 *
 * The site is no longer embedded inside the legacy uni-app, so there
 * is no longer a parent frame to postMessage tokens to — the satoken
 * cookie set by the backend is read directly by subsequent requests.
 */
export function handleAuthSuccess(action: AuthAction, result: AuthResult): void {
  if (typeof window === "undefined") return;
  void result;

  const locale = localeFromPathname(window.location.pathname);

  if (action !== "login") {
    const base = localizePath("/login", locale);
    const query = window.location.search;
    window.location.assign(`${base}${query}`);
    return;
  }

  const fallback = localizePath("/", locale);
  const redirect = readRedirectParam();
  window.location.assign(resolveRedirectTarget(redirect) ?? fallback);
}

function readRedirectParam(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("redirect") ?? params.get("from");
  } catch {
    return null;
  }
}

/**
 * Sanitize the `redirect` value into a safe URL to navigate to. Accepts
 * relative paths only — absolute URLs are rejected so we never bounce
 * a user off-origin (defense against open-redirect phishing).
 */
export function resolveRedirectTarget(redirect: string | null | undefined): string | null {
  if (!redirect) return null;
  const trimmed = redirect.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return trimmed;
  }
  return null;
}
