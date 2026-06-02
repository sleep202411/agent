import { useMemo, useSyncExternalStore } from "react";

import { getAuthSnapshot, refreshCurrentUser, signIn, signOut, subscribeAuth } from "./auth-store";

export function useAuth() {
  const state = useSyncExternalStore(subscribeAuth, getAuthSnapshot, getAuthSnapshot);

  return useMemo(
    () => ({
      ...state,
      refreshCurrentUser,
      signIn,
      signOut,
    }),
    [state]
  );
}
