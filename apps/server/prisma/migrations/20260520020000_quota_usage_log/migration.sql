-- Quota Phase 1 — observation ledger.
--
-- One row per consumable user action (image generate / chat submit /
-- workflow start / upload). No enforcement yet — we want a week of
-- real usage data before deciding the per-tier daily limits.

CREATE TYPE "QuotaDimension" AS ENUM ('image', 'chat', 'workflow', 'upload');

CREATE TABLE "quota_usage_log" (
  "id"               TEXT NOT NULL,
  "user_id"          VARCHAR(64) NOT NULL,
  "dimension"        "QuotaDimension" NOT NULL,
  -- Signed cost: positive = consume, negative = refund.
  "cost"             INTEGER NOT NULL DEFAULT 1,
  "reason"           VARCHAR(64) NOT NULL,
  "idempotency_key"  VARCHAR(128),
  "metadata"         JSONB,
  "created_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "quota_usage_log_pkey" PRIMARY KEY ("id")
);

-- Per-user/dimension scan for "what did user X spend on dim Y today".
CREATE INDEX "quota_usage_log_user_dim_recent_idx"
  ON "quota_usage_log"("user_id", "dimension", "created_at" DESC);

-- Cross-user analytics over a day window.
CREATE INDEX "quota_usage_log_dim_recent_idx"
  ON "quota_usage_log"("dimension", "created_at" DESC);
