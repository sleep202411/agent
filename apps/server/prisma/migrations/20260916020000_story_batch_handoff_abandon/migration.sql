-- Durable poison-pill marker for Story generation batch continuation handoffs
-- that can never be delivered (e.g. the source Agent OS run reached a
-- terminal status before the batch settled). The continuation worker stamps
-- these instead of retrying every sweep forever.
ALTER TABLE "story_generation_batches" ADD COLUMN "handoff_abandoned_at" TIMESTAMPTZ(6);
ALTER TABLE "story_generation_batches" ADD COLUMN "handoff_abandon_reason" JSONB;
