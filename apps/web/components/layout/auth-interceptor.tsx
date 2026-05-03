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
 *      route them to /login?redirect=<current>.
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

export function AuthInterceptor() {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const locale = useLocale() as Locale;
  const queryClient = useQueryClient();

  useEffect(() => {
    setUnauthorizedHandler(() => {
      queryClient.removeQueries({ queryKey: ["user", "info"] });
      queryClient.removeQueries({ queryKey: ["user", "credits"] });
      const stripped = stripLocalePrefix(pathname);
      if (isProtectedPath(stripped)) {
        const loginUrl = localizePath("/login", locale);
        const redirect = encodeURIComponent(pathname);
        router.replace(`${loginUrl}?redirect=${redirect}`);
      }
    });
    return () => setUnauthorizedHandler(null);
  }, [pathname, locale, queryClient, router]);

  return null;
}
