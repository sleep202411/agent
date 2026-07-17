-- Story Studio has no retained creator data at this cut-over. Explicitly reset
-- every Story table that survives this migration before any ALTER/NOT NULL
-- work. Retired story_film_* tables are dropped below. Do not rely on the
-- project-root FK cascade here: an older database may have a missing constraint
-- or orphaned Build row, and those rows must still be removed rather than
-- backfilled.
BEGIN;

TRUNCATE TABLE
  "story_build_assets",
  "story_builds",
  "story_canvas_layouts",
  "story_drafts",
  "story_experience_publications",
  "story_project_members",
  "story_projects",
  "story_revisions",
  "story_video_upload_sessions"
RESTART IDENTITY CASCADE;

-- Remove every surviving trigger whose body still names the retired film
-- tables/columns. Several live on media_assets/story_builds/story_projects,
-- so dropping only the old tables would leave runtime-failing trigger code.
DROP TRIGGER IF EXISTS "media_assets_story_current_video_invalidation_trg"
  ON "media_assets";
DROP TRIGGER IF EXISTS "media_asset_variants_story_current_video_invalidation_trg"
  ON "media_asset_variants";
DROP TRIGGER IF EXISTS "story_builds_ready_guard_trg" ON "story_builds";
DROP TRIGGER IF EXISTS "story_builds_lifecycle_guard_trg" ON "story_builds";
DROP TRIGGER IF EXISTS "story_projects_archive_guard_trg" ON "story_projects";

DROP FUNCTION IF EXISTS "story_generation_attempt_lifecycle_guard"() CASCADE;
DROP FUNCTION IF EXISTS "story_trailer_generation_attempt_lifecycle_guard"() CASCADE;
DROP FUNCTION IF EXISTS "story_generation_attempt_integrity_guard"() CASCADE;
DROP FUNCTION IF EXISTS "story_generation_attempt_reference_guard"() CASCADE;
DROP FUNCTION IF EXISTS "story_current_video_guard"() CASCADE;
DROP FUNCTION IF EXISTS "story_film_clip_version_guard"() CASCADE;
DROP FUNCTION IF EXISTS "story_film_trailer_version_guard"() CASCADE;
DROP FUNCTION IF EXISTS "story_film_spec_version_guard"() CASCADE;
DROP FUNCTION IF EXISTS "story_film_clip_frame_profile_guard"() CASCADE;
DROP FUNCTION IF EXISTS "story_film_clip_head_on_insert"() CASCADE;
DROP FUNCTION IF EXISTS "story_film_spec_frame_profile_guard"() CASCADE;
DROP FUNCTION IF EXISTS "story_film_spec_model_guard"() CASCADE;
DROP FUNCTION IF EXISTS "story_film_trailer_head_on_insert"() CASCADE;
DROP FUNCTION IF EXISTS "story_film_trailer_reference_mode_guard"() CASCADE;
DROP FUNCTION IF EXISTS "story_reference_approval_invalidate_production"() CASCADE;
DROP FUNCTION IF EXISTS "story_media_asset_invalidate_current_video"() CASCADE;
DROP FUNCTION IF EXISTS "story_media_variant_invalidate_current_video"() CASCADE;
DROP FUNCTION IF EXISTS "story_generation_frame_reference_provenance_guard"() CASCADE;
DROP FUNCTION IF EXISTS "story_continuity_asset_inputs_guard"() CASCADE;
DROP FUNCTION IF EXISTS "story_continuity_check_version_guard"() CASCADE;
DROP FUNCTION IF EXISTS "story_reference_review_revision_guard"() CASCADE;
DROP FUNCTION IF EXISTS "story_reference_review_bump_revision"() CASCADE;
DROP FUNCTION IF EXISTS "story_reference_approval_guard"() CASCADE;
DROP FUNCTION IF EXISTS "story_reference_slot_approved_pointer_guard"() CASCADE;
DROP FUNCTION IF EXISTS "story_reference_version_lifecycle_guard"() CASCADE;
DROP FUNCTION IF EXISTS "story_reference_workspace_guard"() CASCADE;
DROP FUNCTION IF EXISTS "story_film_reference_slot_version_guard"() CASCADE;
DROP FUNCTION IF EXISTS "story_clip_reference_mode_guard"() CASCADE;
DROP FUNCTION IF EXISTS "story_reference_slot_kind_bindings_guard"() CASCADE;
DROP FUNCTION IF EXISTS "story_clip_mode_existing_references_guard"() CASCADE;
DROP FUNCTION IF EXISTS "story_dependency_join_frame_guard"() CASCADE;
DROP FUNCTION IF EXISTS "story_dependency_version_guard"() CASCADE;
DROP FUNCTION IF EXISTS "story_film_bump_production_revision"() CASCADE;
DROP FUNCTION IF EXISTS "story_build_ready_guard"() CASCADE;
DROP FUNCTION IF EXISTS "story_build_lifecycle_guard"() CASCADE;
DROP FUNCTION IF EXISTS "story_project_archive_guard"() CASCADE;
DROP FUNCTION IF EXISTS "story_assert_film_scope"() CASCADE;
DROP FUNCTION IF EXISTS "story_reference_approval_asset_moderation_guard"() CASCADE;
DROP FUNCTION IF EXISTS "story_reference_pointer_asset_moderation_guard"() CASCADE;
DROP FUNCTION IF EXISTS "story_reference_version_submission_key_immutable"() CASCADE;
DROP FUNCTION IF EXISTS "story_release_approval_guard"() CASCADE;

DROP FUNCTION IF EXISTS "story_clip_reference_role_matches_slot_kind"(
  "StoryFilmClipReferenceRole", "StoryFilmReferenceKind"
) CASCADE;

DROP TABLE IF EXISTS "story_film_build_clips" CASCADE;
DROP TABLE IF EXISTS "story_film_continuity_checks" CASCADE;
DROP TABLE IF EXISTS "story_film_clip_dependencies" CASCADE;
DROP TABLE IF EXISTS "story_film_generation_attempt_references" CASCADE;
DROP TABLE IF EXISTS "story_film_trailer_generation_attempt_references" CASCADE;
DROP TABLE IF EXISTS "story_film_generation_attempts" CASCADE;
DROP TABLE IF EXISTS "story_film_trailer_generation_attempts" CASCADE;
DROP TABLE IF EXISTS "story_film_clip_references" CASCADE;
DROP TABLE IF EXISTS "story_film_trailer_references" CASCADE;
DROP TABLE IF EXISTS "story_film_clip_heads" CASCADE;
DROP TABLE IF EXISTS "story_film_trailer_heads" CASCADE;
DROP TABLE IF EXISTS "story_film_clips" CASCADE;
DROP TABLE IF EXISTS "story_film_trailers" CASCADE;
DROP TABLE IF EXISTS "story_film_reference_approvals" CASCADE;
DROP TABLE IF EXISTS "story_film_reference_reviews" CASCADE;
DROP TABLE IF EXISTS "story_film_reference_versions" CASCADE;
DROP TABLE IF EXISTS "story_film_reference_slots" CASCADE;
DROP TABLE IF EXISTS "story_film_specs" CASCADE;

DROP TYPE IF EXISTS "StoryFilmClipReferenceRole";
DROP TYPE IF EXISTS "StoryFilmContinuityDecision";
DROP TYPE IF EXISTS "StoryFilmDependencyKind";
DROP TYPE IF EXISTS "StoryFilmDependencyTransition";
DROP TYPE IF EXISTS "StoryFilmFrameMode";
DROP TYPE IF EXISTS "StoryFilmGenerationAttemptStatus";
DROP TYPE IF EXISTS "StoryFilmGenerationMode";
DROP TYPE IF EXISTS "StoryFilmReferenceKind";
DROP TYPE IF EXISTS "StoryFilmReferenceSource";
DROP TYPE IF EXISTS "StoryFilmReferenceVersionStatus";

CREATE TYPE "StoryReferenceKind" AS ENUM (
  'character', 'location', 'prop', 'graphic', 'style',
  'join_frame', 'first_frame', 'last_frame'
);
CREATE TYPE "StoryReferenceSource" AS ENUM (
  'upload', 'ai_job', 'import', 'generation_frame'
);
CREATE TYPE "StoryReferenceVersionStatus" AS ENUM (
  'pending', 'processing', 'ready', 'failed'
);
CREATE TYPE "StoryVideoTargetKind" AS ENUM ('clip', 'trailer');
CREATE TYPE "StoryVideoReferenceRole" AS ENUM (
  'reference', 'first_frame', 'last_frame'
);
CREATE TYPE "StoryVideoGenerationAttemptStatus" AS ENUM (
  'queued', 'running', 'processing', 'ready', 'superseded', 'failed', 'cancelled'
);

ALTER TABLE "media_asset_variants"
  ADD COLUMN "has_audio" BOOLEAN,
  ADD COLUMN "duration_ms" INTEGER,
  ADD CONSTRAINT "media_asset_variants_duration_ms_chk"
    CHECK ("duration_ms" IS NULL OR "duration_ms" > 0);
CREATE UNIQUE INDEX "media_asset_variants_id_asset_unique"
  ON "media_asset_variants"("id", "asset_id");

ALTER TABLE "story_builds"
  DROP CONSTRAINT IF EXISTS "story_builds_source_revision_id_fkey",
  DROP COLUMN "source_production_revision",
  ADD COLUMN "source_draft_revision" INTEGER NOT NULL,
  ADD COLUMN "video_snapshot_hash" VARCHAR(64) NOT NULL;

