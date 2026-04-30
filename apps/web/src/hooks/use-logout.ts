"use client";

/**
 * One-stop logout. Three steps in sync:
 *
 *   1. Backend: Sa-Token logout (clears the satoken cookie).
 *   2. RQ: drop the user-info / credits caches so any subscribed UI
 *      flips to signed-out and AuthGate kicks the user off any
 *      protected page they were standing on.
 *   3. Router: hard-replace to the locale home so the user lands
 *      somewhere public regardless of where they came from.
 *
 * Replace every old `dispatch(logout())` callsite with `useLogout()()`.
 */
import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { logout as apiLogout } from "@/src/lib/auth/api";
import { useLocale } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";

export function useLogout() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const locale = useLocale() as Locale;

  return useCallback(async () => {
    try {
      await apiLogout();
    } catch {
      // Backend logout best-effort — we still clear local state and
      // navigate, otherwise a stale 401 leaves the user "logged in" on
      // the client even though the cookie is gone.
    }
    queryClient.removeQueries({ queryKey: ["user", "info"] });
    queryClient.removeQueries({ queryKey: ["user", "credits"] });
    router.replace(localizePath("/", locale));
  }, [queryClient, router, locale]);
}
