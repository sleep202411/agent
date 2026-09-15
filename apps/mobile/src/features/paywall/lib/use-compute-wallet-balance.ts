import { useEffect, useState } from "react";

import { useAuth } from "@/auth";

import { fetchComputeWalletBalance } from "./compute-wallet";

export function useComputeWalletBalance(): string | null {
  const auth = useAuth();
  const scope = auth.status === "authenticated" ? auth.generation : null;
  const [result, setResult] = useState<{ scope: number; balance: string | null } | null>(null);

  useEffect(() => {
    if (scope === null) return;
    const controller = new AbortController();
    void fetchComputeWalletBalance(controller.signal).then((balance) => {
      if (!controller.signal.aborted) setResult({ scope, balance });
    });
    return () => controller.abort();
  }, [scope]);

  return scope !== null && result?.scope === scope ? result.balance : null;
}
