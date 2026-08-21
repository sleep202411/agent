-- A domain-accepted external job must survive the worker dying before it can
-- journal RunPaused. This immutable registration is committed in the same
-- transaction as StoryAgentRun and is the recovery authority for that gap.
CREATE TABLE "agent_os_external_handoff_registrations" (
  "id" UUID NOT NULL,
  "external_job_id" UUID NOT NULL,
  "source_agent_run_id" UUID NOT NULL,
  "source_agent_turn_id" UUID NOT NULL,
  "source_agent_tool_call_id" VARCHAR(256) NOT NULL,
  "source_conversation_id" UUID NOT NULL,
  "source_tool_id" VARCHAR(128) NOT NULL,
  "started_message" TEXT NOT NULL,
  "completion_message" TEXT NOT NULL,
  "story_agent_run_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "agent_os_external_handoff_registrations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agent_os_external_handoffs_story_run_fkey"
    FOREIGN KEY ("story_agent_run_id") REFERENCES "story_agent_runs"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "agent_os_external_handoffs_source_run_fkey"
    FOREIGN KEY ("source_agent_run_id") REFERENCES "agent_os_runs"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "agent_os_external_handoffs_story_job_identity_check"
    CHECK ("external_job_id" = "story_agent_run_id"),
  CONSTRAINT "agent_os_external_handoffs_copy_nonempty_check"
    CHECK (
      length(btrim("source_agent_tool_call_id")) > 0
      AND length(btrim("source_tool_id")) > 0
      AND length(btrim("started_message")) > 0
      AND length(btrim("completion_message")) > 0
    )
);

CREATE UNIQUE INDEX "agent_os_external_handoffs_job_unique"
  ON "agent_os_external_handoff_registrations" ("external_job_id");
CREATE UNIQUE INDEX "agent_os_external_handoffs_story_run_unique"
  ON "agent_os_external_handoff_registrations" ("story_agent_run_id");
CREATE UNIQUE INDEX "agent_os_external_handoffs_source_tool_unique"
  ON "agent_os_external_handoff_registrations" ("source_agent_run_id", "source_agent_tool_call_id");
CREATE INDEX "agent_os_external_handoffs_source_run_idx"
  ON "agent_os_external_handoff_registrations" ("source_agent_run_id", "created_at");

-- Existing source tuples were produced by the Agent OS UUID contract. Validate
-- before casting so a malformed historical tuple stops deployment without
-- partially inventing a registration.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "story_agent_runs"
    WHERE "source_agent_run_id" IS NOT NULL
      AND (
        "conversation_id" IS NULL
        OR "conversation_id" !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        OR "source_agent_turn_id" IS NULL
        OR "source_agent_tool_call_id" IS NULL
        OR "source_started_message" IS NULL
        OR "source_completion_message" IS NULL
        OR length(btrim("source_agent_tool_call_id")) = 0
        OR length(btrim("source_started_message")) = 0
        OR length(btrim("source_completion_message")) = 0
      )
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Cannot backfill Agent OS external handoff registrations',
      DETAIL = 'A Story Agent source handoff has an invalid conversation id or empty correlation/copy field.';
  END IF;
END $$;

-- Durable Agent admission now creates agent_os_runs before any domain tool can
-- execute. Validate the full ownership tuple explicitly so the FK backfill
-- cannot accidentally bless a run from another project, conversation, actor,
-- or product domain.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "story_agent_runs" AS story_run
    WHERE story_run."source_agent_run_id" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM "agent_os_runs" AS agent_run
        WHERE agent_run."id" = story_run."source_agent_run_id"
          AND agent_run."project_id" = story_run."story_project_id"
          AND agent_run."conversation_id" = story_run."conversation_id"::uuid
          AND agent_run."actor_id" = story_run."initiated_by_user_id"
          AND agent_run."project_kind" = 'story'
      )
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Cannot link Story external handoffs to Agent OS runs',
      DETAIL = 'A Story Agent source tuple does not match a durable Agent OS run in the same project, conversation, actor, and domain.';
  END IF;
END $$;

INSERT INTO "agent_os_external_handoff_registrations" (
  "id",
  "external_job_id",
  "source_agent_run_id",
  "source_agent_turn_id",
  "source_agent_tool_call_id",
  "source_conversation_id",
  "source_tool_id",
  "started_message",
  "completion_message",
  "story_agent_run_id",
  "created_at"
)
SELECT
  "id",
  "id",
  "source_agent_run_id",
  "source_agent_turn_id",
  "source_agent_tool_call_id",
  "conversation_id"::uuid,
  'story.author',
  "source_started_message",
  "source_completion_message",
  "id",
  "created_at"
FROM "story_agent_runs"
WHERE "source_agent_run_id" IS NOT NULL;

ALTER TABLE "story_agent_runs"
  ADD COLUMN "source_result_delivery_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "source_result_delivery_next_attempt_at" TIMESTAMPTZ(6),
  ADD COLUMN "source_result_delivery_lease_owner" VARCHAR(160),
  ADD COLUMN "source_result_delivery_lease_expires_at" TIMESTAMPTZ(6),
  ADD COLUMN "source_result_delivery_last_error" TEXT,
  ADD CONSTRAINT "story_agent_runs_source_delivery_attempts_nonnegative_check"
    CHECK ("source_result_delivery_attempts" >= 0),
  ADD CONSTRAINT "story_agent_runs_source_delivery_lease_complete_check"
    CHECK (
      ("source_result_delivery_lease_owner" IS NULL AND "source_result_delivery_lease_expires_at" IS NULL)
      OR
      ("source_result_delivery_lease_owner" IS NOT NULL AND "source_result_delivery_lease_expires_at" IS NOT NULL)
    ),
  ADD CONSTRAINT "story_agent_runs_source_delivery_terminal_check"
    CHECK (
      "source_result_delivered_at" IS NULL
      OR (
        "source_result_delivery_next_attempt_at" IS NULL
        AND "source_result_delivery_lease_owner" IS NULL
        AND "source_result_delivery_lease_expires_at" IS NULL
        AND "source_result_delivery_last_error" IS NULL
      )
    );

DROP INDEX "story_agent_runs_agent_os_delivery_pending_idx";
CREATE INDEX "story_agent_runs_agent_os_delivery_pending_idx"
  ON "story_agent_runs" (
    "source_result_delivery_next_attempt_at",
    "source_result_delivery_lease_expires_at",
    "id"
  )
  WHERE "source_agent_run_id" IS NOT NULL
    AND "source_result_delivered_at" IS NULL
    AND "status" IN (
      'proposed',
      'applying',
      'succeeded',
      'failed',
      'authoring_failed',
      'cancelled',
      'stale'
    );
