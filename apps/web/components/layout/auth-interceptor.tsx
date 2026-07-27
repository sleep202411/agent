"use client";

/**
 * Global 401 handler. Registered inside <Providers> (so it covers
 * every route, including the full-screen project editor under
 * /projects which doesn't render the (site) layout's <AuthGate>).
 *
 * On 401 from the api-client:
 *   1. Drop the user-info / credits caches so any subscribed UI
 *      flips to signed-out.
 *   2. If the user happens to be standing on a protected path,
 *      open the shared sign-in dialog over the page they're on
 *      (2026-07-21: this used to navigate to /login?redirect=<current>
 *      — a round trip that lost their scroll position and any
 *      in-progress form to end up back where it started). Inside
 *      apps/mobile's WebView it still navigates: that shell detects a
 *      dead session by watching for /login and answers with its own
 *      native prompt (see `src/lib/auth/native-shell.ts`).
 *   3. Otherwise leave them where they are (e.g. expired session
 *      while reading the public Plaza is fine — they'll be asked
 *      to log in only if/when they actually try to do something
 *      that requires it).
 */

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { setUnauthorizedHandler } from "@/src/lib/api";
import { useLocale } from "@/src/i18n/i18n";
import type { Locale } from "@/src/i18n/config";
import { localizePath, stripLocalePrefix } from "@/src/i18n/locale-url";
import { isProtectedPath } from "@/src/lib/auth/protected-paths";
import { isNativeShell } from "@/src/lib/auth/native-shell";
import { useAuthDialog } from "@/components/auth/auth-dialog-provider";

export function AuthInterceptor() {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const locale = useLocale() as Locale;
  const queryClient = useQueryClient();
  const { open } = useAuthDialog();

  useEffect(() => {
    setUnauthorizedHandler(() => {
      queryClient.removeQueries({ queryKey: ["user", "info"] });
      queryClient.removeQueries({ queryKey: ["user", "credits"] });
      const stripped = stripLocalePrefix(pathname);
      if (isProtectedPath(stripped)) {
        if (isNativeShell()) {
          // Embedded in apps/mobile: the native shell watches for this
          // navigation to raise its OWN sign-in prompt, so keep making it
          // rather than opening a web dialog inside the WebView.
          const loginUrl = localizePath("/login", locale);
          router.replace(`${loginUrl}?redirect=${encodeURIComponent(pathname)}`);
          return;
        }
        open({
          mode: "stay",
          // The route needs a session and they declined to give one;
          // there is nothing usable to leave them on.
          onDismiss: () => router.replace(localizePath("/", locale)),
        });
      }
    });
    return () => setUnauthorizedHandler(null);
  }, [pathname, locale, queryClient, router, open]);

  return null;
}
