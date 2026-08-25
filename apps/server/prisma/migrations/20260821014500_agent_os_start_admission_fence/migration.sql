-- A run start is a durable user submission before it is an HTTP dispatch.
-- Drain any pre-v2 command outbox before deploying: those commands do not
-- contain browser-owned turn/message identities or attachment display metadata
-- and silently inventing either would corrupt the transcript contract.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "agent_os_runs"
    WHERE "start_command" IS NOT NULL
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Cannot enable Agent OS start admission fencing with pending legacy starts',
      DETAIL = 'Drain or explicitly cancel every agent_os_runs row whose start_command is non-null, then retry the migration.';
  END IF;
END $$;

-- Rename the old dispatcher-only claim into the execution fence it now is.
-- The lease covers Worker acceptance, graph scheduling, checkpoint recovery,
-- and every initial-turn Domain call; HTTP acknowledgement alone never owns it.
ALTER TABLE "agent_os_runs"
  RENAME COLUMN "start_dispatch_lease_id" TO "start_execution_attempt_id";

ALTER TABLE "agent_os_runs"
  RENAME COLUMN "start_dispatch_lease_expires_at" TO "start_execution_lease_expires_at";

ALTER TABLE "agent_os_runs"
  RENAME COLUMN "start_dispatch_attempts" TO "start_execution_epoch";

ALTER TABLE "agent_os_runs"
  ADD COLUMN "start_admission_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "client_submission_id" UUID,
  ADD COLUMN "start_turn_id" UUID,
  ADD COLUMN "start_user_message_id" UUID,
  ADD COLUMN "submission_fingerprint" VARCHAR(64),
  ADD COLUMN "start_execution_token" UUID,
  ADD COLUMN "start_execution_owner_id" UUID,
  ADD COLUMN "start_execution_heartbeat_at" TIMESTAMPTZ(6),
  ADD COLUMN "start_execution_checkpoint_id" VARCHAR(160),
  ADD COLUMN "start_execution_checkpoint_namespace" VARCHAR(200),
  ADD COLUMN "start_execution_checkpoint_thread_id" UUID,
  ADD COLUMN "start_execution_checkpoint_message_id" UUID,
  ADD COLUMN "start_execution_checkpointed_at" TIMESTAMPTZ(6),
  ADD COLUMN "start_execution_finished_at" TIMESTAMPTZ(6);

ALTER TABLE "agent_os_runs"
  ADD CONSTRAINT "agent_os_runs_start_admission_v2_complete_check"
  CHECK (
    ("start_admission_version" = 1
      AND "client_submission_id" IS NULL
      AND "start_turn_id" IS NULL
      AND "start_user_message_id" IS NULL
      AND "submission_fingerprint" IS NULL
      AND "start_execution_token" IS NULL)
    OR
    ("start_admission_version" = 2
      AND "client_submission_id" IS NOT NULL
      AND "start_turn_id" IS NOT NULL
      AND "start_user_message_id" IS NOT NULL
      AND "submission_fingerprint" ~ '^[0-9a-f]{64}$'
      AND "start_execution_token" IS NOT NULL)
  ),
  ADD CONSTRAINT "agent_os_runs_start_execution_attempt_complete_check"
  CHECK (
    ("start_execution_attempt_id" IS NULL
      AND "start_execution_owner_id" IS NULL
      AND "start_execution_lease_expires_at" IS NULL)
    OR
    ("start_execution_attempt_id" IS NOT NULL
      AND "start_execution_lease_expires_at" IS NOT NULL
      AND "start_execution_epoch" > 0)
  ),
  ADD CONSTRAINT "agent_os_runs_start_checkpoint_complete_check"
  CHECK (
    ("start_execution_checkpoint_id" IS NULL
      AND "start_execution_checkpoint_namespace" IS NULL
      AND "start_execution_checkpoint_thread_id" IS NULL
      AND "start_execution_checkpoint_message_id" IS NULL
      AND "start_execution_checkpointed_at" IS NULL)
    OR
    ("start_execution_checkpoint_id" IS NOT NULL
      AND "start_execution_checkpoint_namespace" IS NOT NULL
      AND "start_execution_checkpoint_thread_id" IS NOT NULL
      AND "start_execution_checkpoint_message_id" IS NOT NULL
      AND "start_execution_checkpointed_at" IS NOT NULL)
  );

-- PostgreSQL UNIQUE permits multiple NULL client_submission_id values, so the
-- ordinary constraint exactly matches Prisma while still making every v2
-- submission identity globally unique for one actor/project pair.
ALTER TABLE "agent_os_runs"
  ADD CONSTRAINT "agent_os_runs_actor_project_submission_unique"
  UNIQUE ("actor_id", "project_id", "client_submission_id");

DROP INDEX IF EXISTS "agent_os_runs_start_dispatch_pending_idx";

CREATE INDEX "agent_os_runs_start_execution_pending_idx"
  ON "agent_os_runs"("start_dispatch_next_attempt_at", "created_at", "id")
  WHERE "start_command" IS NOT NULL
    AND "start_execution_finished_at" IS NULL;
