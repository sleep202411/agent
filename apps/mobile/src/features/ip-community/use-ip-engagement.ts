import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAuth, useAuthGate } from "@/auth";
import { getAuthGeneration } from "@/auth/auth-store";
import { likeIp, recordIpView, unlikeIp } from "@/data/browse-service";
import { invalidateBrowse } from "@/data/browse-refresh";
import type { IpEngagementSnapshot } from "@/data/types";
import { ApiRequestError } from "@/lib/api-client";

export function useIpEngagement(
  ip: { id: string; viewerHasLiked: boolean } | undefined,
  active: boolean,
  apply: (id: string, value: IpEngagementSnapshot | undefined) => void,
  refresh: () => Promise<unknown>,
  onError: (error: unknown) => void
) {
  const auth = useAuth(),
    gate = useAuthGate();
  const ipId = ip?.id;
  const scope = useMemo(
    () => ({ ipId, generation: auth.generation, active }),
    [ipId, auth.generation, active]
  );
  const live = useRef<typeof scope | null>(null);
  const pending = useRef(false);
  const mutationVersion = useRef(0);
  const viewed = useRef<string | undefined>(undefined);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [busy, setBusy] = useState(false);
  useLayoutEffect(() => {
    live.current = active ? scope : null;
    return () => {
      live.current = null;
    };
  }, [scope, active]);
  useEffect(() => {
    if (!active || !ipId || viewed.current === ipId) return;
    viewed.current = ipId;
    const version = mutationVersion.current;
    let alive = true;
    void recordIpView(ipId, { source: "mobile_detail" })
      .then((value) => {
        if (!alive || live.current !== scope || version !== mutationVersion.current) return;
        apply(ipId, value);
        if (value) invalidateBrowse();
      })
      .catch(() => {
        /* Analytics must not block browsing. */
      });
    return () => {
      alive = false;
    };
  }, [active, ipId, scope, apply]);

  const toggle = async () => {
    if (!ip || !active || live.current !== scope || pending.current) return;
    if (auth.status !== "authenticated") {
      // Like Web, return to the same detail after login with a fresh viewer state.
      // Never replay the guest's toggle against the newly authenticated account.
      gate.requireAuth();
      return;
    }
    if (getAuthGeneration() !== scope.generation) return;
    pending.current = true;
    mutationVersion.current++;
    setBusy(true);
    const current = () => live.current === scope && getAuthGeneration() === scope.generation;
    try {
      const value = ip.viewerHasLiked ? await unlikeIp(ip.id) : await likeIp(ip.id);
      invalidateBrowse();
      if (current()) {
        if (value) apply(ip.id, value);
        else await refresh();
      } else if (live.current?.ipId === ip.id && getAuthGeneration() === scope.generation) {
        // The viewer returned before the old request completed: re-read instead
        // of applying a response captured before the return's detail snapshot.
        await refresh();
      }
    } catch (error) {
      if (current()) {
        if (error instanceof ApiRequestError && error.status === 401) gate.openLogin();
        else onError(error);
      } else if (live.current?.ipId === ip.id && getAuthGeneration() === scope.generation) {
        await refresh();
      }
    } finally {
      pending.current = false;
      if (mounted.current && getAuthGeneration() === scope.generation) setBusy(false);
    }
  };
  return { busy, toggle };
}
