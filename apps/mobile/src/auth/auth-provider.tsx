import { useEffect, type PropsWithChildren } from "react";

import { hydrateAuthSession } from "./auth-store";

export function AuthProvider({ children }: PropsWithChildren) {
  useEffect(() => {
    void hydrateAuthSession();
  }, []);

  return children;
}
