/**
 * Cancel a workflow run when the user leaves the page.
 *
 * Strategy: listen for `pagehide` and fire `navigator.sendBeacon` to
 * the `/cancel-on-leave` endpoint. sendBeacon is the only browser API
 * that reliably dispatches a request during page unload — fetch with
 * `keepalive` works most of the time but not when the browser is
 * already tearing the document down (mobile Safari especially).
 *
 * Pairs with the heartbeat reaper:
 *   - sendBeacon = best-effort fast cancel (slot freed immediately)
 *   - reaper     = backstop for cases sendBeacon doesn't fire
 *                  (browser crash, OS forced kill, network drop)
 *
 * Why `pagehide` and not `beforeunload`:
 *   - `beforeunload` is unreliable on mobile (iOS Safari ignores it
 *     when navigating to a new page; some browsers fire it only when
 *     a confirm-dialog handler is present)
 *   - `pagehide` fires consistently across all platforms and covers
 *     bfcache transitions (back/forward navigation) which
 *     `beforeunload` misses
 *
 * No-op when:
 *   - runId / projectId missing
 *   - SSR (no `window`)
 *   - sendBeacon unavailable (very old browsers — fallback would be
 *     fetch with keepalive, but those browsers also predate keepalive
 *     so we just accept the slot will be reaped via heartbeat)
 */
"use client";

import { useEffect } from "react";
import { cancelWorkflowOnLeave } from "@/src/lib/workflow/workflow-client";

export function useWorkflowCancelOnLeave(
  runIds: string[],
  projectId: string | null | undefined
): void {
  // Same stable-key trick as useWorkflowHeartbeat: avoid effect rebuild
  // on every render when the set is unchanged.
  const depKey = [...runIds].sort().join(",");
  useEffect(() => {
    if (!projectId || runIds.length === 0) return;
    if (typeof window === "undefined") return;

    const onPageHide = (): void => {
      // Fan out one beacon per runId. sendBeacon is fire-and-forget so
      // there's no useful aggregation to do — the browser will queue
      // them all on its way out.
      for (const runId of runIds) {
        cancelWorkflowOnLeave(runId, projectId);
      }
    };

    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depKey, projectId]);
}
