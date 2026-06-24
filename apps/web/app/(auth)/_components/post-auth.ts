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
 * is no longer a parent frame to postMessage tokens to.
 *
 * Safari commits a Set-Cookie from a fetch() response *asynchronously*, which
 * races the immediate window.location.assign below: the navigation request can
 * fire before the backend's satoken cookie has landed, so the auth middleware
 * sees no session and bounces the user straight back to /login ("login shows
 * success, then immediately returns to the login page" — Safari only; Chrome
 * commits the cookie first). The backend also returns the token in the response
 * body, so we write the SAME cookie synchronously here to win that race.
 */
export function handleAuthSuccess(action: AuthAction, result: AuthResult): void {
  if (typeof window === "undefined") return;
  persistSessionCookie(result);

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

/**
 * Synchronously mirror the satoken into a cookie so it exists the instant we
 * navigate (Safari's async Set-Cookie commit would otherwise miss the redirect).
 *
 * Scope matches the backend's prod cookie — `Domain=.<registrable>` + `Path=/`
 * (the live Java sets a domain-wide satoken so the session is shared across
 * subdomains; Chrome confirms this) — so this UPDATES that one cookie rather
 * than creating a second one, and keeps subdomains logged in. The domain is
 * derived from the current host, NOT from any backend config, so it tracks
 * fizzdragon.com / fizzspace.cn automatically and stays decoupled from Java.
 * The token is written raw (sa-token doesn't URL-encode it) so the value
 * matches byte-for-byte.
 */
function persistSessionCookie(result: AuthResult): void {
  const token = result.tokenValue;
  if (!token) return;
  const name = result.tokenName ?? "satoken";
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  const maxAge = 60 * 60 * 24 * 30; // 30d, refreshed on every login
  document.cookie = `${name}=${token}; Path=/${sessionCookieDomain()}; Max-Age=${maxAge}; SameSite=Lax${secure}`;
}

/**
 * The registrable apex as a `; Domain=...` attribute (`.fizzdragon.com` /
 * `.fizzspace.cn`) so the cookie is shared across subdomains, mirroring the
 * backend. Empty (host-only) on localhost / bare IPs where Domain is invalid.
 */
function sessionCookieDomain(): string {
  const host = window.location.hostname;
  if (host === "localhost" || /^[\d.]+$/.test(host)) return "";
  return `; Domain=.${host.split(".").slice(-2).join(".")}`;
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
