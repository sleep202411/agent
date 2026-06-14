import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';
import { DocumentAutosaveService } from './document-autosave.service';
import { DocumentStateBuilder } from './document-crdt';
import { rootSchemaFor } from './document-modes';

/**
 * DocumentCompactionService — the **sole writer** of `crdtState` and the
 * derived `contentSnapshot` for CRDT (yjs_update) documents.
 *
 * Why this exists
 * ---------------
 * The op hot path (DocumentsService.appendOperation) durably appends each Yjs
 * update to the immutable op log and advances `currentSequence`, but does NOT
 * touch `crdtState`/`contentSnapshot`. Folding the op stream into a compacted
 * binary state and a materialized JSON view is expensive and must not block the
 * acknowledgement of every keystroke. This service does that folding off the hot
 * path, debounced and coalesced per document.
 *
 * It also fixes a prior correctness bug where `crdtState` was overwritten with a
 * single incremental update per op (so it never represented the merged document
 * and bootstrap/reconnect was broken). Compaction always rebuilds the FULL state
 * from `crdtState` (the base, covering ≤ snapshotSequence) plus every op after
 * snapshotSequence, so the stored state is always the true merge.
 *
 * Design properties
 * -----------------
 * • DB-authoritative — every run rebuilds from persisted rows, never from
 *   in-process memory, so it cannot drift and self-heals after restarts.
 * • Multi-pod safe WITHOUT sticky routing or leader election — the persist is a
 *   monotonic guarded update (`WHERE snapshot_sequence < target`), so concurrent
 *   compactors on different pods can only ever move snapshotSequence forward; a
 *   superseded run is a harmless no-op. (A future phase may add sticky-routed
 *   live docs for server-authored / AI co-editing; not needed to close the loop.)
 * • Memory bounded — folds the op tail in batches and caps ops per run, doing a
 *   partial compaction (and rescheduling) for very long tails.
 * • Crash safe — purely derived state; losing an in-flight compaction just means
 *   the next run (or the next op) redoes it.
 */
