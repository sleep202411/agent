/**
 * Stale-run reaper.
 *
 * Runs on an interval inside the worker process. Scans every BullMQ
 * job in `waiting` (queued) and `active` (currently running by a
 * worker) state; for each, looks up the corresponding workflow meta in
 * Redis and inspects `lastHeartbeatAt`. If the client hasn't pinged in
 * `HEARTBEAT_GRACE_MS`, we assume the user closed the page and cancel
 * the run so the worker slot frees up for the next person in line.
 *
 * Coupled with:
 *   - `recordHeartbeat` (called by the HTTP heartbeat endpoint that the
 *     web client pings every 10s while watching a run)
 *   - the cancel mechanism (`cancelWorkflow`) which sets the Redis
 *     cancel flag — the worker's `throwIfCancelled` then bubbles a
 *     `WorkflowCancelledError` at the next step boundary
 *
 * Failure modes the reaper deliberately tolerates:
 *   - Redis transient errors → log and skip this tick; next tick retries
 *   - getMeta returns null (TTL expiry race) → skip the run
 *   - cancelWorkflow throws (already terminal etc.) → log, continue with
 *     the rest of the candidates
 *
 * Tunables exposed via env (defaults match the design doc):
 *   STORYOS_REAPER_TICK_MS    — interval between scans (default 15_000)
 *   STORYOS_HEARTBEAT_GRACE_MS — staleness threshold (default 30_000)
 */
import { cancelWorkflow } from "./runner";
import { getMeta } from "./state";
import { getQueue } from "./queue";

const TICK_MS = Number(process.env.STORYOS_REAPER_TICK_MS ?? 15_000);
export const HEARTBEAT_GRACE_MS = Number(process.env.STORYOS_HEARTBEAT_GRACE_MS ?? 30_000);

let timer: NodeJS.Timeout | null = null;

export interface ReaperHandle {
  stop(): void;
}

/**
 * Boot the reaper. Idempotent — calling start a second time is a noop.
 * Returns a handle whose `stop()` cancels the interval (used by
 * worker.ts shutdown so we don't keep ticking after SIGTERM).
 */
export function startReaper(): ReaperHandle {
  if (timer) {
    return {
      stop: () => {
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
      },
    };
  }
  timer = setInterval(() => {
    void tickOnce().catch((err) => {
      // eslint-disable-next-line no-console
      console.warn(`[reaper] tick failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }, TICK_MS);
  // eslint-disable-next-line no-console
  console.log(`[reaper] started (tick=${TICK_MS}ms, heartbeatGrace=${HEARTBEAT_GRACE_MS}ms)`);
  return {
    stop: () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}

/**
 * One scan pass. Exported for testing — production callers use
 * `startReaper()` so the interval lifecycle is owned in one place.
 */
export async function tickOnce(now: number = Date.now()): Promise<void> {
  const queue = getQueue();
  // Both `waiting` (queued, no worker) and `active` (currently being
  // processed) need reaping: a queued run with no heartbeat means user
  // dispatched then walked away; an active run with no heartbeat means
  // user closed mid-execution and we should release the slot rather
  // than burn LLM tokens for a result no one will see.
  const jobs = await queue.getJobs(["waiting", "active"]);
  const cutoff = now - HEARTBEAT_GRACE_MS;

  for (const job of jobs) {
    const id = String(job.id ?? "");
    if (!id.startsWith("run-")) continue; // Skip resume jobs.
    const runId = id.slice("run-".length);
    const meta = await getMeta(runId);
    if (!meta) continue;
    if (meta.status !== "queued" && meta.status !== "running") continue;
    const last = meta.lastHeartbeatAt ?? meta.startedAt;
    if (last >= cutoff) continue;
    // Stale — cancel.
    try {
      await cancelWorkflow(runId);
      // eslint-disable-next-line no-console
      console.log(
        `[reaper] cancelled stale runId=${runId} workflow=${meta.workflowName} status=${meta.status} idleMs=${now - last}`
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[reaper] cancel failed for runId=${runId}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}
