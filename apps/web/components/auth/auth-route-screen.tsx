"use client";

/**
 * The `/login`, `/register` and `/forgot-password` routes.
 *
 * These URLs are load-bearing and are NOT going away just because the
 * two-pane pages did:
 *
 *   - `proxy.ts` server-side 307s every protected path to
 *     `/login?redirect=…` before render. It has no dialog to open — a
 *     real navigable URL is the only thing a middleware can redirect to.
 *   - Nine in-app links still point here.
 *   - `apps/mobile`'s AuthedWebView decides the session died by watching
 *     for a WebView navigation whose URL contains `/login`, and swaps in
 *     its NATIVE sign-in prompt. If `/login` stopped being a navigation
 *     target the app would render this web page inside the WebView
 *     instead — see the header comment on
 *     `apps/mobile/src/components/authed-web-view.tsx`.
 *
 * So the route stays; only its body changes. It renders the site shell
 * (nav + footer, via the `(site)` group) and opens the shared dialog on
 * top, which is what "one sign-in experience" means here.
 *
 * Success goes through `mode: "navigate"` so `?redirect=` is honoured by
 * `handleAuthSuccess`. Dismissing the dialog leaves nothing behind, so a
 * dismiss sends the visitor to the localized home page rather than
 * stranding them on a blank shell.
 */

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { AuthMode } from "@repo/auth-flow";

import { useAuthDialog } from "@/components/auth/auth-dialog-provider";
import { useLocale } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";

export function AuthRouteScreen({ intent = "signin" }: { intent?: AuthMode }) {
  const { open } = useAuthDialog();
  const router = useRouter();
  const locale = useLocale() as Locale;

  // Latest-value ref so the effect below stays mount-only: re-running it
  // on a locale change would reopen a dialog the user just dismissed.
  const homeRef = useRef(localizePath("/", locale));
  useEffect(() => {
    homeRef.current = localizePath("/", locale);
  }, [locale]);

  // `intent` is fixed per route (only /forgot-password passes one), so it
  // belongs in the deps rather than behind a ref — and `open()` is
  // idempotent while open, so even a change could not reopen anything.
  useEffect(() => {
    open({
      mode: "navigate",
      intent,
      onDismiss: () => router.replace(homeRef.current),
    });
  }, [open, router, intent]);

  // Deliberately empty: the dialog is the page. Height keeps the footer
  // from riding up under the nav while the dialog is open.
  return <div className="min-h-[calc(100vh-4rem)]" />;
}
