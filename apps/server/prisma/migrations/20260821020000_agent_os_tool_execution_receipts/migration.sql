-- Exactly-once Agent OS command receipts. A completed receipt is the durable
-- response-loss replay authority; an executing row is only a short lease used
-- to serialize multiple Gateway/Worker pods.
CREATE TABLE "agent_os_tool_execution_receipts" (
  "id" UUID NOT NULL,
  "run_id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "turn_id" UUID NOT NULL,
  "tool_call_id" VARCHAR(256) NOT NULL,
  "tool_id" VARCHAR(128) NOT NULL,
  "project_id" UUID NOT NULL,
  "actor_id" VARCHAR(128) NOT NULL,
  "idempotency_key" VARCHAR(512) NOT NULL,
  "request_fingerprint" VARCHAR(64) NOT NULL,
  "status" VARCHAR(16) NOT NULL,
  "lease_id" UUID,
  "lease_expires_at" TIMESTAMPTZ(6),
  "response" JSONB,
  "start_execution_token" UUID,
  "start_execution_attempt_id" UUID,
  "start_execution_epoch" INTEGER,
  "start_execution_owner_id" UUID,
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "agent_os_tool_execution_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agent_os_tool_receipts_fingerprint_check"
    CHECK ("request_fingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "agent_os_tool_receipts_status_check"
    CHECK (
      ("status" = 'executing'
        AND "lease_id" IS NOT NULL
        AND "lease_expires_at" IS NOT NULL
        AND "response" IS NULL
        AND "completed_at" IS NULL)
      OR
      ("status" = 'completed'
        AND "lease_id" IS NULL
        AND "lease_expires_at" IS NULL
        AND "response" IS NOT NULL
        AND "completed_at" IS NOT NULL)
    ),
  CONSTRAINT "agent_os_tool_receipts_start_proof_check"
    CHECK (
      ("start_execution_token" IS NULL
        AND "start_execution_attempt_id" IS NULL
        AND "start_execution_epoch" IS NULL
        AND "start_execution_owner_id" IS NULL)
      OR
      ("start_execution_token" IS NOT NULL
        AND "start_execution_attempt_id" IS NOT NULL
        AND "start_execution_epoch" > 0
        AND "start_execution_owner_id" IS NOT NULL)
    ),
  CONSTRAINT "agent_os_tool_execution_receipts_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "agent_os_runs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "agent_os_tool_receipts_run_call_unique"
  ON "agent_os_tool_execution_receipts"("run_id", "tool_call_id");

CREATE UNIQUE INDEX "agent_os_tool_receipts_run_key_unique"
  ON "agent_os_tool_execution_receipts"("run_id", "idempotency_key");

CREATE INDEX "agent_os_tool_receipts_run_status_idx"
  ON "agent_os_tool_execution_receipts"("run_id", "status", "created_at");

CREATE INDEX "agent_os_tool_receipts_expired_execution_idx"
  ON "agent_os_tool_execution_receipts"("lease_expires_at", "created_at", "id")
  WHERE "status" = 'executing';
