import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef } from "react";

import type { AuthSheetOptions } from "./auth-sheet";
import { openAuthSheet, requireAuthenticated } from "./auth-sheet";
import { useAuth } from "./use-auth";

export function useAuthGate() {
  const auth = useAuth();

  const openLogin = useCallback(
    (options?: Omit<AuthSheetOptions, "mode">) => openAuthSheet({ ...options, mode: "login" }),
    []
  );
  const openRegister = useCallback(
    (options?: Omit<AuthSheetOptions, "mode">) => openAuthSheet({ ...options, mode: "login" }),
    []
  );
  const requireAuth = useCallback(
    (options?: AuthSheetOptions) => requireAuthenticated(auth, { ...options, mode: "login" }),
    [auth]
  );

  return useMemo(
    () => ({
      isAuthenticated: auth.status === "authenticated",
      openLogin,
      openRegister,
      requireAuth,
    }),
    [auth.status, openLogin, openRegister, requireAuth]
  );
}

/**
 * Login-only screens: present the global auth sheet the moment a guest focuses
 * the screen, instead of making them tap through a CTA first. Guarded so a
 * swipe-dismiss doesn't immediately re-pop; re-arms once a session ends.
 */
export function useLoginGateOnFocus(enabled = true) {
  const auth = useAuth();
  const promptedRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (enabled && auth.status === "anonymous" && !promptedRef.current) {
        promptedRef.current = true;
        openAuthSheet({ mode: "login" });
      }
    }, [enabled, auth.status])
  );

  useEffect(() => {
    if (auth.status === "authenticated") promptedRef.current = false;
  }, [auth.status]);
}