@Injectable()
export class DocumentCompactionService implements OnModuleDestroy {
  private readonly logger = new Logger(DocumentCompactionService.name);
  private readonly config: CompactionConfig = Object.freeze(loadConfig());
  private readonly entries = new Map<string, PendingEntry>();
  private destroyed = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly autosave: DocumentAutosaveService,
  ) {}

  /**
   * Request a debounced compaction for a CRDT document. Cheap and non-blocking —
   * safe to call from the op hot path after every yjs_update commit. Bursts
   * coalesce into a single run once the document goes quiet (`debounceMs`) or
   * after `maxIntervalMs` of sustained activity, whichever comes first.
   */
  schedule(documentId: string): void {
    if (this.destroyed) return;
    const entry = this.entries.get(documentId) ?? this.createEntry();
    this.entries.set(documentId, entry);
    entry.dirty = true;
    if (entry.running) return; // the in-flight run will pick the work up
    this.arm(documentId, entry);
  }

  /** Compact a document immediately and resolve once it is fully quiescent. */
  async flush(documentId: string): Promise<void> {
    const entry = this.entries.get(documentId);
    if (!entry) return;
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = undefined;
    }
    if (!entry.running) {
      entry.dirty = true;
      this.startRun(documentId, entry);
    }
    await entry.running?.catch(() => undefined);
  }

  /** Flush every document with pending work (used on graceful shutdown). */
  async flushAll(): Promise<void> {
    await Promise.all([...this.entries.keys()].map((id) => this.flush(id)));
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    for (const entry of this.entries.values()) {
      if (entry.timer) {
        clearTimeout(entry.timer);
        entry.timer = undefined;
      }
    }
    await this.flushAll();
  }

  private createEntry(): PendingEntry {
    return { timer: undefined, firstDirtyAt: 0, dirty: false, running: null };
  }

  private arm(documentId: string, entry: PendingEntry): void {
    if (entry.timer) clearTimeout(entry.timer);
    if (entry.firstDirtyAt === 0) entry.firstDirtyAt = Date.now();
    const now = Date.now();
    const hardCap = entry.firstDirtyAt + this.config.maxIntervalMs;
    const fireAt = Math.min(now + this.config.debounceMs, hardCap);
    entry.timer = setTimeout(
      () => {
        entry.timer = undefined;
        if (!entry.running) this.startRun(documentId, entry);
      },
      Math.max(0, fireAt - now),
    );
    // Never let a pending compaction keep the process alive on its own.
    entry.timer.unref?.();
  }

  private startRun(documentId: string, entry: PendingEntry): void {
    entry.running = this.runUntilClean(documentId, entry).finally(() => {
      entry.running = null;
      if (entry.dirty) {
        this.arm(documentId, entry);
      } else if (!entry.timer) {
        this.entries.delete(documentId); // keep the map bounded to active docs
      }
    });
  }

  private async runUntilClean(
    documentId: string,
    entry: PendingEntry,
  ): Promise<void> {
    let consecutiveErrors = 0;
    while (entry.dirty) {
      entry.dirty = false;
      entry.firstDirtyAt = 0;
      try {
        const morePending = await this.compactDocument(documentId);
        consecutiveErrors = 0;
        if (morePending) entry.dirty = true; // partial run — continue draining
      } catch (err) {
        consecutiveErrors += 1;
        this.logger.error(
          `compaction failed for document ${documentId} (attempt ${consecutiveErrors}): ${stringifyError(err)}`,
        );
        if (consecutiveErrors >= this.config.maxRetries) {
          this.logger.error(
            `giving up compaction for document ${documentId} after ${consecutiveErrors} attempts; will retry on the next operation`,
          );
          return; // leave dirty=false; a future schedule() re-arms a fresh run
        }
        entry.dirty = true;
        await delay(this.config.errorBackoffMs * consecutiveErrors);
      }
    }
  }

  /**
   * Rebuild and persist the compacted state for one document.
   * @returns true if a partial compaction was performed (op budget hit) and more
   *          work remains, so the caller should run again.
   */
  private async compactDocument(documentId: string): Promise<boolean> {
    const doc = await this.prisma.platformDocument.findUnique({
      where: { id: documentId },
      select: {
        type: true,
        crdtState: true,
        snapshotSequence: true,
        currentSequence: true,
        deletedAt: true,
      },
    });
    if (!doc || doc.deletedAt) return false;

    const schema = rootSchemaFor(doc.type);
    if (!schema) {
      // Not a CRDT-backed mode — should never be scheduled for compaction.
      // Skip rather than clobber the doc's snapshot with an empty materialize.
      this.logger.warn(
        `compaction skipped for document ${documentId}: mode "${doc.type}" is not CRDT-backed`,
      );
      return false;
    }

    const target = doc.currentSequence;
    if (target <= doc.snapshotSequence) return false; // already up to date

    const builder = new DocumentStateBuilder(
      doc.crdtState ? new Uint8Array(doc.crdtState) : null,
      schema,
    );
    try {
      let cursor = doc.snapshotSequence;
      let applied = 0;
      let exhausted = false;

      while (applied < this.config.maxOpsPerRun) {
        const take = Math.min(
          this.config.batchSize,
          this.config.maxOpsPerRun - applied,
        );
        const batch = await this.prisma.platformDocumentOperation.findMany({
          where: {
            documentId,
            sequence: { gt: cursor, lte: target },
            yjsUpdate: { not: null },
          },
          orderBy: { sequence: 'asc' },
          take,
          select: { sequence: true, yjsUpdate: true },
        });
        if (batch.length === 0) {
          exhausted = true;
          break;
        }
        for (const op of batch) {
          builder.apply(op.yjsUpdate ? new Uint8Array(op.yjsUpdate) : null);
          cursor = op.sequence;
          applied += 1;
        }
        if (batch.length < take) {
          exhausted = true;
          break;
        }
      }

      // If exhausted, the rebuilt state covers everything up to `target` (any
      // non-CRDT ops in the range contribute nothing). Otherwise we stopped at
      // the op budget and only cover up to the last applied sequence.
      const newSnapshotSequence = exhausted ? target : cursor;
      const merged = builder.finish();

      const result = await this.prisma.platformDocument.updateMany({
        where: {
          id: documentId,
          snapshotSequence: { lt: newSnapshotSequence },
        },
        data: {
          crdtState: Buffer.from(merged.state),
          contentSnapshot: merged.snapshot as unknown as Prisma.InputJsonValue,
          snapshotSequence: newSnapshotSequence,
          lastCompactedAt: new Date(),
        },
      });
      if (result.count === 0) {
        // A concurrent compactor (this pod or another) already advanced past us.
        this.logger.debug(
          `compaction for document ${documentId} superseded at sequence ${newSnapshotSequence}`,
        );
      } else if (exhausted) {
        // Fully compacted to target by this run (count > 0): stamp a gated
        // autosave checkpoint from the just-merged state, then prune the
        // subsumed op tail (keeping a replayable retention margin).
        await this.autosave.maybeStamp(documentId, merged, newSnapshotSequence);
        if (this.config.pruneEnabled) {
          await this.pruneOperations(documentId, newSnapshotSequence);
        }
      }

      return !exhausted; // partial run ⇒ more work remains
    } finally {
      builder.destroy();
    }
  }

  /** Delete op rows safely subsumed by crdtState, keeping a retention margin. */
  private async pruneOperations(
    documentId: string,
    snapshotSequence: number,
  ): Promise<void> {
    const pruneBelow = snapshotSequence - this.config.pruneRetention;
    if (pruneBelow <= 0) return;
    const deleted = await this.prisma.platformDocumentOperation.deleteMany({
      where: { documentId, sequence: { lte: pruneBelow } },
    });
    if (deleted.count > 0) {
      this.logger.debug(
        `pruned ${deleted.count} op rows ≤ ${pruneBelow} for document ${documentId}`,
      );
    }
  }
}

