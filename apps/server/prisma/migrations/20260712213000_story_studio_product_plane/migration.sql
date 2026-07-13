-- Story Studio product plane v3 (clean break).
--
-- The previous owner-only text-adventure creator was never opened. Its 24
-- local rows have no compatibility contract, so this migration deliberately
-- drops the three legacy Story tables and rebuilds the domain around immutable
-- revisions, reproducible builds/releases, and a revision-scoped interactive-
-- film production plane. StoryProject remains directly Workspace-owned and has
-- no FK to PlatformProject.

DROP TABLE IF EXISTS "story_drafts" CASCADE;
DROP TABLE IF EXISTS "story_releases" CASCADE;
DROP TABLE IF EXISTS "story_projects" CASCADE;

DROP TYPE IF EXISTS "StoryPublishState";
DROP TYPE IF EXISTS "StoryVisibility";
DROP TYPE IF EXISTS "StoryProjectStatus";

CREATE TYPE "StoryFormat" AS ENUM (
  'text_adventure', 'interactive_film', 'narrative_rpg'
);
CREATE TYPE "StoryProjectStatus" AS ENUM ('active', 'archived');
CREATE TYPE "StoryVisibility" AS ENUM ('private', 'unlisted', 'public');
CREATE TYPE "StoryProjectMemberRole" AS ENUM (
  'owner', 'producer', 'editor', 'reviewer', 'viewer'
);
CREATE TYPE "StoryProjectMemberStatus" AS ENUM ('active', 'removed');
CREATE TYPE "StoryRevisionSource" AS ENUM ('creator', 'import');
CREATE TYPE "StoryBuildStatus" AS ENUM (
  'queued', 'validating', 'compiling', 'ready', 'failed', 'cancelled'
);
CREATE TYPE "StoryBuildKind" AS ENUM ('preview', 'production');
CREATE TYPE "StoryAssetRole" AS ENUM (
  'video', 'audio', 'subtitle', 'poster', 'cover', 'runtime', 'other'
);
CREATE TYPE "StoryReviewDecision" AS ENUM ('approve', 'reject', 'request_changes');
CREATE TYPE "StoryDeploymentEnvironment" AS ENUM ('preview', 'production');
CREATE TYPE "StoryDeploymentStatus" AS ENUM ('active', 'offline');
CREATE TYPE "StoryReleaseChannel" AS ENUM ('preview', 'production');
CREATE TYPE "StoryFilmReviewPolicy" AS ENUM ('explicit_approval', 'four_eyes');
CREATE TYPE "StoryFilmReferenceKind" AS ENUM (
  'character', 'location', 'prop', 'graphic', 'style', 'join_frame',
  'first_frame', 'last_frame'
);
CREATE TYPE "StoryFilmReferenceSource" AS ENUM ('upload', 'ai_job', 'import', 'take_frame');
CREATE TYPE "StoryFilmReferenceVersionStatus" AS ENUM (
  'pending', 'processing', 'ready', 'failed'
);
CREATE TYPE "StoryFilmGenerationMode" AS ENUM ('frame_lock', 'omni_reference');
CREATE TYPE "StoryFilmFrameMode" AS ENUM ('first_frame', 'first_last_frame');
CREATE TYPE "StoryFilmClipReferenceRole" AS ENUM (
  'omni', 'first_frame', 'last_frame', 'continuity', 'style'
);
CREATE TYPE "StoryFilmDependencyKind" AS ENUM ('required', 'continuity', 'convergence');
CREATE TYPE "StoryFilmDependencyTransition" AS ENUM (
  'direct', 'hidden_cut', 'shared_join_frame'
);
CREATE TYPE "StoryFilmTakeStatus" AS ENUM (
  'queued', 'running', 'processing', 'ready', 'failed', 'cancelled'
);
CREATE TYPE "StoryFilmContinuityDecision" AS ENUM ('pending', 'pass', 'fail', 'waived');

CREATE TABLE "story_projects" (
  "id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "format" "StoryFormat" NOT NULL,
  "status" "StoryProjectStatus" NOT NULL DEFAULT 'active',
  "visibility" "StoryVisibility" NOT NULL DEFAULT 'private',
  "title" VARCHAR(160) NOT NULL,
  "summary" TEXT,
  "default_locale" VARCHAR(16) NOT NULL DEFAULT 'en-US',
  "cover_asset_id" UUID,
  "tags" JSONB NOT NULL DEFAULT '[]',
  "source_ip_id" UUID,
  "next_build_number" INTEGER NOT NULL DEFAULT 1,
  "next_release_version" INTEGER NOT NULL DEFAULT 1,
  "publish_revision" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_by_user_id" VARCHAR(64) NOT NULL,
  "archived_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_projects_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_projects_title_nonempty_chk" CHECK (btrim("title") <> ''),
  CONSTRAINT "story_projects_locale_nonempty_chk" CHECK (btrim("default_locale") <> ''),
  CONSTRAINT "story_projects_counters_chk" CHECK (
    "next_build_number" > 0 AND "next_release_version" > 0 AND
    "publish_revision" >= 0 AND "version" >= 0
  ),
  CONSTRAINT "story_projects_tags_array_chk" CHECK (jsonb_typeof("tags") = 'array'),
  CONSTRAINT "story_projects_archive_state_chk" CHECK (
    ("status" = 'active' AND "archived_at" IS NULL) OR
    ("status" = 'archived' AND "archived_at" IS NOT NULL)
  )
);

CREATE TABLE "story_project_members" (
  "id" UUID NOT NULL,
  "story_project_id" UUID NOT NULL,
  "user_id" VARCHAR(64) NOT NULL,
  "role" "StoryProjectMemberRole" NOT NULL,
  "status" "StoryProjectMemberStatus" NOT NULL DEFAULT 'active',
  "granted_by_user_id" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "removed_at" TIMESTAMPTZ(6),
  CONSTRAINT "story_project_members_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_project_members_status_chk" CHECK (
    ("status" = 'active' AND "removed_at" IS NULL) OR
    ("status" = 'removed' AND "removed_at" IS NOT NULL)
  )
);

