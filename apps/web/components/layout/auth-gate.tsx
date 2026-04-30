"use client";

/**
 * Client-side fallback for the proxy.ts server-side auth gate.
 *
 * The middleware in `proxy.ts` already 307s unauthenticated requests
 * to /login before render — so on the *first paint* of a protected
 * page the user is guaranteed to have a session cookie. AuthGate
 * exists for the *mid-session expiry* case: a user sits on /profile
 * for two hours, the satoken cookie expires, the next /user/query
 * request returns null, and we need to redirect them out without
 * waiting for the next manual navigation.
 *
 * Implementation: share the same `isProtectedPath` config, listen
 * to React-Query's `useUserInfo()` result, and `router.replace` to
 * /login when the active route is protected and the user is null
 * after fetch settles.
 *
 * No-ops on public routes — the effect's first guard returns early
 * so unprotected pages don't pay any cost.
 */

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useUserInfo } from "@/src/hooks/use-user";
import { useLocale } from "@/src/i18n/i18n";
import type { Locale } from "@/src/i18n/config";
import { localizePath, stripLocalePrefix } from "@/src/i18n/locale-url";
import { isProtectedPath } from "@/src/lib/auth/protected-paths";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const locale = useLocale() as Locale;
  const { data: user, isLoading, isFetched } = useUserInfo();

  // First-paint / fetch-settle gate. Middleware already redirects on
  // hard navigation; this handles the case where useUserInfo resolves
  // to null after client-side navigation into a protected page.
  // The api-level 401 handler lives in <AuthInterceptor> at the
  // Providers level (covers /projects too, not just (site) routes).
  useEffect(() => {
    const stripped = stripLocalePrefix(pathname);
    if (!isProtectedPath(stripped)) return;
    if (isLoading || !isFetched) return;
    if (user) return;

    const loginUrl = localizePath("/login", locale);
    const redirect = encodeURIComponent(pathname);
    router.replace(`${loginUrl}?redirect=${redirect}`);
  }, [pathname, locale, user, isLoading, isFetched, router]);

  return <>{children}</>;
}