interface CompactionConfig {
  /** Quiet period after the last op before compacting. */
  debounceMs: number;
  /** Hard cap from first dirtying op, so sustained activity still compacts. */
  maxIntervalMs: number;
  /** Op rows read per DB query while folding the tail. */
  batchSize: number;
  /** Max ops folded in a single run; longer tails compact partially + reschedule. */
  maxOpsPerRun: number;
  /** Base backoff between failed runs (multiplied by attempt count). */
  errorBackoffMs: number;
  /** Consecutive failures before deferring to the next operation. */
  maxRetries: number;
  /**
   * Delete op rows fully subsumed by a compaction. OFF by default — enabling is
   * a deliberate ops decision once the client undo window is validated. Safe
   * because clients behind the horizon rehydrate from crdtState (see
   * resolveSyncWindow); the retention margin keeps a replayable recent tail.
   */
  pruneEnabled: boolean;
  /** Ops within this many sequences below the horizon are KEPT (not pruned). */
  pruneRetention: number;
}

interface PendingEntry {
  timer?: NodeJS.Timeout;
  firstDirtyAt: number;
  dirty: boolean;
  running: Promise<void> | null;
}

function loadConfig(): CompactionConfig {
  return {
    debounceMs: posIntEnv('DOCUMENT_COMPACTION_DEBOUNCE_MS', 1500),
    maxIntervalMs: posIntEnv('DOCUMENT_COMPACTION_MAX_INTERVAL_MS', 15_000),
    batchSize: posIntEnv('DOCUMENT_COMPACTION_BATCH_SIZE', 1_000),
    maxOpsPerRun: posIntEnv('DOCUMENT_COMPACTION_MAX_OPS_PER_RUN', 20_000),
    errorBackoffMs: posIntEnv('DOCUMENT_COMPACTION_ERROR_BACKOFF_MS', 1_000),
    maxRetries: posIntEnv('DOCUMENT_COMPACTION_MAX_RETRIES', 3),
    pruneEnabled: boolEnv('DOCUMENT_OP_PRUNE_ENABLED', false),
    pruneRetention: posIntEnv('DOCUMENT_OP_PRUNE_RETENTION', 10_000),
  };
}

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') return fallback;
  return raw.trim().toLowerCase() === 'true';
}

function posIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function stringifyError(err: unknown): string {
  return err instanceof Error ? (err.stack ?? err.message) : String(err);
}
