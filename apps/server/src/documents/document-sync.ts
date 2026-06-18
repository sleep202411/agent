/**
 * Reconnect/sync window resolution against the compaction horizon.
 *
 * A (re)connecting client asks to resume from `afterSequence` (its last acked
 * operation). The server holds a compacted `crdtState` covering operations up to
 * `snapshotSequence` (the horizon), plus the op rows after it.
 *
 *   • afterSequence >= snapshotSequence — the client is at/ahead of the horizon
 *     and can replay incrementally: send operations after `afterSequence`.
 *   • afterSequence <  snapshotSequence — the client is BEHIND the horizon (it
 *     was offline across a compaction, or the older op rows were pruned). The
 *     operations it asks for may no longer exist as a replayable tail, so it must
 *     rebuild from `crdtState` (which subsumes everything ≤ snapshotSequence) and
 *     then replay operations after the horizon. `resyncRequired` signals this.
 *
 * This is the safety guarantee that makes op-row pruning sound: any client that
 * falls behind the horizon is deterministically rehydrated from crdtState rather
 * than from op rows that may have been pruned.
 */
export interface SyncWindow {
  /** Replay operations with sequence strictly greater than this. */
  fromSequence: number;
  /** The client must rebuild from crdtState before applying the operations. */
  resyncRequired: boolean;
}

export function resolveSyncWindow(
  afterSequence: number,
  snapshotSequence: number,
): SyncWindow {
  const safeAfter = normalizeSequence(afterSequence);
  const safeSnapshot = normalizeSequence(snapshotSequence);
  return {
    fromSequence: Math.max(safeAfter, safeSnapshot),
    resyncRequired: safeAfter < safeSnapshot,
  };
}

function normalizeSequence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}
