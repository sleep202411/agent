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
 * Any other origin would mean either a misconfigured embed or an
 * attacker trying to phish a token out of the iframe.
 *
 * Composed from:
 *   - known prod/staging hosts (www + apex for the .com site, the .cn
 *     domestic site, the test.* staging site)
 *   - `NEXT_PUBLIC_PARENT_ORIGIN` (build-time, trusted — lets staging
 *     or preview deploys widen the list without code changes)
 *   - localhost in non-prod (uni-app `-p h5` defaults to port 8080;
 *     covers http and 127.0.0.1 too so either hostname works)
 */
const STATIC_PARENT_ORIGINS = [
  "https://fizzdragon.com",
  "https://www.fizzdragon.com",
  "https://fizzdragon.fizzspace.cn",
  "https://www.fizzdragon.fizzspace.cn",
  "https://test.fizzdragon.com",
];

const DEV_PARENT_ORIGINS =
  process.env.NODE_ENV === "production"
    ? []
    : [
        "http://localhost:8080",
        "http://127.0.0.1:8080",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
      ];

const ENV_PARENT_ORIGINS = (process.env.NEXT_PUBLIC_PARENT_ORIGIN ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export const ALLOWED_PARENT_ORIGINS = Array.from(
  new Set([...STATIC_PARENT_ORIGINS, ...ENV_PARENT_ORIGINS, ...DEV_PARENT_ORIGINS])
);

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

const PARENT_ORIGIN_STORAGE_KEY = "fizzdragon:auth:parentOrigin";

/**
 * On the very first iframe page load, `document.referrer` holds the
 * parent window's URL — that's our best signal for "who embedded us."
 * Once the user navigates inside the iframe (e.g. reset-password →
 * login), referrer switches to the previous iframe page and the parent
 * origin is no longer discoverable from it. So stash it in
 * sessionStorage on first sight and reuse it across in-iframe nav.
 */
function cacheParentOriginFromReferrer(): void {
  if (typeof window === "undefined") return;
  try {
    if (sessionStorage.getItem(PARENT_ORIGIN_STORAGE_KEY)) return;
    const referrerOrigin = safeOrigin(document.referrer);
    if (referrerOrigin && ALLOWED_PARENT_ORIGINS.includes(referrerOrigin)) {
      sessionStorage.setItem(PARENT_ORIGIN_STORAGE_KEY, referrerOrigin);
    }
  } catch {
    /* sessionStorage unavailable (privacy mode, etc.) — fall through to resolveParentOrigin */
  }
}

if (typeof window !== "undefined") cacheParentOriginFromReferrer();

/**
 * Pick the target origin for postMessage. Checks, in order:
 *   1. sessionStorage cache (written on first iframe page load, so
 *      it survives internal navigations)
 *   2. `document.referrer` origin (works on the first page load)
 *   3. `NEXT_PUBLIC_PARENT_ORIGIN` from env (last-resort, useful when
 *      referrer-policy strips the referrer entirely)
 * Returns `null` when none of those yields a trusted origin — the
 * caller must abort (never use `*` with a token payload).
 */
export function resolveParentOrigin(): string | null {
  if (typeof window === "undefined") return null;

  try {
    const cached = sessionStorage.getItem(PARENT_ORIGIN_STORAGE_KEY);
    if (cached && ALLOWED_PARENT_ORIGINS.includes(cached)) return cached;
  } catch {
    /* sessionStorage unavailable — skip cache step */
  }

  const referrerOrigin = safeOrigin(document.referrer);
  if (referrerOrigin && ALLOWED_PARENT_ORIGINS.includes(referrerOrigin)) {
    return referrerOrigin;
  }

  const envMatch = ENV_PARENT_ORIGINS.find((o) => ALLOWED_PARENT_ORIGINS.includes(o));
  return envMatch ?? null;
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

  if (!result.tokenValue) {
    // eslint-disable-next-line no-console
    console.warn("[auth-iframe] no tokenValue on AuthResult — aborting post", result);
    return false;
  }

  const targetOrigin = resolveParentOrigin();
  if (!targetOrigin) {
    // eslint-disable-next-line no-console
    console.warn("[auth-iframe] no whitelisted parent origin — aborting post", {
      referrer: document.referrer,
      env: process.env.NEXT_PUBLIC_PARENT_ORIGIN,
    });
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
