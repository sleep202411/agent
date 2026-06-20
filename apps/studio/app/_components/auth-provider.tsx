"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getAuthUser, logout as javaLogout, type AuthUser } from "@/lib/auth";
import { bindReferralCode } from "@/lib/billing";
import { LoginDialog } from "./login-dialog";

/** Where a captured ?ref= referral code waits until the user is authenticated. */
const REFERRAL_CODE_KEY = "fizz:ref";

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

  // Capture a ?ref= referral code from an invite link the moment we land, before
  // any client navigation (or the login flow) can drop it. Stashed until auth.
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const ref = params.get("ref");
      if (!ref) return;
      sessionStorage.setItem(REFERRAL_CODE_KEY, ref.trim().toUpperCase());
      // Strip ?ref from the URL so it isn't re-shared or re-applied on reload.
      params.delete("ref");
      const qs = params.toString();
      window.history.replaceState(
        null,
        "",
        window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash
      );
    } catch {
      /* sessionStorage / history unavailable — referral capture is best-effort */
    }
  }, []);

  // Once authenticated, bind any stashed referral code exactly once. Fire-and-
  // forget: the server rejects self / already-referred / unknown codes, so a
  // failure is an expected no-op. Silent — Settings → Billing shows bound state.
  useEffect(() => {
    if (!user) return;
    let code: string | null = null;
    try {
      code = sessionStorage.getItem(REFERRAL_CODE_KEY);
      if (code) sessionStorage.removeItem(REFERRAL_CODE_KEY);
    } catch {
      return;
    }
    if (!code) return;
    void bindReferralCode(code)
      .then(() => queryClient.invalidateQueries())
      .catch(() => {
        /* self / already-referred / unknown / disabled — benign, manual entry remains */
      });
  }, [user, queryClient]);

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
