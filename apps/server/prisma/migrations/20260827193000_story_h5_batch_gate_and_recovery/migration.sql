-- H5 media generation is a durable stage boundary. A sequential batch can
-- pause for funds or recovery, and Agent OS must not advance until the batch
-- reaches a successful terminal state.
ALTER TYPE "StoryGenerationBatchStatus" ADD VALUE IF NOT EXISTS 'blocked' AFTER 'awaiting_confirmation';

ALTER TABLE "story_generation_batches"
  ADD COLUMN "blocked_at" TIMESTAMPTZ(6),
  ADD COLUMN "block_reason" JSONB,
  ADD COLUMN "handoff_result_delivered_at" TIMESTAMPTZ(6);

ALTER TABLE "story_generation_batches"
  ADD CONSTRAINT "story_generation_batches_blocked_state_check"
  CHECK (
    ("status" = 'blocked' AND "blocked_at" IS NOT NULL AND "block_reason" IS NOT NULL)
    OR
    ("status" <> 'blocked' AND "blocked_at" IS NULL AND "block_reason" IS NULL)
  );

-- Generalize the immutable external-job registration so a confirmed H5 batch
-- can pause the same Agent turn that created it. Exactly one domain job owns a
-- registration, and the generic external job id must equal that job's id.
ALTER TABLE "agent_os_external_handoff_registrations"
  DROP CONSTRAINT "agent_os_external_handoffs_story_job_identity_check",
  ALTER COLUMN "story_agent_run_id" DROP NOT NULL,
  ADD COLUMN "generation_batch_id" UUID;

ALTER TABLE "agent_os_external_handoff_registrations"
  ADD CONSTRAINT "agent_os_external_handoffs_generation_batch_fkey"
    FOREIGN KEY ("generation_batch_id") REFERENCES "story_generation_batches"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "agent_os_external_handoffs_job_identity_check"
    CHECK (
      num_nonnulls("story_agent_run_id", "generation_batch_id") = 1
      AND "external_job_id" = COALESCE("story_agent_run_id", "generation_batch_id")
    );

CREATE UNIQUE INDEX "agent_os_external_handoffs_generation_batch_unique"
  ON "agent_os_external_handoff_registrations" ("generation_batch_id");

CREATE INDEX "story_generation_batches_handoff_delivery_idx"
  ON "story_generation_batches" ("status", "handoff_result_delivered_at", "created_at")
  WHERE "handoff_result_delivered_at" IS NULL;