CREATE TABLE "story_drafts" (
  "id" UUID NOT NULL,
  "story_project_id" UUID NOT NULL,
  "schema_version" VARCHAR(64) NOT NULL,
  "content" JSONB NOT NULL,
  "content_hash" VARCHAR(64) NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "updated_by_user_id" VARCHAR(64) NOT NULL,
  "updated_by_session_id" VARCHAR(64),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_drafts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_drafts_schema_nonempty_chk" CHECK (btrim("schema_version") <> ''),
  CONSTRAINT "story_drafts_hash_chk" CHECK ("content_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "story_drafts_revision_chk" CHECK ("revision" >= 0)
);

CREATE TABLE "story_revisions" (
  "id" UUID NOT NULL,
  "story_project_id" UUID NOT NULL,
  "number" INTEGER NOT NULL,
  "source_draft_revision" INTEGER NOT NULL,
  "schema_version" VARCHAR(64) NOT NULL,
  "content" JSONB NOT NULL,
  "content_hash" VARCHAR(64) NOT NULL,
  "label" VARCHAR(160),
  "source" "StoryRevisionSource" NOT NULL,
  "created_by_user_id" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_revisions_number_chk" CHECK ("number" > 0),
  CONSTRAINT "story_revisions_draft_revision_chk" CHECK ("source_draft_revision" >= 0),
  CONSTRAINT "story_revisions_schema_nonempty_chk" CHECK (btrim("schema_version") <> ''),
  CONSTRAINT "story_revisions_hash_chk" CHECK ("content_hash" ~ '^[0-9a-f]{64}$')
);

CREATE TABLE "story_builds" (
  "id" UUID NOT NULL,
  "story_project_id" UUID NOT NULL,
  "source_revision_id" UUID NOT NULL,
  "build_number" INTEGER NOT NULL,
  "kind" "StoryBuildKind" NOT NULL,
  "scope" JSONB NOT NULL,
  "source_production_revision" INTEGER NOT NULL,
  "status" "StoryBuildStatus" NOT NULL DEFAULT 'queued',
  "input_hash" VARCHAR(64) NOT NULL,
  "input_manifest_hash" VARCHAR(64) NOT NULL,
  "runtime_schema_version" INTEGER NOT NULL DEFAULT 1,
  "runtime_json" JSONB,
  "runtime_hash" VARCHAR(64),
  "diagnostics" JSONB NOT NULL DEFAULT '[]',
  "path_report" JSONB NOT NULL DEFAULT '{}',
  "error_code" VARCHAR(96),
  "error_detail" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_by_user_id" VARCHAR(64) NOT NULL,
  "started_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_builds_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_builds_number_chk" CHECK ("build_number" > 0),
  CONSTRAINT "story_builds_scope_object_chk" CHECK (jsonb_typeof("scope") = 'object'),
  CONSTRAINT "story_builds_production_scope_chk" CHECK (
    "kind" <> 'production' OR "scope" ->> 'kind' = 'full'
  ),
  CONSTRAINT "story_builds_production_revision_chk" CHECK ("source_production_revision" >= 0),
  CONSTRAINT "story_builds_input_hash_chk" CHECK ("input_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "story_builds_manifest_hash_chk" CHECK ("input_manifest_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "story_builds_runtime_schema_chk" CHECK ("runtime_schema_version" = 1),
  CONSTRAINT "story_builds_version_chk" CHECK ("version" >= 0),
  CONSTRAINT "story_builds_json_shape_chk" CHECK (
    jsonb_typeof("diagnostics") = 'array' AND jsonb_typeof("path_report") = 'object'
  ),
  CONSTRAINT "story_builds_runtime_hash_chk" CHECK (
    "runtime_hash" IS NULL OR "runtime_hash" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "story_builds_ready_shape_chk" CHECK (
    "status" <> 'ready' OR (
      "runtime_json" IS NOT NULL AND "runtime_hash" IS NOT NULL AND
      "completed_at" IS NOT NULL
    )
  ),
  CONSTRAINT "story_builds_failure_shape_chk" CHECK (
    "status" <> 'failed' OR ("error_code" IS NOT NULL AND "completed_at" IS NOT NULL)
  ),
  CONSTRAINT "story_builds_cancelled_shape_chk" CHECK (
    "status" <> 'cancelled' OR "completed_at" IS NOT NULL
  )
);

CREATE TABLE "story_build_assets" (
  "id" UUID NOT NULL,
  "build_id" UUID NOT NULL,
  "story_project_id" UUID NOT NULL,
  "logical_key" VARCHAR(160) NOT NULL,
  "role" "StoryAssetRole" NOT NULL,
  "asset_id" UUID NOT NULL,
  "variant_id" UUID NOT NULL,
  "checksum_sha256" VARCHAR(64) NOT NULL,
  "content_type" VARCHAR(128) NOT NULL,
  "size_bytes" BIGINT,
  "width" INTEGER,
  "height" INTEGER,
  "duration_ms" INTEGER,
  "rank" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_build_assets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_build_assets_key_nonempty_chk" CHECK (btrim("logical_key") <> ''),
  CONSTRAINT "story_build_assets_hash_chk" CHECK ("checksum_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "story_build_assets_dimensions_chk" CHECK (
    ("size_bytes" IS NULL OR "size_bytes" >= 0) AND
    ("width" IS NULL OR "width" > 0) AND
    ("height" IS NULL OR "height" > 0) AND
    ("duration_ms" IS NULL OR "duration_ms" > 0) AND
    "rank" >= 0
  )
);

CREATE TABLE "story_releases" (
  "id" UUID NOT NULL,
  "story_project_id" UUID NOT NULL,
  "build_id" UUID NOT NULL,
  "source_revision_id" UUID NOT NULL,
  "release_version" INTEGER NOT NULL,
  "channel" "StoryReleaseChannel" NOT NULL,
  "format" "StoryFormat" NOT NULL,
  "runtime_locale" VARCHAR(16) NOT NULL,
  "runtime_schema_version" INTEGER NOT NULL,
  "runtime_json" JSONB NOT NULL,
  "runtime_hash" VARCHAR(64) NOT NULL,
  "manifest_hash" VARCHAR(64) NOT NULL,
  "metadata_snapshot" JSONB NOT NULL DEFAULT '{}',
  "review_revision" INTEGER NOT NULL DEFAULT 0,
  "created_by_user_id" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_releases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_releases_version_chk" CHECK ("release_version" > 0),
  CONSTRAINT "story_releases_locale_nonempty_chk" CHECK (btrim("runtime_locale") <> ''),
  CONSTRAINT "story_releases_runtime_schema_chk" CHECK ("runtime_schema_version" = 1),
  CONSTRAINT "story_releases_review_revision_chk" CHECK ("review_revision" >= 0),
  CONSTRAINT "story_releases_metadata_object_chk" CHECK (
    jsonb_typeof("metadata_snapshot") = 'object'
  ),
  CONSTRAINT "story_releases_runtime_hash_chk" CHECK ("runtime_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "story_releases_manifest_hash_chk" CHECK ("manifest_hash" ~ '^[0-9a-f]{64}$')
);

CREATE TABLE "story_release_assets" (
  "id" UUID NOT NULL,
  "release_id" UUID NOT NULL,
  "story_project_id" UUID NOT NULL,
  "logical_key" VARCHAR(160) NOT NULL,
  "role" "StoryAssetRole" NOT NULL,
  "asset_id" UUID NOT NULL,
  "variant_id" UUID NOT NULL,
  "checksum_sha256" VARCHAR(64) NOT NULL,
  "content_type" VARCHAR(128) NOT NULL,
  "size_bytes" BIGINT,
  "width" INTEGER,
  "height" INTEGER,
  "duration_ms" INTEGER,
  "rank" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_release_assets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_release_assets_key_nonempty_chk" CHECK (btrim("logical_key") <> ''),
  CONSTRAINT "story_release_assets_hash_chk" CHECK ("checksum_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "story_release_assets_dimensions_chk" CHECK (
    ("size_bytes" IS NULL OR "size_bytes" >= 0) AND
    ("width" IS NULL OR "width" > 0) AND
    ("height" IS NULL OR "height" > 0) AND
    ("duration_ms" IS NULL OR "duration_ms" > 0) AND
    "rank" >= 0
  )
);

CREATE TABLE "story_release_reviews" (
  "id" UUID NOT NULL,
  "release_id" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "decision" "StoryReviewDecision" NOT NULL,
  "checklist" JSONB NOT NULL DEFAULT '{}',
  "notes" TEXT,
  "reviewer_user_id" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_release_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_release_reviews_sequence_chk" CHECK ("sequence" > 0),
  CONSTRAINT "story_release_reviews_rejection_notes_chk" CHECK (
    "decision" = 'approve' OR ("notes" IS NOT NULL AND btrim("notes") <> '')
  )
);

CREATE TABLE "story_release_approvals" (
  "release_id" UUID NOT NULL,
  "review_id" UUID NOT NULL,
  "approved_by_user_id" VARCHAR(64) NOT NULL,
  "approved_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_release_approvals_pkey" PRIMARY KEY ("release_id")
);

CREATE TABLE "story_deployments" (
  "story_project_id" UUID NOT NULL,
  "environment" "StoryDeploymentEnvironment" NOT NULL,
  "release_id" UUID NOT NULL,
  "status" "StoryDeploymentStatus" NOT NULL DEFAULT 'active',
  "version" INTEGER NOT NULL DEFAULT 0,
  "deployed_by_user_id" VARCHAR(64) NOT NULL,
  "deployed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "offline_by_user_id" VARCHAR(64),
  "offline_at" TIMESTAMPTZ(6),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_deployments_pkey" PRIMARY KEY ("story_project_id", "environment"),
  CONSTRAINT "story_deployments_version_chk" CHECK ("version" >= 0),
  CONSTRAINT "story_deployments_status_chk" CHECK (
    ("status" = 'active' AND "offline_by_user_id" IS NULL AND "offline_at" IS NULL) OR
    ("status" = 'offline' AND "offline_by_user_id" IS NOT NULL AND "offline_at" IS NOT NULL)
  )
);

CREATE TABLE "story_film_specs" (
  "revision_id" UUID NOT NULL,
  "story_project_id" UUID NOT NULL,
  "runtime_schema_version" INTEGER NOT NULL DEFAULT 1,
  "target_duration_ms" INTEGER NOT NULL,
  "duration_tolerance_ms" INTEGER NOT NULL,
  "max_continuous_duration_ms" INTEGER NOT NULL,
  "max_generated_clip_duration_ms" INTEGER NOT NULL,
  "target_clip_count" INTEGER NOT NULL,
  "target_choice_count" INTEGER NOT NULL,
  "target_ending_count" INTEGER NOT NULL,
  "frame_width" INTEGER NOT NULL,
  "frame_height" INTEGER NOT NULL,
  "frame_rate_numerator" INTEGER NOT NULL,
  "frame_rate_denominator" INTEGER NOT NULL DEFAULT 1,
  "audio_sample_rate" INTEGER NOT NULL DEFAULT 48000,
  "default_locale" VARCHAR(16) NOT NULL,
  "enabled_locales" JSONB NOT NULL,
  "default_canonical_model_id" UUID NOT NULL,
  "review_policy" "StoryFilmReviewPolicy" NOT NULL,
  "spec_json" JSONB NOT NULL,
  "spec_hash" VARCHAR(64) NOT NULL,
  "production_revision" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_by_user_id" VARCHAR(64) NOT NULL,
  "updated_by_user_id" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_film_specs_pkey" PRIMARY KEY ("revision_id"),
  CONSTRAINT "story_film_specs_runtime_schema_chk" CHECK ("runtime_schema_version" = 1),
  CONSTRAINT "story_film_specs_duration_chk" CHECK (
    "target_duration_ms" > 0 AND "target_duration_ms" <= 86400000 AND
    "duration_tolerance_ms" >= 0 AND "duration_tolerance_ms" <= 60000 AND
    "max_continuous_duration_ms" > 0 AND "max_continuous_duration_ms" <= 600000 AND
    "max_generated_clip_duration_ms" > 0 AND "max_generated_clip_duration_ms" <= 600000 AND
    "max_generated_clip_duration_ms" <= "max_continuous_duration_ms"
  ),
  CONSTRAINT "story_film_specs_targets_chk" CHECK (
    "target_clip_count" > 0 AND "target_clip_count" <= 10000 AND
    "target_choice_count" >= 0 AND "target_choice_count" <= 10000 AND
    "target_ending_count" > 0 AND "target_ending_count" <= 1000
  ),
  CONSTRAINT "story_film_specs_frame_chk" CHECK (
    "frame_width" > 0 AND "frame_width" <= 16384 AND
    "frame_height" > 0 AND "frame_height" <= 16384 AND
    "frame_width" * 9 = "frame_height" * 16 AND
    "frame_rate_numerator" > 0 AND "frame_rate_numerator" <= 240000 AND
    "frame_rate_denominator" > 0 AND "frame_rate_denominator" <= 10000
  ),
  CONSTRAINT "story_film_specs_audio_chk" CHECK ("audio_sample_rate" IN (44100, 48000)),
  CONSTRAINT "story_film_specs_locales_chk" CHECK (
    btrim("default_locale") <> '' AND jsonb_typeof("enabled_locales") = 'array' AND
    jsonb_array_length("enabled_locales") BETWEEN 1 AND 50 AND
    "enabled_locales" ? "default_locale"
  ),
  CONSTRAINT "story_film_specs_hash_chk" CHECK ("spec_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "story_film_specs_json_shape_chk" CHECK (jsonb_typeof("spec_json") = 'object'),
  CONSTRAINT "story_film_specs_counters_chk" CHECK (
    "production_revision" >= 0 AND "version" >= 0
  )
);

CREATE TABLE "story_film_reference_slots" (
  "id" UUID NOT NULL,
  "story_project_id" UUID NOT NULL,
  "revision_id" UUID NOT NULL,
  "key" VARCHAR(80) NOT NULL,
  "kind" "StoryFilmReferenceKind" NOT NULL,
  "label" VARCHAR(160) NOT NULL,
  "description" TEXT,
  "required" BOOLEAN NOT NULL DEFAULT true,
  "rank" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 0,
  "approved_version_id" UUID,
  "archived_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_film_reference_slots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_film_reference_slots_key_nonempty_chk" CHECK (btrim("key") <> ''),
  CONSTRAINT "story_film_reference_slots_label_nonempty_chk" CHECK (btrim("label") <> ''),
  CONSTRAINT "story_film_reference_slots_counters_chk" CHECK ("rank" >= 0 AND "version" >= 0)
);

CREATE TABLE "story_film_reference_versions" (
  "id" UUID NOT NULL,
  "story_project_id" UUID NOT NULL,
  "revision_id" UUID NOT NULL,
  "reference_slot_id" UUID NOT NULL,
  "version_number" INTEGER NOT NULL,
  "source" "StoryFilmReferenceSource" NOT NULL,
  "status" "StoryFilmReferenceVersionStatus" NOT NULL DEFAULT 'pending',
  "ai_job_id" UUID,
  "ai_job_output_id" TEXT,
  "source_take_id" UUID,
  "source_frame_index" INTEGER,
  "source_output_checksum_sha256" VARCHAR(64),
  "asset_id" UUID NOT NULL,
  "prompt_snapshot" JSONB,
  "generation_config" JSONB,
  "checksum_sha256" VARCHAR(64) NOT NULL,
  "error" JSONB,
  "review_revision" INTEGER NOT NULL DEFAULT 0,
  "created_by_user_id" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ready_at" TIMESTAMPTZ(6),
  CONSTRAINT "story_film_reference_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_film_reference_versions_number_chk" CHECK ("version_number" > 0),
  CONSTRAINT "story_film_reference_versions_hash_chk" CHECK (
    "checksum_sha256" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "story_film_reference_versions_review_revision_chk" CHECK (
    "review_revision" >= 0
  ),
  CONSTRAINT "story_film_reference_versions_source_chk" CHECK (
    (
      "source" = 'ai_job' AND
      "ai_job_id" IS NOT NULL AND "ai_job_output_id" IS NOT NULL AND
      "source_take_id" IS NULL AND "source_frame_index" IS NULL AND
      "source_output_checksum_sha256" IS NULL
    ) OR (
      "source" = 'take_frame' AND
      "ai_job_id" IS NULL AND "ai_job_output_id" IS NULL AND
      "source_take_id" IS NOT NULL AND "source_frame_index" IS NOT NULL AND
      "source_frame_index" >= 0 AND "source_output_checksum_sha256" IS NOT NULL AND
      "source_output_checksum_sha256" ~ '^[0-9a-f]{64}$'
    ) OR (
      "source" IN ('upload', 'import') AND
      "ai_job_id" IS NULL AND "ai_job_output_id" IS NULL AND
      "source_take_id" IS NULL AND "source_frame_index" IS NULL AND
      "source_output_checksum_sha256" IS NULL
    )
  ),
  CONSTRAINT "story_film_reference_versions_ready_chk" CHECK (
    "status" <> 'ready' OR (
      "ready_at" IS NOT NULL
    )
  ),
  CONSTRAINT "story_film_reference_versions_failed_chk" CHECK (
    "status" <> 'failed' OR "error" IS NOT NULL
  )
);

CREATE TABLE "story_film_reference_reviews" (
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
  CONSTRAINT "story_film_reference_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_film_reference_reviews_sequence_chk" CHECK ("sequence" > 0),
  CONSTRAINT "story_film_reference_reviews_approve_chk" CHECK (
    "decision" <> 'approve' OR ("technical_passed" AND "safety_passed")
  ),
  CONSTRAINT "story_film_reference_reviews_rejection_notes_chk" CHECK (
    "decision" = 'approve' OR ("notes" IS NOT NULL AND btrim("notes") <> '')
  )
);

CREATE TABLE "story_film_reference_approvals" (
  "reference_version_id" UUID NOT NULL,
  "review_id" UUID NOT NULL,
  "approved_by_user_id" VARCHAR(64) NOT NULL,
  "approved_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_film_reference_approvals_pkey" PRIMARY KEY ("reference_version_id")
);

CREATE TABLE "story_film_clips" (
  "id" UUID NOT NULL,
  "story_project_id" UUID NOT NULL,
  "revision_id" UUID NOT NULL,
  "key" VARCHAR(80) NOT NULL,
  "graph_node_id" VARCHAR(128) NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "generation_mode" "StoryFilmGenerationMode" NOT NULL,
  "frame_mode" "StoryFilmFrameMode",
  "target_duration_ms" INTEGER NOT NULL,
  "spec_json" JSONB NOT NULL,
  "spec_hash" VARCHAR(64) NOT NULL,
  "production_input_manifest" JSONB,
  "production_input_hash" VARCHAR(64),
  "version" INTEGER NOT NULL DEFAULT 0,
  "rank" INTEGER NOT NULL DEFAULT 0,
  "master_take_id" UUID,
  "master_revision" INTEGER NOT NULL DEFAULT 0,
  "master_selected_by_user_id" VARCHAR(64),
  "master_selected_at" TIMESTAMPTZ(6),
  "created_by_user_id" VARCHAR(64) NOT NULL,
  "updated_by_user_id" VARCHAR(64) NOT NULL,
  "archived_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_film_clips_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_film_clips_key_nonempty_chk" CHECK (btrim("key") <> ''),
  CONSTRAINT "story_film_clips_graph_node_nonempty_chk" CHECK (btrim("graph_node_id") <> ''),
  CONSTRAINT "story_film_clips_title_nonempty_chk" CHECK (btrim("title") <> ''),
  CONSTRAINT "story_film_clips_duration_chk" CHECK ("target_duration_ms" > 0),
  CONSTRAINT "story_film_clips_hashes_chk" CHECK (
    "spec_hash" ~ '^[0-9a-f]{64}$' AND (
      ("production_input_manifest" IS NULL AND "production_input_hash" IS NULL) OR
      (
        "production_input_manifest" IS NOT NULL AND
        jsonb_typeof("production_input_manifest") = 'object' AND
        "production_input_hash" IS NOT NULL AND
        "production_input_hash" ~ '^[0-9a-f]{64}$'
      )
    )
  ),
  CONSTRAINT "story_film_clips_spec_object_chk" CHECK (jsonb_typeof("spec_json") = 'object'),
  CONSTRAINT "story_film_clips_counters_chk" CHECK (
    "version" >= 0 AND "master_revision" >= 0 AND "rank" >= 0
  ),
  CONSTRAINT "story_film_clips_master_audit_chk" CHECK (
    ("master_take_id" IS NULL AND "master_selected_by_user_id" IS NULL AND "master_selected_at" IS NULL) OR
    ("master_take_id" IS NOT NULL AND "master_selected_by_user_id" IS NOT NULL AND "master_selected_at" IS NOT NULL)
  ),
  CONSTRAINT "story_film_clips_mode_chk" CHECK (
    ("generation_mode" = 'frame_lock' AND "frame_mode" IS NOT NULL) OR
    ("generation_mode" = 'omni_reference' AND "frame_mode" IS NULL)
  )
);

CREATE TABLE "story_film_clip_references" (
  "id" UUID NOT NULL,
  "story_project_id" UUID NOT NULL,
  "revision_id" UUID NOT NULL,
  "clip_id" UUID NOT NULL,
  "reference_slot_id" UUID NOT NULL,
  "role" "StoryFilmClipReferenceRole" NOT NULL,
  "position" INTEGER NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_film_clip_references_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_film_clip_references_position_chk" CHECK (
    "position" >= 0 AND
    ("role" NOT IN ('first_frame', 'last_frame') OR "position" = 0)
  )
);

CREATE TABLE "story_film_clip_dependencies" (
  "id" UUID NOT NULL,
  "story_project_id" UUID NOT NULL,
  "revision_id" UUID NOT NULL,
  "predecessor_clip_id" UUID NOT NULL,
  "successor_clip_id" UUID NOT NULL,
  "kind" "StoryFilmDependencyKind" NOT NULL,
  "transition" "StoryFilmDependencyTransition" NOT NULL,
  "join_frame_slot_id" UUID,
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_film_clip_dependencies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_film_clip_dependencies_no_self_chk" CHECK (
    "predecessor_clip_id" <> "successor_clip_id"
  ),
  CONSTRAINT "story_film_clip_dependencies_version_chk" CHECK ("version" >= 0),
  CONSTRAINT "story_film_clip_dependencies_join_chk" CHECK (
    ("transition" = 'shared_join_frame' AND "join_frame_slot_id" IS NOT NULL) OR
    ("transition" <> 'shared_join_frame' AND "join_frame_slot_id" IS NULL)
  )
);

CREATE TABLE "story_film_takes" (
  "id" UUID NOT NULL,
  "story_project_id" UUID NOT NULL,
  "revision_id" UUID NOT NULL,
  "clip_id" UUID NOT NULL,
  "take_number" INTEGER NOT NULL,
  "status" "StoryFilmTakeStatus" NOT NULL DEFAULT 'queued',
  "clip_spec_hash" VARCHAR(64) NOT NULL,
  "production_input_hash" VARCHAR(64) NOT NULL,
  "prompt_snapshot" JSONB NOT NULL,
  "generation_config" JSONB NOT NULL,
  "model_snapshot" JSONB NOT NULL,
  "ai_job_id" UUID NOT NULL,
  "ai_job_output_id" TEXT,
  "output_asset_id" UUID,
  "output_variant_id" UUID,
  "output_checksum_sha256" VARCHAR(64),
  "technical_checks" JSONB NOT NULL DEFAULT '[]',
  "error" JSONB,
  "review_revision" INTEGER NOT NULL DEFAULT 0,
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
  CONSTRAINT "story_film_takes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_film_takes_number_chk" CHECK ("take_number" > 0),
  CONSTRAINT "story_film_takes_hashes_chk" CHECK (
    "clip_spec_hash" ~ '^[0-9a-f]{64}$' AND
    "production_input_hash" ~ '^[0-9a-f]{64}$' AND
    ("output_checksum_sha256" IS NULL OR "output_checksum_sha256" ~ '^[0-9a-f]{64}$')
  ),
  CONSTRAINT "story_film_takes_counters_chk" CHECK (
    "version" >= 0 AND "review_revision" >= 0
  ),
  CONSTRAINT "story_film_takes_technical_checks_array_chk" CHECK (
    jsonb_typeof("technical_checks") = 'array' AND
    jsonb_typeof("prompt_snapshot") = 'object' AND
    jsonb_typeof("generation_config") = 'object' AND
    jsonb_typeof("model_snapshot") = 'object'
  ),
  CONSTRAINT "story_film_takes_ready_chk" CHECK (
    "status" <> 'ready' OR (
      "ai_job_output_id" IS NOT NULL AND "output_asset_id" IS NOT NULL AND
      "output_variant_id" IS NOT NULL AND "output_checksum_sha256" IS NOT NULL AND
      "ready_at" IS NOT NULL AND "completed_at" IS NOT NULL
    )
  ),
  CONSTRAINT "story_film_takes_failed_chk" CHECK (
    "status" <> 'failed' OR ("error" IS NOT NULL AND "completed_at" IS NOT NULL)
  ),
  CONSTRAINT "story_film_takes_cancelled_chk" CHECK (
    "status" <> 'cancelled' OR ("cancelled_at" IS NOT NULL AND "completed_at" IS NOT NULL)
  )
);

CREATE TABLE "story_film_take_references" (
  "story_project_id" UUID NOT NULL,
  "revision_id" UUID NOT NULL,
  "take_id" UUID NOT NULL,
  "reference_slot_id" UUID NOT NULL,
  "reference_version_id" UUID NOT NULL,
  "role" "StoryFilmClipReferenceRole" NOT NULL,
  "position" INTEGER NOT NULL,
  "asset_id" UUID NOT NULL,
  "checksum_sha256" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_film_take_references_pkey" PRIMARY KEY ("take_id", "role", "position"),
  CONSTRAINT "story_film_take_references_position_chk" CHECK ("position" >= 0),
  CONSTRAINT "story_film_take_references_hash_chk" CHECK (
    "checksum_sha256" ~ '^[0-9a-f]{64}$'
  )
);

CREATE TABLE "story_film_take_reviews" (
  "id" UUID NOT NULL,
  "take_id" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "decision" "StoryReviewDecision" NOT NULL,
  "technical_passed" BOOLEAN NOT NULL,
  "safety_passed" BOOLEAN NOT NULL,
  "checklist" JSONB NOT NULL DEFAULT '{}',
  "notes" TEXT,
  "reviewer_user_id" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_film_take_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_film_take_reviews_sequence_chk" CHECK ("sequence" > 0),
  CONSTRAINT "story_film_take_reviews_approve_chk" CHECK (
    "decision" <> 'approve' OR ("technical_passed" AND "safety_passed")
  ),
  CONSTRAINT "story_film_take_reviews_rejection_notes_chk" CHECK (
    "decision" = 'approve' OR ("notes" IS NOT NULL AND btrim("notes") <> '')
  )
);

CREATE TABLE "story_film_take_approvals" (
  "take_id" UUID NOT NULL,
  "review_id" UUID NOT NULL,
  "approved_by_user_id" VARCHAR(64) NOT NULL,
  "approved_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_film_take_approvals_pkey" PRIMARY KEY ("take_id")
);

CREATE TABLE "story_film_continuity_checks" (
  "id" UUID NOT NULL,
  "story_project_id" UUID NOT NULL,
  "revision_id" UUID NOT NULL,
  "dependency_id" UUID NOT NULL,
  "upstream_take_id" UUID NOT NULL,
  "downstream_take_id" UUID NOT NULL,
  "metrics" JSONB NOT NULL DEFAULT '{}',
  "thresholds" JSONB NOT NULL DEFAULT '{}',
  "automatic_passed" BOOLEAN,
  "decision" "StoryFilmContinuityDecision" NOT NULL DEFAULT 'pending',
  "notes" TEXT,
  "reviewer_user_id" VARCHAR(64),
  "reviewed_at" TIMESTAMPTZ(6),
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_film_continuity_checks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_film_continuity_checks_version_chk" CHECK ("version" >= 0),
  CONSTRAINT "story_film_continuity_checks_review_chk" CHECK (
    ("decision" = 'pending' AND "reviewer_user_id" IS NULL AND "reviewed_at" IS NULL) OR
    ("decision" <> 'pending' AND "reviewer_user_id" IS NOT NULL AND "reviewed_at" IS NOT NULL)
  )
);

CREATE TABLE "story_film_build_clips" (
  "build_id" UUID NOT NULL,
  "story_project_id" UUID NOT NULL,
  "revision_id" UUID NOT NULL,
  "clip_id" UUID NOT NULL,
  "take_id" UUID NOT NULL,
  "build_asset_id" UUID NOT NULL,
  "logical_key" VARCHAR(160) NOT NULL,
  "clip_spec_hash" VARCHAR(64) NOT NULL,
  "production_input_hash" VARCHAR(64) NOT NULL,
  "checksum_sha256" VARCHAR(64) NOT NULL,
  "duration_ms" INTEGER NOT NULL,
  "rank" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_film_build_clips_pkey" PRIMARY KEY ("build_id", "clip_id"),
  CONSTRAINT "story_film_build_clips_key_nonempty_chk" CHECK (btrim("logical_key") <> ''),
  CONSTRAINT "story_film_build_clips_hashes_chk" CHECK (
    "clip_spec_hash" ~ '^[0-9a-f]{64}$' AND
    "production_input_hash" ~ '^[0-9a-f]{64}$' AND
    "checksum_sha256" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "story_film_build_clips_values_chk" CHECK ("duration_ms" > 0 AND "rank" >= 0)
);

-- Uniqueness and query indexes. Partial indexes are SQL-owned because Prisma
-- cannot express active-row predicates.
ALTER TABLE "story_projects"
  ADD CONSTRAINT "story_projects_id_workspace_unique" UNIQUE ("id", "workspace_id");
CREATE INDEX "story_projects_workspace_format_recent_idx"
  ON "story_projects" ("workspace_id", "format", "status", "updated_at" DESC);
CREATE INDEX "story_projects_creator_recent_idx"
  ON "story_projects" ("created_by_user_id", "status", "updated_at" DESC);

ALTER TABLE "story_project_members"
  ADD CONSTRAINT "story_project_members_project_user_unique"
  UNIQUE ("story_project_id", "user_id");
CREATE UNIQUE INDEX "story_project_members_one_active_owner_unique"
  ON "story_project_members" ("story_project_id")
  WHERE "status" = 'active' AND "role" = 'owner';
CREATE INDEX "story_project_members_user_status_idx"
  ON "story_project_members" ("user_id", "status");
CREATE INDEX "story_project_members_project_status_role_idx"
  ON "story_project_members" ("story_project_id", "status", "role");

ALTER TABLE "story_drafts"
  ADD CONSTRAINT "story_drafts_story_project_id_key" UNIQUE ("story_project_id");

ALTER TABLE "story_revisions"
  ADD CONSTRAINT "story_revisions_project_number_unique"
  UNIQUE ("story_project_id", "number"),
  ADD CONSTRAINT "story_revisions_project_draft_revision_unique"
  UNIQUE ("story_project_id", "source_draft_revision"),
  ADD CONSTRAINT "story_revisions_id_project_unique"
  UNIQUE ("id", "story_project_id");
CREATE INDEX "story_revisions_project_recent_idx"
  ON "story_revisions" ("story_project_id", "created_at" DESC);

ALTER TABLE "story_builds"
  ADD CONSTRAINT "story_builds_project_number_unique"
  UNIQUE ("story_project_id", "build_number"),
  ADD CONSTRAINT "story_builds_id_project_unique"
  UNIQUE ("id", "story_project_id");
CREATE INDEX "story_builds_project_status_recent_idx"
  ON "story_builds" ("story_project_id", "status", "created_at" DESC);

ALTER TABLE "story_build_assets"
  ADD CONSTRAINT "story_build_assets_build_logical_key_unique"
  UNIQUE ("build_id", "logical_key"),
  ADD CONSTRAINT "story_build_assets_id_build_unique"
  UNIQUE ("id", "build_id");
CREATE INDEX "story_build_assets_project_idx"
  ON "story_build_assets" ("story_project_id", "created_at");

ALTER TABLE "story_releases"
  ADD CONSTRAINT "story_releases_build_id_key" UNIQUE ("build_id"),
  ADD CONSTRAINT "story_releases_project_version_unique"
  UNIQUE ("story_project_id", "release_version"),
  ADD CONSTRAINT "story_releases_id_project_unique"
  UNIQUE ("id", "story_project_id");
CREATE INDEX "story_releases_project_recent_idx"
  ON "story_releases" ("story_project_id", "created_at" DESC);

ALTER TABLE "story_release_assets"
  ADD CONSTRAINT "story_release_assets_release_logical_key_unique"
  UNIQUE ("release_id", "logical_key");
CREATE INDEX "story_release_assets_project_idx"
  ON "story_release_assets" ("story_project_id", "created_at");

ALTER TABLE "story_release_reviews"
  ADD CONSTRAINT "story_release_reviews_release_sequence_unique"
  UNIQUE ("release_id", "sequence"),
  ADD CONSTRAINT "story_release_reviews_id_release_unique"
  UNIQUE ("id", "release_id");
ALTER TABLE "story_release_approvals"
  ADD CONSTRAINT "story_release_approvals_review_id_key" UNIQUE ("review_id");
CREATE INDEX "story_deployments_release_status_idx"
  ON "story_deployments" ("release_id", "status");

ALTER TABLE "story_film_specs"
  ADD CONSTRAINT "story_film_specs_revision_project_unique"
  UNIQUE ("revision_id", "story_project_id");
CREATE INDEX "story_film_specs_project_recent_idx"
  ON "story_film_specs" ("story_project_id", "updated_at" DESC);

ALTER TABLE "story_film_reference_slots"
  ADD CONSTRAINT "story_film_reference_slots_approved_version_id_key"
  UNIQUE ("approved_version_id"),
  ADD CONSTRAINT "story_film_reference_slots_revision_key_unique"
  UNIQUE ("revision_id", "key"),
  ADD CONSTRAINT "story_film_reference_slots_scope_unique"
  UNIQUE ("id", "story_project_id", "revision_id");
CREATE INDEX "story_film_reference_slots_scope_kind_idx"
  ON "story_film_reference_slots" ("story_project_id", "revision_id", "kind", "rank");

ALTER TABLE "story_film_reference_versions"
  ADD CONSTRAINT "story_film_reference_versions_ai_job_output_id_key"
  UNIQUE ("ai_job_output_id"),
  ADD CONSTRAINT "story_film_reference_versions_slot_number_unique"
  UNIQUE ("reference_slot_id", "version_number"),
  ADD CONSTRAINT "story_film_reference_versions_id_slot_unique"
  UNIQUE ("id", "reference_slot_id"),
  ADD CONSTRAINT "story_film_reference_versions_scope_unique"
  UNIQUE ("id", "story_project_id", "revision_id");
CREATE INDEX "story_film_reference_versions_scope_status_idx"
  ON "story_film_reference_versions"
  ("story_project_id", "revision_id", "status", "created_at" DESC);
CREATE INDEX "story_film_reference_versions_ai_job_idx"
  ON "story_film_reference_versions" ("ai_job_id");
CREATE INDEX "story_film_reference_versions_source_take_frame_idx"
  ON "story_film_reference_versions" ("source_take_id", "source_frame_index");

ALTER TABLE "story_film_reference_reviews"
  ADD CONSTRAINT "story_film_reference_reviews_version_sequence_unique"
  UNIQUE ("reference_version_id", "sequence"),
  ADD CONSTRAINT "story_film_reference_reviews_id_version_unique"
  UNIQUE ("id", "reference_version_id");
ALTER TABLE "story_film_reference_approvals"
  ADD CONSTRAINT "story_film_reference_approvals_review_id_key" UNIQUE ("review_id");

ALTER TABLE "story_film_clips"
  ADD CONSTRAINT "story_film_clips_master_take_id_key" UNIQUE ("master_take_id"),
  ADD CONSTRAINT "story_film_clips_revision_key_unique" UNIQUE ("revision_id", "key"),
  ADD CONSTRAINT "story_film_clips_revision_graph_node_unique"
  UNIQUE ("revision_id", "graph_node_id"),
  ADD CONSTRAINT "story_film_clips_scope_unique"
  UNIQUE ("id", "story_project_id", "revision_id");
CREATE INDEX "story_film_clips_scope_rank_idx"
  ON "story_film_clips" ("story_project_id", "revision_id", "rank");

ALTER TABLE "story_film_clip_references"
  ADD CONSTRAINT "story_film_clip_references_clip_role_position_unique"
  UNIQUE ("clip_id", "role", "position"),
  ADD CONSTRAINT "story_film_clip_references_clip_slot_role_unique"
  UNIQUE ("clip_id", "reference_slot_id", "role");
CREATE INDEX "story_film_clip_references_scope_slot_idx"
  ON "story_film_clip_references"
  ("story_project_id", "revision_id", "reference_slot_id");
CREATE UNIQUE INDEX "story_film_clip_references_one_first_frame_idx"
  ON "story_film_clip_references" ("clip_id")
  WHERE "role" = 'first_frame';
CREATE UNIQUE INDEX "story_film_clip_references_one_last_frame_idx"
  ON "story_film_clip_references" ("clip_id")
  WHERE "role" = 'last_frame';

ALTER TABLE "story_film_clip_dependencies"
  ADD CONSTRAINT "story_film_clip_dependencies_edge_kind_unique"
  UNIQUE ("predecessor_clip_id", "successor_clip_id", "kind"),
  ADD CONSTRAINT "story_film_clip_dependencies_scope_unique"
  UNIQUE ("id", "story_project_id", "revision_id");
CREATE INDEX "story_film_clip_dependencies_scope_successor_idx"
  ON "story_film_clip_dependencies"
  ("story_project_id", "revision_id", "successor_clip_id");

ALTER TABLE "story_film_takes"
  ADD CONSTRAINT "story_film_takes_ai_job_output_id_key" UNIQUE ("ai_job_output_id"),
  ADD CONSTRAINT "story_film_takes_clip_number_unique" UNIQUE ("clip_id", "take_number"),
  ADD CONSTRAINT "story_film_takes_id_clip_unique" UNIQUE ("id", "clip_id"),
  ADD CONSTRAINT "story_film_takes_scope_unique"
  UNIQUE ("id", "story_project_id", "revision_id");
CREATE INDEX "story_film_takes_scope_status_idx"
  ON "story_film_takes" ("story_project_id", "revision_id", "status", "created_at" DESC);
CREATE INDEX "story_film_takes_ai_job_idx" ON "story_film_takes" ("ai_job_id");

CREATE INDEX "story_film_take_references_scope_version_idx"
  ON "story_film_take_references"
  ("story_project_id", "revision_id", "reference_version_id");

ALTER TABLE "story_film_take_reviews"
  ADD CONSTRAINT "story_film_take_reviews_take_sequence_unique"
  UNIQUE ("take_id", "sequence"),
  ADD CONSTRAINT "story_film_take_reviews_id_take_unique"
  UNIQUE ("id", "take_id");
ALTER TABLE "story_film_take_approvals"
  ADD CONSTRAINT "story_film_take_approvals_review_id_key" UNIQUE ("review_id");

ALTER TABLE "story_film_continuity_checks"
  ADD CONSTRAINT "story_film_continuity_checks_inputs_unique"
  UNIQUE ("dependency_id", "upstream_take_id", "downstream_take_id"),
  ADD CONSTRAINT "story_film_continuity_checks_scope_unique"
  UNIQUE ("id", "story_project_id", "revision_id");
CREATE INDEX "story_film_continuity_checks_scope_decision_idx"
  ON "story_film_continuity_checks"
  ("story_project_id", "revision_id", "decision");

ALTER TABLE "story_film_build_clips"
  ADD CONSTRAINT "story_film_build_clips_build_asset_id_key" UNIQUE ("build_asset_id"),
  ADD CONSTRAINT "story_film_build_clips_build_logical_key_unique"
  UNIQUE ("build_id", "logical_key");
CREATE INDEX "story_film_build_clips_scope_rank_idx"
  ON "story_film_build_clips" ("story_project_id", "revision_id", "rank");

-- Foreign keys. Scope-composite keys are intentional: a UUID that exists in
-- another StoryProject/Revision is not a valid relation target.
ALTER TABLE "story_projects"
  ADD CONSTRAINT "story_projects_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_projects_cover_asset_id_fkey"
  FOREIGN KEY ("cover_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL;

ALTER TABLE "story_project_members"
  ADD CONSTRAINT "story_project_members_story_project_id_fkey"
  FOREIGN KEY ("story_project_id") REFERENCES "story_projects"("id") ON DELETE CASCADE;
ALTER TABLE "story_drafts"
  ADD CONSTRAINT "story_drafts_story_project_id_fkey"
  FOREIGN KEY ("story_project_id") REFERENCES "story_projects"("id") ON DELETE CASCADE;
ALTER TABLE "story_revisions"
  ADD CONSTRAINT "story_revisions_story_project_id_fkey"
  FOREIGN KEY ("story_project_id") REFERENCES "story_projects"("id") ON DELETE RESTRICT;

ALTER TABLE "story_builds"
  ADD CONSTRAINT "story_builds_story_project_id_fkey"
  FOREIGN KEY ("story_project_id") REFERENCES "story_projects"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_builds_source_revision_id_fkey"
  FOREIGN KEY ("source_revision_id") REFERENCES "story_revisions"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_builds_source_revision_scope_fkey"
  FOREIGN KEY ("source_revision_id", "story_project_id")
  REFERENCES "story_revisions"("id", "story_project_id") ON DELETE RESTRICT;

ALTER TABLE "story_build_assets"
  ADD CONSTRAINT "story_build_assets_build_id_fkey"
  FOREIGN KEY ("build_id") REFERENCES "story_builds"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "story_build_assets_story_project_id_fkey"
  FOREIGN KEY ("story_project_id") REFERENCES "story_projects"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_build_assets_build_scope_fkey"
  FOREIGN KEY ("build_id", "story_project_id")
  REFERENCES "story_builds"("id", "story_project_id") ON DELETE CASCADE,
  ADD CONSTRAINT "story_build_assets_asset_id_fkey"
  FOREIGN KEY ("asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_build_assets_variant_id_fkey"
  FOREIGN KEY ("variant_id") REFERENCES "media_asset_variants"("id") ON DELETE RESTRICT;

ALTER TABLE "story_releases"
  ADD CONSTRAINT "story_releases_story_project_id_fkey"
  FOREIGN KEY ("story_project_id") REFERENCES "story_projects"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_releases_build_id_fkey"
  FOREIGN KEY ("build_id") REFERENCES "story_builds"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_releases_build_scope_fkey"
  FOREIGN KEY ("build_id", "story_project_id")
  REFERENCES "story_builds"("id", "story_project_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_releases_source_revision_id_fkey"
  FOREIGN KEY ("source_revision_id") REFERENCES "story_revisions"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_releases_source_revision_scope_fkey"
  FOREIGN KEY ("source_revision_id", "story_project_id")
  REFERENCES "story_revisions"("id", "story_project_id") ON DELETE RESTRICT;

ALTER TABLE "story_release_assets"
  ADD CONSTRAINT "story_release_assets_release_id_fkey"
  FOREIGN KEY ("release_id") REFERENCES "story_releases"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_release_assets_story_project_id_fkey"
  FOREIGN KEY ("story_project_id") REFERENCES "story_projects"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_release_assets_release_scope_fkey"
  FOREIGN KEY ("release_id", "story_project_id")
  REFERENCES "story_releases"("id", "story_project_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_release_assets_asset_id_fkey"
  FOREIGN KEY ("asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_release_assets_variant_id_fkey"
  FOREIGN KEY ("variant_id") REFERENCES "media_asset_variants"("id") ON DELETE RESTRICT;

ALTER TABLE "story_release_reviews"
  ADD CONSTRAINT "story_release_reviews_release_id_fkey"
  FOREIGN KEY ("release_id") REFERENCES "story_releases"("id") ON DELETE RESTRICT;
ALTER TABLE "story_release_approvals"
  ADD CONSTRAINT "story_release_approvals_release_id_fkey"
  FOREIGN KEY ("release_id") REFERENCES "story_releases"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_release_approvals_review_id_fkey"
  FOREIGN KEY ("review_id") REFERENCES "story_release_reviews"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_release_approvals_review_scope_fkey"
  FOREIGN KEY ("review_id", "release_id")
  REFERENCES "story_release_reviews"("id", "release_id") ON DELETE RESTRICT;

ALTER TABLE "story_deployments"
  ADD CONSTRAINT "story_deployments_story_project_id_fkey"
  FOREIGN KEY ("story_project_id") REFERENCES "story_projects"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_deployments_release_id_fkey"
  FOREIGN KEY ("release_id") REFERENCES "story_releases"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_deployments_release_scope_fkey"
  FOREIGN KEY ("release_id", "story_project_id")
  REFERENCES "story_releases"("id", "story_project_id") ON DELETE RESTRICT;

ALTER TABLE "story_film_specs"
  ADD CONSTRAINT "story_film_specs_story_project_id_fkey"
  FOREIGN KEY ("story_project_id") REFERENCES "story_projects"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_specs_revision_id_fkey"
  FOREIGN KEY ("revision_id") REFERENCES "story_revisions"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_specs_revision_scope_fkey"
  FOREIGN KEY ("revision_id", "story_project_id")
  REFERENCES "story_revisions"("id", "story_project_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_specs_default_canonical_model_id_fkey"
  FOREIGN KEY ("default_canonical_model_id")
  REFERENCES "ai_canonical_models"("id") ON DELETE RESTRICT;

ALTER TABLE "story_film_reference_slots"
  ADD CONSTRAINT "story_film_reference_slots_story_project_id_fkey"
  FOREIGN KEY ("story_project_id") REFERENCES "story_projects"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_reference_slots_revision_id_fkey"
  FOREIGN KEY ("revision_id") REFERENCES "story_revisions"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_reference_slots_revision_scope_fkey"
  FOREIGN KEY ("revision_id", "story_project_id")
  REFERENCES "story_revisions"("id", "story_project_id") ON DELETE RESTRICT;

ALTER TABLE "story_film_reference_versions"
  ADD CONSTRAINT "story_film_reference_versions_story_project_id_fkey"
  FOREIGN KEY ("story_project_id") REFERENCES "story_projects"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_reference_versions_revision_id_fkey"
  FOREIGN KEY ("revision_id") REFERENCES "story_revisions"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_reference_versions_revision_scope_fkey"
  FOREIGN KEY ("revision_id", "story_project_id")
  REFERENCES "story_revisions"("id", "story_project_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_reference_versions_reference_slot_id_fkey"
  FOREIGN KEY ("reference_slot_id") REFERENCES "story_film_reference_slots"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_reference_versions_slot_scope_fkey"
  FOREIGN KEY ("reference_slot_id", "story_project_id", "revision_id")
  REFERENCES "story_film_reference_slots"("id", "story_project_id", "revision_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_reference_versions_ai_job_id_fkey"
  FOREIGN KEY ("ai_job_id") REFERENCES "ai_jobs"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_reference_versions_ai_job_output_id_fkey"
  FOREIGN KEY ("ai_job_output_id") REFERENCES "ai_outputs"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_reference_versions_source_take_id_fkey"
  FOREIGN KEY ("source_take_id") REFERENCES "story_film_takes"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_reference_versions_source_take_scope_fkey"
  FOREIGN KEY ("source_take_id", "story_project_id", "revision_id")
  REFERENCES "story_film_takes"("id", "story_project_id", "revision_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_reference_versions_asset_id_fkey"
  FOREIGN KEY ("asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT;

ALTER TABLE "story_film_reference_reviews"
  ADD CONSTRAINT "story_film_reference_reviews_reference_version_id_fkey"
  FOREIGN KEY ("reference_version_id")
  REFERENCES "story_film_reference_versions"("id") ON DELETE RESTRICT;
ALTER TABLE "story_film_reference_approvals"
  ADD CONSTRAINT "story_film_reference_approvals_reference_version_id_fkey"
  FOREIGN KEY ("reference_version_id")
  REFERENCES "story_film_reference_versions"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_reference_approvals_review_id_fkey"
  FOREIGN KEY ("review_id") REFERENCES "story_film_reference_reviews"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_reference_approvals_review_scope_fkey"
  FOREIGN KEY ("review_id", "reference_version_id")
  REFERENCES "story_film_reference_reviews"("id", "reference_version_id") ON DELETE RESTRICT;

ALTER TABLE "story_film_reference_slots"
  ADD CONSTRAINT "story_film_reference_slots_approved_version_id_fkey"
  FOREIGN KEY ("approved_version_id")
  REFERENCES "story_film_reference_versions"("id") ON DELETE NO ACTION,
  ADD CONSTRAINT "story_film_reference_slots_approved_version_scope_fkey"
  FOREIGN KEY ("approved_version_id", "id")
  REFERENCES "story_film_reference_versions"("id", "reference_slot_id") ON DELETE NO ACTION;

ALTER TABLE "story_film_clips"
  ADD CONSTRAINT "story_film_clips_story_project_id_fkey"
  FOREIGN KEY ("story_project_id") REFERENCES "story_projects"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_clips_revision_id_fkey"
  FOREIGN KEY ("revision_id") REFERENCES "story_revisions"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_clips_revision_scope_fkey"
  FOREIGN KEY ("revision_id", "story_project_id")
  REFERENCES "story_revisions"("id", "story_project_id") ON DELETE RESTRICT;

ALTER TABLE "story_film_clip_references"
  ADD CONSTRAINT "story_film_clip_references_story_project_id_fkey"
  FOREIGN KEY ("story_project_id") REFERENCES "story_projects"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_clip_references_revision_id_fkey"
  FOREIGN KEY ("revision_id") REFERENCES "story_revisions"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_clip_references_clip_id_fkey"
  FOREIGN KEY ("clip_id") REFERENCES "story_film_clips"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "story_film_clip_references_clip_scope_fkey"
  FOREIGN KEY ("clip_id", "story_project_id", "revision_id")
  REFERENCES "story_film_clips"("id", "story_project_id", "revision_id") ON DELETE CASCADE,
  ADD CONSTRAINT "story_film_clip_references_reference_slot_id_fkey"
  FOREIGN KEY ("reference_slot_id") REFERENCES "story_film_reference_slots"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_clip_references_slot_scope_fkey"
  FOREIGN KEY ("reference_slot_id", "story_project_id", "revision_id")
  REFERENCES "story_film_reference_slots"("id", "story_project_id", "revision_id") ON DELETE RESTRICT;

ALTER TABLE "story_film_clip_dependencies"
  ADD CONSTRAINT "story_film_clip_dependencies_story_project_id_fkey"
  FOREIGN KEY ("story_project_id") REFERENCES "story_projects"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_clip_dependencies_revision_id_fkey"
  FOREIGN KEY ("revision_id") REFERENCES "story_revisions"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_clip_dependencies_predecessor_clip_id_fkey"
  FOREIGN KEY ("predecessor_clip_id") REFERENCES "story_film_clips"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_clip_dependencies_predecessor_scope_fkey"
  FOREIGN KEY ("predecessor_clip_id", "story_project_id", "revision_id")
  REFERENCES "story_film_clips"("id", "story_project_id", "revision_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_clip_dependencies_successor_clip_id_fkey"
  FOREIGN KEY ("successor_clip_id") REFERENCES "story_film_clips"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_clip_dependencies_successor_scope_fkey"
  FOREIGN KEY ("successor_clip_id", "story_project_id", "revision_id")
  REFERENCES "story_film_clips"("id", "story_project_id", "revision_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_clip_dependencies_join_frame_slot_id_fkey"
  FOREIGN KEY ("join_frame_slot_id") REFERENCES "story_film_reference_slots"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_clip_dependencies_join_frame_scope_fkey"
  FOREIGN KEY ("join_frame_slot_id", "story_project_id", "revision_id")
  REFERENCES "story_film_reference_slots"("id", "story_project_id", "revision_id") ON DELETE RESTRICT;

ALTER TABLE "story_film_takes"
  ADD CONSTRAINT "story_film_takes_story_project_id_fkey"
  FOREIGN KEY ("story_project_id") REFERENCES "story_projects"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_takes_revision_id_fkey"
  FOREIGN KEY ("revision_id") REFERENCES "story_revisions"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_takes_clip_id_fkey"
  FOREIGN KEY ("clip_id") REFERENCES "story_film_clips"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_takes_clip_scope_fkey"
  FOREIGN KEY ("clip_id", "story_project_id", "revision_id")
  REFERENCES "story_film_clips"("id", "story_project_id", "revision_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_takes_ai_job_id_fkey"
  FOREIGN KEY ("ai_job_id") REFERENCES "ai_jobs"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_takes_ai_job_output_id_fkey"
  FOREIGN KEY ("ai_job_output_id") REFERENCES "ai_outputs"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_takes_output_asset_id_fkey"
  FOREIGN KEY ("output_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_takes_output_variant_id_fkey"
  FOREIGN KEY ("output_variant_id") REFERENCES "media_asset_variants"("id") ON DELETE RESTRICT;

ALTER TABLE "story_film_clips"
  ADD CONSTRAINT "story_film_clips_master_take_id_fkey"
  FOREIGN KEY ("master_take_id") REFERENCES "story_film_takes"("id") ON DELETE NO ACTION,
  ADD CONSTRAINT "story_film_clips_master_take_scope_fkey"
  FOREIGN KEY ("master_take_id", "id")
  REFERENCES "story_film_takes"("id", "clip_id") ON DELETE NO ACTION;

ALTER TABLE "story_film_take_references"
  ADD CONSTRAINT "story_film_take_references_story_project_id_fkey"
  FOREIGN KEY ("story_project_id") REFERENCES "story_projects"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_take_references_revision_id_fkey"
  FOREIGN KEY ("revision_id") REFERENCES "story_revisions"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_take_references_take_id_fkey"
  FOREIGN KEY ("take_id") REFERENCES "story_film_takes"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_take_references_take_scope_fkey"
  FOREIGN KEY ("take_id", "story_project_id", "revision_id")
  REFERENCES "story_film_takes"("id", "story_project_id", "revision_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_take_references_reference_slot_id_fkey"
  FOREIGN KEY ("reference_slot_id") REFERENCES "story_film_reference_slots"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_take_references_slot_scope_fkey"
  FOREIGN KEY ("reference_slot_id", "story_project_id", "revision_id")
  REFERENCES "story_film_reference_slots"("id", "story_project_id", "revision_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_take_references_reference_version_id_fkey"
  FOREIGN KEY ("reference_version_id") REFERENCES "story_film_reference_versions"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_take_references_version_slot_fkey"
  FOREIGN KEY ("reference_version_id", "reference_slot_id")
  REFERENCES "story_film_reference_versions"("id", "reference_slot_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_take_references_asset_id_fkey"
  FOREIGN KEY ("asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT;

ALTER TABLE "story_film_take_reviews"
  ADD CONSTRAINT "story_film_take_reviews_take_id_fkey"
  FOREIGN KEY ("take_id") REFERENCES "story_film_takes"("id") ON DELETE RESTRICT;
ALTER TABLE "story_film_take_approvals"
  ADD CONSTRAINT "story_film_take_approvals_take_id_fkey"
  FOREIGN KEY ("take_id") REFERENCES "story_film_takes"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_take_approvals_review_id_fkey"
  FOREIGN KEY ("review_id") REFERENCES "story_film_take_reviews"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_take_approvals_review_scope_fkey"
  FOREIGN KEY ("review_id", "take_id")
  REFERENCES "story_film_take_reviews"("id", "take_id") ON DELETE RESTRICT;

ALTER TABLE "story_film_continuity_checks"
  ADD CONSTRAINT "story_film_continuity_checks_story_project_id_fkey"
  FOREIGN KEY ("story_project_id") REFERENCES "story_projects"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_continuity_checks_revision_id_fkey"
  FOREIGN KEY ("revision_id") REFERENCES "story_revisions"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_continuity_checks_dependency_id_fkey"
  FOREIGN KEY ("dependency_id") REFERENCES "story_film_clip_dependencies"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_continuity_checks_dependency_scope_fkey"
  FOREIGN KEY ("dependency_id", "story_project_id", "revision_id")
  REFERENCES "story_film_clip_dependencies"("id", "story_project_id", "revision_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_continuity_checks_upstream_take_id_fkey"
  FOREIGN KEY ("upstream_take_id") REFERENCES "story_film_takes"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_continuity_checks_upstream_scope_fkey"
  FOREIGN KEY ("upstream_take_id", "story_project_id", "revision_id")
  REFERENCES "story_film_takes"("id", "story_project_id", "revision_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_continuity_checks_downstream_take_id_fkey"
  FOREIGN KEY ("downstream_take_id") REFERENCES "story_film_takes"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_continuity_checks_downstream_scope_fkey"
  FOREIGN KEY ("downstream_take_id", "story_project_id", "revision_id")
  REFERENCES "story_film_takes"("id", "story_project_id", "revision_id") ON DELETE RESTRICT;

ALTER TABLE "story_film_build_clips"
  ADD CONSTRAINT "story_film_build_clips_build_id_fkey"
  FOREIGN KEY ("build_id") REFERENCES "story_builds"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "story_film_build_clips_build_scope_fkey"
  FOREIGN KEY ("build_id", "story_project_id")
  REFERENCES "story_builds"("id", "story_project_id") ON DELETE CASCADE,
  ADD CONSTRAINT "story_film_build_clips_story_project_id_fkey"
  FOREIGN KEY ("story_project_id") REFERENCES "story_projects"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_build_clips_revision_id_fkey"
  FOREIGN KEY ("revision_id") REFERENCES "story_revisions"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_build_clips_clip_id_fkey"
  FOREIGN KEY ("clip_id") REFERENCES "story_film_clips"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_build_clips_clip_scope_fkey"
  FOREIGN KEY ("clip_id", "story_project_id", "revision_id")
  REFERENCES "story_film_clips"("id", "story_project_id", "revision_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_build_clips_take_id_fkey"
  FOREIGN KEY ("take_id") REFERENCES "story_film_takes"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_build_clips_take_clip_fkey"
  FOREIGN KEY ("take_id", "clip_id")
  REFERENCES "story_film_takes"("id", "clip_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_build_clips_build_asset_id_fkey"
  FOREIGN KEY ("build_asset_id") REFERENCES "story_build_assets"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_build_clips_build_asset_scope_fkey"
  FOREIGN KEY ("build_asset_id", "build_id")
  REFERENCES "story_build_assets"("id", "build_id") ON DELETE RESTRICT;

-- ─── Cross-domain and identity guards ─────────────────────────────────────

CREATE FUNCTION "story_prevent_mutation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is immutable (% attempted)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "story_revisions_immutable_trg"
BEFORE UPDATE OR DELETE ON "story_revisions"
FOR EACH ROW EXECUTE FUNCTION "story_prevent_mutation"();
CREATE TRIGGER "story_release_assets_immutable_trg"
BEFORE UPDATE OR DELETE ON "story_release_assets"
FOR EACH ROW EXECUTE FUNCTION "story_prevent_mutation"();
CREATE TRIGGER "story_release_reviews_immutable_trg"
BEFORE UPDATE OR DELETE ON "story_release_reviews"
FOR EACH ROW EXECUTE FUNCTION "story_prevent_mutation"();
CREATE TRIGGER "story_release_approvals_immutable_trg"
BEFORE UPDATE OR DELETE ON "story_release_approvals"
FOR EACH ROW EXECUTE FUNCTION "story_prevent_mutation"();
CREATE TRIGGER "story_film_reference_reviews_immutable_trg"
BEFORE UPDATE OR DELETE ON "story_film_reference_reviews"
FOR EACH ROW EXECUTE FUNCTION "story_prevent_mutation"();
CREATE TRIGGER "story_film_reference_approvals_immutable_trg"
BEFORE UPDATE OR DELETE ON "story_film_reference_approvals"
FOR EACH ROW EXECUTE FUNCTION "story_prevent_mutation"();
CREATE TRIGGER "story_film_take_reviews_immutable_trg"
BEFORE UPDATE OR DELETE ON "story_film_take_reviews"
FOR EACH ROW EXECUTE FUNCTION "story_prevent_mutation"();
CREATE TRIGGER "story_film_take_approvals_immutable_trg"
BEFORE UPDATE OR DELETE ON "story_film_take_approvals"
FOR EACH ROW EXECUTE FUNCTION "story_prevent_mutation"();
CREATE TRIGGER "story_film_build_clips_immutable_trg"
BEFORE UPDATE OR DELETE ON "story_film_build_clips"
FOR EACH ROW EXECUTE FUNCTION "story_prevent_mutation"();
CREATE TRIGGER "story_deployments_no_delete_trg"
BEFORE DELETE ON "story_deployments"
FOR EACH ROW EXECUTE FUNCTION "story_prevent_mutation"();

CREATE FUNCTION "story_release_immutable_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'story_releases is immutable (DELETE attempted)'
      USING ERRCODE = '55000';
  END IF;
  IF (to_jsonb(NEW) - 'review_revision') IS DISTINCT FROM
     (to_jsonb(OLD) - 'review_revision') THEN
    RAISE EXCEPTION 'StoryRelease envelope is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF NEW."review_revision" = OLD."review_revision" + 1
     AND pg_trigger_depth() >= 2 THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'StoryRelease reviewRevision is trigger-managed'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "story_releases_immutable_trg"
BEFORE UPDATE OR DELETE ON "story_releases"
FOR EACH ROW EXECUTE FUNCTION "story_release_immutable_guard"();

CREATE FUNCTION "story_project_identity_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."workspace_id" IS DISTINCT FROM OLD."workspace_id" THEN
    RAISE EXCEPTION 'StoryProject.workspaceId is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."format" IS DISTINCT FROM OLD."format" THEN
    RAISE EXCEPTION 'StoryProject.format is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_projects_identity_guard_trg"
BEFORE UPDATE ON "story_projects"
FOR EACH ROW EXECUTE FUNCTION "story_project_identity_guard"();

CREATE FUNCTION "story_project_cover_workspace_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  asset_workspace UUID;
BEGIN
  IF NEW."cover_asset_id" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT "workspace_id" INTO asset_workspace
  FROM "media_assets" WHERE "id" = NEW."cover_asset_id";
  IF asset_workspace IS NULL OR asset_workspace <> NEW."workspace_id" THEN
    RAISE EXCEPTION 'StoryProject cover asset must belong to the same Workspace'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_projects_cover_workspace_guard_trg"
BEFORE INSERT OR UPDATE OF "workspace_id", "cover_asset_id" ON "story_projects"
FOR EACH ROW EXECUTE FUNCTION "story_project_cover_workspace_guard"();

CREATE FUNCTION "story_project_member_workspace_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  project_workspace UUID;
BEGIN
  IF NEW."status" <> 'active' THEN
    RETURN NEW;
  END IF;
  SELECT "workspace_id" INTO project_workspace
  FROM "story_projects" WHERE "id" = NEW."story_project_id";
  IF NOT EXISTS (
    SELECT 1 FROM "workspace_members"
    WHERE "workspace_id" = project_workspace
      AND "user_id" = NEW."user_id"
      AND "status" = 'active'
      AND "removed_at" IS NULL
  ) THEN
    RAISE EXCEPTION 'Active StoryProject member must be an active Workspace member'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_project_members_workspace_guard_trg"
BEFORE INSERT OR UPDATE ON "story_project_members"
FOR EACH ROW EXECUTE FUNCTION "story_project_member_workspace_guard"();

CREATE FUNCTION "story_project_owner_required_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  target_project UUID;
BEGIN
  target_project := COALESCE(NEW."story_project_id", OLD."story_project_id");
  IF EXISTS (SELECT 1 FROM "story_projects" WHERE "id" = target_project)
     AND (
       SELECT count(*) FROM "story_project_members"
       WHERE "story_project_id" = target_project
         AND "status" = 'active' AND "role" = 'owner'
     ) <> 1 THEN
    RAISE EXCEPTION 'StoryProject must have exactly one active owner'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "story_project_members_owner_required_trg"
AFTER INSERT OR UPDATE OR DELETE ON "story_project_members"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "story_project_owner_required_guard"();

CREATE FUNCTION "story_project_initial_owner_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (
    SELECT count(*) FROM "story_project_members"
    WHERE "story_project_id" = NEW."id"
      AND "status" = 'active' AND "role" = 'owner'
  ) <> 1 THEN
    RAISE EXCEPTION 'New StoryProject must have exactly one active owner'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "story_projects_initial_owner_required_trg"
AFTER INSERT ON "story_projects"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "story_project_initial_owner_guard"();

CREATE FUNCTION "story_assert_film_scope"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  project_format "StoryFormat";
  revision_project UUID;
BEGIN
  SELECT "format" INTO project_format
  FROM "story_projects" WHERE "id" = NEW."story_project_id";
  IF project_format IS DISTINCT FROM 'interactive_film'::"StoryFormat" THEN
    RAISE EXCEPTION '% may only reference an interactive_film StoryProject', TG_TABLE_NAME
      USING ERRCODE = '23514';
  END IF;

  SELECT "story_project_id" INTO revision_project
  FROM "story_revisions" WHERE "id" = NEW."revision_id";
  IF revision_project IS NULL OR revision_project <> NEW."story_project_id" THEN
    RAISE EXCEPTION '% revision/project scope mismatch', TG_TABLE_NAME
      USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME <> 'story_film_specs' AND NOT EXISTS (
    SELECT 1 FROM "story_film_specs"
    WHERE "revision_id" = NEW."revision_id"
      AND "story_project_id" = NEW."story_project_id"
  ) THEN
    RAISE EXCEPTION '% requires the revision StoryFilmSpec', TG_TABLE_NAME
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "story_film_spec_model_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "ai_canonical_models"
    WHERE "id" = NEW."default_canonical_model_id"
      AND "modality" = 'video'
      AND "status" = 'active'
      AND "archived_at" IS NULL
  ) THEN
    RAISE EXCEPTION 'StoryFilmSpec default model must be an active video AiCanonicalModel'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_film_specs_model_guard_trg"
BEFORE INSERT OR UPDATE OF "default_canonical_model_id" ON "story_film_specs"
FOR EACH ROW EXECUTE FUNCTION "story_film_spec_model_guard"();

CREATE TRIGGER "story_film_specs_scope_guard_trg"
BEFORE INSERT OR UPDATE OF "story_project_id", "revision_id" ON "story_film_specs"
FOR EACH ROW EXECUTE FUNCTION "story_assert_film_scope"();
CREATE TRIGGER "story_film_reference_slots_scope_guard_trg"
BEFORE INSERT OR UPDATE OF "story_project_id", "revision_id" ON "story_film_reference_slots"
FOR EACH ROW EXECUTE FUNCTION "story_assert_film_scope"();
CREATE TRIGGER "story_film_reference_versions_scope_guard_trg"
BEFORE INSERT OR UPDATE OF "story_project_id", "revision_id" ON "story_film_reference_versions"
FOR EACH ROW EXECUTE FUNCTION "story_assert_film_scope"();
CREATE TRIGGER "story_film_clips_scope_guard_trg"
BEFORE INSERT OR UPDATE OF "story_project_id", "revision_id" ON "story_film_clips"
FOR EACH ROW EXECUTE FUNCTION "story_assert_film_scope"();
CREATE TRIGGER "story_film_clip_references_scope_guard_trg"
BEFORE INSERT OR UPDATE OF "story_project_id", "revision_id" ON "story_film_clip_references"
FOR EACH ROW EXECUTE FUNCTION "story_assert_film_scope"();
CREATE TRIGGER "story_film_clip_dependencies_scope_guard_trg"
BEFORE INSERT OR UPDATE OF "story_project_id", "revision_id" ON "story_film_clip_dependencies"
FOR EACH ROW EXECUTE FUNCTION "story_assert_film_scope"();
CREATE TRIGGER "story_film_takes_scope_guard_trg"
BEFORE INSERT OR UPDATE OF "story_project_id", "revision_id" ON "story_film_takes"
FOR EACH ROW EXECUTE FUNCTION "story_assert_film_scope"();
CREATE TRIGGER "story_film_take_references_scope_guard_trg"
BEFORE INSERT OR UPDATE OF "story_project_id", "revision_id" ON "story_film_take_references"
FOR EACH ROW EXECUTE FUNCTION "story_assert_film_scope"();
CREATE TRIGGER "story_film_continuity_checks_scope_guard_trg"
BEFORE INSERT OR UPDATE OF "story_project_id", "revision_id" ON "story_film_continuity_checks"
FOR EACH ROW EXECUTE FUNCTION "story_assert_film_scope"();
CREATE TRIGGER "story_film_build_clips_scope_guard_trg"
BEFORE INSERT OR UPDATE OF "story_project_id", "revision_id" ON "story_film_build_clips"
FOR EACH ROW EXECUTE FUNCTION "story_assert_film_scope"();

CREATE FUNCTION "story_film_spec_version_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  specification_changed BOOLEAN;
BEGIN
  IF NEW."revision_id" IS DISTINCT FROM OLD."revision_id"
     OR NEW."story_project_id" IS DISTINCT FROM OLD."story_project_id"
     OR NEW."created_by_user_id" IS DISTINCT FROM OLD."created_by_user_id"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'StoryFilmSpec identity and creator fields are immutable'
      USING ERRCODE = '23514';
  END IF;

  specification_changed :=
    NEW."runtime_schema_version" IS DISTINCT FROM OLD."runtime_schema_version" OR
    NEW."target_duration_ms" IS DISTINCT FROM OLD."target_duration_ms" OR
    NEW."duration_tolerance_ms" IS DISTINCT FROM OLD."duration_tolerance_ms" OR
    NEW."max_continuous_duration_ms" IS DISTINCT FROM OLD."max_continuous_duration_ms" OR
    NEW."max_generated_clip_duration_ms" IS DISTINCT FROM OLD."max_generated_clip_duration_ms" OR
    NEW."target_clip_count" IS DISTINCT FROM OLD."target_clip_count" OR
    NEW."target_choice_count" IS DISTINCT FROM OLD."target_choice_count" OR
    NEW."target_ending_count" IS DISTINCT FROM OLD."target_ending_count" OR
    NEW."frame_width" IS DISTINCT FROM OLD."frame_width" OR
    NEW."frame_height" IS DISTINCT FROM OLD."frame_height" OR
    NEW."frame_rate_numerator" IS DISTINCT FROM OLD."frame_rate_numerator" OR
    NEW."frame_rate_denominator" IS DISTINCT FROM OLD."frame_rate_denominator" OR
    NEW."audio_sample_rate" IS DISTINCT FROM OLD."audio_sample_rate" OR
    NEW."default_locale" IS DISTINCT FROM OLD."default_locale" OR
    NEW."enabled_locales" IS DISTINCT FROM OLD."enabled_locales" OR
    NEW."default_canonical_model_id" IS DISTINCT FROM OLD."default_canonical_model_id" OR
    NEW."review_policy" IS DISTINCT FROM OLD."review_policy" OR
    NEW."spec_json" IS DISTINCT FROM OLD."spec_json" OR
    NEW."spec_hash" IS DISTINCT FROM OLD."spec_hash";

  IF specification_changed THEN
    IF NEW."version" <> OLD."version" + 1 THEN
      RAISE EXCEPTION 'StoryFilmSpec content update must increment version by exactly one'
        USING ERRCODE = '23514';
    END IF;
    IF NEW."production_revision" <> OLD."production_revision" + 1 THEN
      RAISE EXCEPTION 'StoryFilmSpec content update must increment productionRevision by exactly one'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW."version" IS DISTINCT FROM OLD."version"
       OR NEW."updated_by_user_id" IS DISTINCT FROM OLD."updated_by_user_id" THEN
      RAISE EXCEPTION 'StoryFilmSpec version/editor may change only with spec content'
        USING ERRCODE = '23514';
    END IF;
    IF NEW."production_revision" NOT IN (
      OLD."production_revision", OLD."production_revision" + 1
    ) THEN
      RAISE EXCEPTION 'StoryFilmSpec productionRevision may increment only by one'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_film_specs_version_guard_trg"
BEFORE UPDATE ON "story_film_specs"
FOR EACH ROW EXECUTE FUNCTION "story_film_spec_version_guard"();

CREATE FUNCTION "story_reference_workspace_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  expected_workspace UUID;
  asset_workspace UUID;
  job_workspace UUID;
  job_project UUID;
  output_job UUID;
  output_asset UUID;
BEGIN
  SELECT "workspace_id" INTO expected_workspace
  FROM "story_projects" WHERE "id" = NEW."story_project_id";

  IF NEW."asset_id" IS NOT NULL THEN
    SELECT "workspace_id" INTO asset_workspace
    FROM "media_assets" WHERE "id" = NEW."asset_id";
    IF asset_workspace IS NULL OR asset_workspace <> expected_workspace THEN
      RAISE EXCEPTION 'Story reference MediaAsset must belong to the project Workspace'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."ai_job_id" IS NOT NULL THEN
    SELECT "workspace_id", "project_id" INTO job_workspace, job_project
    FROM "ai_jobs" WHERE "id" = NEW."ai_job_id";
    IF job_workspace IS NULL OR job_workspace <> expected_workspace OR job_project IS NOT NULL THEN
      RAISE EXCEPTION 'Story reference AiJob must be Workspace-scoped with projectId NULL'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."ai_job_output_id" IS NOT NULL THEN
    SELECT "job_id", "asset_id" INTO output_job, output_asset
    FROM "ai_outputs" WHERE "id" = NEW."ai_job_output_id";
    IF output_job IS NULL OR output_job <> NEW."ai_job_id" THEN
      RAISE EXCEPTION 'Story reference AiJobOutput must belong to its AiJob'
        USING ERRCODE = '23514';
    END IF;
    IF NEW."asset_id" IS NOT NULL AND output_asset IS DISTINCT FROM NEW."asset_id" THEN
      RAISE EXCEPTION 'Story reference MediaAsset must be the AiJobOutput asset'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_film_reference_versions_workspace_guard_trg"
BEFORE INSERT OR UPDATE ON "story_film_reference_versions"
FOR EACH ROW EXECUTE FUNCTION "story_reference_workspace_guard"();

CREATE FUNCTION "story_take_frame_reference_provenance_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  source_status "StoryFilmTakeStatus";
  source_project UUID;
  source_revision UUID;
  source_checksum VARCHAR(64);
BEGIN
  IF NEW."source" <> 'take_frame' THEN
    RETURN NEW;
  END IF;

  SELECT "status", "story_project_id", "revision_id", "output_checksum_sha256"
    INTO source_status, source_project, source_revision, source_checksum
  FROM "story_film_takes"
  WHERE "id" = NEW."source_take_id";

  IF source_status IS DISTINCT FROM 'ready'::"StoryFilmTakeStatus"
     OR source_project IS DISTINCT FROM NEW."story_project_id"
     OR source_revision IS DISTINCT FROM NEW."revision_id"
     OR source_checksum IS NULL
     OR source_checksum IS DISTINCT FROM NEW."source_output_checksum_sha256"
     OR NOT EXISTS (
       SELECT 1 FROM "story_film_take_approvals"
       WHERE "take_id" = NEW."source_take_id"
     ) THEN
    RAISE EXCEPTION 'take_frame ReferenceVersion requires an approved ready Take with matching scope and output checksum'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_film_reference_versions_take_frame_provenance_trg"
BEFORE INSERT OR UPDATE OF
  "source", "source_take_id", "source_frame_index",
  "source_output_checksum_sha256", "story_project_id", "revision_id"
ON "story_film_reference_versions"
FOR EACH ROW EXECUTE FUNCTION "story_take_frame_reference_provenance_guard"();

CREATE FUNCTION "story_take_workspace_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  expected_workspace UUID;
  asset_workspace UUID;
  job_workspace UUID;
  job_project UUID;
  output_job UUID;
  output_asset UUID;
  variant_asset UUID;
BEGIN
  SELECT "workspace_id" INTO expected_workspace
  FROM "story_projects" WHERE "id" = NEW."story_project_id";

  SELECT "workspace_id", "project_id" INTO job_workspace, job_project
  FROM "ai_jobs" WHERE "id" = NEW."ai_job_id";
  IF job_workspace IS NULL OR job_workspace <> expected_workspace OR job_project IS NOT NULL THEN
    RAISE EXCEPTION 'Story Take AiJob must be Workspace-scoped with projectId NULL'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."ai_job_output_id" IS NOT NULL THEN
    SELECT "job_id", "asset_id" INTO output_job, output_asset
    FROM "ai_outputs" WHERE "id" = NEW."ai_job_output_id";
    IF output_job IS NULL OR output_job <> NEW."ai_job_id" THEN
      RAISE EXCEPTION 'Story Take AiJobOutput must belong to its AiJob'
        USING ERRCODE = '23514';
    END IF;
    IF NEW."output_asset_id" IS NOT NULL AND output_asset IS DISTINCT FROM NEW."output_asset_id" THEN
      RAISE EXCEPTION 'Story Take output MediaAsset must be the AiJobOutput asset'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."output_asset_id" IS NOT NULL THEN
    SELECT "workspace_id" INTO asset_workspace
    FROM "media_assets" WHERE "id" = NEW."output_asset_id";
    IF asset_workspace IS NULL OR asset_workspace <> expected_workspace THEN
      RAISE EXCEPTION 'Story Take output MediaAsset must belong to the project Workspace'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."output_variant_id" IS NOT NULL THEN
    SELECT "asset_id" INTO variant_asset
    FROM "media_asset_variants" WHERE "id" = NEW."output_variant_id";
    IF variant_asset IS NULL OR variant_asset IS DISTINCT FROM NEW."output_asset_id" THEN
      RAISE EXCEPTION 'Story Take output Variant must belong to its MediaAsset'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_film_takes_workspace_guard_trg"
BEFORE INSERT OR UPDATE ON "story_film_takes"
FOR EACH ROW EXECUTE FUNCTION "story_take_workspace_guard"();

CREATE FUNCTION "story_manifest_asset_workspace_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  expected_workspace UUID;
  asset_workspace UUID;
  variant_asset UUID;
BEGIN
  SELECT "workspace_id" INTO expected_workspace
  FROM "story_projects" WHERE "id" = NEW."story_project_id";
  SELECT "workspace_id" INTO asset_workspace
  FROM "media_assets" WHERE "id" = NEW."asset_id";
  SELECT "asset_id" INTO variant_asset
  FROM "media_asset_variants" WHERE "id" = NEW."variant_id";
  IF asset_workspace IS NULL OR asset_workspace <> expected_workspace THEN
    RAISE EXCEPTION '% MediaAsset must belong to the project Workspace', TG_TABLE_NAME
      USING ERRCODE = '23514';
  END IF;
  IF variant_asset IS NULL OR variant_asset <> NEW."asset_id" THEN
    RAISE EXCEPTION '% Variant must belong to its MediaAsset', TG_TABLE_NAME
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_build_assets_workspace_guard_trg"
BEFORE INSERT OR UPDATE ON "story_build_assets"
FOR EACH ROW EXECUTE FUNCTION "story_manifest_asset_workspace_guard"();
CREATE TRIGGER "story_release_assets_workspace_guard_trg"
BEFORE INSERT OR UPDATE ON "story_release_assets"
FOR EACH ROW EXECUTE FUNCTION "story_manifest_asset_workspace_guard"();

-- ─── Film production input/version guards ─────────────────────────────────

CREATE FUNCTION "story_reference_version_lifecycle_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  review_only_update BOOLEAN;
BEGIN
  IF NEW."story_project_id" IS DISTINCT FROM OLD."story_project_id"
     OR NEW."revision_id" IS DISTINCT FROM OLD."revision_id"
     OR NEW."reference_slot_id" IS DISTINCT FROM OLD."reference_slot_id"
     OR NEW."version_number" IS DISTINCT FROM OLD."version_number"
     OR NEW."source" IS DISTINCT FROM OLD."source"
     OR NEW."ai_job_id" IS DISTINCT FROM OLD."ai_job_id"
     OR NEW."ai_job_output_id" IS DISTINCT FROM OLD."ai_job_output_id"
     OR NEW."source_take_id" IS DISTINCT FROM OLD."source_take_id"
     OR NEW."source_frame_index" IS DISTINCT FROM OLD."source_frame_index"
     OR NEW."source_output_checksum_sha256" IS DISTINCT FROM OLD."source_output_checksum_sha256"
     OR NEW."prompt_snapshot" IS DISTINCT FROM OLD."prompt_snapshot"
     OR NEW."generation_config" IS DISTINCT FROM OLD."generation_config"
     OR NEW."created_by_user_id" IS DISTINCT FROM OLD."created_by_user_id"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'StoryFilmReferenceVersion frozen input fields are immutable'
      USING ERRCODE = '23514';
  END IF;

  review_only_update :=
    NEW."review_revision" = OLD."review_revision" + 1 AND
    NEW."status" IS NOT DISTINCT FROM OLD."status" AND
    NEW."ai_job_output_id" IS NOT DISTINCT FROM OLD."ai_job_output_id" AND
    NEW."asset_id" IS NOT DISTINCT FROM OLD."asset_id" AND
    NEW."checksum_sha256" IS NOT DISTINCT FROM OLD."checksum_sha256" AND
    NEW."error" IS NOT DISTINCT FROM OLD."error" AND
    NEW."ready_at" IS NOT DISTINCT FROM OLD."ready_at";

  IF review_only_update THEN
    IF pg_trigger_depth() < 2 THEN
      RAISE EXCEPTION 'StoryFilmReferenceVersion reviewRevision is trigger-managed'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."review_revision" IS DISTINCT FROM OLD."review_revision" THEN
    RAISE EXCEPTION 'StoryFilmReferenceVersion reviewRevision is trigger-managed'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" IN ('ready', 'failed') THEN
    RAISE EXCEPTION 'Terminal StoryFilmReferenceVersion output is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NOT (
    NEW."status" = OLD."status" OR
    (OLD."status" = 'pending' AND NEW."status" IN ('processing', 'ready', 'failed')) OR
    (OLD."status" = 'processing' AND NEW."status" IN ('ready', 'failed'))
  ) THEN
    RAISE EXCEPTION 'Invalid StoryFilmReferenceVersion status transition % -> %',
      OLD."status", NEW."status" USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_film_reference_versions_lifecycle_guard_trg"
BEFORE UPDATE ON "story_film_reference_versions"
FOR EACH ROW EXECUTE FUNCTION "story_reference_version_lifecycle_guard"();

CREATE FUNCTION "story_take_lifecycle_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  review_only_update BOOLEAN;
BEGIN
  IF NEW."story_project_id" IS DISTINCT FROM OLD."story_project_id"
     OR NEW."revision_id" IS DISTINCT FROM OLD."revision_id"
     OR NEW."clip_id" IS DISTINCT FROM OLD."clip_id"
     OR NEW."take_number" IS DISTINCT FROM OLD."take_number"
     OR NEW."clip_spec_hash" IS DISTINCT FROM OLD."clip_spec_hash"
     OR NEW."production_input_hash" IS DISTINCT FROM OLD."production_input_hash"
     OR NEW."prompt_snapshot" IS DISTINCT FROM OLD."prompt_snapshot"
     OR NEW."generation_config" IS DISTINCT FROM OLD."generation_config"
     OR NEW."model_snapshot" IS DISTINCT FROM OLD."model_snapshot"
     OR NEW."ai_job_id" IS DISTINCT FROM OLD."ai_job_id"
     OR NEW."created_by_user_id" IS DISTINCT FROM OLD."created_by_user_id"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'StoryFilmTake frozen input fields are immutable'
      USING ERRCODE = '23514';
  END IF;

  review_only_update :=
    NEW."review_revision" = OLD."review_revision" + 1 AND
    NEW."version" IS NOT DISTINCT FROM OLD."version" AND
    NEW."status" IS NOT DISTINCT FROM OLD."status" AND
    NEW."ai_job_output_id" IS NOT DISTINCT FROM OLD."ai_job_output_id" AND
    NEW."output_asset_id" IS NOT DISTINCT FROM OLD."output_asset_id" AND
    NEW."output_variant_id" IS NOT DISTINCT FROM OLD."output_variant_id" AND
    NEW."output_checksum_sha256" IS NOT DISTINCT FROM OLD."output_checksum_sha256" AND
    NEW."technical_checks" IS NOT DISTINCT FROM OLD."technical_checks" AND
    NEW."error" IS NOT DISTINCT FROM OLD."error" AND
    NEW."queued_at" IS NOT DISTINCT FROM OLD."queued_at" AND
    NEW."started_at" IS NOT DISTINCT FROM OLD."started_at" AND
    NEW."ready_at" IS NOT DISTINCT FROM OLD."ready_at" AND
    NEW."cancelled_at" IS NOT DISTINCT FROM OLD."cancelled_at" AND
    NEW."superseded_at" IS NOT DISTINCT FROM OLD."superseded_at" AND
    NEW."completed_at" IS NOT DISTINCT FROM OLD."completed_at";

  IF review_only_update THEN
    IF pg_trigger_depth() < 2 THEN
      RAISE EXCEPTION 'StoryFilmTake reviewRevision is trigger-managed'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."review_revision" IS DISTINCT FROM OLD."review_revision" THEN
    RAISE EXCEPTION 'StoryFilmTake reviewRevision is trigger-managed'
      USING ERRCODE = '55000';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'StoryFilmTake update must increment version by exactly one'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."status" IN ('ready', 'failed', 'cancelled') THEN
    IF NEW."status" IS DISTINCT FROM OLD."status"
       OR NEW."ai_job_output_id" IS DISTINCT FROM OLD."ai_job_output_id"
       OR NEW."output_asset_id" IS DISTINCT FROM OLD."output_asset_id"
       OR NEW."output_variant_id" IS DISTINCT FROM OLD."output_variant_id"
       OR NEW."output_checksum_sha256" IS DISTINCT FROM OLD."output_checksum_sha256"
       OR NEW."technical_checks" IS DISTINCT FROM OLD."technical_checks"
       OR NEW."error" IS DISTINCT FROM OLD."error"
       OR NEW."queued_at" IS DISTINCT FROM OLD."queued_at"
       OR NEW."started_at" IS DISTINCT FROM OLD."started_at"
       OR NEW."ready_at" IS DISTINCT FROM OLD."ready_at"
       OR NEW."cancelled_at" IS DISTINCT FROM OLD."cancelled_at"
       OR NEW."completed_at" IS DISTINCT FROM OLD."completed_at" THEN
      RAISE EXCEPTION 'Terminal StoryFilmTake output is immutable'
        USING ERRCODE = '55000';
    END IF;
  ELSIF NOT (
    NEW."status" = OLD."status" OR
    (OLD."status" = 'queued' AND NEW."status" IN ('running', 'processing', 'ready', 'failed', 'cancelled')) OR
    (OLD."status" = 'running' AND NEW."status" IN ('processing', 'ready', 'failed', 'cancelled')) OR
    (OLD."status" = 'processing' AND NEW."status" IN ('ready', 'failed', 'cancelled'))
  ) THEN
    RAISE EXCEPTION 'Invalid StoryFilmTake status transition % -> %',
      OLD."status", NEW."status" USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_film_takes_lifecycle_guard_trg"
BEFORE UPDATE ON "story_film_takes"
FOR EACH ROW EXECUTE FUNCTION "story_take_lifecycle_guard"();

CREATE FUNCTION "story_film_clip_version_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  max_clip_ms INTEGER;
  content_changed BOOLEAN := false;
  master_changed BOOLEAN := false;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."id" IS DISTINCT FROM OLD."id"
       OR NEW."story_project_id" IS DISTINCT FROM OLD."story_project_id"
       OR NEW."revision_id" IS DISTINCT FROM OLD."revision_id"
       OR NEW."created_by_user_id" IS DISTINCT FROM OLD."created_by_user_id"
       OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
      RAISE EXCEPTION 'StoryFilmClip identity and creator fields are immutable'
        USING ERRCODE = '23514';
    END IF;

    content_changed :=
      NEW."key" IS DISTINCT FROM OLD."key" OR
      NEW."graph_node_id" IS DISTINCT FROM OLD."graph_node_id" OR
      NEW."title" IS DISTINCT FROM OLD."title" OR
      NEW."generation_mode" IS DISTINCT FROM OLD."generation_mode" OR
      NEW."frame_mode" IS DISTINCT FROM OLD."frame_mode" OR
      NEW."target_duration_ms" IS DISTINCT FROM OLD."target_duration_ms" OR
      NEW."spec_json" IS DISTINCT FROM OLD."spec_json" OR
      NEW."spec_hash" IS DISTINCT FROM OLD."spec_hash" OR
      NEW."production_input_manifest" IS DISTINCT FROM OLD."production_input_manifest" OR
      NEW."production_input_hash" IS DISTINCT FROM OLD."production_input_hash" OR
      NEW."rank" IS DISTINCT FROM OLD."rank" OR
      NEW."archived_at" IS DISTINCT FROM OLD."archived_at";
    master_changed :=
      NEW."master_take_id" IS DISTINCT FROM OLD."master_take_id" OR
      NEW."master_selected_by_user_id" IS DISTINCT FROM OLD."master_selected_by_user_id" OR
      NEW."master_selected_at" IS DISTINCT FROM OLD."master_selected_at";

    IF content_changed AND NEW."version" <> OLD."version" + 1 THEN
      RAISE EXCEPTION 'StoryFilmClip content update must increment version by exactly one'
        USING ERRCODE = '23514';
    ELSIF NOT content_changed AND NEW."version" IS DISTINCT FROM OLD."version" THEN
      RAISE EXCEPTION 'StoryFilmClip version may change only with content'
        USING ERRCODE = '23514';
    END IF;

    IF master_changed AND NEW."master_revision" <> OLD."master_revision" + 1 THEN
      RAISE EXCEPTION 'StoryFilmClip master update must increment masterRevision by exactly one'
        USING ERRCODE = '23514';
    ELSIF NOT master_changed AND NEW."master_revision" IS DISTINCT FROM OLD."master_revision" THEN
      RAISE EXCEPTION 'StoryFilmClip masterRevision may change only with Master audit fields'
        USING ERRCODE = '23514';
    END IF;

    IF content_changed AND NEW."master_take_id" IS NOT NULL THEN
      RAISE EXCEPTION 'Changing FilmClip production input must clear the Master Take'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  SELECT "max_generated_clip_duration_ms" INTO max_clip_ms
  FROM "story_film_specs" WHERE "revision_id" = NEW."revision_id";
  IF max_clip_ms IS NOT NULL AND NEW."target_duration_ms" > max_clip_ms THEN
    RAISE EXCEPTION 'FilmClip duration exceeds FilmSpec generation limit'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_film_clips_version_guard_trg"
BEFORE INSERT OR UPDATE ON "story_film_clips"
FOR EACH ROW EXECUTE FUNCTION "story_film_clip_version_guard"();

CREATE FUNCTION "story_film_reference_slot_version_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'StoryFilmReferenceSlot update must increment version by exactly one'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_film_reference_slots_version_guard_trg"
BEFORE UPDATE ON "story_film_reference_slots"
FOR EACH ROW EXECUTE FUNCTION "story_film_reference_slot_version_guard"();

CREATE FUNCTION "story_clip_reference_role_matches_slot_kind"(
  reference_role "StoryFilmClipReferenceRole",
  slot_kind "StoryFilmReferenceKind"
)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE reference_role
    WHEN 'omni' THEN slot_kind IN ('character', 'location', 'prop', 'graphic', 'style')
    WHEN 'first_frame' THEN slot_kind IN ('first_frame', 'last_frame', 'join_frame')
    WHEN 'last_frame' THEN slot_kind IN ('first_frame', 'last_frame', 'join_frame')
    WHEN 'continuity' THEN slot_kind IN ('character', 'location', 'prop', 'graphic')
    WHEN 'style' THEN slot_kind = 'style'
    ELSE false
  END;
$$;

CREATE FUNCTION "story_clip_reference_mode_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  clip_mode "StoryFilmGenerationMode";
  clip_frame_mode "StoryFilmFrameMode";
  slot_kind "StoryFilmReferenceKind";
BEGIN
  SELECT "generation_mode", "frame_mode" INTO clip_mode, clip_frame_mode
  FROM "story_film_clips" WHERE "id" = NEW."clip_id";
  SELECT "kind" INTO slot_kind
  FROM "story_film_reference_slots" WHERE "id" = NEW."reference_slot_id";
  IF slot_kind IS NULL OR NOT "story_clip_reference_role_matches_slot_kind"(
    NEW."role", slot_kind
  ) THEN
    RAISE EXCEPTION 'FilmClipReference role % is incompatible with ReferenceSlot kind %',
      NEW."role", slot_kind USING ERRCODE = '23514';
  END IF;
  IF NEW."role" IN ('first_frame', 'last_frame') AND NEW."position" <> 0 THEN
    RAISE EXCEPTION 'FilmClipReference frame roles must use position 0'
      USING ERRCODE = '23514';
  END IF;
  IF clip_mode = 'frame_lock' AND NEW."role" = 'omni' THEN
    RAISE EXCEPTION 'frame_lock FilmClip cannot bind omni references'
      USING ERRCODE = '23514';
  END IF;
  IF clip_mode = 'omni_reference' AND NEW."role" IN ('first_frame', 'last_frame') THEN
    RAISE EXCEPTION 'omni_reference FilmClip cannot bind first/last frames'
      USING ERRCODE = '23514';
  END IF;
  IF clip_frame_mode = 'first_frame' AND NEW."role" = 'last_frame' THEN
    RAISE EXCEPTION 'first_frame FilmClip cannot bind a last frame'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_film_clip_references_mode_guard_trg"
BEFORE INSERT OR UPDATE ON "story_film_clip_references"
FOR EACH ROW EXECUTE FUNCTION "story_clip_reference_mode_guard"();

CREATE FUNCTION "story_reference_slot_kind_bindings_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."kind" IS DISTINCT FROM OLD."kind" AND EXISTS (
    SELECT 1 FROM "story_film_clip_references" binding
    WHERE binding."reference_slot_id" = NEW."id"
      AND NOT "story_clip_reference_role_matches_slot_kind"(
        binding."role", NEW."kind"
      )
  ) THEN
    RAISE EXCEPTION 'ReferenceSlot kind update is incompatible with existing FilmClipReference roles'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_film_reference_slots_kind_bindings_guard_trg"
BEFORE UPDATE OF "kind" ON "story_film_reference_slots"
FOR EACH ROW EXECUTE FUNCTION "story_reference_slot_kind_bindings_guard"();

CREATE FUNCTION "story_clip_mode_existing_references_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."generation_mode" = 'frame_lock' AND EXISTS (
    SELECT 1 FROM "story_film_clip_references"
    WHERE "clip_id" = NEW."id" AND "role" = 'omni'
  ) THEN
    RAISE EXCEPTION 'frame_lock FilmClip has existing omni references'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."generation_mode" = 'omni_reference' AND EXISTS (
    SELECT 1 FROM "story_film_clip_references"
    WHERE "clip_id" = NEW."id" AND "role" IN ('first_frame', 'last_frame')
  ) THEN
    RAISE EXCEPTION 'omni_reference FilmClip has existing frame references'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."frame_mode" = 'first_frame' AND EXISTS (
    SELECT 1 FROM "story_film_clip_references"
    WHERE "clip_id" = NEW."id" AND "role" = 'last_frame'
  ) THEN
    RAISE EXCEPTION 'first_frame FilmClip has an existing last-frame reference'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_film_clips_existing_references_guard_trg"
BEFORE UPDATE OF "generation_mode", "frame_mode" ON "story_film_clips"
FOR EACH ROW EXECUTE FUNCTION "story_clip_mode_existing_references_guard"();

CREATE FUNCTION "story_dependency_join_frame_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  slot_kind "StoryFilmReferenceKind";
BEGIN
  IF NEW."transition" = 'shared_join_frame' THEN
    SELECT "kind" INTO slot_kind FROM "story_film_reference_slots"
    WHERE "id" = NEW."join_frame_slot_id";
    IF slot_kind IS DISTINCT FROM 'join_frame'::"StoryFilmReferenceKind" THEN
      RAISE EXCEPTION 'shared_join_frame dependency requires a join_frame ReferenceSlot'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_film_clip_dependencies_join_frame_guard_trg"
BEFORE INSERT OR UPDATE ON "story_film_clip_dependencies"
FOR EACH ROW EXECUTE FUNCTION "story_dependency_join_frame_guard"();

CREATE FUNCTION "story_dependency_version_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."story_project_id" IS DISTINCT FROM OLD."story_project_id"
     OR NEW."revision_id" IS DISTINCT FROM OLD."revision_id"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'StoryFilmClipDependency identity is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'StoryFilmClipDependency update must increment version by exactly one'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_film_clip_dependencies_version_guard_trg"
BEFORE UPDATE ON "story_film_clip_dependencies"
FOR EACH ROW EXECUTE FUNCTION "story_dependency_version_guard"();

CREATE FUNCTION "story_continuity_check_version_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."story_project_id" IS DISTINCT FROM OLD."story_project_id"
     OR NEW."revision_id" IS DISTINCT FROM OLD."revision_id"
     OR NEW."dependency_id" IS DISTINCT FROM OLD."dependency_id"
     OR NEW."upstream_take_id" IS DISTINCT FROM OLD."upstream_take_id"
     OR NEW."downstream_take_id" IS DISTINCT FROM OLD."downstream_take_id"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'StoryFilmContinuityCheck identity/input is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'StoryFilmContinuityCheck update must increment version by exactly one'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_film_continuity_checks_version_guard_trg"
BEFORE UPDATE ON "story_film_continuity_checks"
FOR EACH ROW EXECUTE FUNCTION "story_continuity_check_version_guard"();

-- ─── Review, approval and Master guards ───────────────────────────────────

CREATE FUNCTION "story_reference_review_revision_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  current_revision INTEGER;
  version_status "StoryFilmReferenceVersionStatus";
BEGIN
  SELECT "review_revision", "status" INTO current_revision, version_status
  FROM "story_film_reference_versions"
  WHERE "id" = NEW."reference_version_id" FOR UPDATE;
  IF version_status IS DISTINCT FROM 'ready'::"StoryFilmReferenceVersionStatus" THEN
    RAISE EXCEPTION 'Only a ready ReferenceVersion may be reviewed'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "story_film_reference_approvals"
    WHERE "reference_version_id" = NEW."reference_version_id"
  ) THEN
    RAISE EXCEPTION 'Approved ReferenceVersion cannot receive another Review'
      USING ERRCODE = '55000';
  END IF;
  IF NEW."sequence" <> current_revision + 1 THEN
    RAISE EXCEPTION 'Reference review sequence conflict'
      USING ERRCODE = '40001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_film_reference_reviews_revision_guard_trg"
BEFORE INSERT ON "story_film_reference_reviews"
FOR EACH ROW EXECUTE FUNCTION "story_reference_review_revision_guard"();

CREATE FUNCTION "story_reference_review_bump_revision"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "story_film_reference_versions"
  SET "review_revision" = "review_revision" + 1
  WHERE "id" = NEW."reference_version_id";
  RETURN NULL;
END;
$$;

CREATE TRIGGER "story_film_reference_reviews_bump_revision_trg"
AFTER INSERT ON "story_film_reference_reviews"
FOR EACH ROW EXECUTE FUNCTION "story_reference_review_bump_revision"();

CREATE FUNCTION "story_take_review_revision_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  current_revision INTEGER;
  take_status "StoryFilmTakeStatus";
BEGIN
  SELECT "review_revision", "status" INTO current_revision, take_status
  FROM "story_film_takes" WHERE "id" = NEW."take_id" FOR UPDATE;
  IF take_status IS DISTINCT FROM 'ready'::"StoryFilmTakeStatus" THEN
    RAISE EXCEPTION 'Only a ready Take may be reviewed'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "story_film_take_approvals" WHERE "take_id" = NEW."take_id"
  ) THEN
    RAISE EXCEPTION 'Approved Take cannot receive another Review'
      USING ERRCODE = '55000';
  END IF;
  IF NEW."sequence" <> current_revision + 1 THEN
    RAISE EXCEPTION 'Take review sequence conflict'
      USING ERRCODE = '40001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_film_take_reviews_revision_guard_trg"
BEFORE INSERT ON "story_film_take_reviews"
FOR EACH ROW EXECUTE FUNCTION "story_take_review_revision_guard"();

CREATE FUNCTION "story_take_review_bump_revision"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "story_film_takes"
  SET "review_revision" = "review_revision" + 1,
      "updated_at" = CURRENT_TIMESTAMP
  WHERE "id" = NEW."take_id";
  RETURN NULL;
END;
$$;

CREATE TRIGGER "story_film_take_reviews_bump_revision_trg"
AFTER INSERT ON "story_film_take_reviews"
FOR EACH ROW EXECUTE FUNCTION "story_take_review_bump_revision"();

CREATE FUNCTION "story_release_review_revision_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  current_revision INTEGER;
BEGIN
  SELECT "review_revision" INTO current_revision
  FROM "story_releases" WHERE "id" = NEW."release_id" FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM "story_release_approvals" WHERE "release_id" = NEW."release_id"
  ) THEN
    RAISE EXCEPTION 'Approved Release cannot receive another Review'
      USING ERRCODE = '55000';
  END IF;
  IF NEW."sequence" <> current_revision + 1 THEN
    RAISE EXCEPTION 'Release review sequence conflict'
      USING ERRCODE = '40001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_release_reviews_revision_guard_trg"
BEFORE INSERT ON "story_release_reviews"
FOR EACH ROW EXECUTE FUNCTION "story_release_review_revision_guard"();

CREATE FUNCTION "story_release_review_bump_revision"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "story_releases"
  SET "review_revision" = "review_revision" + 1
  WHERE "id" = NEW."release_id";
  RETURN NULL;
END;
$$;

CREATE TRIGGER "story_release_reviews_bump_revision_trg"
AFTER INSERT ON "story_release_reviews"
FOR EACH ROW EXECUTE FUNCTION "story_release_review_bump_revision"();

CREATE FUNCTION "story_reference_approval_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  review_row "story_film_reference_reviews"%ROWTYPE;
  version_status "StoryFilmReferenceVersionStatus";
  current_review_revision INTEGER;
  version_creator VARCHAR(64);
  review_policy "StoryFilmReviewPolicy";
BEGIN
  SELECT * INTO review_row FROM "story_film_reference_reviews"
  WHERE "id" = NEW."review_id";
  IF review_row."reference_version_id" IS DISTINCT FROM NEW."reference_version_id"
     OR review_row."decision" <> 'approve'
     OR NOT review_row."technical_passed"
     OR NOT review_row."safety_passed"
     OR review_row."reviewer_user_id" IS DISTINCT FROM NEW."approved_by_user_id" THEN
    RAISE EXCEPTION 'Reference Approval must point to its passing approve Review'
      USING ERRCODE = '23514';
  END IF;
  SELECT v."status", v."review_revision", v."created_by_user_id", s."review_policy"
    INTO version_status, current_review_revision, version_creator, review_policy
  FROM "story_film_reference_versions" v
  JOIN "story_film_specs" s ON s."revision_id" = v."revision_id"
  WHERE v."id" = NEW."reference_version_id";
  IF version_status IS DISTINCT FROM 'ready'::"StoryFilmReferenceVersionStatus" THEN
    RAISE EXCEPTION 'Only a ready ReferenceVersion may be approved'
      USING ERRCODE = '23514';
  END IF;
  IF review_row."sequence" IS DISTINCT FROM current_review_revision THEN
    RAISE EXCEPTION 'Reference Approval must use the latest Review'
      USING ERRCODE = '23514';
  END IF;
  IF review_policy = 'four_eyes' AND version_creator = NEW."approved_by_user_id" THEN
    RAISE EXCEPTION 'four_eyes policy forbids ReferenceVersion self-approval'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_film_reference_approvals_guard_trg"
BEFORE INSERT ON "story_film_reference_approvals"
FOR EACH ROW EXECUTE FUNCTION "story_reference_approval_guard"();

CREATE FUNCTION "story_reference_slot_approved_pointer_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  approved_slot UUID;
BEGIN
  IF NEW."approved_version_id" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT v."reference_slot_id" INTO approved_slot
  FROM "story_film_reference_versions" v
  JOIN "story_film_reference_approvals" a
    ON a."reference_version_id" = v."id"
  WHERE v."id" = NEW."approved_version_id" AND v."status" = 'ready';
  IF approved_slot IS NULL OR approved_slot <> NEW."id" THEN
    RAISE EXCEPTION 'approvedVersionId must be an approved ready version of this Slot'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_film_reference_slots_approved_pointer_guard_trg"
BEFORE INSERT OR UPDATE OF "approved_version_id" ON "story_film_reference_slots"
FOR EACH ROW EXECUTE FUNCTION "story_reference_slot_approved_pointer_guard"();

CREATE FUNCTION "story_take_approval_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  review_row "story_film_take_reviews"%ROWTYPE;
  take_status "StoryFilmTakeStatus";
  current_review_revision INTEGER;
  take_creator VARCHAR(64);
  review_policy "StoryFilmReviewPolicy";
BEGIN
  SELECT * INTO review_row FROM "story_film_take_reviews"
  WHERE "id" = NEW."review_id";
  IF review_row."take_id" IS DISTINCT FROM NEW."take_id"
     OR review_row."decision" <> 'approve'
     OR NOT review_row."technical_passed"
     OR NOT review_row."safety_passed"
     OR review_row."reviewer_user_id" IS DISTINCT FROM NEW."approved_by_user_id" THEN
    RAISE EXCEPTION 'Take Approval must point to its passing approve Review'
      USING ERRCODE = '23514';
  END IF;
  SELECT t."status", t."review_revision", t."created_by_user_id", s."review_policy"
    INTO take_status, current_review_revision, take_creator, review_policy
  FROM "story_film_takes" t
  JOIN "story_film_specs" s ON s."revision_id" = t."revision_id"
  WHERE t."id" = NEW."take_id";
  IF take_status IS DISTINCT FROM 'ready'::"StoryFilmTakeStatus" THEN
    RAISE EXCEPTION 'Only a ready Take may be approved'
      USING ERRCODE = '23514';
  END IF;
  IF review_row."sequence" IS DISTINCT FROM current_review_revision THEN
    RAISE EXCEPTION 'Take Approval must use the latest Review'
      USING ERRCODE = '23514';
  END IF;
  IF review_policy = 'four_eyes' AND take_creator = NEW."approved_by_user_id" THEN
    RAISE EXCEPTION 'four_eyes policy forbids Take self-approval'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_film_take_approvals_guard_trg"
BEFORE INSERT ON "story_film_take_approvals"
FOR EACH ROW EXECUTE FUNCTION "story_take_approval_guard"();

CREATE FUNCTION "story_clip_master_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  take_row "story_film_takes"%ROWTYPE;
BEGIN
  IF NEW."master_take_id" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO take_row FROM "story_film_takes"
  WHERE "id" = NEW."master_take_id";
  IF take_row."clip_id" IS DISTINCT FROM NEW."id"
     OR take_row."story_project_id" IS DISTINCT FROM NEW."story_project_id"
     OR take_row."revision_id" IS DISTINCT FROM NEW."revision_id"
     OR take_row."status" <> 'ready'
     OR take_row."superseded_at" IS NOT NULL
     OR NEW."production_input_manifest" IS NULL
     OR NEW."production_input_hash" IS NULL
     OR take_row."clip_spec_hash" IS DISTINCT FROM NEW."spec_hash"
     OR take_row."production_input_hash" IS DISTINCT FROM NEW."production_input_hash"
     OR NOT EXISTS (
       SELECT 1 FROM "story_film_take_approvals"
       WHERE "take_id" = take_row."id"
     ) THEN
    RAISE EXCEPTION 'Master Take must be approved, ready, current and belong to the Clip'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "story_film_clip_references" cr
    JOIN "story_film_reference_slots" s ON s."id" = cr."reference_slot_id"
    LEFT JOIN "story_film_take_references" tr
      ON tr."take_id" = take_row."id"
     AND tr."reference_slot_id" = cr."reference_slot_id"
     AND tr."role" = cr."role"
     AND tr."position" = cr."position"
     AND tr."reference_version_id" = s."approved_version_id"
    WHERE cr."clip_id" = NEW."id" AND cr."required"
      AND (s."approved_version_id" IS NULL OR tr."take_id" IS NULL)
  ) THEN
    RAISE EXCEPTION 'Master Take does not pin every currently approved required reference'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_film_clips_master_guard_trg"
BEFORE INSERT OR UPDATE OF "master_take_id" ON "story_film_clips"
FOR EACH ROW EXECUTE FUNCTION "story_clip_master_guard"();

CREATE FUNCTION "story_release_approval_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  review_row "story_release_reviews"%ROWTYPE;
  release_creator VARCHAR(64);
  release_project UUID;
  release_channel "StoryReleaseChannel";
  current_review_revision INTEGER;
  review_policy "StoryFilmReviewPolicy";
BEGIN
  SELECT * INTO review_row FROM "story_release_reviews"
  WHERE "id" = NEW."review_id";
  SELECT "created_by_user_id", "story_project_id", "channel", "review_revision"
    INTO release_creator, release_project, release_channel, current_review_revision
  FROM "story_releases" WHERE "id" = NEW."release_id";
  SELECT s."review_policy" INTO review_policy
  FROM "story_releases" r
  JOIN "story_film_specs" s ON s."revision_id" = r."source_revision_id"
  WHERE r."id" = NEW."release_id";

  IF review_row."release_id" IS DISTINCT FROM NEW."release_id"
     OR review_row."decision" <> 'approve'
     OR review_row."sequence" IS DISTINCT FROM current_review_revision
     OR review_row."reviewer_user_id" IS DISTINCT FROM NEW."approved_by_user_id" THEN
    RAISE EXCEPTION 'Release Approval must point to its approve Review'
      USING ERRCODE = '23514';
  END IF;
  IF release_channel = 'production' AND review_policy = 'four_eyes'
     AND release_creator = NEW."approved_by_user_id" THEN
    RAISE EXCEPTION 'Production four-eyes policy forbids self-approval'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "story_project_members"
    WHERE "story_project_id" = release_project
      AND "user_id" = NEW."approved_by_user_id"
      AND "status" = 'active'
      AND "role" IN ('owner', 'producer', 'reviewer')
  ) THEN
    RAISE EXCEPTION 'Release approver lacks StoryProject review authority'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_release_approvals_guard_trg"
BEFORE INSERT ON "story_release_approvals"
FOR EACH ROW EXECUTE FUNCTION "story_release_approval_guard"();

-- Production revision is the single staleness token for the Revision-scoped
-- film production plane. Mutations to inputs or Master pointers bump it.
CREATE FUNCTION "story_film_bump_production_revision"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  target_revision UUID;
BEGIN
  target_revision := COALESCE(NEW."revision_id", OLD."revision_id");
  UPDATE "story_film_specs"
  SET "production_revision" = "production_revision" + 1,
      "updated_at" = CURRENT_TIMESTAMP
  WHERE "revision_id" = target_revision;
  RETURN NULL;
END;
$$;

CREATE TRIGGER "story_film_reference_slots_bump_production_trg"
AFTER INSERT OR UPDATE OR DELETE ON "story_film_reference_slots"
FOR EACH ROW EXECUTE FUNCTION "story_film_bump_production_revision"();
CREATE TRIGGER "story_film_clips_bump_production_trg"
AFTER INSERT OR UPDATE OR DELETE ON "story_film_clips"
FOR EACH ROW EXECUTE FUNCTION "story_film_bump_production_revision"();
CREATE TRIGGER "story_film_clip_references_bump_production_trg"
AFTER INSERT OR UPDATE OR DELETE ON "story_film_clip_references"
FOR EACH ROW EXECUTE FUNCTION "story_film_bump_production_revision"();
CREATE TRIGGER "story_film_clip_dependencies_bump_production_trg"
AFTER INSERT OR UPDATE OR DELETE ON "story_film_clip_dependencies"
FOR EACH ROW EXECUTE FUNCTION "story_film_bump_production_revision"();

CREATE FUNCTION "story_take_reference_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  version_row "story_film_reference_versions"%ROWTYPE;
  approved_version UUID;
  asset_workspace UUID;
  project_workspace UUID;
  take_status "StoryFilmTakeStatus";
BEGIN
  SELECT * INTO version_row FROM "story_film_reference_versions"
  WHERE "id" = NEW."reference_version_id";
  SELECT "approved_version_id" INTO approved_version
  FROM "story_film_reference_slots" WHERE "id" = NEW."reference_slot_id";
  SELECT "workspace_id" INTO project_workspace
  FROM "story_projects" WHERE "id" = NEW."story_project_id";
  SELECT "workspace_id" INTO asset_workspace
  FROM "media_assets" WHERE "id" = NEW."asset_id";
  SELECT "status" INTO take_status
  FROM "story_film_takes" WHERE "id" = NEW."take_id";

  IF take_status IS DISTINCT FROM 'queued'::"StoryFilmTakeStatus"
     OR version_row."reference_slot_id" IS DISTINCT FROM NEW."reference_slot_id"
     OR version_row."story_project_id" IS DISTINCT FROM NEW."story_project_id"
     OR version_row."revision_id" IS DISTINCT FROM NEW."revision_id"
     OR version_row."status" <> 'ready'
     OR version_row."asset_id" IS DISTINCT FROM NEW."asset_id"
     OR version_row."checksum_sha256" IS DISTINCT FROM NEW."checksum_sha256"
     OR approved_version IS DISTINCT FROM NEW."reference_version_id"
     OR asset_workspace IS NULL OR asset_workspace <> project_workspace THEN
    RAISE EXCEPTION 'TakeReference must freeze the current approved ReferenceVersion asset'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_film_take_references_guard_trg"
BEFORE INSERT ON "story_film_take_references"
FOR EACH ROW EXECUTE FUNCTION "story_take_reference_guard"();
CREATE TRIGGER "story_film_take_references_immutable_trg"
BEFORE UPDATE OR DELETE ON "story_film_take_references"
FOR EACH ROW EXECUTE FUNCTION "story_prevent_mutation"();

CREATE FUNCTION "story_continuity_inputs_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  predecessor UUID;
  successor UUID;
  upstream_clip UUID;
  downstream_clip UUID;
BEGIN
  SELECT "predecessor_clip_id", "successor_clip_id" INTO predecessor, successor
  FROM "story_film_clip_dependencies" WHERE "id" = NEW."dependency_id";
  SELECT "clip_id" INTO upstream_clip FROM "story_film_takes"
  WHERE "id" = NEW."upstream_take_id";
  SELECT "clip_id" INTO downstream_clip FROM "story_film_takes"
  WHERE "id" = NEW."downstream_take_id";
  IF predecessor IS NULL OR upstream_clip <> predecessor OR downstream_clip <> successor THEN
    RAISE EXCEPTION 'ContinuityCheck Takes must match dependency predecessor/successor'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_film_continuity_checks_inputs_guard_trg"
BEFORE INSERT OR UPDATE OF "dependency_id", "upstream_take_id", "downstream_take_id"
ON "story_film_continuity_checks"
FOR EACH ROW EXECUTE FUNCTION "story_continuity_inputs_guard"();

-- ─── Build, Release and Deployment gates ──────────────────────────────────

CREATE FUNCTION "story_build_lifecycle_guard"()
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
     OR NEW."kind" IS DISTINCT FROM OLD."kind"
     OR NEW."scope" IS DISTINCT FROM OLD."scope"
     OR NEW."source_production_revision" IS DISTINCT FROM OLD."source_production_revision"
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

CREATE FUNCTION "story_build_asset_mutability_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  parent_status "StoryBuildStatus";
  parent_build UUID;
BEGIN
  parent_build := COALESCE(NEW."build_id", OLD."build_id");
  SELECT "status" INTO parent_status FROM "story_builds" WHERE "id" = parent_build;
  IF parent_status IN ('ready', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'Assets of a terminal StoryBuild are immutable'
      USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_build_assets_mutability_guard_trg"
BEFORE INSERT OR UPDATE OR DELETE ON "story_build_assets"
FOR EACH ROW EXECUTE FUNCTION "story_build_asset_mutability_guard"();

CREATE TRIGGER "story_film_build_clips_insert_mutability_guard_trg"
BEFORE INSERT ON "story_film_build_clips"
FOR EACH ROW EXECUTE FUNCTION "story_build_asset_mutability_guard"();

CREATE FUNCTION "story_build_ready_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  project_format "StoryFormat";
  current_production_revision INTEGER;
  expected_clips INTEGER;
  actual_clips INTEGER;
BEGIN
  IF NEW."status" <> 'ready' OR OLD."status" = 'ready' THEN
    RETURN NEW;
  END IF;

  SELECT "format" INTO project_format FROM "story_projects"
  WHERE "id" = NEW."story_project_id";

  IF project_format = 'interactive_film' THEN
    SELECT "production_revision", "target_clip_count"
      INTO current_production_revision, expected_clips
    FROM "story_film_specs" WHERE "revision_id" = NEW."source_revision_id";
    IF current_production_revision IS NULL
       OR current_production_revision <> NEW."source_production_revision" THEN
      RAISE EXCEPTION 'Film Build source production revision is stale'
        USING ERRCODE = '23514';
    END IF;

    SELECT count(*) INTO actual_clips FROM "story_film_build_clips"
    WHERE "build_id" = NEW."id";
    IF (NEW."kind" = 'production' AND actual_clips <> expected_clips)
       OR (NEW."kind" = 'preview' AND actual_clips < 1) THEN
      RAISE EXCEPTION 'Film Build clip manifest is incomplete'
        USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM "story_film_build_clips" bc
      JOIN "story_film_clips" c ON c."id" = bc."clip_id"
      JOIN "story_film_takes" t ON t."id" = bc."take_id"
      JOIN "story_build_assets" a ON a."id" = bc."build_asset_id"
      LEFT JOIN "story_film_take_approvals" ta ON ta."take_id" = t."id"
      WHERE bc."build_id" = NEW."id"
        AND (
          bc."story_project_id" <> NEW."story_project_id" OR
          bc."revision_id" <> NEW."source_revision_id" OR
          c."master_take_id" IS DISTINCT FROM t."id" OR
          t."status" <> 'ready' OR t."superseded_at" IS NOT NULL OR ta."take_id" IS NULL OR
          t."clip_spec_hash" <> c."spec_hash" OR bc."clip_spec_hash" <> t."clip_spec_hash" OR
          bc."production_input_hash" <> t."production_input_hash" OR
          bc."checksum_sha256" <> t."output_checksum_sha256" OR
          bc."duration_ms" <> c."target_duration_ms" OR
          a."asset_id" IS DISTINCT FROM t."output_asset_id" OR
          a."variant_id" IS DISTINCT FROM t."output_variant_id" OR
          a."checksum_sha256" <> t."output_checksum_sha256"
        )
    ) THEN
      RAISE EXCEPTION 'Film Build contains a non-approved, stale or mismatched Master Take'
        USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM "story_film_build_clips" bc
      JOIN "story_film_clip_references" cr ON cr."clip_id" = bc."clip_id" AND cr."required"
      JOIN "story_film_reference_slots" s ON s."id" = cr."reference_slot_id"
      LEFT JOIN "story_film_take_references" tr
        ON tr."take_id" = bc."take_id"
       AND tr."reference_slot_id" = cr."reference_slot_id"
       AND tr."role" = cr."role" AND tr."position" = cr."position"
       AND tr."reference_version_id" = s."approved_version_id"
      WHERE bc."build_id" = NEW."id"
        AND (s."approved_version_id" IS NULL OR tr."take_id" IS NULL)
    ) THEN
      RAISE EXCEPTION 'Film Build Take references are stale or incomplete'
        USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM "story_film_clip_dependencies" d
      JOIN "story_film_build_clips" up
        ON up."build_id" = NEW."id" AND up."clip_id" = d."predecessor_clip_id"
      JOIN "story_film_build_clips" down
        ON down."build_id" = NEW."id" AND down."clip_id" = d."successor_clip_id"
      LEFT JOIN "story_film_continuity_checks" cc
        ON cc."dependency_id" = d."id"
       AND cc."upstream_take_id" = up."take_id"
       AND cc."downstream_take_id" = down."take_id"
       AND cc."decision" IN ('pass', 'waived')
      WHERE d."revision_id" = NEW."source_revision_id"
        AND d."kind" IN ('continuity', 'convergence')
        AND cc."id" IS NULL
    ) THEN
      RAISE EXCEPTION 'Film Build is missing a passing continuity check'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_builds_ready_guard_trg"
BEFORE UPDATE OF "status" ON "story_builds"
FOR EACH ROW EXECUTE FUNCTION "story_build_ready_guard"();

CREATE FUNCTION "story_release_insert_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  build_row "story_builds"%ROWTYPE;
  project_format "StoryFormat";
BEGIN
  SELECT * INTO build_row FROM "story_builds" WHERE "id" = NEW."build_id";
  SELECT "format" INTO project_format FROM "story_projects"
  WHERE "id" = NEW."story_project_id";
  IF build_row."status" <> 'ready'
     OR build_row."story_project_id" IS DISTINCT FROM NEW."story_project_id"
     OR build_row."source_revision_id" IS DISTINCT FROM NEW."source_revision_id"
     OR build_row."kind"::text IS DISTINCT FROM NEW."channel"::text
     OR build_row."runtime_schema_version" IS DISTINCT FROM NEW."runtime_schema_version"
     OR build_row."runtime_json" IS DISTINCT FROM NEW."runtime_json"
     OR build_row."runtime_hash" IS DISTINCT FROM NEW."runtime_hash"
     OR build_row."input_manifest_hash" IS DISTINCT FROM NEW."manifest_hash"
     OR project_format IS DISTINCT FROM NEW."format" THEN
    RAISE EXCEPTION 'StoryRelease must be an exact immutable envelope of a ready Build'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_releases_insert_guard_trg"
BEFORE INSERT ON "story_releases"
FOR EACH ROW EXECUTE FUNCTION "story_release_insert_guard"();

CREATE FUNCTION "story_release_manifest_complete_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  target_release UUID;
  target_build UUID;
BEGIN
  target_release := CASE WHEN TG_TABLE_NAME = 'story_releases'
    THEN COALESCE(NEW."id", OLD."id")
    ELSE COALESCE(NEW."release_id", OLD."release_id") END;
  SELECT "build_id" INTO target_build FROM "story_releases"
  WHERE "id" = target_release;
  IF target_build IS NULL THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT "logical_key", "role", "asset_id", "variant_id", "checksum_sha256",
           "content_type", "size_bytes", "width", "height", "duration_ms", "rank"
    FROM "story_build_assets" WHERE "build_id" = target_build
    EXCEPT
    SELECT "logical_key", "role", "asset_id", "variant_id", "checksum_sha256",
           "content_type", "size_bytes", "width", "height", "duration_ms", "rank"
    FROM "story_release_assets" WHERE "release_id" = target_release
  ) OR EXISTS (
    SELECT "logical_key", "role", "asset_id", "variant_id", "checksum_sha256",
           "content_type", "size_bytes", "width", "height", "duration_ms", "rank"
    FROM "story_release_assets" WHERE "release_id" = target_release
    EXCEPT
    SELECT "logical_key", "role", "asset_id", "variant_id", "checksum_sha256",
           "content_type", "size_bytes", "width", "height", "duration_ms", "rank"
    FROM "story_build_assets" WHERE "build_id" = target_build
  ) THEN
    RAISE EXCEPTION 'StoryRelease asset manifest must exactly equal its Build manifest'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "story_releases_manifest_complete_trg"
AFTER INSERT ON "story_releases"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "story_release_manifest_complete_guard"();
CREATE CONSTRAINT TRIGGER "story_release_assets_manifest_complete_trg"
AFTER INSERT ON "story_release_assets"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "story_release_manifest_complete_guard"();

CREATE FUNCTION "story_deployment_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  release_project UUID;
  build_kind "StoryBuildKind";
  release_channel "StoryReleaseChannel";
  project_status "StoryProjectStatus";
BEGIN
  SELECT r."story_project_id", b."kind", r."channel"
    INTO release_project, build_kind, release_channel
  FROM "story_releases" r JOIN "story_builds" b ON b."id" = r."build_id"
  WHERE r."id" = NEW."release_id";
  SELECT "status" INTO project_status FROM "story_projects"
  WHERE "id" = NEW."story_project_id";
  IF release_project IS NULL OR release_project <> NEW."story_project_id" THEN
    RAISE EXCEPTION 'Deployment Release must belong to the StoryProject'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."status" = 'active' AND project_status <> 'active' THEN
    RAISE EXCEPTION 'Archived StoryProject cannot have an active Deployment'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."status" = 'active'
     AND release_channel::text IS DISTINCT FROM NEW."environment"::text THEN
    RAISE EXCEPTION 'Deployment environment must match the Release channel'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."status" = 'active' AND NEW."environment" = 'production' AND (
    build_kind <> 'production' OR NOT EXISTS (
      SELECT 1 FROM "story_release_approvals" WHERE "release_id" = NEW."release_id"
    )
  ) THEN
    RAISE EXCEPTION 'Production Deployment requires an approved production Build Release'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'StoryDeployment update must increment version by exactly one'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_deployments_guard_trg"
BEFORE INSERT OR UPDATE ON "story_deployments"
FOR EACH ROW EXECUTE FUNCTION "story_deployment_guard"();

CREATE FUNCTION "story_deployment_bump_publish_revision"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "story_projects"
  SET "publish_revision" = "publish_revision" + 1,
      "updated_at" = CURRENT_TIMESTAMP
  WHERE "id" = NEW."story_project_id";
  RETURN NULL;
END;
$$;

CREATE TRIGGER "story_deployments_bump_publish_revision_trg"
AFTER INSERT OR UPDATE ON "story_deployments"
FOR EACH ROW EXECUTE FUNCTION "story_deployment_bump_publish_revision"();

CREATE FUNCTION "story_project_archive_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" = 'archived' AND OLD."status" <> 'archived' THEN
    IF EXISTS (
      SELECT 1 FROM "story_deployments"
      WHERE "story_project_id" = NEW."id" AND "status" = 'active'
    ) OR EXISTS (
      SELECT 1 FROM "story_builds"
      WHERE "story_project_id" = NEW."id"
        AND "status" IN ('queued', 'validating', 'compiling')
    ) OR EXISTS (
      SELECT 1 FROM "story_film_takes"
      WHERE "story_project_id" = NEW."id"
        AND "status" IN ('queued', 'running', 'processing')
    ) THEN
      RAISE EXCEPTION 'Offline deployments and finish active production before archiving StoryProject'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_projects_archive_guard_trg"
BEFORE UPDATE OF "status" ON "story_projects"
FOR EACH ROW EXECUTE FUNCTION "story_project_archive_guard"();
