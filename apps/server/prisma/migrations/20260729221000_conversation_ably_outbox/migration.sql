-- Durable, transactionally-enqueued Ably delivery for authoritative messages.
-- Postgres remains the source of truth; this queue repairs the realtime fast
-- path after process crashes and transient Ably/network failures.

CREATE TABLE "conversation_realtime_outbox" (
    "id" UUID NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "idempotency_key" VARCHAR(180) NOT NULL,
    "dispatched_at" TIMESTAMPTZ(6),
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "locked_at" TIMESTAMPTZ(6),
    "locked_by" VARCHAR(160),
    "dead_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_realtime_outbox_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "conversation_realtime_outbox_attempt_nonnegative"
      CHECK ("attempt" >= 0)
);

CREATE UNIQUE INDEX "conversation_realtime_outbox_message_unique"
  ON "conversation_realtime_outbox"("message_id");

CREATE UNIQUE INDEX "conversation_realtime_outbox_idempotency_unique"
  ON "conversation_realtime_outbox"("idempotency_key");

CREATE INDEX "conversation_realtime_outbox_pending_idx"
  ON "conversation_realtime_outbox"("dispatched_at", "dead_at", "next_attempt_at");

CREATE INDEX "conversation_realtime_outbox_locked_idx"
  ON "conversation_realtime_outbox"("locked_at");

CREATE INDEX "conversation_realtime_outbox_dead_idx"
  ON "conversation_realtime_outbox"("dead_at");

CREATE INDEX "conversation_realtime_outbox_conversation_idx"
  ON "conversation_realtime_outbox"("conversation_id", "created_at" DESC);

ALTER TABLE "conversation_realtime_outbox"
  ADD CONSTRAINT "conversation_realtime_outbox_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "conversation_realtime_outbox"
  ADD CONSTRAINT "conversation_realtime_outbox_message_id_fkey"
  FOREIGN KEY ("message_id") REFERENCES "messages"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
