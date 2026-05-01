/**
 * Queue position computation against the shared BullMQ workflow queue.
 *
 * Position is global FIFO across all workflow types — the worker pool's
 * concurrency=4 is also shared across types, so global FIFO is the
 * natural fairness unit. If we ever introduce per-workflow priority
 * (e.g. paid users' jobs jump the line), promote this to a multi-queue
 * design instead of biasing position math.
 *
 * Position is **0-indexed**: 0 = next to run; >0 = N runs ahead.
 *
 * `getWaiting()` returns active+delayed jobs in arrival order. We walk
 * once, find own jobId, return its index. O(N) where N is queue depth;
 * BullMQ caps default depth far below the cost of this scan.
 */
import { getQueue } from "./queue";

/**
 * Resolve a run's queue position. Returns:
 *   - `0..N-1` — 0-indexed position in waiting list
 *   - `null`   — runId not in waiting (already running, completed, or unknown)
 */
export async function getQueuePosition(runId: string): Promise<number | null> {
  const targetJobId = `run-${runId}`;
  const queue = getQueue();
  const waiting = await queue.getWaiting();
  for (let i = 0; i < waiting.length; i++) {
    if (waiting[i].id === targetJobId) return i;
  }
  return null;
}

/**
 * Snapshot of every waiting run's `runId` + `workflowName` + `projectId` +
 * `position`. Used by `broadcastQueuePositions()` (in workflow-messages)
 * to fan out `workflow_queued` events whenever the queue advances.
 *
 * `projectId` is pulled directly from the BullMQ job's `ctx` payload so
 * the broadcaster doesn't need to round-trip through Redis meta to
 * resolve which chat to publish into.
 *
 * Listed in arrival order (= position 0..N-1).
 */
export interface QueuedRunSnapshot {
  runId: string;
  workflowName: string;
  projectId: string;
  position: number;
}

export async function snapshotWaitingRuns(): Promise<QueuedRunSnapshot[]> {
  const queue = getQueue();
  const waiting = await queue.getWaiting();
  const out: QueuedRunSnapshot[] = [];
  for (let i = 0; i < waiting.length; i++) {
    const job = waiting[i];
    // jobId convention: "run-<uuid>" for fresh runs, "resume-<uuid>-<ts>"
    // for resumes. Resume jobs are the worker re-entering after HITL —
    // they're not "queued waiting for first slot", they're awaiting
    // confirmation, so we exclude them from the position broadcast.
    const id = String(job.id ?? "");
    if (!id.startsWith("run-")) continue;
    const runId = id.slice("run-".length);
    const data = job.data as { workflowName?: string; ctx?: { projectId?: string } } | undefined;
    const workflowName = data?.workflowName ?? "";
    const projectId = data?.ctx?.projectId ?? "";
    if (!workflowName || !projectId) continue;
    out.push({ runId, workflowName, projectId, position: out.length });
  }
  return out;
}
