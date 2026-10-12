import { useCallback, useEffect, useMemo, useState } from "react";
import { useScreenActive } from "@/hooks/use-app-active";
import { fetchCommunityPointBalance } from "@/data/ip-api";
import { fetchComputeWalletBalance } from "@/features/paywall/lib/compute-wallet";

type Balances = { owner: string; community?: string; compute?: string; errors: string[] };
/** Account/session identity must include the auth generation, not just login status. */
export function usePersonalBalances(owner: string | undefined) {
  const active = useScreenActive();
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const scope = useMemo(() => ({ owner, active, revision }), [owner, active, revision]);
  const [snapshot, setSnapshot] = useState<{ scope: typeof scope; balances: Balances }>();
  useEffect(() => {
    if (!owner || !active) return;
    const controller = new AbortController();
    void Promise.allSettled([
      fetchCommunityPointBalance(controller.signal),
      fetchComputeWalletBalance(controller.signal),
    ]).then(([community, compute]) => {
      if (controller.signal.aborted) return;
      setSnapshot({
        scope,
        balances: {
          owner,
          errors: [community, compute].flatMap((result) =>
            result.status === "rejected"
              ? [result.reason instanceof Error ? result.reason.message : String(result.reason)]
              : []
          ),
          community: community.status === "fulfilled" ? (community.value ?? undefined) : undefined,
          compute: compute.status === "fulfilled" ? (compute.value ?? undefined) : undefined,
        },
      });
    });
    return () => controller.abort();
  }, [owner, active, scope]);
  // A return visit must not briefly resurrect the previous balance while refreshing.
  return owner && active && snapshot?.scope === scope
    ? { ...snapshot.balances, refresh }
    : undefined;
}
