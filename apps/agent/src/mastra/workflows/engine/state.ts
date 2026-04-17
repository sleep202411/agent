/**
 * Redis-backed workflow meta + event log.
 *
 * This is our side's audit layer. It's separate from Mastra's workflow
 * snapshot (which stores the full execution state in `mastra.storage`).
 *
 * Meta is a JSON string at `workflow:run:{runId}:state` that drives the
 * status API, task card UI, and workflow listings. Events append to a
 * Redis Stream at `workflow:run:{runId}:events` for replay and debugging.
 */
import { getRedis } from "../../lib/redis-client";
import { K, TTL } from "../../lib/redis-keys";
import type { WorkflowEvent, WorkflowEventType, WorkflowMeta, WorkflowStatus } from "./types";

export async function putMeta(meta: WorkflowMeta): Promise<void> {
  const redis = getRedis();
  const key = K.workflowState(meta.runId);
  const value = JSON.stringify({ ...meta, updatedAt: Date.now() });
  const tx = redis.multi().set(key, value, "EX", TTL.WORKFLOW);

  // Maintain sorted-set indexes for listing by user / workspace,
  // ordered by startedAt. Stored score is the start timestamp.
  tx.zadd(K.workflowRunsByUser(meta.userId), meta.startedAt, meta.runId);
  tx.expire(K.workflowRunsByUser(meta.userId), TTL.WORKFLOW);

  tx.zadd(K.workflowRunsByWorkspace(meta.workspaceId), meta.startedAt, meta.runId);
  tx.expire(K.workflowRunsByWorkspace(meta.workspaceId), TTL.WORKFLOW);

  await tx.exec();
}

export async function getMeta(runId: string): Promise<WorkflowMeta | null> {
  const redis = getRedis();
  const raw = await redis.get(K.workflowState(runId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as WorkflowMeta;
  } catch {
    return null;
  }
}

export async function patchMeta(
  runId: string,
  patch: Partial<WorkflowMeta>
): Promise<WorkflowMeta | null> {
  const existing = await getMeta(runId);
  if (!existing) return null;
  const merged: WorkflowMeta = { ...existing, ...patch, runId: existing.runId };
  await putMeta(merged);
  return merged;
}

export async function setStatus(
  runId: string,
  status: WorkflowStatus,
  extras: Partial<WorkflowMeta> = {}
): Promise<WorkflowMeta | null> {
  const now = Date.now();
  const completed =
    status === "completed" || status === "failed" || status === "cancelled"
      ? { completedAt: now }
      : {};
  return patchMeta(runId, { status, ...completed, ...extras });
}

// ─── Event log (Redis Stream) ──────────────────────────────────────────

/**
 * Append one event to the run's stream. Keeps the stream capped at a sane
 * length so a runaway workflow doesn't bloat Redis.
 */
export async function appendEvent(
  runId: string,
  type: WorkflowEventType,
  data?: unknown
): Promise<void> {
  const redis = getRedis();
  const key = K.workflowEvents(runId);
  await redis
    .multi()
    .xadd(
      key,
      "MAXLEN",
      "~",
      "2000",
      "*",
      "type",
      type,
      "timestamp",
      String(Date.now()),
      "data",
      data === undefined ? "" : JSON.stringify(data)
    )
    .expire(key, TTL.WORKFLOW)
    .exec();
}

export async function readEvents(
  runId: string,
  opts: { limit?: number; fromId?: string } = {}
): Promise<WorkflowEvent[]> {
  const redis = getRedis();
  const count = opts.limit ?? 100;
  const start = opts.fromId ?? "-";
  // XRANGE returns oldest→newest; we want that order for task card timelines.
  const entries = (await redis.xrange(
    K.workflowEvents(runId),
    start,
    "+",
    "COUNT",
    count
  )) as Array<[string, string[]]>;
  return entries.map(([id, fields]) => {
    const kv: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) kv[fields[i]] = fields[i + 1];
    let data: unknown = undefined;
    if (kv.data) {
      try {
        data = JSON.parse(kv.data);
      } catch {
        data = kv.data;
      }
    }
    return {
      id,
      runId,
      timestamp: Number(kv.timestamp ?? 0),
      type: (kv.type as WorkflowEventType) ?? "started",
      data,
    };
  });
}

// ─── Cancel flag ────────────────────────────────────────────────────────

/** Call from HTTP handler to request cancellation. Worker picks up via isCancelled(). */
export async function requestCancel(runId: string): Promise<void> {
  const redis = getRedis();
  await redis.set(K.workflowCancel(runId), "1", "EX", TTL.WORKFLOW);
}

export async function isCancelled(runId: string): Promise<boolean> {
  const redis = getRedis();
  const v = await redis.get(K.workflowCancel(runId));
  return v === "1";
}

export async function clearCancel(runId: string): Promise<void> {
  const redis = getRedis();
  await redis.del(K.workflowCancel(runId));
}

// ─── Listing (for UI "active workflows" / explain_current_state) ────────

export async function listWorkflowsByUser(
  userId: string,
  opts: { limit?: number } = {}
): Promise<WorkflowMeta[]> {
  const redis = getRedis();
  const limit = opts.limit ?? 20;
  // ZREVRANGEBYSCORE: newest first
  const ids = await redis.zrevrangebyscore(
    K.workflowRunsByUser(userId),
    "+inf",
    "-inf",
    "LIMIT",
    0,
    limit
  );
  const metas: WorkflowMeta[] = [];
  for (const id of ids) {
    const m = await getMeta(id);
    if (m) metas.push(m);
  }
  return metas;
}

export async function listWorkflowsByWorkspace(
  workspaceId: string,
  opts: { limit?: number } = {}
): Promise<WorkflowMeta[]> {
  const redis = getRedis();
  const limit = opts.limit ?? 20;
  const ids = await redis.zrevrangebyscore(
    K.workflowRunsByWorkspace(workspaceId),
    "+inf",
    "-inf",
    "LIMIT",
    0,
    limit
  );
  const metas: WorkflowMeta[] = [];
  for (const id of ids) {
    const m = await getMeta(id);
    if (m) metas.push(m);
  }
  return metas;
}
