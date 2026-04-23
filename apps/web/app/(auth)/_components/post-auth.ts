"use client";

import type { AuthAction, AuthSuccessMessage } from "@/src/lib/auth/iframe-bridge";
import { isEmbeddedMode, postAuthSuccess } from "@/src/lib/auth/iframe-bridge";
import type { AuthResult } from "@/src/lib/auth/api";

/**
 * Decide what happens after a successful auth action.
 *
 * - Embedded (iframe host = fizzdragon-web): postMessage the token to
 *   the parent and stop. The host owns the "close iframe / redirect"
 *   decision.
 * - Standalone: navigate to `redirect` query param if present,
 *   otherwise fall back to the studio shell.
 */
export function handleAuthSuccess(action: AuthAction, result: AuthResult): void {
  if (typeof window === "undefined") return;

  if (isEmbeddedMode()) {
    postAuthSuccess(action, result);
    return;
  }

  const fallback = action === "login" ? "/studio/projects" : "/login";
  let destination = fallback;
  try {
    const params = new URLSearchParams(window.location.search);
    const redirect = params.get("redirect");
    if (redirect && redirect.startsWith("/")) destination = redirect;
  } catch {
    /* ignore malformed search */
  }
  window.location.assign(destination);
}

export type { AuthAction, AuthSuccessMessage };
