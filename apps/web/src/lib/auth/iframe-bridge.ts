/**
 * iframe embed bridge for the auth pages.
 *
 * The login/register/reset pages are both:
 *   - served standalone (users hit fizzstudio.* directly — after auth
 *     the router navigates to /studio/projects or a `redirect` query)
 *   - embedded via `<iframe src="/login?embed=1">` inside the old
 *     fizzdragon-web host (hosts: fizzdragon.com / fizzspace.cn /
 *     test.fizzdragon.com)
 *
 * In embed mode we don't navigate after success — we postMessage the
 * SaToken + user payload to `window.parent` so the host can write it
 * into its own cookie/localStorage and close / navigate itself.
 */

import type { AuthResult } from "./api";

export type AuthAction = "login" | "register" | "reset";

export interface AuthSuccessMessage {
  type: "auth:success";
  action: AuthAction;
  tokenName: string;
  tokenValue: string;
  user: AuthResult["user"];
}

/**
 * Whitelisted parent origins the iframe is allowed to postMessage to.
 * Locked to the three SITE_REGION-specific domains; any other origin
 * would indicate either a misconfigured embed or an attacker trying to
 * phish a token out of the iframe.
 */
export const ALLOWED_PARENT_ORIGINS = [
  "https://fizzdragon.com",
  "https://fizzdragon.fizzspace.cn",
  "https://test.fizzdragon.com",
];

export function isEmbeddedMode(): boolean {
  if (typeof window === "undefined") return false;
  if (window.self !== window.top) return true;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("embed") === "1") return true;
  } catch {
    /* SSR or opaque location — fall through */
  }
  return false;
}

/**
 * Pick the target origin for postMessage: prefer `document.referrer`'s
 * origin if it matches the allow-list, else fall back to the build-time
 * `NEXT_PUBLIC_PARENT_ORIGIN`. Returns `null` when neither is trusted —
 * the caller should abort (never use `*` with a token payload).
 */
export function resolveParentOrigin(): string | null {
  if (typeof window === "undefined") return null;
  const referrerOrigin = safeOrigin(document.referrer);
  if (referrerOrigin && ALLOWED_PARENT_ORIGINS.includes(referrerOrigin)) {
    return referrerOrigin;
  }
  const envOrigin = process.env.NEXT_PUBLIC_PARENT_ORIGIN?.trim();
  if (envOrigin && ALLOWED_PARENT_ORIGINS.includes(envOrigin)) {
    return envOrigin;
  }
  return null;
}

function safeOrigin(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Forward the auth result to the parent frame. No-op (returns false)
 * when not in embed mode, when we're in SSR, or when the parent origin
 * isn't on the allow-list.
 */
export function postAuthSuccess(action: AuthAction, result: AuthResult): boolean {
  if (typeof window === "undefined") return false;
  if (!isEmbeddedMode()) return false;
  if (!result.tokenValue) return false;

  const targetOrigin = resolveParentOrigin();
  if (!targetOrigin) {
    // eslint-disable-next-line no-console
    console.warn(
      "[auth-iframe] refusing to postMessage auth payload — no whitelisted parent origin",
      { referrer: document.referrer, env: process.env.NEXT_PUBLIC_PARENT_ORIGIN }
    );
    return false;
  }

  const message: AuthSuccessMessage = {
    type: "auth:success",
    action,
    tokenName: result.tokenName ?? "satoken",
    tokenValue: result.tokenValue,
    user: result.user,
  };
  window.parent.postMessage(message, targetOrigin);
  return true;
}
