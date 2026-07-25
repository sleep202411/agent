CREATE TYPE "StudioAgentQuotaChargeStatus" AS ENUM (
  'consume_pending',
  'charged',
  'rejected',
  'refund_pending',
  'refunded',
  'settle_pending',
  'settled'
);

CREATE TABLE "studio_agent_quota_charge_attempts" (
  "id" UUID NOT NULL,
  "thread_id" UUID NOT NULL,
  "root_run_id" UUID,
  "workspace_id" UUID NOT NULL,
  "user_id" VARCHAR(160) NOT NULL,
  "client_message_id" VARCHAR(128) NOT NULL,
  "request_hash" VARCHAR(64) NOT NULL,
  "day_bucket" VARCHAR(10) NOT NULL,
  "month_bucket" VARCHAR(7) NOT NULL,
  "quota_profile" JSONB NOT NULL,
  "quota_cost" INTEGER NOT NULL DEFAULT 1,
  "reserved_token_units" BIGINT NOT NULL,
  "actual_model_attempts" INTEGER NOT NULL DEFAULT 0,
  "actual_input_tokens" BIGINT NOT NULL DEFAULT 0,
  "actual_output_tokens" BIGINT NOT NULL DEFAULT 0,
  "actual_cached_input_tokens" BIGINT NOT NULL DEFAULT 0,
  "actual_reasoning_tokens" BIGINT NOT NULL DEFAULT 0,
  "status" "StudioAgentQuotaChargeStatus" NOT NULL DEFAULT 'consume_pending',
  "refund_reason" VARCHAR(32),
  "rejection" JSONB,
  "admission_expires_at" TIMESTAMPTZ(6) NOT NULL,
  "terminal_at" TIMESTAMPTZ(6),
  "redis_finalized_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "studio_agent_quota_charge_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "studio_agent_quota_charge_positive_cost_check"
    CHECK ("quota_cost" > 0),
  CONSTRAINT "studio_agent_quota_charge_nonnegative_reservation_check"
    CHECK ("reserved_token_units" >= 0),
  CONSTRAINT "studio_agent_quota_charge_usage_nonnegative_check"
    CHECK (
      "actual_model_attempts" >= 0 AND
      "actual_input_tokens" >= 0 AND
      "actual_output_tokens" >= 0 AND
      "actual_cached_input_tokens" >= 0 AND
      "actual_reasoning_tokens" >= 0
    ),
  CONSTRAINT "studio_agent_quota_charge_window_shape_check"
    CHECK (
      "day_bucket" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND
      "month_bucket" ~ '^[0-9]{4}-[0-9]{2}$' AND
      left("day_bucket", 7) = "month_bucket"
    ),
  CONSTRAINT "studio_agent_quota_charge_root_terminal_shape_check"
    CHECK (
      (
        "status" IN ('consume_pending', 'charged') AND
        "terminal_at" IS NULL
      ) OR (
        "status" IN ('rejected', 'refund_pending', 'refunded', 'settle_pending', 'settled') AND
        "terminal_at" IS NOT NULL
      )
    ),
  CONSTRAINT "studio_agent_quota_charge_redis_finalized_shape_check"
    CHECK (
      "redis_finalized_at" IS NULL OR
      "status" IN ('refunded', 'settled')
    )
);

CREATE UNIQUE INDEX "studio_agent_quota_charge_root_thread_unique"
  ON "studio_agent_quota_charge_attempts"("root_run_id", "thread_id");
CREATE UNIQUE INDEX "studio_agent_quota_charge_thread_message_unique"
  ON "studio_agent_quota_charge_attempts"("thread_id", "client_message_id");
CREATE UNIQUE INDEX "studio_agent_quota_charge_id_thread_unique"
  ON "studio_agent_quota_charge_attempts"("id", "thread_id");
CREATE INDEX "studio_agent_quota_charge_reconcile_idx"
  ON "studio_agent_quota_charge_attempts"(
    "status",
    "admission_expires_at",
    "updated_at",
    "id"
  );
CREATE INDEX "studio_agent_quota_charge_user_active_idx"
  ON "studio_agent_quota_charge_attempts"(
    "user_id",
    "status",
    "updated_at",
    "id"
  );
CREATE INDEX "studio_agent_quota_charge_workspace_active_idx"
  ON "studio_agent_quota_charge_attempts"(
    "workspace_id",
    "status",
    "updated_at",
    "id"
  );

ALTER TABLE "studio_agent_quota_charge_attempts"
  ADD CONSTRAINT "studio_agent_quota_charge_thread_fkey"
  FOREIGN KEY ("thread_id")
  REFERENCES "studio_agent_threads"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "studio_agent_quota_charge_attempts"
  ADD CONSTRAINT "studio_agent_quota_charge_root_fkey"
  FOREIGN KEY ("root_run_id", "thread_id")
  REFERENCES "studio_agent_runs"("id", "thread_id")
  ON DELETE NO ACTION
  ON UPDATE CASCADE;

ALTER TABLE "studio_agent_quota_charge_attempts"
  ADD CONSTRAINT "studio_agent_quota_charge_workspace_fkey"
  FOREIGN KEY ("workspace_id")
  REFERENCES "workspaces"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