ALTER TABLE "story_builds"
  ADD CONSTRAINT "story_builds_source_draft_revision_chk"
    CHECK ("source_draft_revision" >= 0),
  ADD CONSTRAINT "story_builds_video_snapshot_hash_chk"
    CHECK ("video_snapshot_hash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "story_build_assets"
  ADD COLUMN "has_audio" BOOLEAN,
  ADD COLUMN "browser_safe_mp4" BOOLEAN;
ALTER TABLE "story_build_assets"
  ADD CONSTRAINT "story_build_assets_video_metadata_chk" CHECK (
    "role" <> 'video' OR (
      "content_type" = 'video/mp4' AND
      "browser_safe_mp4" IS TRUE AND
      "has_audio" IS NOT NULL AND
      "duration_ms" > 0 AND
      "width" > 0 AND
      "height" > 0
    )
  );
ALTER TABLE "story_build_assets"
  DROP CONSTRAINT IF EXISTS "story_build_assets_variant_id_fkey";
ALTER TABLE "story_build_assets"
  ADD CONSTRAINT "story_build_assets_variant_id_asset_id_fkey"
  FOREIGN KEY ("variant_id", "asset_id")
  REFERENCES "media_asset_variants"("id", "asset_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "story_reference_slots" (
  "id" UUID NOT NULL,
  "story_project_id" UUID NOT NULL,
  "key" VARCHAR(80) NOT NULL,
  "kind" "StoryReferenceKind" NOT NULL,
  "label" VARCHAR(240) NOT NULL,
  "description" TEXT,
  "required" BOOLEAN NOT NULL DEFAULT true,
  "rank" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 0,
  "approved_version_id" UUID,
  "archived_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_reference_slots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_reference_slots_key_nonempty_chk"
    CHECK (btrim("key") <> ''),
  CONSTRAINT "story_reference_slots_version_chk"
    CHECK ("version" >= 0 AND "rank" >= 0)
);

CREATE TABLE "story_video_selections" (
  "id" UUID NOT NULL,
  "story_project_id" UUID NOT NULL,
  "target_kind" "StoryVideoTargetKind" NOT NULL,
  "target_key" VARCHAR(128) NOT NULL,
  "current_asset_id" UUID,
  "current_variant_id" UUID,
  "current_source_generation_attempt_id" UUID,
  "current_checksum_sha256" VARCHAR(64),
  "current_content_type" VARCHAR(128),
  "current_duration_ms" INTEGER,
  "current_width" INTEGER,
  "current_height" INTEGER,
  "current_browser_safe_mp4" BOOLEAN,
  "current_has_audio" BOOLEAN,
  "version" INTEGER NOT NULL DEFAULT 0,
  "set_by_user_id" VARCHAR(64),
  "set_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_video_selections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_video_selections_target_chk" CHECK (
    btrim("target_key") <> '' AND
    ("target_kind" <> 'trailer' OR "target_key" = 'trailer')
  ),
  CONSTRAINT "story_video_selections_version_chk" CHECK ("version" >= 0),
  CONSTRAINT "story_video_selections_media_shape_chk" CHECK (
    (
      "current_asset_id" IS NULL AND
      "current_variant_id" IS NULL AND
      "current_source_generation_attempt_id" IS NULL AND
      "current_checksum_sha256" IS NULL AND
      "current_content_type" IS NULL AND
      "current_duration_ms" IS NULL AND
      "current_width" IS NULL AND
      "current_height" IS NULL AND
      "current_browser_safe_mp4" IS NULL AND
      "current_has_audio" IS NULL
    ) OR (
      "current_asset_id" IS NOT NULL AND
      "current_variant_id" IS NOT NULL AND
      "current_checksum_sha256" ~ '^[0-9a-f]{64}$' AND
      "current_content_type" = 'video/mp4' AND
      "current_duration_ms" > 0 AND
      "current_width" > 0 AND
      "current_height" > 0 AND
      "current_browser_safe_mp4" IS TRUE AND
      "current_has_audio" IS NOT NULL AND
      "set_at" IS NOT NULL
    )
  )
);

CREATE TABLE "story_video_generation_attempts" (
  "id" UUID NOT NULL,
  "story_project_id" UUID NOT NULL,
  "selection_id" UUID NOT NULL,
  "attempt_number" INTEGER NOT NULL,
  "submission_key" VARCHAR(240) NOT NULL,
  "request_fingerprint" VARCHAR(64) NOT NULL,
  "status" "StoryVideoGenerationAttemptStatus" NOT NULL DEFAULT 'queued',
  "selection_version_at_submit" INTEGER NOT NULL,
  "recipe_snapshot" JSONB NOT NULL,
  "ai_job_id" UUID NOT NULL,
  "ai_job_output_id" TEXT,
  "output_asset_id" UUID,
  "output_variant_id" UUID,
  "output_checksum_sha256" VARCHAR(64),
  "technical_checks" JSONB NOT NULL DEFAULT '[]',
  "error" JSONB,
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_by_user_id" VARCHAR(64) NOT NULL,
  "queued_at" TIMESTAMPTZ(6),
  "started_at" TIMESTAMPTZ(6),
  "ready_at" TIMESTAMPTZ(6),
  "cancelled_at" TIMESTAMPTZ(6),
  "superseded_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_video_generation_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_video_generation_attempts_counters_chk" CHECK (
    "attempt_number" > 0 AND
    "selection_version_at_submit" > 0 AND
    "version" >= 0
  ),
  CONSTRAINT "story_video_generation_attempts_identity_chk" CHECK (
    btrim("submission_key") <> '' AND
    "request_fingerprint" ~ '^[0-9a-f]{64}$' AND
    jsonb_typeof("recipe_snapshot") = 'object' AND
    jsonb_typeof("technical_checks") = 'array'
  ),
  CONSTRAINT "story_video_generation_attempts_output_identity_chk" CHECK (
    (
      "ai_job_output_id" IS NULL AND
      "output_asset_id" IS NULL AND
      "output_variant_id" IS NULL AND
      "output_checksum_sha256" IS NULL
    ) OR (
      "ai_job_output_id" IS NOT NULL AND
      "output_asset_id" IS NOT NULL AND
      "output_variant_id" IS NOT NULL AND
      "output_checksum_sha256" ~ '^[0-9a-f]{64}$'
    )
  ),
  CONSTRAINT "story_video_generation_attempts_output_shape_chk" CHECK (
    ("status" NOT IN ('ready', 'superseded')) OR (
      "ai_job_output_id" IS NOT NULL AND
      "output_asset_id" IS NOT NULL AND
      "output_variant_id" IS NOT NULL AND
      "output_checksum_sha256" ~ '^[0-9a-f]{64}$' AND
      "ready_at" IS NOT NULL AND
      "completed_at" IS NOT NULL
    )
  ),
  CONSTRAINT "story_video_generation_attempts_terminal_shape_chk" CHECK (
    ("status" <> 'cancelled' OR
      ("cancelled_at" IS NOT NULL AND "completed_at" IS NOT NULL)) AND
    ("status" <> 'superseded' OR "superseded_at" IS NOT NULL) AND
    ("status" <> 'failed' OR
      ("error" IS NOT NULL AND "completed_at" IS NOT NULL))
  )
);

CREATE TABLE "story_reference_versions" (
  "id" UUID NOT NULL,
  "story_project_id" UUID NOT NULL,
  "reference_slot_id" UUID NOT NULL,
  "version_number" INTEGER NOT NULL,
  "submission_key" VARCHAR(240) NOT NULL,
  "request_fingerprint" VARCHAR(64) NOT NULL,
  "source" "StoryReferenceSource" NOT NULL,
  "status" "StoryReferenceVersionStatus" NOT NULL DEFAULT 'pending',
  "ai_job_id" UUID,
  "ai_job_output_id" TEXT,
  "source_generation_attempt_id" UUID,
  "source_frame_index" INTEGER,
  "source_output_checksum_sha256" VARCHAR(64),
  "asset_id" UUID NOT NULL,
  "variant_id" UUID NOT NULL,
  "source_recipe_snapshot" JSONB,
  "checksum_sha256" VARCHAR(64) NOT NULL,
  "error" JSONB,
  "review_revision" INTEGER NOT NULL DEFAULT 0,
  "created_by_user_id" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ready_at" TIMESTAMPTZ(6),
  CONSTRAINT "story_reference_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_reference_versions_identity_chk" CHECK (
    "version_number" > 0 AND
    btrim("submission_key") <> '' AND
    "request_fingerprint" ~ '^[0-9a-f]{64}$' AND
    "checksum_sha256" ~ '^[0-9a-f]{64}$' AND
    "review_revision" >= 0 AND
    (
      "source_recipe_snapshot" IS NULL OR
      jsonb_typeof("source_recipe_snapshot") = 'object'
    )
  ),
  CONSTRAINT "story_reference_versions_ai_source_chk" CHECK (
    (
      "source" = 'ai_job' AND
      "ai_job_id" IS NOT NULL AND
      "ai_job_output_id" IS NOT NULL
    ) OR (
      "source" <> 'ai_job' AND
      "ai_job_id" IS NULL AND
      "ai_job_output_id" IS NULL
    )
  ),
  CONSTRAINT "story_reference_versions_frame_source_chk" CHECK (
    (
      "source" = 'generation_frame' AND
      "source_generation_attempt_id" IS NOT NULL AND
      "source_frame_index" IS NOT NULL AND
      "source_frame_index" >= 0 AND
      "source_output_checksum_sha256" ~ '^[0-9a-f]{64}$'
    ) OR (
      "source" <> 'generation_frame' AND
      "source_generation_attempt_id" IS NULL AND
      "source_frame_index" IS NULL AND
      "source_output_checksum_sha256" IS NULL
    )
  ),
  CONSTRAINT "story_reference_versions_status_shape_chk" CHECK (
    (
      "status" = 'ready' AND
      "ready_at" IS NOT NULL AND
      "error" IS NULL
    ) OR (
      "status" = 'failed' AND
      "ready_at" IS NULL AND
      "error" IS NOT NULL
    ) OR (
      "status" IN ('pending', 'processing') AND
      "ready_at" IS NULL
    )
  )
);

CREATE TABLE "story_reference_reviews" (
  "id" UUID NOT NULL,
  "reference_version_id" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "decision" "StoryReviewDecision" NOT NULL,
  "technical_passed" BOOLEAN NOT NULL,
  "safety_passed" BOOLEAN NOT NULL,
  "checklist" JSONB NOT NULL DEFAULT '{}',
  "notes" TEXT,
  "reviewer_user_id" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_reference_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_reference_reviews_sequence_chk" CHECK ("sequence" > 0),
  CONSTRAINT "story_reference_reviews_checklist_chk"
    CHECK (jsonb_typeof("checklist") = 'object')
);

CREATE TABLE "story_reference_approvals" (
  "reference_version_id" UUID NOT NULL,
  "review_id" UUID NOT NULL,
  "approved_by_user_id" VARCHAR(64) NOT NULL,
  "approved_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_reference_approvals_pkey" PRIMARY KEY ("reference_version_id")
);

CREATE TABLE "story_video_generation_attempt_references" (
  "story_project_id" UUID NOT NULL,
  "attempt_id" UUID NOT NULL,
  "reference_slot_id" UUID NOT NULL,
  "reference_version_id" UUID NOT NULL,
  "role" "StoryVideoReferenceRole" NOT NULL,
  "position" INTEGER NOT NULL,
  "asset_id" UUID NOT NULL,
  "variant_id" UUID NOT NULL,
  "checksum_sha256" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_video_generation_attempt_references_pkey"
    PRIMARY KEY ("attempt_id", "role", "position"),
  CONSTRAINT "story_video_generation_attempt_references_position_chk"
    CHECK ("position" >= 0),
  CONSTRAINT "story_video_generation_attempt_references_hash_chk"
    CHECK ("checksum_sha256" ~ '^[0-9a-f]{64}$')
);

CREATE TABLE "story_video_build_clips" (
  "build_id" UUID NOT NULL,
  "story_project_id" UUID NOT NULL,
  "graph_node_id" VARCHAR(128) NOT NULL,
  "source_generation_attempt_id" UUID,
  "build_asset_id" UUID NOT NULL,
  "logical_key" VARCHAR(160) NOT NULL,
  "checksum_sha256" VARCHAR(64) NOT NULL,
  "content_type" VARCHAR(128) NOT NULL,
  "duration_ms" INTEGER NOT NULL,
  "width" INTEGER,
  "height" INTEGER,
  "browser_safe_mp4" BOOLEAN NOT NULL,
  "has_audio" BOOLEAN NOT NULL,
  "rank" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_video_build_clips_pkey" PRIMARY KEY ("build_id", "graph_node_id"),
  CONSTRAINT "story_video_build_clips_media_chk" CHECK (
    btrim("graph_node_id") <> '' AND
    btrim("logical_key") <> '' AND
    "checksum_sha256" ~ '^[0-9a-f]{64}$' AND
    "content_type" = 'video/mp4' AND
    "duration_ms" > 0 AND
    "width" > 0 AND
    "height" > 0 AND
    "browser_safe_mp4" IS TRUE AND
    "rank" >= 0
  )
);

CREATE UNIQUE INDEX "story_reference_slots_project_key_unique"
  ON "story_reference_slots"("story_project_id", "key");
CREATE UNIQUE INDEX "story_reference_slots_scope_unique"
  ON "story_reference_slots"("id", "story_project_id");
CREATE UNIQUE INDEX "story_reference_slots_approved_slot_unique"
  ON "story_reference_slots"("approved_version_id", "id");
CREATE INDEX "story_reference_slots_project_kind_idx"
  ON "story_reference_slots"("story_project_id", "kind", "rank");

CREATE UNIQUE INDEX "story_reference_versions_submission_key_key"
  ON "story_reference_versions"("submission_key");
CREATE UNIQUE INDEX "story_reference_versions_ai_job_output_id_key"
  ON "story_reference_versions"("ai_job_output_id");
CREATE UNIQUE INDEX "story_reference_versions_slot_number_unique"
  ON "story_reference_versions"("reference_slot_id", "version_number");
CREATE UNIQUE INDEX "story_reference_versions_scope_unique"
  ON "story_reference_versions"("id", "story_project_id");
CREATE UNIQUE INDEX "story_reference_versions_id_slot_unique"
  ON "story_reference_versions"("id", "reference_slot_id");
CREATE UNIQUE INDEX "story_reference_versions_slot_scope_unique"
  ON "story_reference_versions"("id", "reference_slot_id", "story_project_id");
CREATE INDEX "story_reference_versions_project_status_idx"
  ON "story_reference_versions"("story_project_id", "status", "created_at" DESC);
CREATE INDEX "story_reference_versions_ai_job_idx"
  ON "story_reference_versions"("ai_job_id");
CREATE INDEX "story_reference_versions_source_generation_frame_idx"
  ON "story_reference_versions"("source_generation_attempt_id", "source_frame_index");

CREATE UNIQUE INDEX "story_reference_reviews_version_sequence_unique"
  ON "story_reference_reviews"("reference_version_id", "sequence");
CREATE UNIQUE INDEX "story_reference_reviews_id_version_unique"
  ON "story_reference_reviews"("id", "reference_version_id");
CREATE UNIQUE INDEX "story_reference_approvals_review_version_unique"
  ON "story_reference_approvals"("review_id", "reference_version_id");

CREATE UNIQUE INDEX "story_video_selections_target_unique"
  ON "story_video_selections"("story_project_id", "target_kind", "target_key");
CREATE UNIQUE INDEX "story_video_selections_id_project_unique"
  ON "story_video_selections"("id", "story_project_id");
CREATE UNIQUE INDEX "story_video_selections_current_attempt_unique"
  ON "story_video_selections"("current_source_generation_attempt_id", "id");
CREATE INDEX "story_video_selections_project_kind_idx"
  ON "story_video_selections"("story_project_id", "target_kind", "updated_at" DESC);

CREATE UNIQUE INDEX "story_video_generation_attempts_submission_key_key"
  ON "story_video_generation_attempts"("submission_key");
CREATE UNIQUE INDEX "story_video_generation_attempts_ai_job_id_key"
  ON "story_video_generation_attempts"("ai_job_id");
CREATE UNIQUE INDEX "story_video_generation_attempts_ai_job_output_id_key"
  ON "story_video_generation_attempts"("ai_job_output_id");
CREATE UNIQUE INDEX "story_video_generation_attempts_selection_number_unique"
  ON "story_video_generation_attempts"("selection_id", "attempt_number");
CREATE UNIQUE INDEX "story_video_generation_attempts_selection_version_unique"
  ON "story_video_generation_attempts"("selection_id", "selection_version_at_submit");
CREATE UNIQUE INDEX "story_video_generation_attempts_id_project_unique"
  ON "story_video_generation_attempts"("id", "story_project_id");
CREATE UNIQUE INDEX "story_video_generation_attempts_id_selection_unique"
  ON "story_video_generation_attempts"("id", "selection_id");
CREATE INDEX "story_video_generation_attempts_project_status_idx"
  ON "story_video_generation_attempts"("story_project_id", "status", "created_at" DESC);
CREATE INDEX "story_video_generation_attempts_selection_recent_idx"
  ON "story_video_generation_attempts"("selection_id", "created_at" DESC);
CREATE INDEX "story_video_generation_attempt_references_version_idx"
  ON "story_video_generation_attempt_references"("story_project_id", "reference_version_id");

CREATE UNIQUE INDEX "story_video_build_clips_build_asset_id_key"
  ON "story_video_build_clips"("build_asset_id");
CREATE UNIQUE INDEX "story_video_build_clips_asset_build_unique"
  ON "story_video_build_clips"("build_asset_id", "build_id");
CREATE UNIQUE INDEX "story_video_build_clips_build_logical_key_unique"
  ON "story_video_build_clips"("build_id", "logical_key");
CREATE INDEX "story_video_build_clips_project_rank_idx"
  ON "story_video_build_clips"("story_project_id", "rank");

ALTER TABLE "story_reference_slots"
  ADD CONSTRAINT "story_reference_slots_story_project_id_fkey"
  FOREIGN KEY ("story_project_id") REFERENCES "story_projects"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "story_reference_versions"
  ADD CONSTRAINT "story_reference_versions_story_project_id_fkey"
  FOREIGN KEY ("story_project_id") REFERENCES "story_projects"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "story_reference_versions"
  ADD CONSTRAINT "story_reference_versions_reference_slot_id_story_project_i_fkey"
  FOREIGN KEY ("reference_slot_id", "story_project_id")
  REFERENCES "story_reference_slots"("id", "story_project_id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "story_reference_versions"
  ADD CONSTRAINT "story_reference_versions_ai_job_id_fkey"
  FOREIGN KEY ("ai_job_id") REFERENCES "ai_jobs"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "story_reference_versions"
  ADD CONSTRAINT "story_reference_versions_ai_job_output_id_fkey"
  FOREIGN KEY ("ai_job_output_id") REFERENCES "ai_outputs"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "story_reference_versions"
  ADD CONSTRAINT "story_reference_versions_asset_id_fkey"
  FOREIGN KEY ("asset_id") REFERENCES "media_assets"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "story_reference_versions"
  ADD CONSTRAINT "story_reference_versions_variant_id_asset_id_fkey"
  FOREIGN KEY ("variant_id", "asset_id")
  REFERENCES "media_asset_variants"("id", "asset_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "story_reference_reviews"
  ADD CONSTRAINT "story_reference_reviews_reference_version_id_fkey"
  FOREIGN KEY ("reference_version_id") REFERENCES "story_reference_versions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "story_reference_approvals"
  ADD CONSTRAINT "story_reference_approvals_reference_version_id_fkey"
  FOREIGN KEY ("reference_version_id") REFERENCES "story_reference_versions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "story_reference_approvals"
  ADD CONSTRAINT "story_reference_approvals_review_id_fkey"
  FOREIGN KEY ("review_id", "reference_version_id")
  REFERENCES "story_reference_reviews"("id", "reference_version_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "story_video_selections"
  ADD CONSTRAINT "story_video_selections_story_project_id_fkey"
  FOREIGN KEY ("story_project_id") REFERENCES "story_projects"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "story_video_selections"
  ADD CONSTRAINT "story_video_selections_current_asset_id_fkey"
  FOREIGN KEY ("current_asset_id") REFERENCES "media_assets"("id")
  ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "story_video_selections"
  ADD CONSTRAINT "story_video_selections_current_variant_id_current_asset_id_fkey"
  FOREIGN KEY ("current_variant_id", "current_asset_id")
  REFERENCES "media_asset_variants"("id", "asset_id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "story_video_generation_attempts"
  ADD CONSTRAINT "story_video_generation_attempts_story_project_id_fkey"
  FOREIGN KEY ("story_project_id") REFERENCES "story_projects"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "story_video_generation_attempts"
  ADD CONSTRAINT "story_video_generation_attempts_selection_id_story_project_fkey"
  FOREIGN KEY ("selection_id", "story_project_id")
  REFERENCES "story_video_selections"("id", "story_project_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "story_video_generation_attempts"
  ADD CONSTRAINT "story_video_generation_attempts_ai_job_id_fkey"
  FOREIGN KEY ("ai_job_id") REFERENCES "ai_jobs"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "story_video_generation_attempts"
  ADD CONSTRAINT "story_video_generation_attempts_ai_job_output_id_fkey"
  FOREIGN KEY ("ai_job_output_id") REFERENCES "ai_outputs"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "story_video_generation_attempts"
  ADD CONSTRAINT "story_video_generation_attempts_output_asset_id_fkey"
  FOREIGN KEY ("output_asset_id") REFERENCES "media_assets"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "story_video_generation_attempts"
  ADD CONSTRAINT "story_video_generation_attempts_output_variant_id_output_a_fkey"
  FOREIGN KEY ("output_variant_id", "output_asset_id")
  REFERENCES "media_asset_variants"("id", "asset_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "story_reference_versions"
  ADD CONSTRAINT "story_reference_versions_source_generation_attempt_id_fkey"
  FOREIGN KEY ("source_generation_attempt_id", "story_project_id")
  REFERENCES "story_video_generation_attempts"("id", "story_project_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "story_reference_slots"
  ADD CONSTRAINT "story_reference_slots_approved_version_id_fkey"
  FOREIGN KEY ("approved_version_id", "id")
  REFERENCES "story_reference_versions"("id", "reference_slot_id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "story_video_selections"
  ADD CONSTRAINT "story_video_selections_current_source_generation_attempt_i_fkey"
  FOREIGN KEY ("current_source_generation_attempt_id", "id")
  REFERENCES "story_video_generation_attempts"("id", "selection_id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "story_video_generation_attempt_references"
  ADD CONSTRAINT "story_video_generation_attempt_references_story_project_id_fkey"
  FOREIGN KEY ("story_project_id") REFERENCES "story_projects"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "story_video_generation_attempt_references"
  ADD CONSTRAINT "story_video_generation_attempt_references_attempt_id_story_fkey"
  FOREIGN KEY ("attempt_id", "story_project_id")
  REFERENCES "story_video_generation_attempts"("id", "story_project_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "story_video_generation_attempt_references"
  ADD CONSTRAINT "story_video_generation_attempt_references_reference_slot_fkey"
  FOREIGN KEY ("reference_slot_id", "story_project_id")
  REFERENCES "story_reference_slots"("id", "story_project_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "story_video_generation_attempt_references"
  ADD CONSTRAINT "story_video_generation_attempt_references_reference_versio_fkey"
  FOREIGN KEY ("reference_version_id", "reference_slot_id", "story_project_id")
  REFERENCES "story_reference_versions"("id", "reference_slot_id", "story_project_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "story_video_generation_attempt_references"
  ADD CONSTRAINT "story_video_generation_attempt_references_asset_id_fkey"
  FOREIGN KEY ("asset_id") REFERENCES "media_assets"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "story_video_generation_attempt_references"
  ADD CONSTRAINT "story_video_generation_attempt_references_variant_id_asset_fkey"
  FOREIGN KEY ("variant_id", "asset_id")
  REFERENCES "media_asset_variants"("id", "asset_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "story_video_build_clips"
  ADD CONSTRAINT "story_video_build_clips_build_id_fkey"
  FOREIGN KEY ("build_id") REFERENCES "story_builds"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "story_video_build_clips"
  ADD CONSTRAINT "story_video_build_clips_story_project_id_fkey"
  FOREIGN KEY ("story_project_id") REFERENCES "story_projects"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "story_video_build_clips"
  ADD CONSTRAINT "story_video_build_clips_source_generation_attempt_id_story_fkey"
  FOREIGN KEY ("source_generation_attempt_id", "story_project_id")
  REFERENCES "story_video_generation_attempts"("id", "story_project_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "story_video_build_clips"
  ADD CONSTRAINT "story_video_build_clips_build_asset_id_build_id_fkey"
  FOREIGN KEY ("build_asset_id", "build_id")
  REFERENCES "story_build_assets"("id", "build_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- New target-state guards. These contain no retired schema objects.
CREATE FUNCTION "story_video_generation_attempt_lifecycle_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'STORY_VIDEO_ATTEMPT_APPEND_ONLY: generation attempts cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."story_project_id" IS DISTINCT FROM OLD."story_project_id"
     OR NEW."selection_id" IS DISTINCT FROM OLD."selection_id"
     OR NEW."attempt_number" IS DISTINCT FROM OLD."attempt_number"
     OR NEW."submission_key" IS DISTINCT FROM OLD."submission_key"
     OR NEW."request_fingerprint" IS DISTINCT FROM OLD."request_fingerprint"
     OR NEW."selection_version_at_submit" IS DISTINCT FROM OLD."selection_version_at_submit"
     OR NEW."recipe_snapshot" IS DISTINCT FROM OLD."recipe_snapshot"
     OR NEW."ai_job_id" IS DISTINCT FROM OLD."ai_job_id"
     OR NEW."created_by_user_id" IS DISTINCT FROM OLD."created_by_user_id"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'STORY_VIDEO_ATTEMPT_INPUT_IMMUTABLE: scope, recipe, job, and request identity are frozen'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."status" IN ('ready', 'superseded', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'STORY_VIDEO_ATTEMPT_TERMINAL: terminal generation attempts are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'STORY_VIDEO_ATTEMPT_VERSION: updates must increment version by exactly one'
      USING ERRCODE = '23514';
  END IF;

  IF NOT (
    NEW."status" = OLD."status" OR
    (OLD."status" = 'queued' AND NEW."status" IN (
      'running', 'processing', 'ready', 'superseded', 'failed', 'cancelled'
    )) OR
    (OLD."status" = 'running' AND NEW."status" IN (
      'processing', 'ready', 'superseded', 'failed', 'cancelled'
    )) OR
    (OLD."status" = 'processing' AND NEW."status" IN (
      'ready', 'superseded', 'failed', 'cancelled'
    ))
  ) THEN
    RAISE EXCEPTION 'STORY_VIDEO_ATTEMPT_TRANSITION: invalid status transition % -> %',
      OLD."status", NEW."status" USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_video_generation_attempts_lifecycle_guard_trg"
BEFORE UPDATE OR DELETE ON "story_video_generation_attempts"
FOR EACH ROW EXECUTE FUNCTION "story_video_generation_attempt_lifecycle_guard"();

CREATE FUNCTION "story_video_generation_attempt_integrity_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  expected_workspace UUID;
  selection_target_key VARCHAR(128);
  current_selection_version INTEGER;
  job_workspace UUID;
  job_project UUID;
  job_type TEXT;
  job_status TEXT;
  job_block_key VARCHAR(128);
  job_surface VARCHAR(64);
  job_deleted_at TIMESTAMPTZ;
  output_job UUID;
  output_asset_from_job UUID;
  output_type TEXT;
  output_deleted_at TIMESTAMPTZ;
  asset_workspace UUID;
  asset_kind TEXT;
  asset_status TEXT;
  asset_moderation TEXT;
  asset_deleted_at TIMESTAMPTZ;
  variant_asset UUID;
  variant_status TEXT;
  variant_checksum TEXT;
  variant_content_type TEXT;
  variant_duration_ms INTEGER;
  variant_width INTEGER;
  variant_height INTEGER;
  variant_has_audio BOOLEAN;
  variant_metadata JSONB;
  variant_deleted_at TIMESTAMPTZ;
BEGIN
  SELECT project."workspace_id", selection."target_key", selection."version"
    INTO expected_workspace, selection_target_key, current_selection_version
  FROM "story_projects" AS project
  JOIN "story_video_selections" AS selection
    ON selection."story_project_id" = project."id"
  WHERE project."id" = NEW."story_project_id"
    AND selection."id" = NEW."selection_id";

  IF expected_workspace IS NULL THEN
    RAISE EXCEPTION 'STORY_VIDEO_ATTEMPT_SCOPE: selection must belong to the exact Story project'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT'
     AND NEW."selection_version_at_submit" IS DISTINCT FROM current_selection_version THEN
    RAISE EXCEPTION 'STORY_VIDEO_ATTEMPT_SELECTION_VERSION: submission must freeze the exact reserved selection version'
      USING ERRCODE = '23514';
  END IF;

  SELECT "workspace_id", "project_id", "type"::text, "status"::text,
         "document_block_id", "source_surface", "deleted_at"
    INTO job_workspace, job_project, job_type, job_status,
         job_block_key, job_surface, job_deleted_at
  FROM "ai_jobs"
  WHERE "id" = NEW."ai_job_id";

  IF job_workspace IS DISTINCT FROM expected_workspace
     OR job_project IS NOT NULL
     OR job_type IS DISTINCT FROM 'video'
     OR job_block_key IS DISTINCT FROM selection_target_key
     OR job_surface IS DISTINCT FROM 'story-studio'
     OR job_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'STORY_VIDEO_ATTEMPT_JOB_SCOPE: AiJob must be the active Story video job for this workspace and target'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."ai_job_output_id" IS NOT NULL THEN
    SELECT "job_id", "asset_id", "type"::text, "deleted_at"
      INTO output_job, output_asset_from_job, output_type, output_deleted_at
    FROM "ai_outputs"
    WHERE "id" = NEW."ai_job_output_id";
    IF output_job IS DISTINCT FROM NEW."ai_job_id"
       OR output_asset_from_job IS DISTINCT FROM NEW."output_asset_id"
       OR output_type IS DISTINCT FROM 'video'
       OR output_deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'STORY_VIDEO_ATTEMPT_OUTPUT_JOB: output must be the active exact AiJob output asset'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."output_asset_id" IS NOT NULL THEN
    SELECT "workspace_id", "kind"::text, "status"::text,
           "moderation_status"::text, "deleted_at"
      INTO asset_workspace, asset_kind, asset_status,
           asset_moderation, asset_deleted_at
    FROM "media_assets"
    WHERE "id" = NEW."output_asset_id";

    SELECT "asset_id", "status"::text, "checksum_sha256", "content_type",
           "duration_ms", "width", "height", "has_audio", "metadata", "deleted_at"
      INTO variant_asset, variant_status, variant_checksum, variant_content_type,
           variant_duration_ms, variant_width, variant_height, variant_has_audio,
           variant_metadata, variant_deleted_at
    FROM "media_asset_variants"
    WHERE "id" = NEW."output_variant_id";

    IF asset_workspace IS DISTINCT FROM expected_workspace
       OR asset_kind IS DISTINCT FROM 'video'
       OR variant_asset IS DISTINCT FROM NEW."output_asset_id"
       OR variant_checksum IS DISTINCT FROM NEW."output_checksum_sha256" THEN
      RAISE EXCEPTION 'STORY_VIDEO_ATTEMPT_OUTPUT_IDENTITY: output must freeze one exact workspace asset and variant checksum'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."status" IN ('ready', 'superseded') THEN
    IF job_status IS DISTINCT FROM 'completed'
       OR asset_status IS DISTINCT FROM 'ready'
       OR asset_moderation = 'blocked'
       OR asset_deleted_at IS NOT NULL
       OR variant_status IS DISTINCT FROM 'ready'
       OR variant_deleted_at IS NOT NULL
       OR variant_content_type IS DISTINCT FROM 'video/mp4'
       OR variant_duration_ms IS NULL OR variant_duration_ms <= 0
       OR variant_width IS NULL OR variant_width <= 0
       OR variant_height IS NULL OR variant_height <= 0
       OR variant_has_audio IS NULL
       OR (
         variant_metadata->>'browserSafeMp4' IS DISTINCT FROM 'true' AND
         variant_metadata->'videoProbe'->>'browserSafeMp4' IS DISTINCT FROM 'true'
       )
       OR NOT EXISTS (
         SELECT 1
         FROM "media_object_placements" AS placement
         WHERE placement."asset_id" = NEW."output_asset_id"
           AND placement."variant_id" = NEW."output_variant_id"
           AND placement."status" = 'active'
           AND placement."deleted_at" IS NULL
       ) THEN
      RAISE EXCEPTION 'STORY_VIDEO_ATTEMPT_OUTPUT_NOT_READY: terminal video output must be active, browser-safe, placed, and byte-exact'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_video_generation_attempts_integrity_guard_trg"
BEFORE INSERT OR UPDATE ON "story_video_generation_attempts"
FOR EACH ROW EXECUTE FUNCTION "story_video_generation_attempt_integrity_guard"();

CREATE FUNCTION "story_video_selection_provenance_consistency_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  source_row "story_video_generation_attempts"%ROWTYPE;
BEGIN
  IF NEW."current_source_generation_attempt_id" IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO source_row
  FROM "story_video_generation_attempts"
  WHERE "id" = NEW."current_source_generation_attempt_id";

  IF source_row."selection_id" IS DISTINCT FROM NEW."id"
     OR source_row."story_project_id" IS DISTINCT FROM NEW."story_project_id"
     OR source_row."status" IS DISTINCT FROM 'ready'
     OR source_row."output_asset_id" IS DISTINCT FROM NEW."current_asset_id"
     OR source_row."output_variant_id" IS DISTINCT FROM NEW."current_variant_id"
     OR source_row."output_checksum_sha256" IS DISTINCT FROM NEW."current_checksum_sha256" THEN
    RAISE EXCEPTION 'STORY_VIDEO_SELECTION_PROVENANCE: generated selection must match the exact ready attempt output'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "story_video_selections_provenance_consistency_trg"
AFTER INSERT OR UPDATE ON "story_video_selections"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "story_video_selection_provenance_consistency_guard"();

CREATE FUNCTION "story_video_ready_attempt_selection_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  current_status TEXT;
  current_selection UUID;
  output_asset UUID;
  output_variant UUID;
  output_checksum TEXT;
BEGIN
  SELECT "status"::text, "selection_id", "output_asset_id",
         "output_variant_id", "output_checksum_sha256"
    INTO current_status, current_selection, output_asset, output_variant, output_checksum
  FROM "story_video_generation_attempts"
  WHERE "id" = NEW."id";

  IF current_status = 'ready' AND NOT EXISTS (
    SELECT 1
    FROM "story_video_selections"
    WHERE "id" = current_selection
      AND "current_source_generation_attempt_id" = NEW."id"
      AND "current_asset_id" = output_asset
      AND "current_variant_id" = output_variant
      AND "current_checksum_sha256" = output_checksum
  ) THEN
    RAISE EXCEPTION 'STORY_VIDEO_ATTEMPT_READY_SELECTION: a newly ready attempt must atomically become the exact current selection'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "story_video_generation_attempts_ready_selection_trg"
AFTER INSERT OR UPDATE ON "story_video_generation_attempts"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "story_video_ready_attempt_selection_guard"();

CREATE FUNCTION "story_reference_version_lifecycle_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."story_project_id" IS DISTINCT FROM OLD."story_project_id"
     OR NEW."reference_slot_id" IS DISTINCT FROM OLD."reference_slot_id"
     OR NEW."version_number" IS DISTINCT FROM OLD."version_number"
     OR NEW."submission_key" IS DISTINCT FROM OLD."submission_key"
     OR NEW."request_fingerprint" IS DISTINCT FROM OLD."request_fingerprint"
     OR NEW."source" IS DISTINCT FROM OLD."source"
     OR NEW."ai_job_id" IS DISTINCT FROM OLD."ai_job_id"
     OR NEW."ai_job_output_id" IS DISTINCT FROM OLD."ai_job_output_id"
     OR NEW."source_generation_attempt_id" IS DISTINCT FROM OLD."source_generation_attempt_id"
     OR NEW."source_frame_index" IS DISTINCT FROM OLD."source_frame_index"
     OR NEW."source_output_checksum_sha256" IS DISTINCT FROM OLD."source_output_checksum_sha256"
     OR NEW."asset_id" IS DISTINCT FROM OLD."asset_id"
     OR NEW."variant_id" IS DISTINCT FROM OLD."variant_id"
     OR NEW."source_recipe_snapshot" IS DISTINCT FROM OLD."source_recipe_snapshot"
     OR NEW."checksum_sha256" IS DISTINCT FROM OLD."checksum_sha256"
     OR NEW."created_by_user_id" IS DISTINCT FROM OLD."created_by_user_id"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'STORY_REFERENCE_VERSION_INPUT_IMMUTABLE: identity, provenance, recipe, asset, and variant are frozen'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."status" = 'failed' THEN
    RAISE EXCEPTION 'STORY_REFERENCE_VERSION_TERMINAL: failed reference versions are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'ready' THEN
    IF NEW."status" IS DISTINCT FROM OLD."status"
       OR NEW."error" IS DISTINCT FROM OLD."error"
       OR NEW."ready_at" IS DISTINCT FROM OLD."ready_at"
       OR NEW."review_revision" NOT IN (
         OLD."review_revision", OLD."review_revision" + 1
       ) THEN
      RAISE EXCEPTION 'STORY_REFERENCE_VERSION_TERMINAL: ready output is immutable; only one atomic review revision may append'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."review_revision" IS DISTINCT FROM OLD."review_revision" THEN
    RAISE EXCEPTION 'STORY_REFERENCE_REVIEW_REVISION: only ready versions may advance reviewRevision'
      USING ERRCODE = '23514';
  END IF;

  IF NOT (
    NEW."status" = OLD."status" OR
    (OLD."status" = 'pending' AND NEW."status" IN ('processing', 'ready', 'failed')) OR
    (OLD."status" = 'processing' AND NEW."status" IN ('ready', 'failed'))
  ) THEN
    RAISE EXCEPTION 'STORY_REFERENCE_VERSION_TRANSITION: invalid status transition % -> %',
      OLD."status", NEW."status" USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_reference_versions_lifecycle_guard_trg"
BEFORE UPDATE ON "story_reference_versions"
FOR EACH ROW EXECUTE FUNCTION "story_reference_version_lifecycle_guard"();

CREATE FUNCTION "story_reference_version_integrity_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  expected_workspace UUID;
  asset_workspace UUID;
  asset_kind TEXT;
  asset_status TEXT;
  asset_moderation TEXT;
  asset_deleted_at TIMESTAMPTZ;
  variant_asset UUID;
  variant_status TEXT;
  variant_checksum TEXT;
  variant_deleted_at TIMESTAMPTZ;
  job_workspace UUID;
  job_type TEXT;
  job_deleted_at TIMESTAMPTZ;
  output_job UUID;
  output_asset UUID;
  output_type TEXT;
  output_deleted_at TIMESTAMPTZ;
  source_project UUID;
  source_status TEXT;
  source_checksum TEXT;
BEGIN
  SELECT project."workspace_id" INTO expected_workspace
  FROM "story_projects" AS project
  JOIN "story_reference_slots" AS slot
    ON slot."story_project_id" = project."id"
  WHERE project."id" = NEW."story_project_id"
    AND slot."id" = NEW."reference_slot_id";

  IF expected_workspace IS NULL THEN
    RAISE EXCEPTION 'STORY_REFERENCE_VERSION_SCOPE: slot must belong to the exact Story project'
      USING ERRCODE = '23514';
  END IF;

  SELECT "workspace_id", "kind"::text, "status"::text,
         "moderation_status"::text, "deleted_at"
    INTO asset_workspace, asset_kind, asset_status,
         asset_moderation, asset_deleted_at
  FROM "media_assets"
  WHERE "id" = NEW."asset_id";

  SELECT "asset_id", "status"::text, "checksum_sha256", "deleted_at"
    INTO variant_asset, variant_status, variant_checksum, variant_deleted_at
  FROM "media_asset_variants"
  WHERE "id" = NEW."variant_id";

  IF asset_workspace IS DISTINCT FROM expected_workspace
     OR asset_kind IS DISTINCT FROM 'image'
     OR variant_asset IS DISTINCT FROM NEW."asset_id"
     OR variant_checksum IS DISTINCT FROM NEW."checksum_sha256" THEN
    RAISE EXCEPTION 'STORY_REFERENCE_VERSION_MEDIA_IDENTITY: reference must freeze one exact workspace image asset and variant checksum'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."source" = 'ai_job' THEN
    SELECT "workspace_id", "type"::text, "deleted_at"
      INTO job_workspace, job_type, job_deleted_at
    FROM "ai_jobs"
    WHERE "id" = NEW."ai_job_id";
    SELECT "job_id", "asset_id", "type"::text, "deleted_at"
      INTO output_job, output_asset, output_type, output_deleted_at
    FROM "ai_outputs"
    WHERE "id" = NEW."ai_job_output_id";

    IF job_workspace IS DISTINCT FROM expected_workspace
       OR job_type IS DISTINCT FROM 'image'
       OR job_deleted_at IS NOT NULL
       OR output_job IS DISTINCT FROM NEW."ai_job_id"
       OR output_asset IS DISTINCT FROM NEW."asset_id"
       OR output_type IS DISTINCT FROM 'image'
       OR output_deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'STORY_REFERENCE_VERSION_AI_PROVENANCE: AiJob output must be the active exact source image in this workspace'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."source" = 'generation_frame' THEN
    SELECT "story_project_id", "status"::text, "output_checksum_sha256"
      INTO source_project, source_status, source_checksum
    FROM "story_video_generation_attempts"
    WHERE "id" = NEW."source_generation_attempt_id";

    IF source_project IS DISTINCT FROM NEW."story_project_id"
       OR source_status NOT IN ('ready', 'superseded')
       OR source_checksum IS DISTINCT FROM NEW."source_output_checksum_sha256" THEN
      RAISE EXCEPTION 'STORY_REFERENCE_VERSION_FRAME_PROVENANCE: source frame must name an exact completed video output in this project'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."status" = 'ready' AND (
    asset_status IS DISTINCT FROM 'ready'
    OR asset_moderation = 'blocked'
    OR asset_deleted_at IS NOT NULL
    OR variant_status IS DISTINCT FROM 'ready'
    OR variant_deleted_at IS NOT NULL
    OR NOT EXISTS (
      SELECT 1
      FROM "media_object_placements" AS placement
      WHERE placement."asset_id" = NEW."asset_id"
        AND placement."variant_id" = NEW."variant_id"
        AND placement."status" = 'active'
        AND placement."deleted_at" IS NULL
    )
  ) THEN
    RAISE EXCEPTION 'STORY_REFERENCE_VERSION_NOT_READY: ready reference media must be active, non-blocked, placed, and byte-exact'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_reference_versions_integrity_guard_trg"
BEFORE INSERT OR UPDATE ON "story_reference_versions"
FOR EACH ROW EXECUTE FUNCTION "story_reference_version_integrity_guard"();

CREATE FUNCTION "story_reference_review_insert_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  current_revision INTEGER;
  version_status TEXT;
BEGIN
  IF jsonb_typeof(NEW."checklist") IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'STORY_REFERENCE_REVIEW_CHECKLIST: checklist must be an object'
      USING ERRCODE = '23514';
  END IF;
  IF NOT (
    (SELECT count(*) FROM jsonb_object_keys(NEW."checklist")) = 4 AND
    COALESCE(NEW."checklist"->>'technical' IN ('pass', 'fail', 'na'), false) AND
    COALESCE(NEW."checklist"->>'identityContinuity' IN ('pass', 'fail', 'na'), false) AND
    COALESCE(NEW."checklist"->>'rights' IN ('pass', 'fail', 'na'), false) AND
    COALESCE(NEW."checklist"->>'safety' IN ('pass', 'fail', 'na'), false) AND
    NEW."technical_passed" IS NOT DISTINCT FROM
      (NEW."checklist"->>'technical' = 'pass') AND
    NEW."safety_passed" IS NOT DISTINCT FROM
      (NEW."checklist"->>'safety' = 'pass')
  ) THEN
    RAISE EXCEPTION 'STORY_REFERENCE_REVIEW_CHECKLIST: checklist values and frozen pass flags must agree'
      USING ERRCODE = '23514';
  END IF;

  SELECT "review_revision", "status"::text
    INTO current_revision, version_status
  FROM "story_reference_versions"
  WHERE "id" = NEW."reference_version_id"
  FOR UPDATE;

  IF version_status IS DISTINCT FROM 'ready' THEN
    RAISE EXCEPTION 'STORY_REFERENCE_REVIEW_NOT_READY: only a ready reference version may be reviewed'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "story_reference_approvals"
    WHERE "reference_version_id" = NEW."reference_version_id"
  ) THEN
    RAISE EXCEPTION 'STORY_REFERENCE_REVIEW_AFTER_APPROVAL: an approved reference version cannot receive another review'
      USING ERRCODE = '55000';
  END IF;
  IF NEW."sequence" <> current_revision + 1 THEN
    RAISE EXCEPTION 'STORY_REFERENCE_REVIEW_SEQUENCE: expected %, received %',
      current_revision + 1, NEW."sequence" USING ERRCODE = '40001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_reference_reviews_insert_guard_trg"
BEFORE INSERT ON "story_reference_reviews"
FOR EACH ROW EXECUTE FUNCTION "story_reference_review_insert_guard"();

CREATE FUNCTION "story_reference_review_append_only_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'STORY_REFERENCE_REVIEW_APPEND_ONLY: reviews cannot be updated or deleted'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "story_reference_reviews_append_only_trg"
BEFORE UPDATE OR DELETE ON "story_reference_reviews"
FOR EACH ROW EXECUTE FUNCTION "story_reference_review_append_only_guard"();

CREATE FUNCTION "story_reference_review_revision_consistency_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  target_version UUID;
  stored_revision INTEGER;
  review_count BIGINT;
  first_sequence INTEGER;
  last_sequence INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'story_reference_reviews' THEN
    target_version := NEW."reference_version_id";
  ELSE
    target_version := NEW."id";
  END IF;

  SELECT "review_revision" INTO stored_revision
  FROM "story_reference_versions"
  WHERE "id" = target_version;
  SELECT count(*), min("sequence"), max("sequence")
    INTO review_count, first_sequence, last_sequence
  FROM "story_reference_reviews"
  WHERE "reference_version_id" = target_version;

  IF stored_revision IS NULL
     OR stored_revision <> review_count
     OR (review_count > 0 AND (
       first_sequence IS DISTINCT FROM 1 OR
       last_sequence IS DISTINCT FROM stored_revision
     )) THEN
    RAISE EXCEPTION 'STORY_REFERENCE_REVIEW_REVISION_MISMATCH: reviewRevision must atomically equal the contiguous append-only review sequence'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "story_reference_reviews_revision_consistency_trg"
AFTER INSERT ON "story_reference_reviews"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "story_reference_review_revision_consistency_guard"();

CREATE CONSTRAINT TRIGGER "story_reference_versions_review_revision_consistency_trg"
AFTER INSERT OR UPDATE ON "story_reference_versions"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "story_reference_review_revision_consistency_guard"();

CREATE FUNCTION "story_reference_approval_append_only_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'STORY_REFERENCE_APPROVAL_APPEND_ONLY: approvals cannot be updated or deleted'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "story_reference_approvals_append_only_trg"
BEFORE UPDATE OR DELETE ON "story_reference_approvals"
FOR EACH ROW EXECUTE FUNCTION "story_reference_approval_append_only_guard"();

CREATE FUNCTION "story_video_reference_approval_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1
  FROM "story_reference_versions"
  WHERE "id" = NEW."reference_version_id"
  FOR UPDATE;

  IF NOT EXISTS (
    SELECT 1
    FROM "story_reference_reviews" AS review
    JOIN "story_reference_versions" AS version
      ON version."id" = NEW."reference_version_id"
    JOIN "story_projects" AS project
      ON project."id" = version."story_project_id"
    JOIN "media_assets" AS asset
      ON asset."id" = version."asset_id"
     AND asset."workspace_id" = project."workspace_id"
    JOIN "media_asset_variants" AS variant
      ON variant."id" = version."variant_id"
     AND variant."asset_id" = asset."id"
    WHERE review."id" = NEW."review_id"
      AND review."reference_version_id" = NEW."reference_version_id"
      AND review."decision" = 'approve'
      AND review."technical_passed"
      AND review."safety_passed"
      AND review."sequence" = version."review_revision"
      AND review."checklist"->>'technical' = 'pass'
      AND review."checklist"->>'rights' = 'pass'
      AND review."checklist"->>'safety' = 'pass'
      AND review."checklist"->>'identityContinuity' <> 'fail'
      AND version."status" = 'ready'
      AND asset."kind" = 'image'
      AND asset."status" = 'ready'
      AND asset."moderation_status" <> 'blocked'
      AND asset."deleted_at" IS NULL
      AND variant."status" = 'ready'
      AND variant."deleted_at" IS NULL
      AND variant."checksum_sha256" = version."checksum_sha256"
      AND EXISTS (
        SELECT 1
        FROM "media_object_placements" AS placement
        WHERE placement."asset_id" = version."asset_id"
          AND placement."variant_id" = version."variant_id"
          AND placement."status" = 'active'
          AND placement."deleted_at" IS NULL
      )
  ) THEN
    RAISE EXCEPTION 'STORY_REFERENCE_APPROVAL_INVALID: approval requires the latest passing review and exact usable reference media'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_reference_approvals_guard_trg"
BEFORE INSERT ON "story_reference_approvals"
FOR EACH ROW EXECUTE FUNCTION "story_video_reference_approval_guard"();

CREATE FUNCTION "story_video_approved_pointer_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  previous_version_number INTEGER;
  next_version_number INTEGER;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."approved_version_id" IS NOT NULL THEN
    IF NEW."approved_version_id" IS NULL THEN
      RAISE EXCEPTION 'STORY_REFERENCE_APPROVED_POINTER_REVERSE: an approved pointer cannot be cleared'
        USING ERRCODE = '55000';
    END IF;
    IF NEW."approved_version_id" IS DISTINCT FROM OLD."approved_version_id" THEN
      SELECT "version_number" INTO previous_version_number
      FROM "story_reference_versions"
      WHERE "id" = OLD."approved_version_id";
      SELECT "version_number" INTO next_version_number
      FROM "story_reference_versions"
      WHERE "id" = NEW."approved_version_id";
      IF next_version_number IS NULL
         OR previous_version_number IS NULL
         OR next_version_number <= previous_version_number THEN
        RAISE EXCEPTION 'STORY_REFERENCE_APPROVED_POINTER_REVERSE: replacement must advance to a newer approved version'
          USING ERRCODE = '55000';
      END IF;
    END IF;
  END IF;

  IF NEW."approved_version_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "story_reference_versions" AS version
    JOIN "story_reference_approvals" AS approval
      ON approval."reference_version_id" = version."id"
    JOIN "story_projects" AS project
      ON project."id" = version."story_project_id"
    JOIN "media_assets" AS asset
      ON asset."id" = version."asset_id"
     AND asset."workspace_id" = project."workspace_id"
    JOIN "media_asset_variants" AS variant
      ON variant."id" = version."variant_id"
     AND variant."asset_id" = asset."id"
    WHERE version."id" = NEW."approved_version_id"
      AND version."reference_slot_id" = NEW."id"
      AND version."story_project_id" = NEW."story_project_id"
      AND version."status" = 'ready'
      AND asset."kind" = 'image'
      AND asset."status" = 'ready'
      AND asset."moderation_status" <> 'blocked'
      AND asset."deleted_at" IS NULL
      AND variant."status" = 'ready'
      AND variant."deleted_at" IS NULL
      AND variant."checksum_sha256" = version."checksum_sha256"
      AND EXISTS (
        SELECT 1
        FROM "media_object_placements" AS placement
        WHERE placement."asset_id" = version."asset_id"
          AND placement."variant_id" = version."variant_id"
          AND placement."status" = 'active'
          AND placement."deleted_at" IS NULL
      )
  ) THEN
    RAISE EXCEPTION 'STORY_REFERENCE_APPROVED_POINTER_INVALID: pointer must target an approved ready exact version of this slot'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_reference_slots_approved_pointer_guard_trg"
BEFORE INSERT OR UPDATE OF "approved_version_id" ON "story_reference_slots"
FOR EACH ROW EXECUTE FUNCTION "story_video_approved_pointer_guard"();

CREATE FUNCTION "story_video_attempt_reference_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "story_reference_versions" AS version
    JOIN "story_reference_slots" AS slot
      ON slot."id" = version."reference_slot_id"
     AND slot."story_project_id" = version."story_project_id"
    JOIN "story_video_generation_attempts" AS attempt
      ON attempt."id" = NEW."attempt_id"
     AND attempt."story_project_id" = version."story_project_id"
    JOIN "story_projects" AS project
      ON project."id" = version."story_project_id"
    JOIN "media_assets" AS asset
      ON asset."id" = version."asset_id"
     AND asset."workspace_id" = project."workspace_id"
    JOIN "media_asset_variants" AS variant
      ON variant."id" = version."variant_id"
     AND variant."asset_id" = asset."id"
    WHERE version."id" = NEW."reference_version_id"
      AND version."reference_slot_id" = NEW."reference_slot_id"
      AND version."story_project_id" = NEW."story_project_id"
      AND version."status" = 'ready'
      AND slot."approved_version_id" = version."id"
      AND attempt."status" = 'queued'
      AND version."asset_id" = NEW."asset_id"
      AND version."variant_id" = NEW."variant_id"
      AND version."checksum_sha256" = NEW."checksum_sha256"
      AND asset."kind" = 'image'
      AND asset."status" = 'ready'
      AND asset."moderation_status" <> 'blocked'
      AND asset."deleted_at" IS NULL
      AND variant."status" = 'ready'
      AND variant."deleted_at" IS NULL
      AND EXISTS (
        SELECT 1
        FROM "media_object_placements" AS placement
        WHERE placement."asset_id" = NEW."asset_id"
          AND placement."variant_id" = NEW."variant_id"
          AND placement."status" = 'active'
          AND placement."deleted_at" IS NULL
      )
  ) THEN
    RAISE EXCEPTION 'STORY_VIDEO_ATTEMPT_REFERENCE_INVALID: queued attempt must freeze the current approved exact reference media'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_video_generation_attempt_references_guard_trg"
BEFORE INSERT ON "story_video_generation_attempt_references"
FOR EACH ROW EXECUTE FUNCTION "story_video_attempt_reference_guard"();

CREATE FUNCTION "story_video_attempt_reference_append_only_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'STORY_VIDEO_ATTEMPT_REFERENCE_APPEND_ONLY: frozen generation references cannot be updated or deleted'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "story_video_generation_attempt_references_append_only_trg"
BEFORE UPDATE OR DELETE ON "story_video_generation_attempt_references"
FOR EACH ROW EXECUTE FUNCTION "story_video_attempt_reference_append_only_guard"();

CREATE FUNCTION "story_video_selection_media_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."current_asset_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "story_projects" AS project
    JOIN "media_assets" AS asset
      ON asset."id" = NEW."current_asset_id"
     AND asset."workspace_id" = project."workspace_id"
    JOIN "media_asset_variants" AS variant
      ON variant."id" = NEW."current_variant_id"
     AND variant."asset_id" = asset."id"
    WHERE project."id" = NEW."story_project_id"
      AND asset."kind" = 'video'
      AND asset."status" = 'ready'
      AND asset."moderation_status" <> 'blocked'
      AND asset."deleted_at" IS NULL
      AND variant."status" = 'ready'
      AND variant."deleted_at" IS NULL
      AND variant."content_type" = 'video/mp4'
      AND (
        variant."metadata"->>'browserSafeMp4' = 'true' OR
        variant."metadata"->'videoProbe'->>'browserSafeMp4' = 'true'
      )
      AND variant."checksum_sha256" = NEW."current_checksum_sha256"
      AND variant."content_type" = NEW."current_content_type"
      AND variant."duration_ms" = NEW."current_duration_ms"
      AND variant."width" = NEW."current_width"
      AND variant."height" = NEW."current_height"
      AND NEW."current_browser_safe_mp4" IS TRUE
      AND variant."has_audio" = NEW."current_has_audio"
      AND EXISTS (
        SELECT 1
        FROM "media_object_placements" AS placement
        WHERE placement."asset_id" = NEW."current_asset_id"
          AND placement."variant_id" = NEW."current_variant_id"
          AND placement."status" = 'active'
          AND placement."deleted_at" IS NULL
      )
  ) THEN
    RAISE EXCEPTION 'STORY_VIDEO_SELECTION_MEDIA_INVALID: current video must match one exact active browser-safe ready MP4 variant'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_video_selections_media_guard_trg"
BEFORE INSERT OR UPDATE ON "story_video_selections"
FOR EACH ROW EXECUTE FUNCTION "story_video_selection_media_guard"();

CREATE FUNCTION "story_video_media_asset_invalidation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" <> 'ready'
     OR NEW."moderation_status" = 'blocked'
     OR NEW."deleted_at" IS NOT NULL THEN
    UPDATE "story_video_selections"
    SET "current_asset_id" = NULL,
        "current_variant_id" = NULL,
        "current_source_generation_attempt_id" = NULL,
        "current_checksum_sha256" = NULL,
        "current_content_type" = NULL,
        "current_duration_ms" = NULL,
        "current_width" = NULL,
        "current_height" = NULL,
        "current_browser_safe_mp4" = NULL,
        "current_has_audio" = NULL,
        "version" = "version" + 1,
        "set_by_user_id" = NULL,
        "set_at" = clock_timestamp(),
        "updated_at" = clock_timestamp()
    WHERE "current_asset_id" = NEW."id";
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "media_assets_story_video_invalidation_trg"
AFTER UPDATE OF "status", "moderation_status", "deleted_at" ON "media_assets"
FOR EACH ROW EXECUTE FUNCTION "story_video_media_asset_invalidation"();

CREATE FUNCTION "story_video_media_variant_invalidation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" <> 'ready'
     OR NEW."deleted_at" IS NOT NULL
     OR NEW."checksum_sha256" IS DISTINCT FROM OLD."checksum_sha256"
     OR NEW."content_type" IS DISTINCT FROM OLD."content_type"
     OR NEW."duration_ms" IS DISTINCT FROM OLD."duration_ms"
     OR NEW."width" IS DISTINCT FROM OLD."width"
     OR NEW."height" IS DISTINCT FROM OLD."height"
     OR NEW."has_audio" IS DISTINCT FROM OLD."has_audio"
     OR NEW."metadata" IS DISTINCT FROM OLD."metadata" THEN
    UPDATE "story_video_selections"
    SET "current_asset_id" = NULL,
        "current_variant_id" = NULL,
        "current_source_generation_attempt_id" = NULL,
        "current_checksum_sha256" = NULL,
        "current_content_type" = NULL,
        "current_duration_ms" = NULL,
        "current_width" = NULL,
        "current_height" = NULL,
        "current_browser_safe_mp4" = NULL,
        "current_has_audio" = NULL,
        "version" = "version" + 1,
        "set_by_user_id" = NULL,
        "set_at" = clock_timestamp(),
        "updated_at" = clock_timestamp()
    WHERE "current_variant_id" = NEW."id";
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "media_asset_variants_story_video_invalidation_trg"
AFTER UPDATE OF "status", "deleted_at", "checksum_sha256", "content_type",
  "duration_ms", "width", "height", "has_audio", "metadata"
ON "media_asset_variants"
FOR EACH ROW EXECUTE FUNCTION "story_video_media_variant_invalidation"();

CREATE OR REPLACE FUNCTION "story_build_lifecycle_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" IN ('ready', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'Terminal StoryBuild is immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF NEW."story_project_id" IS DISTINCT FROM OLD."story_project_id"
     OR NEW."source_revision_id" IS DISTINCT FROM OLD."source_revision_id"
     OR NEW."build_number" IS DISTINCT FROM OLD."build_number"
     OR NEW."submission_key" IS DISTINCT FROM OLD."submission_key"
     OR NEW."request_fingerprint" IS DISTINCT FROM OLD."request_fingerprint"
     OR NEW."kind" IS DISTINCT FROM OLD."kind"
     OR NEW."scope" IS DISTINCT FROM OLD."scope"
     OR NEW."source_draft_revision" IS DISTINCT FROM OLD."source_draft_revision"
     OR NEW."video_snapshot_hash" IS DISTINCT FROM OLD."video_snapshot_hash"
     OR NEW."input_hash" IS DISTINCT FROM OLD."input_hash"
     OR NEW."input_manifest_hash" IS DISTINCT FROM OLD."input_manifest_hash"
     OR NEW."runtime_schema_version" IS DISTINCT FROM OLD."runtime_schema_version"
     OR NEW."created_by_user_id" IS DISTINCT FROM OLD."created_by_user_id"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'StoryBuild frozen input fields are immutable'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'StoryBuild update must increment version by exactly one'
      USING ERRCODE = '23514';
  END IF;
  IF NOT (
    NEW."status" = OLD."status" OR
    (OLD."status" = 'queued' AND NEW."status" IN ('validating', 'compiling', 'ready', 'failed', 'cancelled')) OR
    (OLD."status" = 'validating' AND NEW."status" IN ('compiling', 'ready', 'failed', 'cancelled')) OR
    (OLD."status" = 'compiling' AND NEW."status" IN ('ready', 'failed', 'cancelled'))
  ) THEN
    RAISE EXCEPTION 'Invalid StoryBuild status transition % -> %',
      OLD."status", NEW."status" USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_builds_lifecycle_guard_trg"
BEFORE UPDATE OR DELETE ON "story_builds"
FOR EACH ROW EXECUTE FUNCTION "story_build_lifecycle_guard"();

CREATE OR REPLACE FUNCTION "story_build_ready_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" <> 'ready' OR OLD."status" = 'ready' THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "story_video_build_clips" AS clip
    JOIN "story_build_assets" AS build_asset
      ON build_asset."id" = clip."build_asset_id"
     AND build_asset."build_id" = clip."build_id"
    JOIN "media_assets" AS media_asset
      ON media_asset."id" = build_asset."asset_id"
    JOIN "media_asset_variants" AS media_variant
      ON media_variant."id" = build_asset."variant_id"
     AND media_variant."asset_id" = build_asset."asset_id"
    LEFT JOIN "story_video_generation_attempts" AS generation
      ON generation."id" = clip."source_generation_attempt_id"
     AND generation."story_project_id" = clip."story_project_id"
    WHERE clip."build_id" = NEW."id"
      AND (
        clip."story_project_id" IS DISTINCT FROM NEW."story_project_id" OR
        build_asset."story_project_id" IS DISTINCT FROM NEW."story_project_id" OR
        build_asset."role" IS DISTINCT FROM 'video' OR
        build_asset."logical_key" IS DISTINCT FROM clip."logical_key" OR
        build_asset."checksum_sha256" IS DISTINCT FROM clip."checksum_sha256" OR
        build_asset."content_type" IS DISTINCT FROM clip."content_type" OR
        build_asset."duration_ms" IS DISTINCT FROM clip."duration_ms" OR
        build_asset."width" IS DISTINCT FROM clip."width" OR
        build_asset."height" IS DISTINCT FROM clip."height" OR
        build_asset."browser_safe_mp4" IS DISTINCT FROM clip."browser_safe_mp4" OR
        build_asset."browser_safe_mp4" IS NOT TRUE OR
        clip."browser_safe_mp4" IS NOT TRUE OR
        build_asset."has_audio" IS DISTINCT FROM clip."has_audio" OR
        media_asset."kind" IS DISTINCT FROM 'video' OR
        media_asset."status" IS DISTINCT FROM 'ready' OR
        media_asset."moderation_status" = 'blocked' OR
        media_asset."deleted_at" IS NOT NULL OR
        media_variant."status" IS DISTINCT FROM 'ready' OR
        media_variant."deleted_at" IS NOT NULL OR
        (
          media_variant."metadata"->>'browserSafeMp4' IS DISTINCT FROM 'true' AND
          media_variant."metadata"->'videoProbe'->>'browserSafeMp4' IS DISTINCT FROM 'true'
        ) OR
        media_variant."checksum_sha256" IS DISTINCT FROM clip."checksum_sha256" OR
        media_variant."content_type" IS DISTINCT FROM clip."content_type" OR
        media_variant."duration_ms" IS DISTINCT FROM clip."duration_ms" OR
        media_variant."width" IS DISTINCT FROM clip."width" OR
        media_variant."height" IS DISTINCT FROM clip."height" OR
        media_variant."has_audio" IS DISTINCT FROM clip."has_audio" OR
        NOT EXISTS (
          SELECT 1
          FROM "media_object_placements" AS placement
          WHERE placement."asset_id" = build_asset."asset_id"
            AND placement."variant_id" = build_asset."variant_id"
            AND placement."status" = 'active'
            AND placement."deleted_at" IS NULL
        ) OR
        (clip."source_generation_attempt_id" IS NOT NULL AND (
          generation."id" IS NULL OR
          generation."status" IS DISTINCT FROM 'ready' OR
          generation."output_asset_id" IS DISTINCT FROM build_asset."asset_id" OR
          generation."output_variant_id" IS DISTINCT FROM build_asset."variant_id" OR
          generation."output_checksum_sha256" IS DISTINCT FROM clip."checksum_sha256"
        ))
      )
  ) OR EXISTS (
    SELECT 1
    FROM "story_build_assets" AS build_asset
    LEFT JOIN "story_video_build_clips" AS clip
      ON clip."build_asset_id" = build_asset."id"
     AND clip."build_id" = build_asset."build_id"
    WHERE build_asset."build_id" = NEW."id"
      AND build_asset."role" = 'video'
      AND clip."build_asset_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'StoryBuild contains incomplete or mismatched frozen video media'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_builds_ready_guard_trg"
BEFORE UPDATE OF "status" ON "story_builds"
FOR EACH ROW EXECUTE FUNCTION "story_build_ready_guard"();

CREATE TRIGGER "story_video_build_clips_mutability_guard_trg"
BEFORE INSERT OR UPDATE OR DELETE ON "story_video_build_clips"
FOR EACH ROW EXECUTE FUNCTION "story_build_asset_mutability_guard"();

CREATE OR REPLACE FUNCTION "story_project_archive_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" = 'archived' AND OLD."status" <> 'archived' AND (
    EXISTS (
      SELECT 1 FROM "story_builds"
      WHERE "story_project_id" = NEW."id"
        AND "status" IN ('queued', 'validating', 'compiling')
    ) OR EXISTS (
      SELECT 1 FROM "story_video_generation_attempts"
      WHERE "story_project_id" = NEW."id"
        AND "status" IN ('queued', 'running', 'processing')
    ) OR EXISTS (
      SELECT 1 FROM "story_experience_publications"
      WHERE "story_project_id" = NEW."id"
        AND "status" IN ('pending', 'uncertain')
    )
  ) THEN
    RAISE EXCEPTION 'Finish active video, build, and publication work before archiving StoryProject'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_projects_archive_guard_trg"
BEFORE UPDATE OF "status" ON "story_projects"
FOR EACH ROW EXECUTE FUNCTION "story_project_archive_guard"();

COMMIT;
