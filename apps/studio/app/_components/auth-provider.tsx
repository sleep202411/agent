"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getAuthUser, logout as javaLogout, type AuthUser } from "@/lib/auth";
import { LoginDialog } from "./login-dialog";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  /** Open the global sign-in dialog. */
  signIn: () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  signIn: () => {},
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

  const signOut = useCallback(async () => {
    await javaLogout();
    queryClient.setQueryData(ME_KEY, null);
    void queryClient.invalidateQueries();
  }, [queryClient]);

  const onLoggedIn = useCallback(() => {
    setDialogOpen(false);
    // The satoken cookie is now set — refresh the session + every surface.
    void queryClient.invalidateQueries();
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading: isLoading, signIn, signOut }),
    [user, isLoading, signIn, signOut]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      {dialogOpen && <LoginDialog onClose={() => setDialogOpen(false)} onLoggedIn={onLoggedIn} />}
    </AuthContext.Provider>
  );
}
