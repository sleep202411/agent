/**
 * Workflow liveness heartbeat — pings the agent every ~10s while the
 * chat is open and the active workflow run is non-terminal, so the
 * agent's reaper knows the user is still watching. If the user closes
 * the tab (or the network drops past the grace window), heartbeats
 * stop and the reaper cancels the run, releasing the worker slot for
 * the next person.
 *
 * Lifecycle decisions:
 *   - Ticks every HEARTBEAT_INTERVAL_MS regardless of tab visibility.
 *     We previously only ticked when `document.visibilityState` was
 *     "visible", treating hidden tabs as "user walked away". That broke
 *     the very common multi-tab pattern: same user, two tabs, two
 *     different projects, one runs role_phase / parse_script for 5-10
 *     min while the user works on the other. Switching to the other
 *     tab silenced heartbeats → reaper killed the run 30s later.
 *     Confirmed 2026-05-02 from prod-com worker logs (6 runs reaped at
 *     idleMs ≈ 30-43s right after a user multi-tabbed).
 *   - "Genuine user gone" cases still terminate naturally because the
 *     JS execution context disappears: tab closed → `pagehide` +
 *     `useWorkflowCancelOnLeave` sendBeacon; browser killed / OS
 *     suspended / power-off → process dies, interval stops, reaper
 *     reaps within grace. The visibility check was protecting against
 *     a scenario that doesn't actually happen — alive-tab-but-user-
 *     gone is bounded by browser auto-throttling within minutes.
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

    let cancelled = false;

    const fire = (): void => {
      if (cancelled) return;
      // Best-effort fan-out: each request is idempotent (lastHeartbeatAt
      // = max(now, prev)), so a partial failure just delays one run's
      // grace deadline by 10s — the next tick covers it.
      for (const runId of runIds) {
        void heartbeatWorkflow(runId, projectId);
      }
    };

    // Send one immediately so the agent records us as active without
    // waiting a full interval after mount.
    fire();
    const timer =
      typeof window !== "undefined" ? window.setInterval(fire, HEARTBEAT_INTERVAL_MS) : null;

    return () => {
      cancelled = true;
      if (timer != null && typeof window !== "undefined") window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depKey, projectId]);
}
