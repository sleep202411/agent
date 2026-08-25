ALTER TABLE "agent_os_runs"
  ADD COLUMN "continuation_command" JSONB,
  ADD COLUMN "continuation_execution_token" UUID,
  ADD COLUMN "continuation_execution_attempt_id" UUID,
  ADD COLUMN "continuation_execution_epoch" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "continuation_execution_owner_id" UUID,
  ADD COLUMN "continuation_execution_lease_expires_at" TIMESTAMPTZ(6),
  ADD COLUMN "continuation_execution_heartbeat_at" TIMESTAMPTZ(6),
  ADD COLUMN "continuation_execution_checkpoint_id" VARCHAR(160),
  ADD COLUMN "continuation_execution_checkpoint_namespace" VARCHAR(200),
  ADD COLUMN "continuation_execution_checkpoint_thread_id" UUID,
  ADD COLUMN "continuation_execution_checkpointed_at" TIMESTAMPTZ(6),
  ADD COLUMN "continuation_execution_finished_at" TIMESTAMPTZ(6),
  ADD COLUMN "continuation_dispatch_next_attempt_at" TIMESTAMPTZ(6),
  ADD COLUMN "continuation_dispatch_last_error" TEXT,
  ADD COLUMN "continuation_dispatched_at" TIMESTAMPTZ(6);

ALTER TABLE "agent_os_runs"
  ADD CONSTRAINT "agent_os_runs_continuation_epoch_nonnegative"
  CHECK ("continuation_execution_epoch" >= 0),
  ADD CONSTRAINT "agent_os_runs_continuation_command_identity"
  CHECK (
    "continuation_command" IS NULL
    OR (
      "continuation_execution_token" IS NOT NULL
      AND "continuation_execution_finished_at" IS NULL
    )
  );

CREATE INDEX "agent_os_runs_continuation_dispatch_idx"
  ON "agent_os_runs" ("continuation_dispatch_next_attempt_at", "created_at");

ALTER TABLE "agent_os_tool_execution_receipts"
  ADD COLUMN "continuation_execution_token" UUID,
  ADD COLUMN "continuation_execution_attempt_id" UUID,
  ADD COLUMN "continuation_execution_epoch" INTEGER,
  ADD COLUMN "continuation_execution_owner_id" UUID;

ALTER TABLE "agent_os_tool_execution_receipts"
  ADD CONSTRAINT "agent_os_tool_receipts_continuation_proof_complete"
  CHECK (
    (
      "continuation_execution_token" IS NULL
      AND "continuation_execution_attempt_id" IS NULL
      AND "continuation_execution_epoch" IS NULL
      AND "continuation_execution_owner_id" IS NULL
    )
    OR (
      "continuation_execution_token" IS NOT NULL
      AND "continuation_execution_attempt_id" IS NOT NULL
      AND "continuation_execution_epoch" IS NOT NULL
      AND "continuation_execution_epoch" > 0
      AND "continuation_execution_owner_id" IS NOT NULL
    )
  );
