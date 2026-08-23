-- Explicit Story production generation bridge.
--
-- A persisted AssetSpec / StoryboardClip is still a logical definition only.
-- This migration adds a durable, user-triggered generation intent that links
-- the immutable target snapshot to the generic AiJob and, after completion,
-- to one or more creative media versions. No generated URL is stored on the
-- logical target or in its generation snapshot.

CREATE TYPE "StoryProductionGenerationKind" AS ENUM ('image', 'video');
CREATE TYPE "StoryProductionGenerationTargetKind" AS ENUM ('asset_spec', 'storyboard_clip');

-- AiJobOutput.id is globally unique already. The composite key additionally
-- lets creative versions prove that their output belongs to the same AiJob as
-- their StoryProductionGeneration without trusting application code.
CREATE UNIQUE INDEX "ai_outputs_id_job_unique"
  ON "ai_outputs" ("id", "job_id");

CREATE TABLE "story_production_generations" (
  "id" UUID NOT NULL,
  "story_project_id" UUID NOT NULL,
  "story_chapter_id" UUID NOT NULL,
  "target_kind" "StoryProductionGenerationTargetKind" NOT NULL,
  "generation_kind" "StoryProductionGenerationKind" NOT NULL,
  "asset_spec_id" UUID,
  "storyboard_clip_id" UUID,
  "ai_job_id" UUID NOT NULL,
  "actor_user_id" VARCHAR(64) NOT NULL,
  "idempotency_key" VARCHAR(160) NOT NULL,
  "request_fingerprint" VARCHAR(64) NOT NULL,
  "target_version" INTEGER NOT NULL,
  "target_source_fingerprint" VARCHAR(64) NOT NULL,
  "prompt_snapshot" JSONB NOT NULL,
  "submission_snapshot" JSONB NOT NULL,
  "retry_of_generation_id" UUID,
  "materialized_at" TIMESTAMPTZ(6),
  "materialization_error" JSONB,
  "reconcile_attempts" INTEGER NOT NULL DEFAULT 0,
  "last_reconciled_at" TIMESTAMPTZ(6),
  "next_reconcile_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "story_production_generations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_production_generations_target_shape_chk" CHECK (
    ("target_kind" = 'asset_spec' AND "asset_spec_id" IS NOT NULL AND "storyboard_clip_id" IS NULL)
    OR
    ("target_kind" = 'storyboard_clip' AND "asset_spec_id" IS NULL AND "storyboard_clip_id" IS NOT NULL)
  ),
  CONSTRAINT "story_production_generations_identity_chk" CHECK (
    btrim("actor_user_id") <> ''
    AND btrim("idempotency_key") <> ''
    AND "request_fingerprint" ~ '^[0-9a-f]{64}$'
    AND "target_source_fingerprint" ~ '^[0-9a-f]{64}$'
    AND "target_version" >= 0
  ),
  CONSTRAINT "story_production_generations_snapshots_chk" CHECK (
    jsonb_typeof("prompt_snapshot") = 'object'
    AND jsonb_typeof("submission_snapshot") = 'object'
  ),
  CONSTRAINT "story_production_generations_reconcile_chk" CHECK (
    "reconcile_attempts" >= 0
    AND (
      "materialized_at" IS NULL
      OR ("materialization_error" IS NULL AND "next_reconcile_at" IS NULL)
    )
  ),
  CONSTRAINT "story_production_generations_retry_self_chk" CHECK (
    "retry_of_generation_id" IS NULL OR "retry_of_generation_id" <> "id"
  )
);

CREATE UNIQUE INDEX "story_production_generations_ai_job_unique"
  ON "story_production_generations" ("ai_job_id");
CREATE UNIQUE INDEX "story_production_generations_id_job_unique"
  ON "story_production_generations" ("id", "ai_job_id");
CREATE UNIQUE INDEX "story_production_generations_actor_key_unique"
  ON "story_production_generations" ("story_chapter_id", "actor_user_id", "idempotency_key");
CREATE INDEX "story_production_generations_target_recent_idx"
  ON "story_production_generations" (
    "story_project_id",
    "story_chapter_id",
    "target_kind",
    "asset_spec_id",
    "storyboard_clip_id",
    "created_at" DESC
  );
