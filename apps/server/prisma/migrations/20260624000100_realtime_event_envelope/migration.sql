-- Realtime event plane (P3, docs/studio-realtime-architecture.md §3):
-- per-channel monotonic `seq` + globally-unique `event_id` on the outbox
-- envelope, plus a per-channel sequence allocator. Columns are nullable and
-- statements are IF NOT EXISTS, so this is idempotent and backward-compatible:
-- old in-flight outbox rows drain without channel/seq/event_id, and the new
-- emit path always sets them.

ALTER TABLE "ai_event_outbox" ADD COLUMN IF NOT EXISTS "channel" TEXT;
ALTER TABLE "ai_event_outbox" ADD COLUMN IF NOT EXISTS "seq" BIGINT;
ALTER TABLE "ai_event_outbox" ADD COLUMN IF NOT EXISTS "event_id" TEXT;

-- Replay catch-up reads events for a channel after a given sequence.
CREATE INDEX IF NOT EXISTS "ai_event_outbox_channel_seq_idx"
  ON "ai_event_outbox" ("channel", "seq");

-- Per-channel monotonic sequence allocator. `next_seq` is advanced atomically
-- by a single INSERT ... ON CONFLICT DO UPDATE (gap-free under concurrent
-- writers); per-channel locking keeps unrelated channels contention-free.
CREATE TABLE IF NOT EXISTS "realtime_sequence_cursor" (
    "channel"  TEXT   NOT NULL,
    "next_seq" BIGINT NOT NULL DEFAULT 1,
    CONSTRAINT "realtime_sequence_cursor_pkey" PRIMARY KEY ("channel")
);

-- New realtime-bearing domains routed through the same outbox (PG 12+ allows
-- ADD VALUE inside the migration transaction; values are not used until commit).
ALTER TYPE "AiOutboxEventType" ADD VALUE IF NOT EXISTS 'wallet_changed';
ALTER TYPE "AiOutboxEventType" ADD VALUE IF NOT EXISTS 'entitlement_changed';
ALTER TYPE "AiOutboxEventType" ADD VALUE IF NOT EXISTS 'team_member_changed';
ALTER TYPE "AiOutboxEventType" ADD VALUE IF NOT EXISTS 'project_changed';
