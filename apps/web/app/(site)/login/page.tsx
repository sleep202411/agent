"use client";

/**
 * `/login` — kept as a real, navigable URL on purpose.
 *
 * `proxy.ts` 307s protected paths here with `?redirect=`, nine in-app
 * links point at it, and apps/mobile's AuthedWebView watches for a
 * WebView navigation to `/login` to decide the session died. See
 * `<AuthRouteScreen>` for the full rationale.
 *
 * Moved out of the deleted `(auth)` group into `(site)` so it renders
 * the normal site shell (nav + footer) with the dialog on top — the
 * two-pane auth layout is gone. `/login` is in `PUBLIC_PATTERNS`, so
 * the `(site)` layout's `<AuthGate>` no-ops here and there is no
 * redirect loop.
 */

import { AuthRouteScreen } from "@/components/auth/auth-route-screen";

export default function LoginPage() {
  return <AuthRouteScreen />;
}
