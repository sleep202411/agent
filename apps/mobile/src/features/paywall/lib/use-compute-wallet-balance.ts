import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/auth";
import { useScreenActive } from "@/hooks/use-app-active";
import { fetchComputeWalletBalance } from "./compute-wallet";

export function useComputeWalletBalance() {
  const auth = useAuth(),
    active = useScreenActive();
  const scope = auth.status === "authenticated" ? auth.generation : null;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    scope: number;
    revision: number;
    balance: string | null;
    error: string | null;
  } | null>(null);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (scope === null || !active) return;
    const controller = new AbortController();
    void fetchComputeWalletBalance(controller.signal).then(
      (balance) => {
        if (!controller.signal.aborted) setResult({ scope, revision, balance, error: null });
      },
      (cause) => {
        if (!controller.signal.aborted)
          setResult({
            scope,
            revision,
            balance: null,
            error: cause instanceof Error ? cause.message : String(cause),
          });
      }
    );
    return () => controller.abort();
  }, [scope, revision, active]);
  const current =
    scope !== null && result?.scope === scope && result.revision === revision ? result : null;
  return {
    balance: current?.balance ?? null,
    error: current?.error ?? null,
    loading: scope !== null && active && !current,
    refresh,
  };
}
