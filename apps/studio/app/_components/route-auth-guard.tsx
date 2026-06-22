"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { isProtectedPath } from "@/lib/auth-gates";
import { useAuth } from "./auth-provider";

/**
 * Global page-level auth gate. A signed-out user who lands on a protected route
 * (direct link, refresh, or in-app nav) is sent to the public home and prompted
 * to sign in — rather than staring at a broken/empty protected page. Public
 * pages are untouched. Action gating (Generate on a public page) lives in
 * `requireAuth`, not here.
 */
export function RouteAuthGuard() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, signIn } = useAuth();

  useEffect(() => {
    if (loading || user) return;
    if (isProtectedPath(pathname)) {
      router.replace("/");
      signIn();
    }
  }, [pathname, user, loading, router, signIn]);

  return null;
}
