import { useMemo } from "react";
import { useAuth } from "@/auth/use-auth";

/** Opaque scope: credentials participate in invalidation but never enter cache keys. */
export function useAuthRequestScope(identity: string) {
  const auth = useAuth();
  const generation = auth.generation;
  const enabled = auth.status === "authenticated";
  const userId = auth.user?.id ?? auth.user?.userId;
  const region = auth.session?.region;
  const tokenName = auth.session?.token?.tokenName;
  const tokenValue = auth.session?.token?.tokenValue;
  return useMemo(
    () => ({ identity, enabled }),
    // Credentials intentionally invalidate the opaque handle without being exposed on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [identity, generation, enabled, userId, region, tokenName, tokenValue]
  );
}
