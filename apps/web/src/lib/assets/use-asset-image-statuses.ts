"use client";

/** Poll active image jobs, retry transient reads and discard abandoned scopes. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCurrentUser } from "@/src/hooks/use-user";
import {
  fetchAssetImageStatuses,
  isInFlight,
  type AssetImageStatusMap,
} from "./image-status-client";

const POLL_INTERVAL_MS = 3_000;
const EMPTY_STATUSES: AssetImageStatusMap = {};

export interface UseAssetImageStatusesResult {
  statuses: AssetImageStatusMap;
  refetch: () => void;
  /** True while at least one asset is still pending/generating. */
  hasInFlight: boolean;
}

export function useAssetImageStatuses(
  projectId: string | null | undefined
): UseAssetImageStatusesResult {
  const { user } = useCurrentUser();
  const userId = user?.id;
  const scope = useMemo(() => ({ projectId, userId }), [projectId, userId]);
  const [snapshot, setSnapshot] = useState<{
    scope: typeof scope;
    statuses: AssetImageStatusMap;
  } | null>(null);
  const refresh = useRef<{ scope: typeof scope; run: () => void } | null>(null);
  const statuses = snapshot?.scope === scope ? snapshot.statuses : EMPTY_STATUSES;

  useEffect(() => {
    if (!scope.projectId || !scope.userId) return;
    const currentProject = scope.projectId;
    let disposed = false;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let needsPoll = true;

    async function run() {
      if (disposed) return;
      if (timer) clearTimeout(timer);
      timer = null;
      controller?.abort();
      const request = new AbortController();
      controller = request;
      try {
        const next = await fetchAssetImageStatuses(currentProject, request.signal);
        if (disposed || request.signal.aborted) return;
        needsPoll = Object.values(next).some((entry) => isInFlight(entry.status));
        setSnapshot({ scope, statuses: next });
      } catch {
        if (!disposed && !request.signal.aborted) needsPoll = true;
      } finally {
        // A replaced request must never schedule another timer for this scope.
        if (!disposed && controller === request && needsPoll) {
          timer = setTimeout(() => void run(), POLL_INTERVAL_MS);
        }
      }
    }
    const ownedRefresh = { scope, run: () => void run() };
    refresh.current = ownedRefresh;
    void run();
    const onVisibility = () => {
      if (!document.hidden && needsPoll) void run();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      controller?.abort();
      if (timer) clearTimeout(timer);
      if (refresh.current === ownedRefresh) refresh.current = null;
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [scope]);

  const refetch = useCallback(() => {
    if (refresh.current?.scope === scope) refresh.current.run();
  }, [scope]);

  return {
    statuses,
    refetch,
    hasInFlight: Object.values(statuses).some((entry) => isInFlight(entry.status)),
  };
}
