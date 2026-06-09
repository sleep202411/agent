import { useMemo, useSyncExternalStore } from "react";

import {
  getAuthSnapshot,
  refreshCurrentUser,
  register,
  signIn,
  signOut,
  subscribeAuth,
} from "./auth-store";

export function useAuth() {
  const state = useSyncExternalStore(subscribeAuth, getAuthSnapshot, getAuthSnapshot);

  return useMemo(
    () => ({
      ...state,
      refreshCurrentUser,
      register,
      signIn,
      signOut,
    }),
    [state]
  );
}
