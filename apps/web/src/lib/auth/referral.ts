"use client";

/**
 * Referral-code carry-through.
 *
 * The old `/register` page read the referrer's code straight out of the
 * URL at mount and prefilled its invite field. The one-button dialog
 * cannot do that: it opens from anywhere (a gated play link, the nav's
 * "Get started", a 401 mid-session), and the invite step runs several
 * steps AFTER the page whose query string carried the code — by then a
 * client-side navigation may well have replaced it.
 *
 * So the code is captured the moment it is seen and stashed in
 * `sessionStorage`, then replayed into the invite step when Java says
 * `isNewUser`. Losing it means referral attribution drops to zero, which
 * is why capture happens on EVERY page (see `<AuthDialogProvider>`), not
 * just on the routes that open the dialog.
 *
 * sessionStorage, not localStorage: attribution should follow the tab
 * that opened the referral link, and must not leak into a different
 * signup weeks later on the same machine.
 */

const STORAGE_KEY = "fd.auth.recommendationCode";

/**
 * A gated link (e.g. /play/interactive-film/[id]?recommendationCode=ABC)
 * reaches the login gate, which stashes the whole path+query in
 * `?redirect=`. Pull the referrer's code back out of that redirect value
 * so attribution still lands. `searchParams.get("redirect")` returns the
 * already-decoded value, so a plain URLSearchParams parse works.
 *
 * Carried over verbatim from the deleted `app/(auth)/register/page.tsx`.
 */
export function referralCodeFromRedirect(redirect: string | null | undefined): string | null {
  if (!redirect) return null;
  const q = redirect.indexOf("?");
  if (q === -1) return null;
  return new URLSearchParams(redirect.slice(q + 1)).get("recommendationCode") ?? null;
}

/** Both sources the old register page honoured, in the same precedence. */
export function referralCodeFromSearch(search: string): string | null {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return null;
  }
  const direct = params.get("recommendationCode");
  if (direct) return direct;
  return referralCodeFromRedirect(params.get("redirect"));
}

/**
 * Capture whatever the current URL carries. Returns the stashed code so
 * a caller can prefill immediately; a URL WITHOUT a code never clears an
 * earlier capture — the visitor is expected to browse between landing on
 * the referral link and signing up.
 */
export function captureReferralCode(search: string): string {
  const found = referralCodeFromSearch(search);
  if (found) writeStash(found);
  return found ?? readReferralCode();
}

export function readReferralCode(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    // Safari private mode throws on any sessionStorage access.
    return "";
  }
}

/** Called once the code has been bound (or deliberately skipped). */
export function clearReferralCode(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do — a failed clear just means a stale prefill.
  }
}

function writeStash(code: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, code);
  } catch {
    // Best-effort: without storage the prefill is lost but the user can
    // still type the code by hand.
  }
}
