import { useCallback, useMemo } from "react";

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
    (options?: Omit<AuthSheetOptions, "mode">) => openAuthSheet({ ...options, mode: "register" }),
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
