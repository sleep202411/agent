"use client";

/**
 * React hook: poll /aurora/assets/image-status for a project.
 *
 * Polling cadence:
 *   - 3s while any tracked asset is `pending` or `generating`
 *   - Stops when all tracked assets are terminal (ready | failed_*)
 *   - Resumes immediately on visibility change (tab back to focus)
 *   - Refetches on explicit refetch() call (after the user clicks retry)
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchAssetImageStatuses,
  isInFlight,
  type AssetImageStatusMap,
} from "./image-status-client";

const POLL_INTERVAL_MS = 3_000;

export interface UseAssetImageStatusesResult {
  statuses: AssetImageStatusMap;
  refetch: () => void;
  /** True while at least one asset is still pending/generating. */
  hasInFlight: boolean;
}

export function useAssetImageStatuses(
  projectId: string | null | undefined
): UseAssetImageStatusesResult {
  const [statuses, setStatuses] = useState<AssetImageStatusMap>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  const hasInFlight = Object.values(statuses).some((s) => isInFlight(s.status));

  const runFetch = useCallback(async () => {
    if (!projectId) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const next = await fetchAssetImageStatuses(projectId, controller.signal);
      if (!mountedRef.current || controller.signal.aborted) return;
      setStatuses(next);
    } catch {
      // transient — next poll will retry
    }
  }, [projectId]);

  // Initial fetch + polling driver.
  useEffect(() => {
    mountedRef.current = true;
    if (!projectId) {
      setStatuses({});
      return () => {
        mountedRef.current = false;
      };
    }
    void runFetch();
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [projectId, runFetch]);

  // Schedule the next poll only while something is in flight.
  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!hasInFlight) return;
    timerRef.current = setTimeout(() => {
      void runFetch();
    }, POLL_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [hasInFlight, statuses, runFetch]);

  // Visibility: when user returns to tab and something was in-flight,
  // immediately refresh to catch up.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibility = () => {
      if (!document.hidden && hasInFlight) void runFetch();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [hasInFlight, runFetch]);

  return {
    statuses,
    refetch: () => void runFetch(),
    hasInFlight,
  };
}
