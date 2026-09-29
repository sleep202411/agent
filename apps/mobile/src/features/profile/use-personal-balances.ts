import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { fetchCommunityPointBalance } from "@/data/ip-api";
import { fetchComputeWalletBalance } from "@/features/paywall/lib/compute-wallet";

type Balances = { owner: string; community?: string; compute?: string };
/** Account/session identity must include the auth generation, not just login status. */
export function usePersonalBalances(owner: string | undefined) {
  const [snapshot, setSnapshot] = useState<Balances>();
  useFocusEffect(
    useCallback(() => {
      if (!owner) return;
      let active = true;
      const controller = new AbortController();
      void Promise.allSettled([
        fetchCommunityPointBalance(),
        fetchComputeWalletBalance(controller.signal),
      ]).then(([community, compute]) => {
        if (!active) return;
        setSnapshot({
          owner,
          community: community.status === "fulfilled" ? (community.value ?? undefined) : undefined,
          compute: compute.status === "fulfilled" ? (compute.value ?? undefined) : undefined,
        });
      });
      return () => {
        active = false;
        controller.abort();
      };
    }, [owner])
  );
  // Hide a previous account immediately, before effect cleanup/new requests complete.
  return owner && snapshot?.owner === owner ? snapshot : undefined;
}
