/**
 * Workflow liveness heartbeat — pings the agent every ~10s while the
 * chat is open and the active workflow run is non-terminal, so the
 * agent's reaper knows the user is still watching. If the user closes
 * the tab (or the network drops past the grace window), heartbeats
 * stop and the reaper cancels the run, releasing the worker slot for
 * the next person.
 *
 * Lifecycle decisions:
 *   - Only ticks while `runId` is set AND `document.visibilityState`
 *     is "visible". Hidden tabs (background tabs, locked screen) are
 *     treated as "user not watching" — beat stops and the reaper
 *     reclaims the slot. The 30s grace window is plenty for users to
 *     re-focus the tab without losing their run.
 *   - On reconnect (visibility flips back to "visible"), fires an
 *     immediate beat so the run isn't a tick away from being reaped.
 *   - Cleanup on unmount / runId change clears the interval; the
 *     next mount restarts it.
 *
 * No retry / dedupe — the network call is itself idempotent
 * (lastHeartbeatAt is just a max-of-now), so a missed tick simply
 * shifts the reap deadline by 10s and the next tick will heal it.
 */
"use client";

import { useEffect } from "react";
import { heartbeatWorkflow } from "@/src/lib/workflow/workflow-client";

const HEARTBEAT_INTERVAL_MS = 10_000;

export function useWorkflowHeartbeat(
  runId: string | null | undefined,
  projectId: string | null | undefined
): void {
  useEffect(() => {
    if (!runId || !projectId) return;
    if (typeof document === "undefined") return;

    let timer: number | null = null;
    let cancelled = false;

    const fire = (): void => {
      if (cancelled) return;
      if (document.visibilityState !== "visible") return;
      void heartbeatWorkflow(runId, projectId);
    };

    const start = (): void => {
      if (timer != null) return;
      // Send one immediately so the agent records us as active without
      // waiting a full interval after mount / re-focus.
      fire();
      timer = window.setInterval(fire, HEARTBEAT_INTERVAL_MS);
    };

    const stop = (): void => {
      if (timer != null) {
        window.clearInterval(timer);
        timer = null;
      }
    };

    const onVisibilityChange = (): void => {
      if (document.visibilityState === "visible") {
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stop();
    };
  }, [runId, projectId]);
}
