/**
 * Draft store — AI-generated entities awaiting user confirmation.
 *
 * Drafts live in Redis under `draft:{runId}:{entityType}:{clientRefId}`.
 * A companion Hash at `draft:{runId}:index` maps clientRefId → entityType so
 * we can list without SCAN.
 *
 * The confirm flow:
 *   1. Workflow step calls `putDraft()` for each generated entity.
 *   2. Workflow suspends with `suspend()` (HITL step).
 *   3. Frontend loads drafts via `listDrafts(runId)` and renders preview.
 *   4. User clicks approve → HTTP /confirm → commit via BatchWriter → `markDraftCommitted()`.
 *   5. After workflow resumes and completes, drafts can be purged via `deleteAllDrafts()`.
 *
 * Draft status lifecycle:
 *   pending → committing → committed     (happy path)
 *   pending → failed                      (Java write failed, user can retry)
 *   pending → discarded                   (user rejected; workflow loops to revise)
 */
import { getRedis } from "./redis-client";
import { K, TTL, type EntityType } from "./redis-keys";

export type DraftStatus = "pending" | "committing" | "committed" | "failed" | "discarded";

export type Draft<T = unknown> = {
  clientRefId: string;
  runId: string;
  entityType: EntityType;
  status: DraftStatus;
  data: T;
  /** Java id, populated once committed. */
  serverId?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
  updatedBy?: string; // 'ai' | userId
};

// ─── Writes ────────────────────────────────────────────────────────────

export async function putDraft<T>(
  runId: string,
  entityType: EntityType,
  clientRefId: string,
  data: T,
  opts: { updatedBy?: string } = {}
): Promise<Draft<T>> {
  const now = Date.now();
  const draft: Draft<T> = {
    clientRefId,
    runId,
    entityType,
    status: "pending",
    data,
    createdAt: now,
    updatedAt: now,
    updatedBy: opts.updatedBy ?? "ai",
  };
  const redis = getRedis();
  await redis
    .multi()
    .set(K.draft(runId, entityType, clientRefId), JSON.stringify(draft), "EX", TTL.DRAFT)
    .hset(K.draftIndex(runId), clientRefId, entityType)
    .expire(K.draftIndex(runId), TTL.DRAFT)
    .exec();
  return draft;
}

export async function patchDraft<T>(
  runId: string,
  clientRefId: string,
  patch: Partial<Draft<T>>
): Promise<Draft<T> | null> {
  const redis = getRedis();
  const entityType = await redis.hget(K.draftIndex(runId), clientRefId);
  if (!entityType) return null;
  const raw = await redis.get(K.draft(runId, entityType as EntityType, clientRefId));
  if (!raw) return null;
  const existing = JSON.parse(raw) as Draft<T>;
  const merged: Draft<T> = {
    ...existing,
    ...patch,
    runId: existing.runId,
    clientRefId: existing.clientRefId,
    entityType: existing.entityType,
    updatedAt: Date.now(),
  };
  await redis.set(
    K.draft(runId, existing.entityType, clientRefId),
    JSON.stringify(merged),
    "EX",
    TTL.DRAFT
  );
  return merged;
}

export async function markDraftCommitting(
  runId: string,
  clientRefId: string
): Promise<Draft | null> {
  return patchDraft(runId, clientRefId, { status: "committing" });
}

export async function markDraftCommitted(
  runId: string,
  clientRefId: string,
  serverId: string
): Promise<Draft | null> {
  return patchDraft(runId, clientRefId, { status: "committed", serverId });
}

export async function markDraftFailed(
  runId: string,
  clientRefId: string,
  error: string
): Promise<Draft | null> {
  return patchDraft(runId, clientRefId, { status: "failed", error });
}

export async function markDraftDiscarded(
  runId: string,
  clientRefId: string
): Promise<Draft | null> {
  return patchDraft(runId, clientRefId, { status: "discarded" });
}

// ─── Reads ─────────────────────────────────────────────────────────────

export async function getDraft<T = unknown>(
  runId: string,
  clientRefId: string
): Promise<Draft<T> | null> {
  const redis = getRedis();
  const entityType = await redis.hget(K.draftIndex(runId), clientRefId);
  if (!entityType) return null;
  const raw = await redis.get(K.draft(runId, entityType as EntityType, clientRefId));
  return raw ? (JSON.parse(raw) as Draft<T>) : null;
}

export async function listDrafts<T = unknown>(
  runId: string,
  opts: { entityType?: EntityType; statuses?: DraftStatus[] } = {}
): Promise<Draft<T>[]> {
  const redis = getRedis();
  const index = await redis.hgetall(K.draftIndex(runId));
  const entries = Object.entries(index);
  if (entries.length === 0) return [];

  // Batch the reads into one MGET so we don't N+1 on large runs.
  const filtered = opts.entityType ? entries.filter(([, t]) => t === opts.entityType) : entries;
  if (filtered.length === 0) return [];

  const keys = filtered.map(([clientRefId, entityType]) =>
    K.draft(runId, entityType as EntityType, clientRefId)
  );
  const values = await redis.mget(...keys);
  const drafts: Draft<T>[] = [];
  for (const v of values) {
    if (!v) continue;
    const d = JSON.parse(v) as Draft<T>;
    if (opts.statuses && !opts.statuses.includes(d.status)) continue;
    drafts.push(d);
  }
  // Stable order by createdAt ascending — matches the order the workflow emitted them.
  drafts.sort((a, b) => a.createdAt - b.createdAt);
  return drafts;
}

export async function countDrafts(
  runId: string,
  opts: { entityType?: EntityType } = {}
): Promise<number> {
  const redis = getRedis();
  if (!opts.entityType) {
    return redis.hlen(K.draftIndex(runId));
  }
  const index = await redis.hgetall(K.draftIndex(runId));
  return Object.values(index).filter((t) => t === opts.entityType).length;
}

// ─── Deletes ───────────────────────────────────────────────────────────

export async function deleteDraft(runId: string, clientRefId: string): Promise<void> {
  const redis = getRedis();
  const entityType = await redis.hget(K.draftIndex(runId), clientRefId);
  if (!entityType) return;
  await redis
    .multi()
    .del(K.draft(runId, entityType as EntityType, clientRefId))
    .hdel(K.draftIndex(runId), clientRefId)
    .exec();
}

/**
 * Purge every draft for a run. Called after a successful commit gate closes
 * and the workflow has resumed — drafts have served their purpose.
 */
export async function deleteAllDrafts(runId: string): Promise<void> {
  const redis = getRedis();
  const index = await redis.hgetall(K.draftIndex(runId));
  const entries = Object.entries(index);
  if (entries.length === 0) {
    await redis.del(K.draftIndex(runId));
    return;
  }
  const tx = redis.multi();
  for (const [clientRefId, entityType] of entries) {
    tx.del(K.draft(runId, entityType as EntityType, clientRefId));
  }
  tx.del(K.draftIndex(runId));
  await tx.exec();
}
