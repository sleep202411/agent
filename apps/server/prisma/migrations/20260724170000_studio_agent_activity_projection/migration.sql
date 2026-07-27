BEGIN;

-- Explicit model/runtime activities are projected at event-append time so a
-- reconnect never needs to replay an unbounded event journal. Capability
-- actions remain canonical in studio_agent_actions and are not duplicated
-- here.

CREATE TYPE "StudioAgentActivityKind" AS ENUM (
  'read', 'search', 'analyze', 'plan', 'execute', 'generate', 'wait', 'other'
);

CREATE TYPE "StudioAgentActivityStatus" AS ENUM (
  'running', 'succeeded', 'failed', 'cancelled'
);

CREATE TABLE "studio_agent_activities" (
  "id" UUID NOT NULL,
  "thread_id" UUID NOT NULL,
  "run_id" UUID NOT NULL,
  "parent_activity_id" UUID,
  "kind" "StudioAgentActivityKind" NOT NULL,
  "label" VARCHAR(240) NOT NULL,
  "detail" TEXT,
  "progress" DOUBLE PRECISION,
  "status" "StudioAgentActivityStatus" NOT NULL DEFAULT 'running',
  "started_at" TIMESTAMPTZ(6) NOT NULL,
  "completed_at" TIMESTAMPTZ(6),
  "first_event_sequence" BIGINT NOT NULL,
  "last_event_sequence" BIGINT NOT NULL,

  CONSTRAINT "studio_agent_activities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "studio_agent_activities_identity_chk" CHECK (
    char_length(btrim("label")) BETWEEN 1 AND 240
    AND ("detail" IS NULL OR char_length(btrim("detail")) BETWEEN 1 AND 8000)
    AND ("parent_activity_id" IS NULL OR "parent_activity_id" <> "id")
  ),
  CONSTRAINT "studio_agent_activities_progress_chk" CHECK (
    "progress" IS NULL OR ("progress" >= 0 AND "progress" <= 1)
  ),
  CONSTRAINT "studio_agent_activities_sequence_chk" CHECK (
    "first_event_sequence" >= 1
    AND "last_event_sequence" >= "first_event_sequence"
  ),
  CONSTRAINT "studio_agent_activities_lifecycle_chk" CHECK (
    ("status" = 'running' AND "completed_at" IS NULL)
    OR (
      "status" IN ('succeeded', 'failed', 'cancelled')
      AND "completed_at" IS NOT NULL
      AND "completed_at" >= "started_at"
    )
  )
);

CREATE INDEX "studio_agent_activities_thread_sequence_idx"
  ON "studio_agent_activities" (
    "thread_id",
    "first_event_sequence",
    "id"
  );

CREATE INDEX "studio_agent_activities_run_status_sequence_idx"
  ON "studio_agent_activities" (
    "run_id",
    "status",
    "first_event_sequence",
    "id"
  );

CREATE INDEX "studio_agent_activities_parent_idx"
  ON "studio_agent_activities" ("thread_id", "parent_activity_id");

CREATE UNIQUE INDEX "studio_agent_activities_id_thread_unique"
  ON "studio_agent_activities" ("id", "thread_id");

ALTER TABLE "studio_agent_activities"
  ADD CONSTRAINT "studio_agent_activities_thread_fkey"
  FOREIGN KEY ("thread_id")
  REFERENCES "studio_agent_threads" ("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "studio_agent_activities"
  ADD CONSTRAINT "studio_agent_activities_run_thread_fkey"
  FOREIGN KEY ("run_id", "thread_id")
  REFERENCES "studio_agent_runs" ("id", "thread_id")
  ON DELETE NO ACTION
  ON UPDATE CASCADE;

ALTER TABLE "studio_agent_activities"
  ADD CONSTRAINT "studio_agent_activities_parent_thread_fkey"
  FOREIGN KEY ("parent_activity_id", "thread_id")
  REFERENCES "studio_agent_activities" ("id", "thread_id")
  ON DELETE NO ACTION
  ON UPDATE CASCADE;

COMMIT;
