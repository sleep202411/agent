/**
 * Cross-checks the runIds the chat-history-derived "Queued · N" pill is
 * showing against authoritative server-side status. If a runId already
 * landed in a terminal state on the server (failed / cancelled /
 * completed / unknown) but the matching `tool-workflow_*` chat message
 * never made it into Redux, the pill would otherwise stick at N
 * forever — this hook returns a Set of runIds the caller should treat
 * as STILL ALIVE so it can compute the displayed count by intersection.
 *
 * Polls every POLL_INTERVAL_MS while there's anything to check; idle
 * (empty input) tears the timer down so cold tabs don't wake the
 * server. Errors swallowed — a transient failure just leaves the
 * previous Set in place until the next tick succeeds.
 *
 * Why it's a separate hook from useWorkflowHeartbeat: heartbeat is a
 * one-shot per-run write call (records lastHeartbeatAt); status is a
 * batched read. Conflating them tangles cadences (heartbeat needs
 * 10s, status doesn't) and keeps the per-run idempotent semantics
 * heartbeat relies on.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { fetchWorkflowStatuses } from "@/src/lib/workflow/workflow-client";

const POLL_INTERVAL_MS = 30_000;

const TERMINAL = new Set<string>(["completed", "failed", "cancelled", "unknown"]);

export function useWorkflowLiveness(
  runIds: string[],
  projectId: string | null | undefined
): Set<string> {
  // Stable signature for the dep array.
  const depKey = [...runIds].sort().join(",");
  const [aliveSet, setAliveSet] = useState<Set<string>>(() => new Set(runIds));
  const aliveRef = useRef(aliveSet);
  aliveRef.current = aliveSet;

  useEffect(() => {
    if (!projectId || runIds.length === 0) {
      setAliveSet(new Set());
      return;
    }

    let cancelled = false;

    const tick = async (): Promise<void> => {
      if (cancelled) return;
      try {
        const statuses = await fetchWorkflowStatuses(runIds, projectId);
        if (cancelled) return;
        const next = new Set<string>();
        for (const runId of runIds) {
          const entry = statuses[runId];
          // No response for a runId → treat as alive for one more tick
          // (we'd rather hide a stale pill slowly than flicker the
          // count when the server briefly hiccups).
          if (!entry) {
            if (aliveRef.current.has(runId)) next.add(runId);
            continue;
          }
          if (!TERMINAL.has(entry.status)) next.add(runId);
        }
        // Only update when the membership actually changed — avoids a
        // re-render every poll when nothing's changed.
        const prev = aliveRef.current;
        if (next.size !== prev.size || [...next].some((r) => !prev.has(r))) {
          setAliveSet(next);
        }
      } catch {
        // Best-effort; next tick will retry.
      }
    };

    // Fire immediately so the pill reconciles right after mount.
    void tick();
    const timer = window.setInterval(() => {
      void tick();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depKey, projectId]);

  return aliveSet;
}
