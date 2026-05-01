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

/**
 * Pings the agent's `/workflow/:runId/heartbeat` for every non-terminal
 * run the user is presently watching, so the reaper knows they're still
 * around. Accepts an array — when the user has multiple queued runs (the
 * pill says "排隊中 · N"), every one of them needs liveness, not just
 * the latest. Without that, all but the most-recently-mounted card got
 * reaped after 30s and the user's pill silently dropped to 0.
 *
 * The dep on `runIds.join(',')` keeps the effect from teardown-and-rebuild
 * on every render — only when the actual set of live runs changes.
 */
export function useWorkflowHeartbeat(runIds: string[], projectId: string | null | undefined): void {
  // Stable signature for the dep array: order doesn't affect liveness, so
  // sort before joining to avoid spurious teardown when callers pass the
  // same set in a different order.
  const depKey = [...runIds].sort().join(",");
  useEffect(() => {
    if (!projectId || runIds.length === 0) return;
    if (typeof document === "undefined") return;

    let timer: number | null = null;
    let cancelled = false;

    const fire = (): void => {
      if (cancelled) return;
      if (document.visibilityState !== "visible") return;
      // Best-effort fan-out: each request is idempotent (lastHeartbeatAt
      // = max(now, prev)), so a partial failure just delays one run's
      // grace deadline by 10s — the next tick covers it.
      for (const runId of runIds) {
        void heartbeatWorkflow(runId, projectId);
      }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depKey, projectId]);
}
