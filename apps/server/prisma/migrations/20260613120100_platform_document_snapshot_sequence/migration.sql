-- Warm-room CRDT compaction bookkeeping on platform_documents:
--   snapshot_sequence = the op sequence the compacted crdtState snapshot covers
--                       (new clients load crdtState, then replay ops > this).
--   last_compacted_at = when the warm-room last recompacted crdtState.
-- Additive + idempotent; safe online (defaults backfill existing rows to 0).
ALTER TABLE "platform_documents"
  ADD COLUMN IF NOT EXISTS "snapshot_sequence" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "platform_documents"
  ADD COLUMN IF NOT EXISTS "last_compacted_at" TIMESTAMPTZ(6);
