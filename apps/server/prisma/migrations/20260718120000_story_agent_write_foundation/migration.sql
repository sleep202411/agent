-- Story Agent project-write foundation.
--
-- Human writes and future Agent execution serialize on one permanent row per
-- StoryProject. Agent lifecycle and undo material are durable project data;
-- private conversation messages are deliberately not stored here.

-- PostgreSQL 12+ permits enum additions inside a transaction. This migration
-- does not consume the new value before commit, so the full schema change can
-- remain atomic. The repository's supported local baseline is PostgreSQL 16.
BEGIN;

ALTER TYPE "AiOutboxEventType"
  ADD VALUE IF NOT EXISTS 'story_agent_run_changed';

CREATE TYPE "StoryAgentRunKind" AS ENUM ('apply', 'undo');
CREATE TYPE "StoryAgentRunStatus" AS ENUM (
  'authoring', 'authoring_failed',
  'proposed', 'applying', 'succeeded', 'failed', 'cancelled', 'stale'
);

CREATE TABLE "story_agent_runs" (
  "id" UUID NOT NULL,
  "story_project_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "kind" "StoryAgentRunKind" NOT NULL DEFAULT 'apply',
  "status" "StoryAgentRunStatus" NOT NULL DEFAULT 'proposed',
  "initiated_by_user_id" VARCHAR(64) NOT NULL,
  "initiated_by_session_id" VARCHAR(64),
  "conversation_id" VARCHAR(180),

  "base_draft_revision" INTEGER NOT NULL,
  "base_layout_revision" INTEGER NOT NULL,
  "result_draft_revision" INTEGER,
  "result_layout_revision" INTEGER,

  "proposal" JSONB NOT NULL,
  "before_draft_snapshot" JSONB,
  "before_draft_hash" VARCHAR(64),
  "after_draft_snapshot" JSONB,
  "after_draft_hash" VARCHAR(64),
  "before_layout_snapshot" JSONB,
  "before_layout_hash" VARCHAR(64),
  "after_layout_snapshot" JSONB,
  "after_layout_hash" VARCHAR(64),
  "affected_node_ids" JSONB NOT NULL DEFAULT '[]',
  "created_node_ids" JSONB NOT NULL DEFAULT '[]',

  "summary" TEXT,
  "authoring_attempts" INTEGER NOT NULL DEFAULT 0,
  "error_code" VARCHAR(96),
  "error_detail" TEXT,
  "idempotency_key" VARCHAR(240) NOT NULL,
  "request_fingerprint" VARCHAR(64) NOT NULL,
  "reverts_run_id" UUID,

  "fencing_token" BIGINT,
  "lease_owner" VARCHAR(160),
  "lease_acquired_at" TIMESTAMPTZ(6),
  "lease_expires_at" TIMESTAMPTZ(6),

  "proposed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "applying_at" TIMESTAMPTZ(6),
  "reveal_started_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "story_agent_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_agent_runs_revisions_chk" CHECK (
    "base_draft_revision" >= 0 AND
    "base_layout_revision" >= 0 AND
    ("result_draft_revision" IS NULL OR "result_draft_revision" >= 0) AND
    ("result_layout_revision" IS NULL OR "result_layout_revision" >= 0)
  ),
  CONSTRAINT "story_agent_runs_proposal_object_chk"
    CHECK (jsonb_typeof("proposal") = 'object'),
  CONSTRAINT "story_agent_runs_node_ids_array_chk" CHECK (
    jsonb_typeof("affected_node_ids") = 'array' AND
    jsonb_typeof("created_node_ids") = 'array'
  ),
  CONSTRAINT "story_agent_runs_snapshot_shape_chk" CHECK (
    ("before_draft_snapshot" IS NULL OR jsonb_typeof("before_draft_snapshot") = 'object') AND
    ("after_draft_snapshot" IS NULL OR jsonb_typeof("after_draft_snapshot") = 'object') AND
    ("before_layout_snapshot" IS NULL OR jsonb_typeof("before_layout_snapshot") = 'object') AND
    ("after_layout_snapshot" IS NULL OR jsonb_typeof("after_layout_snapshot") = 'object')
  ),
  CONSTRAINT "story_agent_runs_hashes_chk" CHECK (
    "request_fingerprint" ~ '^[0-9a-f]{64}$' AND
    ("before_draft_hash" IS NULL OR "before_draft_hash" ~ '^[0-9a-f]{64}$') AND
    ("after_draft_hash" IS NULL OR "after_draft_hash" ~ '^[0-9a-f]{64}$') AND
    ("before_layout_hash" IS NULL OR "before_layout_hash" ~ '^[0-9a-f]{64}$') AND
    ("after_layout_hash" IS NULL OR "after_layout_hash" ~ '^[0-9a-f]{64}$')
  ),
  CONSTRAINT "story_agent_runs_idempotency_key_nonempty_chk"
    CHECK (btrim("idempotency_key") <> ''),
  CONSTRAINT "story_agent_runs_authoring_attempts_chk"
    CHECK ("authoring_attempts" >= 0),
  CONSTRAINT "story_agent_runs_undo_target_chk" CHECK (
    ("kind" = 'apply' AND "reverts_run_id" IS NULL) OR
    ("kind" = 'undo' AND "reverts_run_id" IS NOT NULL)
  ),
  -- Authoring runs hold a worker lease WITHOUT a project fence: drafting never
  -- reserves the project write state, only applying does.
  CONSTRAINT "story_agent_runs_lease_shape_chk" CHECK (
    (
      (
        "lease_owner" IS NULL AND
        "lease_acquired_at" IS NULL AND
        "lease_expires_at" IS NULL
      ) OR (
        "lease_owner" IS NOT NULL AND
        btrim("lease_owner") <> '' AND
        "lease_acquired_at" IS NOT NULL AND
        "lease_expires_at" IS NOT NULL AND
        "lease_expires_at" > "lease_acquired_at"
      )
    ) AND (
      "fencing_token" IS NULL OR (
        "fencing_token" > 0 AND
        "lease_owner" IS NOT NULL
      )
    )
  ),
  CONSTRAINT "story_agent_runs_lifecycle_chk" CHECK (
    (
      "status" = 'authoring' AND
      "applying_at" IS NULL AND
      "completed_at" IS NULL AND
      "fencing_token" IS NULL AND
      "lease_owner" IS NOT NULL AND
      "error_code" IS NULL
    ) OR (
      "status" = 'authoring_failed' AND
      "applying_at" IS NULL AND
      "completed_at" IS NULL AND
      "fencing_token" IS NULL AND
      "lease_owner" IS NULL AND
      "error_code" IS NOT NULL
    ) OR (
      "status" = 'proposed' AND
      "applying_at" IS NULL AND
      "completed_at" IS NULL AND
      "fencing_token" IS NULL
    ) OR (
      "status" = 'applying' AND
      "applying_at" IS NOT NULL AND
      "completed_at" IS NULL AND
      "fencing_token" IS NOT NULL
    ) OR (
      "status" IN ('succeeded', 'failed', 'cancelled', 'stale') AND
      "completed_at" IS NOT NULL
    )
  ),
  CONSTRAINT "story_agent_runs_success_result_chk" CHECK (
    "status" <> 'succeeded' OR (
      "result_draft_revision" IS NOT NULL AND
      "result_layout_revision" IS NOT NULL AND
      "before_draft_snapshot" IS NOT NULL AND
      "before_draft_hash" IS NOT NULL AND
      "after_draft_snapshot" IS NOT NULL AND
      "after_draft_hash" IS NOT NULL AND
      "before_layout_snapshot" IS NOT NULL AND
      "before_layout_hash" IS NOT NULL AND
      "after_layout_snapshot" IS NOT NULL AND
      "after_layout_hash" IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX "story_agent_runs_id_project_unique"
  ON "story_agent_runs"("id", "story_project_id");
CREATE UNIQUE INDEX "story_agent_runs_idempotency_key_key"
  ON "story_agent_runs"("idempotency_key");
CREATE UNIQUE INDEX "story_agent_runs_project_applying_unique"
  ON "story_agent_runs"("story_project_id")
  WHERE "status" = 'applying';
CREATE INDEX "story_agent_runs_authoring_claim_idx"
  ON "story_agent_runs"("lease_expires_at", "id")
  WHERE "status" = 'authoring';
CREATE INDEX "story_agent_runs_project_status_recent_idx"
  ON "story_agent_runs"("story_project_id", "status", "created_at" DESC);
CREATE INDEX "story_agent_runs_initiator_recent_idx"
  ON "story_agent_runs"("initiated_by_user_id", "created_at" DESC);
CREATE INDEX "story_agent_runs_reverts_idx"
  ON "story_agent_runs"("reverts_run_id");

ALTER TABLE "story_agent_runs"
  ADD CONSTRAINT "story_agent_runs_project_scope_fkey"
  FOREIGN KEY ("story_project_id", "workspace_id")
  REFERENCES "story_projects"("id", "workspace_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_agent_runs_reverts_run_id_fkey"
  FOREIGN KEY ("reverts_run_id")
  REFERENCES "story_agent_runs"("id") ON DELETE RESTRICT;

CREATE TABLE "story_project_write_states" (
  "story_project_id" UUID NOT NULL,
  "active_agent_run_id" UUID,
  "fencing_token" BIGINT NOT NULL DEFAULT 0,
  "locked_at" TIMESTAMPTZ(6),
  "lock_expires_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "story_project_write_states_pkey" PRIMARY KEY ("story_project_id"),
  CONSTRAINT "story_project_write_states_fencing_token_chk"
    CHECK ("fencing_token" >= 0),
  CONSTRAINT "story_project_write_states_lock_shape_chk" CHECK (
    (
      "active_agent_run_id" IS NULL AND
      "locked_at" IS NULL AND
      "lock_expires_at" IS NULL
    ) OR (
      "active_agent_run_id" IS NOT NULL AND
      "locked_at" IS NOT NULL AND
      "lock_expires_at" IS NOT NULL AND
      "lock_expires_at" > "locked_at"
    )
  )
);

CREATE UNIQUE INDEX "story_project_write_states_active_agent_run_id_key"
  ON "story_project_write_states"("active_agent_run_id");
CREATE UNIQUE INDEX "story_project_write_states_active_run_project_unique"
  ON "story_project_write_states"("active_agent_run_id", "story_project_id");
CREATE INDEX "story_project_write_states_expiry_idx"
  ON "story_project_write_states"("lock_expires_at");

ALTER TABLE "story_project_write_states"
  ADD CONSTRAINT "story_project_write_states_project_fkey"
  FOREIGN KEY ("story_project_id")
  REFERENCES "story_projects"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "story_project_write_states_active_run_scope_fkey"
  FOREIGN KEY ("active_agent_run_id", "story_project_id")
  REFERENCES "story_agent_runs"("id", "story_project_id") ON DELETE RESTRICT;

-- Existing projects receive the same permanent serialization row as projects
-- created after this migration. There is intentionally no nullable/fallback
-- path in application code when this invariant is missing.
INSERT INTO "story_project_write_states" ("story_project_id")
SELECT "id" FROM "story_projects"
ON CONFLICT ("story_project_id") DO NOTHING;

CREATE OR REPLACE FUNCTION "story_project_write_state_required"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "story_project_write_states"
    WHERE "story_project_id" = NEW."id"
  ) THEN
    RAISE EXCEPTION 'Story project % has no permanent write state', NEW."id"
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "story_projects_write_state_required_trg"
AFTER INSERT ON "story_projects"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "story_project_write_state_required"();

COMMIT;