CREATE INDEX "story_production_generations_reconcile_idx"
  ON "story_production_generations" ("materialized_at", "next_reconcile_at", "created_at");
CREATE INDEX "story_production_generations_retry_idx"
  ON "story_production_generations" ("retry_of_generation_id");

ALTER TABLE "story_production_generations"
  ADD CONSTRAINT "story_production_generations_project_fkey"
    FOREIGN KEY ("story_project_id") REFERENCES "story_projects" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "story_production_generations_chapter_scope_fkey"
    FOREIGN KEY ("story_chapter_id", "story_project_id")
    REFERENCES "story_chapters" ("id", "story_project_id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "story_production_generations_asset_scope_fkey"
    FOREIGN KEY ("asset_spec_id", "story_chapter_id", "story_project_id")
    REFERENCES "story_asset_specs" ("id", "story_chapter_id", "story_project_id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "story_production_generations_clip_scope_fkey"
    FOREIGN KEY ("storyboard_clip_id", "story_chapter_id", "story_project_id")
    REFERENCES "story_storyboard_clips" ("id", "story_chapter_id", "story_project_id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "story_production_generations_ai_job_fkey"
    FOREIGN KEY ("ai_job_id") REFERENCES "ai_jobs" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "story_production_generations_retry_fkey"
    FOREIGN KEY ("retry_of_generation_id") REFERENCES "story_production_generations" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Target and job identity are immutable. Reconciliation may only update its
-- own projection metadata after the request transaction commits.
CREATE FUNCTION "story_production_generation_enforce_immutable"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    OLD."id",
    OLD."story_project_id",
    OLD."story_chapter_id",
    OLD."target_kind",
    OLD."generation_kind",
    OLD."asset_spec_id",
    OLD."storyboard_clip_id",
    OLD."ai_job_id",
    OLD."actor_user_id",
    OLD."idempotency_key",
    OLD."request_fingerprint",
    OLD."target_version",
    OLD."target_source_fingerprint",
    OLD."prompt_snapshot",
    OLD."submission_snapshot",
    OLD."retry_of_generation_id",
    OLD."created_at"
  ) IS DISTINCT FROM ROW(
    NEW."id",
    NEW."story_project_id",
    NEW."story_chapter_id",
    NEW."target_kind",
    NEW."generation_kind",
    NEW."asset_spec_id",
    NEW."storyboard_clip_id",
    NEW."ai_job_id",
    NEW."actor_user_id",
    NEW."idempotency_key",
    NEW."request_fingerprint",
    NEW."target_version",
    NEW."target_source_fingerprint",
    NEW."prompt_snapshot",
    NEW."submission_snapshot",
    NEW."retry_of_generation_id",
    NEW."created_at"
  ) THEN
    RAISE EXCEPTION 'Story production generation identity is immutable'
      USING ERRCODE = '23514',
            CONSTRAINT = 'story_production_generations_immutable_chk';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_production_generations_immutable_trigger"
BEFORE UPDATE ON "story_production_generations"
FOR EACH ROW
EXECUTE FUNCTION "story_production_generation_enforce_immutable"();

-- A Storyboard generation must preserve the persisted clip's media kind. The
-- foreign key handles missing clips; this trigger prevents image/video drift
-- that a cross-table CHECK constraint cannot express.
CREATE FUNCTION "story_production_generation_validate_target_kind"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  persisted_clip_kind TEXT;
BEGIN
  IF NEW."target_kind" = 'storyboard_clip' THEN
    SELECT "kind"::TEXT
      INTO persisted_clip_kind
      FROM "story_storyboard_clips"
      WHERE "id" = NEW."storyboard_clip_id"
        AND "story_chapter_id" = NEW."story_chapter_id"
        AND "story_project_id" = NEW."story_project_id";

    IF FOUND AND persisted_clip_kind <> NEW."generation_kind"::TEXT THEN
      RAISE EXCEPTION 'Storyboard clip kind and generation kind must match'
        USING ERRCODE = '23514',
              CONSTRAINT = 'story_production_generations_target_kind_chk';
    END IF;
  END IF;

  -- Retry lineage is target-local. A failed request may only be replayed for
  -- the exact same project/chapter/target/media kind; otherwise cleanup and
  -- audit semantics become ambiguous even if the API was bypassed.
  IF NEW."retry_of_generation_id" IS NOT NULL THEN
    PERFORM 1
      FROM "story_production_generations" AS original
      WHERE original."id" = NEW."retry_of_generation_id"
        AND original."story_project_id" = NEW."story_project_id"
        AND original."story_chapter_id" = NEW."story_chapter_id"
        AND original."target_kind" = NEW."target_kind"
        AND original."generation_kind" = NEW."generation_kind"
        AND original."asset_spec_id" IS NOT DISTINCT FROM NEW."asset_spec_id"
        AND original."storyboard_clip_id" IS NOT DISTINCT FROM NEW."storyboard_clip_id";

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Story production generation retry must preserve its canonical target'
        USING ERRCODE = '23514',
              CONSTRAINT = 'story_production_generations_retry_target_chk';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_production_generations_target_kind_trigger"
BEFORE INSERT OR UPDATE OF
  "target_kind",
  "generation_kind",
  "storyboard_clip_id",
  "story_chapter_id",
  "story_project_id",
  "retry_of_generation_id"
ON "story_production_generations"
FOR EACH ROW
EXECUTE FUNCTION "story_production_generation_validate_target_kind"();

ALTER TABLE "story_asset_media_versions"
  ADD COLUMN "generation_id" UUID,
  ADD COLUMN "ai_job_id" UUID,
  ADD COLUMN "ai_job_output_id" TEXT;

CREATE UNIQUE INDEX "story_asset_media_versions_ai_output_unique"
  ON "story_asset_media_versions" ("ai_job_output_id");
CREATE INDEX "story_asset_media_versions_generation_idx"
  ON "story_asset_media_versions" ("generation_id");
CREATE INDEX "story_asset_media_versions_ai_job_idx"
  ON "story_asset_media_versions" ("ai_job_id");

ALTER TABLE "story_asset_media_versions"
  ADD CONSTRAINT "story_asset_media_versions_generation_shape_chk" CHECK (
    ("generation_id" IS NULL AND "ai_job_id" IS NULL AND "ai_job_output_id" IS NULL)
    OR
    ("generation_id" IS NOT NULL AND "ai_job_id" IS NOT NULL AND "ai_job_output_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "story_asset_media_versions_generation_job_fkey"
    FOREIGN KEY ("generation_id", "ai_job_id")
    REFERENCES "story_production_generations" ("id", "ai_job_id")
    ON DELETE NO ACTION ON UPDATE CASCADE,
  ADD CONSTRAINT "story_asset_media_versions_ai_output_job_fkey"
    FOREIGN KEY ("ai_job_output_id", "ai_job_id")
    REFERENCES "ai_outputs" ("id", "job_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "story_storyboard_clip_media_versions"
  ADD COLUMN "generation_id" UUID,
  ADD COLUMN "ai_job_id" UUID,
  ADD COLUMN "ai_job_output_id" TEXT;

CREATE UNIQUE INDEX "story_storyboard_media_versions_ai_output_unique"
  ON "story_storyboard_clip_media_versions" ("ai_job_output_id");
CREATE INDEX "story_storyboard_media_versions_generation_idx"
  ON "story_storyboard_clip_media_versions" ("generation_id");
CREATE INDEX "story_storyboard_media_versions_ai_job_idx"
  ON "story_storyboard_clip_media_versions" ("ai_job_id");

ALTER TABLE "story_storyboard_clip_media_versions"
  ADD CONSTRAINT "story_storyboard_media_versions_generation_shape_chk" CHECK (
    ("generation_id" IS NULL AND "ai_job_id" IS NULL AND "ai_job_output_id" IS NULL)
    OR
    ("generation_id" IS NOT NULL AND "ai_job_id" IS NOT NULL AND "ai_job_output_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "story_storyboard_media_versions_generation_job_fkey"
    FOREIGN KEY ("generation_id", "ai_job_id")
    REFERENCES "story_production_generations" ("id", "ai_job_id")
    ON DELETE NO ACTION ON UPDATE CASCADE,
  ADD CONSTRAINT "story_storyboard_media_versions_ai_output_job_fkey"
    FOREIGN KEY ("ai_job_output_id", "ai_job_id")
    REFERENCES "ai_outputs" ("id", "job_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
