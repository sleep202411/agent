import { useEffect, useMemo, useState } from "react";
import { useScreenActive } from "@/hooks/use-app-active";
import { fetchCommunityPointBalance } from "@/data/ip-api";
import { fetchComputeWalletBalance } from "@/features/paywall/lib/compute-wallet";

type Balances = { owner: string; community?: string; compute?: string };
/** Account/session identity must include the auth generation, not just login status. */
export function usePersonalBalances(owner: string | undefined) {
  const active = useScreenActive();
  const scope = useMemo(() => ({ owner, active }), [owner, active]);
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
          community: community.status === "fulfilled" ? (community.value ?? undefined) : undefined,
          compute: compute.status === "fulfilled" ? (compute.value ?? undefined) : undefined,
        },
      });
    });
    return () => controller.abort();
  }, [owner, active, scope]);
  // A return visit must not briefly resurrect the previous balance while refreshing.
  return owner && active && snapshot?.scope === scope ? snapshot.balances : undefined;
}
