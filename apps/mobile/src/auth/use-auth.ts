import { useMemo, useSyncExternalStore } from "react";

import {
  clearIsNewUserFlag,
  continueWithCode,
  getAuthSnapshot,
  refreshCurrentUser,
  resetPasswordAndSignIn,
  saveAccountPassword,
  saveOnboardingNickname,
  signIn,
  signOut,
  submitInviteCode,
  subscribeAuth,
} from "./auth-store";

export function useAuth() {
  const state = useSyncExternalStore(subscribeAuth, getAuthSnapshot, getAuthSnapshot);

  return useMemo(
    () => ({
      ...state,
      clearIsNewUserFlag,
      continueWithCode,
      refreshCurrentUser,
      resetPasswordAndSignIn,
      saveAccountPassword,
      saveOnboardingNickname,
      signIn,
      signOut,
      submitInviteCode,
    }),
    [state]
  );
}
