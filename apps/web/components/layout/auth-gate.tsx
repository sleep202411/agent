"use client";

/**
 * Client-side fallback for the proxy.ts server-side auth gate.
 *
 * The middleware in `proxy.ts` already 307s unauthenticated requests
 * to /login before render — so on the *first paint* of a protected
 * page the user is guaranteed to have a session cookie. AuthGate
 * exists for the *mid-session expiry* case: a user sits on /profile
 * for two hours, the satoken cookie expires, the next /user/query
 * request returns null, and we need to recover without waiting for
 * the next manual navigation.
 *
 * Recovery changed 2026-07-21: this used to `router.replace` to
 * /login?redirect=<here>, which threw away what the user had on screen
 * to show them a form whose only job was to send them back. It now
 * opens the shared sign-in dialog IN PLACE; on success the provider
 * invalidates the user caches and calls `router.refresh()`, so the page
 * they were already on re-renders signed-in. Dismissing means "I don't
 * want to sign in", and the route is protected, so that goes home.
 *
 * The ONE exception is apps/mobile's WebView, which keeps the old
 * navigation: this redirect is the only signal that tells the native
 * shell a session died with its cookie still present, and it answers
 * with a native sign-in prompt (see `src/lib/auth/native-shell.ts`).
 *
 * Implementation: share the same `isProtectedPath` config, listen
 * to React-Query's `useUserInfo()` result, and prompt when the active
 * route is protected and the user is null after fetch settles.
 *
 * No-ops on public routes — the effect's first guard returns early
 * so unprotected pages don't pay any cost.
 */

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useUserInfo } from "@/src/hooks/use-user";
import { useLocale } from "@/src/i18n/i18n";
import type { Locale } from "@/src/i18n/config";
import { localizePath, stripLocalePrefix } from "@/src/i18n/locale-url";
import { isProtectedPath } from "@/src/lib/auth/protected-paths";
import { isNativeShell } from "@/src/lib/auth/native-shell";
import { useAuthDialog } from "@/components/auth/auth-dialog-provider";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const locale = useLocale() as Locale;
  const { data: user, isLoading, isFetched } = useUserInfo();
  const { open } = useAuthDialog();

  // One prompt per route. `user` stays null while the dialog is open, so
  // without this latch every re-render would re-open a dialog the user
  // has just dismissed.
  const promptedFor = useRef<string | null>(null);

  // First-paint / fetch-settle gate. Middleware already redirects on
  // hard navigation; this handles the case where useUserInfo resolves
  // to null after client-side navigation into a protected page.
  // The api-level 401 handler lives in <AuthInterceptor> at the
  // Providers level (covers /projects too, not just (site) routes).
  useEffect(() => {
    const stripped = stripLocalePrefix(pathname);
    if (!isProtectedPath(stripped)) return;
    if (isLoading || !isFetched) return;
    if (user) {
      promptedFor.current = null;
      return;
    }
    if (promptedFor.current === pathname) return;
    promptedFor.current = pathname;

    if (isNativeShell()) {
      // Embedded in apps/mobile: hand the dead session to the NATIVE
      // prompt, which is triggered by this navigation. Unchanged from
      // before the dialog rewrite — see `native-shell.ts`.
      const loginUrl = localizePath("/login", locale);
      router.replace(`${loginUrl}?redirect=${encodeURIComponent(pathname)}`);
      return;
    }

    open({
      mode: "stay",
      onDismiss: () => router.replace(localizePath("/", locale)),
    });
  }, [pathname, locale, user, isLoading, isFetched, router, open]);

  return <>{children}</>;
}
