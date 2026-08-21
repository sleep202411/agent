-- Durable Story authoring -> Agent OS external-job continuation.
-- The Story row is the outbox: terminal authoring states remain retryable until
-- the originating Agent OS journal acknowledges the deterministic result.
ALTER TABLE "story_agent_runs"
  ADD COLUMN "source_agent_run_id" UUID,
  ADD COLUMN "source_agent_turn_id" UUID,
  ADD COLUMN "source_agent_tool_call_id" VARCHAR(256),
  ADD COLUMN "source_started_message" TEXT,
  ADD COLUMN "source_completion_message" TEXT,
  ADD COLUMN "source_result_delivered_at" TIMESTAMPTZ(6);

-- The immutable registration introduced by the following migration owns the
-- foreign key to agent_os_runs. Durable admission guarantees that run row
-- exists before a domain tool executes; only its later RunPaused /
-- waiting_for_external projection may still lag the Story transaction.

ALTER TABLE "story_agent_runs"
  ADD CONSTRAINT "story_agent_runs_source_handoff_complete_check"
  CHECK (
    (
      "source_agent_run_id" IS NULL
      AND "source_agent_turn_id" IS NULL
      AND "source_agent_tool_call_id" IS NULL
      AND "source_started_message" IS NULL
      AND "source_completion_message" IS NULL
    )
    OR
    (
      "source_agent_run_id" IS NOT NULL
      AND "source_agent_turn_id" IS NOT NULL
      AND "source_agent_tool_call_id" IS NOT NULL
      AND "source_started_message" IS NOT NULL
      AND "source_completion_message" IS NOT NULL
      AND "conversation_id" IS NOT NULL
    )
  ),
  ADD CONSTRAINT "story_agent_runs_source_delivery_origin_check"
  CHECK (
    "source_result_delivered_at" IS NULL
    OR "source_agent_run_id" IS NOT NULL
  );

-- A tool call owns exactly one external Story job. Together with the existing
-- idempotency-key uniqueness this rejects both accidental fan-out and replay
-- with a different source identity.
CREATE UNIQUE INDEX "story_agent_runs_source_tool_call_unique"
  ON "story_agent_runs" ("source_agent_run_id", "source_agent_tool_call_id")
  WHERE "source_agent_run_id" IS NOT NULL;

-- Keep the cross-pod continuation scan bounded to undelivered terminal jobs.
CREATE INDEX "story_agent_runs_agent_os_delivery_pending_idx"
  ON "story_agent_runs" ("id")
  WHERE "source_agent_run_id" IS NOT NULL
    AND "source_result_delivered_at" IS NULL
    AND "status" IN ('proposed', 'authoring_failed', 'cancelled', 'stale');
