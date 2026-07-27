BEGIN;

-- This Copilot plane is still pre-release. Its old rows do not record the
-- Redis windows actually used, so retaining or guessing them would make quota
-- reconciliation non-deterministic. Product policy permits dropping this
-- private draft chat data; clear the complete FK-connected plane instead.
TRUNCATE TABLE
  "copilot_messages",
  "copilot_conversations",
  "copilot_user_stream_states",
  "copilot_quota_charge_attempts";

ALTER TABLE "copilot_quota_charge_attempts"
  ADD COLUMN "day_bucket" VARCHAR(10) NOT NULL,
  ADD COLUMN "month_bucket" VARCHAR(7) NOT NULL,
  ADD COLUMN "redis_finalized_at" TIMESTAMPTZ(6),
  ADD CONSTRAINT "copilot_quota_charge_attempts_window_shape" CHECK (
    "day_bucket" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND
    "month_bucket" ~ '^[0-9]{4}-[0-9]{2}$' AND
    left("day_bucket", 7) = "month_bucket" AND
    to_char(to_date("day_bucket", 'YYYY-MM-DD'), 'YYYY-MM-DD') = "day_bucket"
  ),
  ADD CONSTRAINT "copilot_quota_charge_attempts_redis_finalized_terminal" CHECK (
    "redis_finalized_at" IS NULL OR "status" IN ('refunded', 'settled')
  );

COMMIT;
