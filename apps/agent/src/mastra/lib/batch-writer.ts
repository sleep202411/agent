import type { StoryosContext } from "./workspace-client";
import { K, TTL, type EntityType } from "./redis-keys";
import { getRedis } from "./redis-client";

/**
 * Caller provides a stable `clientRefId` (UUID) that identifies this draft for
 * its entire lifetime. Same `clientRefId` submitted again → we skip the Java
 * call and return the cached serverId. The idempotency store is entirely on
 * our side (Redis); Java has no knowledge of `clientRefId`.
 */
export type BatchItem<TData> = {
  clientRefId: string;
  data: TData;
};

export type BatchResultStatus =
  /** Freshly created in Java (first time we saw this clientRefId) */
  | "created"
  /** Java already has this clientRefId mapped; returned cached id without calling Java */
  | "unchanged"
  /** Java call failed (or something else threw) */
  | "failed";

export type BatchResult = {
  clientRefId: string;
  serverId?: string;
  status: BatchResultStatus;
  error?: string;
};

export type BatchWriterOptions = {
  /**
   * Maximum concurrent Java calls. Default 1 (strict sequential) to avoid
   * overwhelming the Java backend. Raise cautiously after measuring.
   */
  concurrency?: number;
};

/**
 * Runs `creator(ctx, data)` for each item that hasn't been written yet,
 * caches the Java-assigned serverId under `idem:{workspaceId}:{entity}:{clientRefId}`,
 * and returns a per-item BatchResult.
 *
 * Phase 2a: caller passes a `creator` that invokes a single Java create endpoint.
 * Phase 2b: caller swaps in a creator that talks to a real Java batch endpoint;
 *           this function's signature does not change and the cache semantics still apply.
 */
export async function batchUpsert<TData>(params: {
  ctx: StoryosContext;
  entityType: EntityType;
  items: BatchItem<TData>[];
  /** Must return the Java-assigned id on success; throws on failure. */
  creator: (ctx: StoryosContext, data: TData) => Promise<string>;
  opts?: BatchWriterOptions;
}): Promise<BatchResult[]> {
  const { ctx, entityType, items, creator } = params;
  const concurrency = Math.max(1, params.opts?.concurrency ?? 1);

  if (items.length === 0) return [];

  // Preserve request order in the result array regardless of execution order.
  const results: BatchResult[] = new Array(items.length);

  // Tiny promise-pool so we don't pull in p-limit / p-map for 20 lines.
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await processOne(ctx, entityType, items[i], creator);
    }
  });
  await Promise.all(workers);

  return results;
}

async function processOne<TData>(
  ctx: StoryosContext,
  entityType: EntityType,
  item: BatchItem<TData>,
  creator: (ctx: StoryosContext, data: TData) => Promise<string>
): Promise<BatchResult> {
  const redis = getRedis();
  const idemKey = K.idem(ctx.projectId, entityType, item.clientRefId);

  // 1. Idempotency cache — if we've already written this clientRefId, skip Java.
  const cached = await redis.get(idemKey);
  if (cached) {
    return {
      clientRefId: item.clientRefId,
      serverId: cached,
      status: "unchanged",
    };
  }

  // 2. Cache miss — call Java.
  let serverId: string;
  try {
    serverId = await creator(ctx, item.data);
  } catch (err) {
    return {
      clientRefId: item.clientRefId,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // 3. Record mapping. Best-effort: a Redis write failure here means we'd
  // call Java again on retry (creating a duplicate), which is the failure
  // mode AOF is supposed to protect against. We still return success so
  // the caller sees the Java-assigned id and can persist it to the draft.
  await redis.set(idemKey, serverId, "EX", TTL.IDEM).catch(() => {
    /* logged by redis client; intentional swallow here */
  });

  return {
    clientRefId: item.clientRefId,
    serverId,
    status: "created",
  };
}

/**
 * Aggregate stats across a BatchResult[] so callers can decide whether the
 * commit as a whole succeeded or partially failed.
 */
export function summarizeBatch(results: BatchResult[]): {
  total: number;
  created: number;
  unchanged: number;
  failed: number;
  firstError?: string;
} {
  let created = 0;
  let unchanged = 0;
  let failed = 0;
  let firstError: string | undefined;
  for (const r of results) {
    if (r.status === "created") created++;
    else if (r.status === "unchanged") unchanged++;
    else if (r.status === "failed") {
      failed++;
      if (!firstError) firstError = r.error;
    }
  }
  return { total: results.length, created, unchanged, failed, firstError };
}
