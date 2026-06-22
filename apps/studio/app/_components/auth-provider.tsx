"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getAuthUser, logout as javaLogout, type AuthUser } from "@/lib/auth";
import { LoginDialog } from "./login-dialog";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  /** Open the global sign-in dialog. */
  signIn: () => void;
  /**
   * Gate an action behind auth: run it now if signed in, otherwise prompt
   * sign-in and run it once login succeeds. The canonical way to gate a
   * "generate"/"save" action on a public page.
   */
  requireAuth: (action: () => void) => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  signIn: () => {},
  requireAuth: () => {},
  signOut: async () => {},
});

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

const ME_KEY = ["fizzstudio", "auth", "me"] as const;

/**
 * Global auth state + the sign-in dialog. Any API 401 anywhere raises the
 * dialog (the api client dispatches `fizz:unauthorized`); a successful login
 * Set-Cookies the satoken, so refetching is all that's needed afterwards.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const pendingActionRef = useRef<(() => void) | null>(null);
  const queryClient = useQueryClient();

  const { data: user = null, isLoading } = useQuery({
    queryKey: ME_KEY,
    queryFn: getAuthUser,
    staleTime: 5 * 60_000,
    retry: false,
  });

  useEffect(() => {
    const onUnauthorized = () => setDialogOpen(true);
    window.addEventListener("fizz:unauthorized", onUnauthorized);
    return () => window.removeEventListener("fizz:unauthorized", onUnauthorized);
  }, []);

  const signIn = useCallback(() => setDialogOpen(true), []);

  const requireAuth = useCallback(
    (action: () => void) => {
      if (user) {
        action();
        return;
      }
      pendingActionRef.current = action;
      setDialogOpen(true);
    },
    [user]
  );

  const signOut = useCallback(async () => {
    await javaLogout();
    queryClient.setQueryData(ME_KEY, null);
    void queryClient.invalidateQueries();
  }, [queryClient]);

  const closeDialog = useCallback(() => {
    // Dismissed without logging in — drop any gated action so it can't fire later.
    pendingActionRef.current = null;
    setDialogOpen(false);
  }, []);

  const onLoggedIn = useCallback(() => {
    setDialogOpen(false);
    // The satoken cookie is now set — refresh the session + every surface.
    void queryClient.invalidateQueries();
    // Resume the action the user was gated on (the cookie is live, so its API
    // calls are authed even before the user query refetches).
    const pending = pendingActionRef.current;
    pendingActionRef.current = null;
    if (pending) pending();
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading: isLoading, signIn, requireAuth, signOut }),
    [user, isLoading, signIn, requireAuth, signOut]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      {dialogOpen && <LoginDialog onClose={closeDialog} onLoggedIn={onLoggedIn} />}
    </AuthContext.Provider>
  );
}
