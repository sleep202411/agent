"use client";

/**
 * One-stop logout. Optimistic — UI flips to signed-out immediately,
 * Sa-Token cookie is cleared on the backend in the background.
 *
 * Why optimistic instead of "await backend, then update UI":
 *   1. /user/logout can take 500ms+ on a slow connection — awaiting it
 *      makes the avatar / nav freeze, the user clicks again, etc.
 *   2. `removeQueries` here used to be the last step, but removing a
 *      query while a subscriber is mounted triggers an *immediate*
 *      refetch. If that refetch races the still-in-flight `apiLogout`
 *      (cookie not yet cleared), Java returns the still-logged-in user
 *      and the cache gets repopulated — the avatar "comes back" after
 *      logout. We instead `setQueryData(null)` so subscribers see the
 *      cleared state without firing a new fetch.
 */
import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { logout as apiLogout } from "@/src/lib/auth/api";
import { useLocale } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { userKeys } from "@/src/hooks/use-user";
import { kycKeys } from "@/src/hooks/use-kyc";

export function useLogout() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const locale = useLocale() as Locale;

  return useCallback(() => {
    // Cancel any in-flight user-bound request so they can't repopulate
    // the cache after we clear it.
    void queryClient.cancelQueries({ queryKey: ["user"] });
    void queryClient.cancelQueries({ queryKey: kycKeys.authStatus });

    // Force-write the cleared state. Subscribers re-render immediately
    // (avatar → "Get Started", protected pages → AuthGate redirect)
    // without firing an extra refetch.
    queryClient.setQueryData(userKeys.info, null);
    queryClient.setQueryData(userKeys.credits, 0);
    queryClient.removeQueries({ queryKey: kycKeys.authStatus });

    // Navigate first, so any unmount happens before the backend roundtrip.
    router.replace(localizePath("/", locale));

    // Backend best-effort. Fire-and-forget — the user is already
    // visibly logged out client-side. If this fails the cookie sticks
    // around briefly, but auth-protected endpoints will still 401.
    apiLogout().catch(() => {});
  }, [queryClient, router, locale]);
}
