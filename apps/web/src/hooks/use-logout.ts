"use client";

/**
 * One-stop logout. Optimistic — UI flips to signed-out immediately,
 * Clear the browser cookie immediately; revoke the server session best-effort.
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
import { clearSessionCookie } from "@repo/auth-flow";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import posthog from "posthog-js";
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
    // Start the request with the current credentials before expiring the local
    // cookie. A failed server roundtrip must not restore browser authentication.
    void apiLogout().catch(() => {});
    clearSessionCookie();
    void queryClient.cancelQueries({ queryKey: ["user-levels", "apply"] });
    queryClient.removeQueries({ queryKey: ["user-levels", "apply"] });
    // Cancel any in-flight user-bound request so they can't repopulate
    // the cache after we clear it.
    void queryClient.cancelQueries({ queryKey: ["user"] });
    void queryClient.cancelQueries({ queryKey: kycKeys.authStatus });

    // Force-write the cleared state across every locale variant.
    // Subscribers re-render immediately (avatar → "Get Started",
    // protected pages → AuthGate redirect) without firing an extra refetch.
    queryClient.setQueriesData({ queryKey: userKeys.info }, null);
    queryClient.removeQueries({ queryKey: userKeys.credits });
    queryClient.removeQueries({ queryKey: kycKeys.authStatus });

    // Capture logout before resetting PostHog identity.
    posthog.capture("user_logged_out");
    posthog.reset();

    // Navigation does not wait for the server roundtrip.
    router.replace(localizePath("/", locale));
  }, [queryClient, router, locale]);
}
