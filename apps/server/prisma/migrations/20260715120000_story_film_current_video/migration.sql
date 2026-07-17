-- Story-film production is a single-current-video model.
-- Generation attempts remain immutable operational history, while review,
-- approval, and "master take" state is removed from the product domain.
BEGIN;

-- A running generation cannot be renamed safely while a worker may still be
-- writing it. Deploy only after workers have drained.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "story_film_takes"
    WHERE "status" IN ('queued', 'running', 'processing')
  ) OR EXISTS (
    SELECT 1 FROM "story_film_trailer_takes"
    WHERE "status" IN ('queued', 'running', 'processing')
  ) THEN
    RAISE EXCEPTION 'Drain story-film generation workers before applying current-video migration'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

-- Remove triggers whose implementations refer to take review/master columns.
DROP TRIGGER IF EXISTS "story_film_clips_master_guard_trg" ON "story_film_clips";
DROP TRIGGER IF EXISTS "story_film_clips_master_output_moderation_guard_trg" ON "story_film_clips";
DROP TRIGGER IF EXISTS "story_film_clips_version_guard_trg" ON "story_film_clips";
DROP TRIGGER IF EXISTS "story_film_clips_bump_production_trg" ON "story_film_clips";
DROP TRIGGER IF EXISTS "story_film_trailers_master_guard_trg" ON "story_film_trailers";
DROP TRIGGER IF EXISTS "story_film_trailers_master_output_moderation_guard_trg" ON "story_film_trailers";
DROP TRIGGER IF EXISTS "story_film_trailers_version_guard_trg" ON "story_film_trailers";
DROP TRIGGER IF EXISTS "story_film_takes_lifecycle_guard_trg" ON "story_film_takes";
DROP TRIGGER IF EXISTS "story_film_takes_output_moderation_guard_trg" ON "story_film_takes";
DROP TRIGGER IF EXISTS "story_film_takes_workspace_guard_trg" ON "story_film_takes";
DROP TRIGGER IF EXISTS "story_film_takes_submission_key_immutable_trg" ON "story_film_takes";
DROP TRIGGER IF EXISTS "story_film_trailer_takes_lifecycle_guard_trg" ON "story_film_trailer_takes";
DROP TRIGGER IF EXISTS "story_film_trailer_takes_output_moderation_guard_trg" ON "story_film_trailer_takes";
DROP TRIGGER IF EXISTS "story_film_trailer_takes_workspace_guard_trg" ON "story_film_trailer_takes";
DROP TRIGGER IF EXISTS "story_film_take_references_guard_trg" ON "story_film_take_references";
DROP TRIGGER IF EXISTS "story_film_take_references_asset_moderation_guard_trg" ON "story_film_take_references";
DROP TRIGGER IF EXISTS "story_film_trailer_take_references_guard_trg" ON "story_film_trailer_take_references";
DROP TRIGGER IF EXISTS "story_film_trailer_take_references_asset_moderation_guard_trg" ON "story_film_trailer_take_references";
DROP TRIGGER IF EXISTS "story_film_reference_versions_take_frame_provenance_trg" ON "story_film_reference_versions";
DROP TRIGGER IF EXISTS "story_film_reference_slots_approval_invalidate_production_trg" ON "story_film_reference_slots";
DROP TRIGGER IF EXISTS "media_assets_story_production_invalidation_trg" ON "media_assets";
DROP TRIGGER IF EXISTS "story_film_continuity_checks_inputs_guard_trg" ON "story_film_continuity_checks";
DROP TRIGGER IF EXISTS "story_film_continuity_checks_version_guard_trg" ON "story_film_continuity_checks";
DROP TRIGGER IF EXISTS "story_builds_ready_guard_trg" ON "story_builds";
DROP TRIGGER IF EXISTS "story_film_specs_version_guard_trg" ON "story_film_specs";

DROP FUNCTION IF EXISTS "story_clip_master_guard"();
DROP FUNCTION IF EXISTS "story_film_trailer_master_guard"();
DROP FUNCTION IF EXISTS "story_master_output_moderation_guard"();
DROP FUNCTION IF EXISTS "story_film_clip_version_guard"();
DROP FUNCTION IF EXISTS "story_film_trailer_version_guard"();
DROP FUNCTION IF EXISTS "story_take_lifecycle_guard"();
DROP FUNCTION IF EXISTS "story_film_trailer_take_lifecycle_guard"();
DROP FUNCTION IF EXISTS "story_take_output_moderation_guard"();
DROP FUNCTION IF EXISTS "story_take_workspace_guard"();
DROP FUNCTION IF EXISTS "story_take_submission_key_immutable"();
DROP FUNCTION IF EXISTS "story_take_reference_asset_moderation_guard"();
DROP FUNCTION IF EXISTS "story_take_reference_guard"();
DROP FUNCTION IF EXISTS "story_film_trailer_take_reference_guard"();
DROP FUNCTION IF EXISTS "story_take_frame_reference_provenance_guard"();
DROP FUNCTION IF EXISTS "story_reference_approval_invalidate_production"();
DROP FUNCTION IF EXISTS "story_media_block_invalidate_production"();
DROP FUNCTION IF EXISTS "story_continuity_inputs_guard"();
DROP FUNCTION IF EXISTS "story_continuity_check_version_guard"();
DROP FUNCTION IF EXISTS "story_build_ready_guard"();
DROP FUNCTION IF EXISTS "story_film_spec_version_guard"();

-- Film/trailer editorial review is intentionally deleted. Reference-version
-- approval and release approval are separate workflows and remain intact.
DROP TABLE "story_film_take_approvals";
DROP TABLE "story_film_take_reviews";
DROP TABLE "story_film_trailer_take_approvals";
DROP TABLE "story_film_trailer_take_reviews";

DROP FUNCTION IF EXISTS "story_take_approval_guard"();
DROP FUNCTION IF EXISTS "story_take_review_revision_guard"();
DROP FUNCTION IF EXISTS "story_take_review_bump_revision"();
DROP FUNCTION IF EXISTS "story_film_trailer_take_approval_guard"();
DROP FUNCTION IF EXISTS "story_film_trailer_take_review_revision_guard"();
DROP FUNCTION IF EXISTS "story_film_trailer_take_review_bump_revision"();
DROP FUNCTION IF EXISTS "story_take_approval_output_moderation_guard"();
DROP FUNCTION IF EXISTS "story_trailer_editorial_approval_guard"();

ALTER TABLE "story_film_specs" DROP COLUMN "review_policy";
-- reviewPolicy was duplicated inside spec_json. Remove it and recompute the
-- canonical SHA-256 so the JSON snapshot and its integrity hash stay aligned.
CREATE FUNCTION "story_migration_canonical_json"(value JSONB)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
  result TEXT;
BEGIN
  CASE jsonb_typeof(value)
    WHEN 'object' THEN
      SELECT '{' || COALESCE(string_agg(to_json(key)::text || ':' || "story_migration_canonical_json"(val), ',' ORDER BY key), '') || '}'
      INTO result FROM jsonb_each(value) AS entry(key, val);
    WHEN 'array' THEN
      SELECT '[' || COALESCE(string_agg("story_migration_canonical_json"(val), ',' ORDER BY ordinality), '') || ']'
      INTO result FROM jsonb_array_elements(value) WITH ORDINALITY AS entry(val, ordinality);
    ELSE
      result := value::text;
  END CASE;
  RETURN result;
END;
$$;
UPDATE "story_film_specs"
SET "spec_json" = "spec_json" - 'reviewPolicy',
    "spec_hash" = encode(
      digest("story_migration_canonical_json"("spec_json" - 'reviewPolicy'), 'sha256'),
      'hex'
    )
WHERE "spec_json" ? 'reviewPolicy';
DROP FUNCTION "story_migration_canonical_json"(JSONB);
DROP TYPE "StoryFilmReviewPolicy";

ALTER TYPE "StoryFilmTakeStatus" RENAME TO "StoryFilmGenerationAttemptStatus";
ALTER TYPE "StoryFilmReferenceSource" RENAME VALUE 'take_frame' TO 'generation_frame';

-- Keep every generated output as asset history; rename only the operational
-- provenance records and their reference snapshots.
ALTER TABLE "story_film_takes" RENAME TO "story_film_generation_attempts";
ALTER TABLE "story_film_generation_attempts" RENAME COLUMN "take_number" TO "attempt_number";
ALTER TABLE "story_film_generation_attempts" DROP CONSTRAINT "story_film_takes_counters_chk";
ALTER TABLE "story_film_generation_attempts" DROP COLUMN "review_revision";
ALTER TABLE "story_film_generation_attempts"
  ADD CONSTRAINT "story_film_generation_attempts_counters_chk" CHECK ("version" >= 0);

ALTER TABLE "story_film_trailer_takes" RENAME TO "story_film_trailer_generation_attempts";
ALTER TABLE "story_film_trailer_generation_attempts" RENAME COLUMN "take_number" TO "attempt_number";
ALTER TABLE "story_film_trailer_generation_attempts" DROP CONSTRAINT "story_film_trailer_takes_counters_chk";
ALTER TABLE "story_film_trailer_generation_attempts" DROP COLUMN "review_revision";
ALTER TABLE "story_film_trailer_generation_attempts"
  ADD CONSTRAINT "story_film_trailer_generation_attempts_counters_chk" CHECK ("version" >= 0);

ALTER TABLE "story_film_take_references" RENAME TO "story_film_generation_attempt_references";
ALTER TABLE "story_film_generation_attempt_references" RENAME COLUMN "take_id" TO "attempt_id";
ALTER TABLE "story_film_trailer_take_references" RENAME TO "story_film_trailer_generation_attempt_references";
ALTER TABLE "story_film_trailer_generation_attempt_references" RENAME COLUMN "take_id" TO "attempt_id";

ALTER TABLE "story_film_reference_versions"
  DROP CONSTRAINT "story_film_reference_versions_source_chk";
ALTER TABLE "story_film_reference_versions"
  RENAME COLUMN "source_take_id" TO "source_generation_attempt_id";
ALTER TABLE "story_film_reference_versions"
  ADD CONSTRAINT "story_film_reference_versions_source_chk" CHECK (
    ("source" = 'ai_job' AND "ai_job_id" IS NOT NULL AND "ai_job_output_id" IS NOT NULL
      AND "source_generation_attempt_id" IS NULL AND "source_frame_index" IS NULL
      AND "source_output_checksum_sha256" IS NULL)
    OR
    ("source" = 'generation_frame' AND "ai_job_id" IS NULL AND "ai_job_output_id" IS NULL
      AND "source_generation_attempt_id" IS NOT NULL AND "source_frame_index" >= 0
      AND "source_output_checksum_sha256" ~ '^[0-9a-f]{64}$')
    OR
    ("source" IN ('upload', 'import') AND "ai_job_id" IS NULL AND "ai_job_output_id" IS NULL
      AND "source_generation_attempt_id" IS NULL AND "source_frame_index" IS NULL
      AND "source_output_checksum_sha256" IS NULL)
  );

ALTER TABLE "story_film_build_clips"
  DROP CONSTRAINT "story_film_build_clips_take_clip_fkey";
ALTER TABLE "story_film_build_clips"
  RENAME COLUMN "take_id" TO "source_generation_attempt_id";
ALTER TABLE "story_film_build_clips"
  ALTER COLUMN "source_generation_attempt_id" DROP NOT NULL,
  ALTER COLUMN "production_input_hash" DROP NOT NULL;

-- A node points directly at one current asset/variant. The optional source
-- attempt provides provenance; imported/library assets need no fake attempt.
ALTER TABLE "story_film_clips"
  DROP CONSTRAINT "story_film_clips_master_audit_chk",
  DROP CONSTRAINT "story_film_clips_counters_chk";
ALTER TABLE "story_film_clips" RENAME COLUMN "master_take_id" TO "current_video_source_attempt_id";
ALTER TABLE "story_film_clips" RENAME COLUMN "master_revision" TO "current_video_revision";
ALTER TABLE "story_film_clips" RENAME COLUMN "master_selected_by_user_id" TO "current_video_set_by_user_id";
ALTER TABLE "story_film_clips" RENAME COLUMN "master_selected_at" TO "current_video_set_at";
ALTER TABLE "story_film_clips"
  ADD COLUMN "current_video_asset_id" UUID,
  ADD COLUMN "current_video_variant_id" UUID,
  ADD COLUMN "current_video_spec_hash" VARCHAR(64),
  ADD COLUMN "current_video_input_hash" VARCHAR(64),
  ADD COLUMN "current_video_checksum_sha256" VARCHAR(64),
  ADD COLUMN "current_video_technical_checks" JSONB,
  ADD COLUMN "latest_generation_attempt_id" UUID;

ALTER TABLE "story_film_trailers"
  DROP CONSTRAINT "story_film_trailers_master_audit_chk",
  DROP CONSTRAINT "story_film_trailers_counters_chk";
ALTER TABLE "story_film_trailers" RENAME COLUMN "master_take_id" TO "current_video_source_attempt_id";
ALTER TABLE "story_film_trailers" RENAME COLUMN "master_revision" TO "current_video_revision";
ALTER TABLE "story_film_trailers" RENAME COLUMN "master_selected_by_user_id" TO "current_video_set_by_user_id";
ALTER TABLE "story_film_trailers" RENAME COLUMN "master_selected_at" TO "current_video_set_at";
ALTER TABLE "story_film_trailers"
  ADD COLUMN "current_video_asset_id" UUID,
  ADD COLUMN "current_video_variant_id" UUID,
  ADD COLUMN "current_video_spec_hash" VARCHAR(64),
  ADD COLUMN "current_video_input_hash" VARCHAR(64),
  ADD COLUMN "current_video_checksum_sha256" VARCHAR(64),
  ADD COLUMN "current_video_technical_checks" JSONB,
  ADD COLUMN "latest_generation_attempt_id" UUID;

UPDATE "story_film_clips" AS clip
SET "current_video_asset_id" = attempt."output_asset_id",
    "current_video_variant_id" = attempt."output_variant_id",
    "current_video_spec_hash" = attempt."clip_spec_hash",
    "current_video_input_hash" = attempt."production_input_hash",
    "current_video_checksum_sha256" = attempt."output_checksum_sha256",
    "current_video_technical_checks" = attempt."technical_checks"
FROM "story_film_generation_attempts" AS attempt
WHERE attempt."id" = clip."current_video_source_attempt_id";

UPDATE "story_film_trailers" AS trailer
SET "current_video_asset_id" = attempt."output_asset_id",
    "current_video_variant_id" = attempt."output_variant_id",
    "current_video_spec_hash" = attempt."trailer_spec_hash",
    "current_video_input_hash" = attempt."production_input_hash",
    "current_video_checksum_sha256" = attempt."output_checksum_sha256",
    "current_video_technical_checks" = attempt."technical_checks"
FROM "story_film_trailer_generation_attempts" AS attempt
WHERE attempt."id" = trailer."current_video_source_attempt_id";

UPDATE "story_film_clips" AS clip
SET "latest_generation_attempt_id" = latest."id"
FROM (
  SELECT DISTINCT ON ("clip_id") "clip_id", "id"
  FROM "story_film_generation_attempts"
  ORDER BY "clip_id", "attempt_number" DESC
) AS latest
WHERE latest."clip_id" = clip."id";

UPDATE "story_film_trailers" AS trailer
SET "latest_generation_attempt_id" = latest."id"
FROM (
  SELECT DISTINCT ON ("trailer_id") "trailer_id", "id"
  FROM "story_film_trailer_generation_attempts"
  ORDER BY "trailer_id", "attempt_number" DESC
) AS latest
WHERE latest."trailer_id" = trailer."id";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "story_film_clips"
    WHERE "current_video_source_attempt_id" IS NOT NULL
      AND ("current_video_asset_id" IS NULL OR "current_video_variant_id" IS NULL
        OR "current_video_checksum_sha256" IS NULL OR "current_video_spec_hash" IS NULL)
  ) OR EXISTS (
    SELECT 1 FROM "story_film_trailers"
    WHERE "current_video_source_attempt_id" IS NOT NULL
      AND ("current_video_asset_id" IS NULL OR "current_video_variant_id" IS NULL
        OR "current_video_checksum_sha256" IS NULL OR "current_video_spec_hash" IS NULL)
  ) THEN
    RAISE EXCEPTION 'Legacy master pointer does not resolve to a complete ready output'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

ALTER TABLE "story_film_clips"
  ADD CONSTRAINT "story_film_clips_counters_chk" CHECK ("version" >= 0 AND "current_video_revision" >= 0 AND "rank" >= 0),
  ADD CONSTRAINT "story_film_clips_current_video_shape_chk" CHECK (
    ("current_video_asset_id" IS NULL AND "current_video_variant_id" IS NULL
      AND "current_video_source_attempt_id" IS NULL AND "current_video_spec_hash" IS NULL
      AND "current_video_input_hash" IS NULL AND "current_video_checksum_sha256" IS NULL
      AND "current_video_technical_checks" IS NULL
      AND "current_video_set_by_user_id" IS NULL AND "current_video_set_at" IS NULL)
    OR
    ("current_video_asset_id" IS NOT NULL AND "current_video_variant_id" IS NOT NULL
      AND "current_video_spec_hash" ~ '^[0-9a-f]{64}$'
      AND ("current_video_input_hash" IS NULL OR "current_video_input_hash" ~ '^[0-9a-f]{64}$')
      AND "current_video_checksum_sha256" ~ '^[0-9a-f]{64}$'
      AND ("current_video_technical_checks" IS NULL OR jsonb_typeof("current_video_technical_checks") = 'array')
      AND "current_video_revision" > 0 AND "current_video_set_at" IS NOT NULL)
  );

ALTER TABLE "story_film_trailers"
  ADD CONSTRAINT "story_film_trailers_counters_chk" CHECK ("version" >= 0 AND "current_video_revision" >= 0),
  ADD CONSTRAINT "story_film_trailers_current_video_shape_chk" CHECK (
    ("current_video_asset_id" IS NULL AND "current_video_variant_id" IS NULL
      AND "current_video_source_attempt_id" IS NULL AND "current_video_spec_hash" IS NULL
      AND "current_video_input_hash" IS NULL AND "current_video_checksum_sha256" IS NULL
      AND "current_video_technical_checks" IS NULL
      AND "current_video_set_by_user_id" IS NULL AND "current_video_set_at" IS NULL)
    OR
    ("current_video_asset_id" IS NOT NULL AND "current_video_variant_id" IS NOT NULL
      AND "current_video_spec_hash" ~ '^[0-9a-f]{64}$'
      AND ("current_video_input_hash" IS NULL OR "current_video_input_hash" ~ '^[0-9a-f]{64}$')
      AND "current_video_checksum_sha256" ~ '^[0-9a-f]{64}$'
      AND ("current_video_technical_checks" IS NULL OR jsonb_typeof("current_video_technical_checks") = 'array')
      AND "current_video_revision" > 0 AND "current_video_set_at" IS NOT NULL)
  );

-- Continuity belongs to concrete asset versions, not to a generation attempt.
ALTER TABLE "story_film_continuity_checks"
  ADD COLUMN "upstream_asset_id" UUID,
  ADD COLUMN "upstream_variant_id" UUID,
  ADD COLUMN "upstream_checksum_sha256" VARCHAR(64),
  ADD COLUMN "downstream_asset_id" UUID,
  ADD COLUMN "downstream_variant_id" UUID,
  ADD COLUMN "downstream_checksum_sha256" VARCHAR(64);

UPDATE "story_film_continuity_checks" AS check_row
SET "upstream_asset_id" = upstream."output_asset_id",
    "upstream_variant_id" = upstream."output_variant_id",
    "upstream_checksum_sha256" = upstream."output_checksum_sha256",
    "downstream_asset_id" = downstream."output_asset_id",
    "downstream_variant_id" = downstream."output_variant_id",
    "downstream_checksum_sha256" = downstream."output_checksum_sha256"
FROM "story_film_generation_attempts" AS upstream,
     "story_film_generation_attempts" AS downstream
WHERE upstream."id" = check_row."upstream_take_id"
  AND downstream."id" = check_row."downstream_take_id";

ALTER TABLE "story_film_continuity_checks"
  DROP CONSTRAINT "story_film_continuity_checks_inputs_unique",
  DROP CONSTRAINT "story_film_continuity_checks_upstream_scope_fkey",
  DROP CONSTRAINT "story_film_continuity_checks_upstream_take_id_fkey",
  DROP CONSTRAINT "story_film_continuity_checks_downstream_scope_fkey",
  DROP CONSTRAINT "story_film_continuity_checks_downstream_take_id_fkey",
  DROP COLUMN "upstream_take_id",
  DROP COLUMN "downstream_take_id",
  ALTER COLUMN "upstream_asset_id" SET NOT NULL,
  ALTER COLUMN "upstream_variant_id" SET NOT NULL,
  ALTER COLUMN "upstream_checksum_sha256" SET NOT NULL,
  ALTER COLUMN "downstream_asset_id" SET NOT NULL,
  ALTER COLUMN "downstream_variant_id" SET NOT NULL,
  ALTER COLUMN "downstream_checksum_sha256" SET NOT NULL,
  ADD CONSTRAINT "story_film_continuity_checks_inputs_unique" UNIQUE ("dependency_id", "upstream_variant_id", "downstream_variant_id"),
  ADD CONSTRAINT "story_film_continuity_checks_checksums_chk" CHECK (
    "upstream_checksum_sha256" ~ '^[0-9a-f]{64}$' AND "downstream_checksum_sha256" ~ '^[0-9a-f]{64}$'
  );

-- Direct pointer foreign keys. Assets are restricted from deletion, so old
-- assets remain available in the workspace library after replacement.
ALTER TABLE "story_film_clips"
  ADD CONSTRAINT "story_film_clips_current_video_asset_id_fkey" FOREIGN KEY ("current_video_asset_id") REFERENCES "media_assets"("id") ON DELETE NO ACTION,
  ADD CONSTRAINT "story_film_clips_current_video_variant_id_fkey" FOREIGN KEY ("current_video_variant_id") REFERENCES "media_asset_variants"("id") ON DELETE NO ACTION,
  ADD CONSTRAINT "story_film_clips_latest_generation_attempt_id_fkey" FOREIGN KEY ("latest_generation_attempt_id") REFERENCES "story_film_generation_attempts"("id") ON DELETE NO ACTION,
  ADD CONSTRAINT "story_film_clips_latest_generation_attempt_id_key" UNIQUE ("latest_generation_attempt_id");
ALTER TABLE "story_film_trailers"
  ADD CONSTRAINT "story_film_trailers_current_video_asset_id_fkey" FOREIGN KEY ("current_video_asset_id") REFERENCES "media_assets"("id") ON DELETE NO ACTION,
  ADD CONSTRAINT "story_film_trailers_current_video_variant_id_fkey" FOREIGN KEY ("current_video_variant_id") REFERENCES "media_asset_variants"("id") ON DELETE NO ACTION,
  ADD CONSTRAINT "story_film_trailers_latest_generation_attempt_id_fkey" FOREIGN KEY ("latest_generation_attempt_id") REFERENCES "story_film_trailer_generation_attempts"("id") ON DELETE NO ACTION,
  ADD CONSTRAINT "story_film_trailers_latest_generation_attempt_id_key" UNIQUE ("latest_generation_attempt_id");
ALTER TABLE "story_film_continuity_checks"
  ADD CONSTRAINT "story_film_continuity_checks_upstream_asset_id_fkey" FOREIGN KEY ("upstream_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_continuity_checks_upstream_variant_id_fkey" FOREIGN KEY ("upstream_variant_id") REFERENCES "media_asset_variants"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_continuity_checks_downstream_asset_id_fkey" FOREIGN KEY ("downstream_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_continuity_checks_downstream_variant_id_fkey" FOREIGN KEY ("downstream_variant_id") REFERENCES "media_asset_variants"("id") ON DELETE RESTRICT;

-- Rename the retained provenance constraints/indexes so database diagnostics
-- use the same target vocabulary as the application.
ALTER TABLE "story_film_clips" RENAME CONSTRAINT "story_film_clips_master_take_id_fkey" TO "story_film_clips_current_video_source_attempt_id_fkey";
ALTER TABLE "story_film_clips" RENAME CONSTRAINT "story_film_clips_master_take_scope_fkey" TO "story_film_clips_current_video_source_attempt_scope_fkey";
ALTER TABLE "story_film_clips" RENAME CONSTRAINT "story_film_clips_master_take_id_key" TO "story_film_clips_current_video_source_attempt_id_key";
ALTER TABLE "story_film_trailers" RENAME CONSTRAINT "story_film_trailers_master_take_id_fkey" TO "story_film_trailers_current_video_source_attempt_id_fkey";
ALTER TABLE "story_film_trailers" RENAME CONSTRAINT "story_film_trailers_master_take_scope_fkey" TO "story_film_trailers_current_video_source_attempt_scope_fkey";
ALTER TABLE "story_film_trailers" RENAME CONSTRAINT "story_film_trailers_master_take_id_key" TO "story_film_trailers_current_video_source_attempt_id_key";
ALTER TABLE "story_film_build_clips" RENAME CONSTRAINT "story_film_build_clips_take_id_fkey" TO "story_film_build_clips_source_generation_attempt_id_fkey";
ALTER TABLE "story_film_reference_versions" RENAME CONSTRAINT "story_film_reference_versions_source_take_id_fkey" TO "story_film_reference_versions_source_generation_attempt_id_fkey";
ALTER TABLE "story_film_reference_versions" RENAME CONSTRAINT "story_film_reference_versions_source_take_scope_fkey" TO "story_film_reference_versions_source_generation_attempt_scope_fkey";
ALTER INDEX "story_film_reference_versions_source_take_frame_idx" RENAME TO "story_film_reference_versions_source_generation_frame_idx";

ALTER TABLE "story_film_generation_attempts" RENAME CONSTRAINT "story_film_takes_pkey" TO "story_film_generation_attempts_pkey";
ALTER TABLE "story_film_generation_attempts" RENAME CONSTRAINT "story_film_takes_clip_number_unique" TO "story_film_generation_attempts_clip_number_unique";
ALTER TABLE "story_film_generation_attempts" RENAME CONSTRAINT "story_film_takes_id_clip_unique" TO "story_film_generation_attempts_id_clip_unique";
ALTER TABLE "story_film_generation_attempts" RENAME CONSTRAINT "story_film_takes_scope_unique" TO "story_film_generation_attempts_scope_unique";
ALTER INDEX "story_film_takes_scope_status_idx" RENAME TO "story_film_generation_attempts_scope_status_idx";
ALTER INDEX "story_film_takes_ai_job_idx" RENAME TO "story_film_generation_attempts_ai_job_idx";
ALTER INDEX "story_film_takes_ai_job_unique" RENAME TO "story_film_generation_attempts_ai_job_id_key";
ALTER INDEX "story_film_takes_submission_key_unique" RENAME TO "story_film_generation_attempts_submission_key_key";

ALTER TABLE "story_film_trailer_generation_attempts" RENAME CONSTRAINT "story_film_trailer_takes_pkey" TO "story_film_trailer_generation_attempts_pkey";
ALTER TABLE "story_film_trailer_generation_attempts" RENAME CONSTRAINT "story_film_trailer_takes_trailer_number_unique" TO "story_film_trailer_generation_attempts_trailer_number_unique";
ALTER TABLE "story_film_trailer_generation_attempts" RENAME CONSTRAINT "story_film_trailer_takes_id_trailer_unique" TO "story_film_trailer_generation_attempts_id_trailer_unique";
ALTER TABLE "story_film_trailer_generation_attempts" RENAME CONSTRAINT "story_film_trailer_takes_scope_unique" TO "story_film_trailer_generation_attempts_scope_unique";
ALTER INDEX "story_film_trailer_takes_scope_status_idx" RENAME TO "story_film_trailer_generation_attempts_scope_status_idx";

-- References keep immutable snapshots of the exact input assets used.
ALTER TABLE "story_film_generation_attempt_references" RENAME CONSTRAINT "story_film_take_references_pkey" TO "story_film_generation_attempt_references_pkey";
ALTER INDEX "story_film_take_references_scope_version_idx" RENAME TO "story_film_generation_attempt_references_scope_version_idx";
ALTER TABLE "story_film_trailer_generation_attempt_references" RENAME CONSTRAINT "story_film_trailer_take_references_pkey" TO "story_film_trailer_generation_attempt_references_pkey";
ALTER INDEX "story_film_trailer_take_references_scope_version_idx" RENAME TO "story_film_trailer_generation_attempt_references_scope_version_idx";

DO $$
DECLARE
  item RECORD;
  target_name TEXT;
BEGIN
  FOR item IN
    SELECT conrelid::regclass AS table_name, conname
    FROM pg_constraint
    -- PG17+ tracks NOT NULL constraints in pg_constraint; their auto-generated
    -- names are internal and renaming them here overflows the 63-char
    -- identifier limit into collisions (observed in prod 2026-07-17). Skip them.
    WHERE contype <> 'n'
      AND (conname LIKE 'story_film_takes_%'
       OR conname LIKE 'story_film_trailer_takes_%'
       OR conname LIKE 'story_film_take_references_%'
       OR conname LIKE 'story_film_trailer_take_references_%')
  LOOP
    target_name := replace(
      replace(
        replace(
          replace(item.conname,
            'story_film_trailer_take_references', 'story_film_trailer_generation_attempt_references'),
          'story_film_take_references', 'story_film_generation_attempt_references'),
        'story_film_trailer_takes', 'story_film_trailer_generation_attempts'),
      'story_film_takes', 'story_film_generation_attempts');
    EXECUTE format('ALTER TABLE %s RENAME CONSTRAINT %I TO %I', item.table_name, item.conname, target_name);
  END LOOP;
END;
$$;

-- Column renames do not rename the relation-column segment in existing
-- constraint names. Remove the last remnants of the retired Take vocabulary.
DO $$
DECLARE
  item RECORD;
  target_name TEXT;
BEGIN
  FOR item IN
    SELECT conrelid::regclass AS table_name, conname
    FROM pg_constraint
    WHERE conrelid IN (
      'story_film_generation_attempt_references'::regclass,
      'story_film_trailer_generation_attempt_references'::regclass
    )
      AND contype <> 'n'
      AND conname ILIKE '%take%'
  LOOP
    target_name := replace(
      replace(item.conname, '_take_id_', '_attempt_id_'),
      '_take_scope_', '_attempt_scope_'
    );
    EXECUTE format('ALTER TABLE %s RENAME CONSTRAINT %I TO %I', item.table_name, item.conname, target_name);
  END LOOP;
END;
$$;

ALTER TRIGGER "story_film_takes_scope_guard_trg" ON "story_film_generation_attempts"
  RENAME TO "story_film_generation_attempts_scope_guard_trg";
ALTER TRIGGER "story_film_trailer_takes_scope_guard_trg" ON "story_film_trailer_generation_attempts"
  RENAME TO "story_film_trailer_generation_attempts_scope_guard_trg";
ALTER TRIGGER "story_film_take_references_scope_guard_trg" ON "story_film_generation_attempt_references"
  RENAME TO "story_film_generation_attempt_references_scope_guard_trg";
ALTER TRIGGER "story_film_take_references_immutable_trg" ON "story_film_generation_attempt_references"
  RENAME TO "story_film_generation_attempt_references_immutable_trg";
ALTER TRIGGER "story_film_trailer_take_references_scope_guard_trg" ON "story_film_trailer_generation_attempt_references"
  RENAME TO "story_film_trailer_generation_attempt_references_scope_guard_trg";
ALTER TRIGGER "story_film_trailer_take_references_immutable_trg" ON "story_film_trailer_generation_attempt_references"
  RENAME TO "story_film_trailer_generation_attempt_references_immutable_trg";

-- Rebuild lifecycle guards without any review-revision escape hatch.
CREATE FUNCTION "story_generation_attempt_lifecycle_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."story_project_id" IS DISTINCT FROM OLD."story_project_id"
     OR NEW."revision_id" IS DISTINCT FROM OLD."revision_id"
     OR NEW."clip_id" IS DISTINCT FROM OLD."clip_id"
     OR NEW."attempt_number" IS DISTINCT FROM OLD."attempt_number"
     OR NEW."submission_key" IS DISTINCT FROM OLD."submission_key"
     OR NEW."clip_spec_hash" IS DISTINCT FROM OLD."clip_spec_hash"
     OR NEW."production_input_hash" IS DISTINCT FROM OLD."production_input_hash"
     OR NEW."prompt_snapshot" IS DISTINCT FROM OLD."prompt_snapshot"
     OR NEW."generation_config" IS DISTINCT FROM OLD."generation_config"
     OR NEW."model_snapshot" IS DISTINCT FROM OLD."model_snapshot"
     OR NEW."ai_job_id" IS DISTINCT FROM OLD."ai_job_id"
     OR NEW."created_by_user_id" IS DISTINCT FROM OLD."created_by_user_id"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'StoryFilmGenerationAttempt frozen inputs are immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'StoryFilmGenerationAttempt update must increment version by exactly one' USING ERRCODE = '23514';
  END IF;
  IF OLD."status" IN ('ready', 'failed', 'cancelled') THEN
    IF NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'Terminal StoryFilmGenerationAttempt is immutable' USING ERRCODE = '55000';
    END IF;
  ELSIF NOT (
    NEW."status" = OLD."status"
    OR (OLD."status" = 'queued' AND NEW."status" IN ('running', 'processing', 'ready', 'failed', 'cancelled'))
    OR (OLD."status" = 'running' AND NEW."status" IN ('processing', 'ready', 'failed', 'cancelled'))
    OR (OLD."status" = 'processing' AND NEW."status" IN ('ready', 'failed', 'cancelled'))
  ) THEN
    RAISE EXCEPTION 'Invalid generation-attempt status transition % -> %', OLD."status", NEW."status" USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "story_trailer_generation_attempt_lifecycle_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."story_project_id" IS DISTINCT FROM OLD."story_project_id"
     OR NEW."revision_id" IS DISTINCT FROM OLD."revision_id"
     OR NEW."trailer_id" IS DISTINCT FROM OLD."trailer_id"
     OR NEW."attempt_number" IS DISTINCT FROM OLD."attempt_number"
     OR NEW."submission_key" IS DISTINCT FROM OLD."submission_key"
     OR NEW."trailer_spec_hash" IS DISTINCT FROM OLD."trailer_spec_hash"
     OR NEW."production_input_hash" IS DISTINCT FROM OLD."production_input_hash"
     OR NEW."prompt_snapshot" IS DISTINCT FROM OLD."prompt_snapshot"
     OR NEW."generation_config" IS DISTINCT FROM OLD."generation_config"
     OR NEW."model_snapshot" IS DISTINCT FROM OLD."model_snapshot"
     OR NEW."ai_job_id" IS DISTINCT FROM OLD."ai_job_id"
     OR NEW."created_by_user_id" IS DISTINCT FROM OLD."created_by_user_id"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'StoryFilmTrailerGenerationAttempt frozen inputs are immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'StoryFilmTrailerGenerationAttempt update must increment version by exactly one' USING ERRCODE = '23514';
  END IF;
  IF OLD."status" IN ('ready', 'failed', 'cancelled') THEN
    IF NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'Terminal StoryFilmTrailerGenerationAttempt is immutable' USING ERRCODE = '55000';
    END IF;
  ELSIF NOT (
    NEW."status" = OLD."status"
    OR (OLD."status" = 'queued' AND NEW."status" IN ('running', 'processing', 'ready', 'failed', 'cancelled'))
    OR (OLD."status" = 'running' AND NEW."status" IN ('processing', 'ready', 'failed', 'cancelled'))
    OR (OLD."status" = 'processing' AND NEW."status" IN ('ready', 'failed', 'cancelled'))
  ) THEN
    RAISE EXCEPTION 'Invalid trailer generation-attempt status transition % -> %', OLD."status", NEW."status" USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_film_generation_attempts_lifecycle_guard_trg"
BEFORE UPDATE ON "story_film_generation_attempts"
FOR EACH ROW EXECUTE FUNCTION "story_generation_attempt_lifecycle_guard"();
CREATE TRIGGER "story_film_trailer_generation_attempts_lifecycle_guard_trg"
BEFORE UPDATE ON "story_film_trailer_generation_attempts"
FOR EACH ROW EXECUTE FUNCTION "story_trailer_generation_attempt_lifecycle_guard"();

CREATE FUNCTION "story_generation_attempt_integrity_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  expected_workspace UUID;
  job_workspace UUID;
  job_project UUID;
  output_job UUID;
  output_asset_from_job UUID;
  asset_workspace UUID;
  asset_kind TEXT;
  asset_status TEXT;
  asset_moderation TEXT;
  asset_deleted_at TIMESTAMPTZ;
  variant_asset UUID;
  variant_status TEXT;
  variant_checksum TEXT;
  variant_deleted_at TIMESTAMPTZ;
BEGIN
  SELECT "workspace_id" INTO expected_workspace
  FROM "story_projects" WHERE "id" = NEW."story_project_id";
  SELECT "workspace_id", "project_id" INTO job_workspace, job_project
  FROM "ai_jobs" WHERE "id" = NEW."ai_job_id";
  IF expected_workspace IS NULL OR job_workspace IS DISTINCT FROM expected_workspace OR job_project IS NOT NULL THEN
    RAISE EXCEPTION 'Generation attempt AiJob must be scoped to the project workspace' USING ERRCODE = '23514';
  END IF;

  IF NEW."ai_job_output_id" IS NOT NULL THEN
    SELECT "job_id", "asset_id" INTO output_job, output_asset_from_job
    FROM "ai_outputs" WHERE "id" = NEW."ai_job_output_id";
    IF output_job IS DISTINCT FROM NEW."ai_job_id"
       OR (NEW."output_asset_id" IS NOT NULL AND output_asset_from_job IS DISTINCT FROM NEW."output_asset_id") THEN
      RAISE EXCEPTION 'Generation attempt output must belong to its AiJob and MediaAsset' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."output_asset_id" IS NOT NULL THEN
    SELECT "workspace_id", "kind"::text, "status"::text, "moderation_status"::text, "deleted_at"
    INTO asset_workspace, asset_kind, asset_status, asset_moderation, asset_deleted_at
    FROM "media_assets" WHERE "id" = NEW."output_asset_id";
    IF asset_workspace IS DISTINCT FROM expected_workspace OR asset_kind <> 'video' THEN
      RAISE EXCEPTION 'Generation attempt output must be a video in the project workspace' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."output_variant_id" IS NOT NULL THEN
    SELECT "asset_id", "status"::text, "checksum_sha256", "deleted_at"
    INTO variant_asset, variant_status, variant_checksum, variant_deleted_at
    FROM "media_asset_variants" WHERE "id" = NEW."output_variant_id";
    IF variant_asset IS DISTINCT FROM NEW."output_asset_id" THEN
      RAISE EXCEPTION 'Generation attempt output variant must belong to its MediaAsset' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."status" = 'ready' THEN
    IF asset_status <> 'ready' OR asset_moderation = 'blocked' OR asset_deleted_at IS NOT NULL
       OR variant_status <> 'ready' OR variant_deleted_at IS NOT NULL
       OR variant_checksum IS DISTINCT FROM NEW."output_checksum_sha256" THEN
      RAISE EXCEPTION 'Ready generation attempt requires an active, non-blocked output variant with matching checksum' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_film_generation_attempts_integrity_guard_trg"
BEFORE INSERT OR UPDATE ON "story_film_generation_attempts"
FOR EACH ROW EXECUTE FUNCTION "story_generation_attempt_integrity_guard"();
CREATE TRIGGER "story_film_trailer_generation_attempts_integrity_guard_trg"
BEFORE INSERT OR UPDATE ON "story_film_trailer_generation_attempts"
FOR EACH ROW EXECUTE FUNCTION "story_generation_attempt_integrity_guard"();

CREATE FUNCTION "story_generation_attempt_reference_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  version_row "story_film_reference_versions"%ROWTYPE;
  approved_version UUID;
  project_workspace UUID;
  asset_workspace UUID;
  asset_moderation TEXT;
  asset_status TEXT;
  asset_deleted_at TIMESTAMPTZ;
  attempt_status TEXT;
BEGIN
  SELECT * INTO version_row FROM "story_film_reference_versions" WHERE "id" = NEW."reference_version_id";
  SELECT "approved_version_id" INTO approved_version FROM "story_film_reference_slots" WHERE "id" = NEW."reference_slot_id";
  SELECT "workspace_id" INTO project_workspace FROM "story_projects" WHERE "id" = NEW."story_project_id";
  SELECT "workspace_id", "moderation_status"::text, "status"::text, "deleted_at"
  INTO asset_workspace, asset_moderation, asset_status, asset_deleted_at
  FROM "media_assets" WHERE "id" = NEW."asset_id";
  IF TG_TABLE_NAME = 'story_film_generation_attempt_references' THEN
    SELECT "status"::text INTO attempt_status FROM "story_film_generation_attempts" WHERE "id" = NEW."attempt_id";
  ELSE
    SELECT "status"::text INTO attempt_status FROM "story_film_trailer_generation_attempts" WHERE "id" = NEW."attempt_id";
  END IF;
  IF attempt_status <> 'queued'
     OR version_row."reference_slot_id" IS DISTINCT FROM NEW."reference_slot_id"
     OR version_row."story_project_id" IS DISTINCT FROM NEW."story_project_id"
     OR version_row."revision_id" IS DISTINCT FROM NEW."revision_id"
     OR version_row."status" <> 'ready'
     OR version_row."asset_id" IS DISTINCT FROM NEW."asset_id"
     OR version_row."checksum_sha256" IS DISTINCT FROM NEW."checksum_sha256"
     OR approved_version IS DISTINCT FROM NEW."reference_version_id"
     OR asset_workspace IS DISTINCT FROM project_workspace
     OR asset_status <> 'ready' OR asset_moderation = 'blocked' OR asset_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Generation attempt reference must freeze the current approved, usable ReferenceVersion asset' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_film_generation_attempt_references_guard_trg"
BEFORE INSERT ON "story_film_generation_attempt_references"
FOR EACH ROW EXECUTE FUNCTION "story_generation_attempt_reference_guard"();
CREATE TRIGGER "story_film_trailer_generation_attempt_references_guard_trg"
BEFORE INSERT ON "story_film_trailer_generation_attempt_references"
FOR EACH ROW EXECUTE FUNCTION "story_generation_attempt_reference_guard"();

-- Validate direct current pointers, their workspace, optional provenance, and
-- latest-request token. This prevents a library asset from crossing workspaces
-- and prevents an attempt from being attached to the wrong node.
CREATE FUNCTION "story_current_video_guard"()
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
  source_node UUID;
  source_asset UUID;
  source_variant UUID;
  source_checksum TEXT;
  source_status TEXT;
  source_spec_hash TEXT;
  source_input_hash TEXT;
  source_technical_checks JSONB;
  latest_node UUID;
  latest_spec_hash TEXT;
  latest_input_hash TEXT;
BEGIN
  SELECT "workspace_id" INTO expected_workspace FROM "story_projects" WHERE "id" = NEW."story_project_id";
  IF NEW."current_video_asset_id" IS NOT NULL THEN
    SELECT "workspace_id", "kind"::text, "status"::text, "moderation_status"::text, "deleted_at"
    INTO asset_workspace, asset_kind, asset_status, asset_moderation, asset_deleted_at
    FROM "media_assets" WHERE "id" = NEW."current_video_asset_id";
    SELECT "asset_id", "status"::text, "checksum_sha256", "deleted_at"
    INTO variant_asset, variant_status, variant_checksum, variant_deleted_at
    FROM "media_asset_variants" WHERE "id" = NEW."current_video_variant_id";
    IF asset_workspace IS DISTINCT FROM expected_workspace OR asset_kind <> 'video'
       OR asset_status <> 'ready' OR asset_moderation = 'blocked' OR asset_deleted_at IS NOT NULL
       OR variant_asset IS DISTINCT FROM NEW."current_video_asset_id"
       OR variant_status <> 'ready' OR variant_deleted_at IS NOT NULL
       OR variant_checksum IS DISTINCT FROM NEW."current_video_checksum_sha256" THEN
      RAISE EXCEPTION 'Current video must be an active, non-blocked project-workspace video variant with matching checksum' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'story_film_clips' THEN
    IF NEW."current_video_source_attempt_id" IS NOT NULL THEN
      SELECT "clip_id", "output_asset_id", "output_variant_id", "output_checksum_sha256", "status"::text,
             "clip_spec_hash", "production_input_hash", "technical_checks"
      INTO source_node, source_asset, source_variant, source_checksum, source_status,
           source_spec_hash, source_input_hash, source_technical_checks
      FROM "story_film_generation_attempts" WHERE "id" = NEW."current_video_source_attempt_id";
      IF source_node IS DISTINCT FROM NEW."id" OR source_status <> 'ready'
        OR source_asset IS DISTINCT FROM NEW."current_video_asset_id"
        OR source_variant IS DISTINCT FROM NEW."current_video_variant_id"
        OR source_checksum IS DISTINCT FROM NEW."current_video_checksum_sha256"
        OR source_spec_hash IS DISTINCT FROM NEW."current_video_spec_hash"
        OR source_input_hash IS DISTINCT FROM NEW."current_video_input_hash"
        OR source_technical_checks IS DISTINCT FROM NEW."current_video_technical_checks" THEN
        RAISE EXCEPTION 'Current clip video provenance must match a ready attempt output' USING ERRCODE = '23514';
      END IF;
    END IF;
    IF NEW."latest_generation_attempt_id" IS NOT NULL THEN
      SELECT "clip_id", "clip_spec_hash", "production_input_hash"
      INTO latest_node, latest_spec_hash, latest_input_hash
      FROM "story_film_generation_attempts" WHERE "id" = NEW."latest_generation_attempt_id";
    END IF;
  ELSE
    IF NEW."current_video_source_attempt_id" IS NOT NULL THEN
      SELECT "trailer_id", "output_asset_id", "output_variant_id", "output_checksum_sha256", "status"::text,
             "trailer_spec_hash", "production_input_hash", "technical_checks"
      INTO source_node, source_asset, source_variant, source_checksum, source_status,
           source_spec_hash, source_input_hash, source_technical_checks
      FROM "story_film_trailer_generation_attempts" WHERE "id" = NEW."current_video_source_attempt_id";
      IF source_node IS DISTINCT FROM NEW."id" OR source_status <> 'ready'
        OR source_asset IS DISTINCT FROM NEW."current_video_asset_id"
        OR source_variant IS DISTINCT FROM NEW."current_video_variant_id"
        OR source_checksum IS DISTINCT FROM NEW."current_video_checksum_sha256"
        OR source_spec_hash IS DISTINCT FROM NEW."current_video_spec_hash"
        OR source_input_hash IS DISTINCT FROM NEW."current_video_input_hash"
        OR source_technical_checks IS DISTINCT FROM NEW."current_video_technical_checks" THEN
        RAISE EXCEPTION 'Current trailer video provenance must match a ready attempt output' USING ERRCODE = '23514';
      END IF;
    END IF;
    IF NEW."latest_generation_attempt_id" IS NOT NULL THEN
      SELECT "trailer_id", "trailer_spec_hash", "production_input_hash"
      INTO latest_node, latest_spec_hash, latest_input_hash
      FROM "story_film_trailer_generation_attempts" WHERE "id" = NEW."latest_generation_attempt_id";
    END IF;
  END IF;
  IF NEW."latest_generation_attempt_id" IS NOT NULL
     AND (latest_node IS DISTINCT FROM NEW."id"
       OR latest_spec_hash IS DISTINCT FROM NEW."spec_hash"
       OR latest_input_hash IS DISTINCT FROM NEW."production_input_hash") THEN
    RAISE EXCEPTION 'Latest generation attempt must match the same node and authored production input' USING ERRCODE = '23514';
  END IF;
  IF NEW."current_video_source_attempt_id" IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW."current_video_source_attempt_id" IS DISTINCT FROM OLD."current_video_source_attempt_id")
     AND (
       jsonb_typeof(source_technical_checks) <> 'array'
       OR jsonb_array_length(source_technical_checks) = 0
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(source_technical_checks) AS check_row
         WHERE check_row->>'status' IS DISTINCT FROM 'passed'
       )
     ) THEN
    RAISE EXCEPTION 'A newly promoted generation attempt must pass every technical check' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_film_clips_current_video_guard_trg"
BEFORE INSERT OR UPDATE ON "story_film_clips"
FOR EACH ROW EXECUTE FUNCTION "story_current_video_guard"();
CREATE TRIGGER "story_film_trailers_current_video_guard_trg"
BEFORE INSERT OR UPDATE ON "story_film_trailers"
FOR EACH ROW EXECUTE FUNCTION "story_current_video_guard"();

CREATE FUNCTION "story_film_clip_version_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  max_clip_ms INTEGER;
  content_changed BOOLEAN := false;
  current_video_changed BOOLEAN := false;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."id" IS DISTINCT FROM OLD."id"
       OR NEW."story_project_id" IS DISTINCT FROM OLD."story_project_id"
       OR NEW."revision_id" IS DISTINCT FROM OLD."revision_id"
       OR NEW."created_by_user_id" IS DISTINCT FROM OLD."created_by_user_id"
       OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
      RAISE EXCEPTION 'StoryFilmClip identity and creator fields are immutable' USING ERRCODE = '23514';
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
    current_video_changed :=
      NEW."current_video_asset_id" IS DISTINCT FROM OLD."current_video_asset_id" OR
      NEW."current_video_variant_id" IS DISTINCT FROM OLD."current_video_variant_id" OR
      NEW."current_video_source_attempt_id" IS DISTINCT FROM OLD."current_video_source_attempt_id" OR
      NEW."current_video_spec_hash" IS DISTINCT FROM OLD."current_video_spec_hash" OR
      NEW."current_video_input_hash" IS DISTINCT FROM OLD."current_video_input_hash" OR
      NEW."current_video_checksum_sha256" IS DISTINCT FROM OLD."current_video_checksum_sha256" OR
      NEW."current_video_technical_checks" IS DISTINCT FROM OLD."current_video_technical_checks" OR
      NEW."current_video_set_by_user_id" IS DISTINCT FROM OLD."current_video_set_by_user_id" OR
      NEW."current_video_set_at" IS DISTINCT FROM OLD."current_video_set_at";
    IF content_changed AND NEW."version" <> OLD."version" + 1 THEN
      RAISE EXCEPTION 'StoryFilmClip content update must increment version by exactly one' USING ERRCODE = '23514';
    ELSIF NOT content_changed AND NEW."version" IS DISTINCT FROM OLD."version" THEN
      RAISE EXCEPTION 'StoryFilmClip version may change only with authored content' USING ERRCODE = '23514';
    END IF;
    IF current_video_changed AND NEW."current_video_revision" <> OLD."current_video_revision" + 1 THEN
      RAISE EXCEPTION 'StoryFilmClip current-video replacement must increment currentVideoRevision by exactly one' USING ERRCODE = '23514';
    ELSIF NOT current_video_changed AND NEW."current_video_revision" IS DISTINCT FROM OLD."current_video_revision" THEN
      RAISE EXCEPTION 'StoryFilmClip currentVideoRevision may change only with the current video' USING ERRCODE = '23514';
    END IF;
  END IF;
  SELECT "max_generated_clip_duration_ms" INTO max_clip_ms
  FROM "story_film_specs" WHERE "revision_id" = NEW."revision_id";
  IF max_clip_ms IS NOT NULL AND NEW."target_duration_ms" > max_clip_ms THEN
    RAISE EXCEPTION 'FilmClip duration exceeds FilmSpec generation limit' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "story_film_trailer_version_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  content_changed BOOLEAN := false;
  current_video_changed BOOLEAN := false;
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."story_project_id" IS DISTINCT FROM OLD."story_project_id"
     OR NEW."revision_id" IS DISTINCT FROM OLD."revision_id"
     OR NEW."created_by_user_id" IS DISTINCT FROM OLD."created_by_user_id"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'StoryFilmTrailer identity and creator fields are immutable' USING ERRCODE = '23514';
  END IF;
  content_changed :=
    NEW."title" IS DISTINCT FROM OLD."title" OR
    NEW."generation_mode" IS DISTINCT FROM OLD."generation_mode" OR
    NEW."frame_mode" IS DISTINCT FROM OLD."frame_mode" OR
    NEW."target_duration_ms" IS DISTINCT FROM OLD."target_duration_ms" OR
    NEW."spec_json" IS DISTINCT FROM OLD."spec_json" OR
    NEW."spec_hash" IS DISTINCT FROM OLD."spec_hash" OR
    NEW."production_input_manifest" IS DISTINCT FROM OLD."production_input_manifest" OR
    NEW."production_input_hash" IS DISTINCT FROM OLD."production_input_hash";
  current_video_changed :=
    NEW."current_video_asset_id" IS DISTINCT FROM OLD."current_video_asset_id" OR
    NEW."current_video_variant_id" IS DISTINCT FROM OLD."current_video_variant_id" OR
    NEW."current_video_source_attempt_id" IS DISTINCT FROM OLD."current_video_source_attempt_id" OR
    NEW."current_video_spec_hash" IS DISTINCT FROM OLD."current_video_spec_hash" OR
    NEW."current_video_input_hash" IS DISTINCT FROM OLD."current_video_input_hash" OR
    NEW."current_video_checksum_sha256" IS DISTINCT FROM OLD."current_video_checksum_sha256" OR
    NEW."current_video_technical_checks" IS DISTINCT FROM OLD."current_video_technical_checks" OR
    NEW."current_video_set_by_user_id" IS DISTINCT FROM OLD."current_video_set_by_user_id" OR
    NEW."current_video_set_at" IS DISTINCT FROM OLD."current_video_set_at";
  IF content_changed AND NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'StoryFilmTrailer content update must increment version by exactly one' USING ERRCODE = '23514';
  ELSIF NOT content_changed AND NEW."version" IS DISTINCT FROM OLD."version" THEN
    RAISE EXCEPTION 'StoryFilmTrailer version may change only with authored content' USING ERRCODE = '23514';
  END IF;
  IF current_video_changed AND NEW."current_video_revision" <> OLD."current_video_revision" + 1 THEN
    RAISE EXCEPTION 'StoryFilmTrailer current-video replacement must increment currentVideoRevision by exactly one' USING ERRCODE = '23514';
  ELSIF NOT current_video_changed AND NEW."current_video_revision" IS DISTINCT FROM OLD."current_video_revision" THEN
    RAISE EXCEPTION 'StoryFilmTrailer currentVideoRevision may change only with the current video' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_film_clips_version_guard_trg"
BEFORE INSERT OR UPDATE ON "story_film_clips"
FOR EACH ROW EXECUTE FUNCTION "story_film_clip_version_guard"();
CREATE TRIGGER "story_film_trailers_version_guard_trg"
BEFORE UPDATE ON "story_film_trailers"
FOR EACH ROW EXECUTE FUNCTION "story_film_trailer_version_guard"();

CREATE FUNCTION "story_film_spec_version_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  specification_changed BOOLEAN;
BEGIN
  IF NEW."revision_id" IS DISTINCT FROM OLD."revision_id"
     OR NEW."story_project_id" IS DISTINCT FROM OLD."story_project_id"
     OR NEW."created_by_user_id" IS DISTINCT FROM OLD."created_by_user_id"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'StoryFilmSpec identity and creator fields are immutable' USING ERRCODE = '23514';
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
    NEW."spec_json" IS DISTINCT FROM OLD."spec_json" OR
    NEW."spec_hash" IS DISTINCT FROM OLD."spec_hash";
  IF specification_changed THEN
    IF NEW."version" <> OLD."version" + 1 OR NEW."production_revision" <> OLD."production_revision" + 1 THEN
      RAISE EXCEPTION 'StoryFilmSpec content update must increment version and productionRevision by exactly one' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW."version" IS DISTINCT FROM OLD."version" OR NEW."updated_by_user_id" IS DISTINCT FROM OLD."updated_by_user_id" THEN
      RAISE EXCEPTION 'StoryFilmSpec version/editor may change only with spec content' USING ERRCODE = '23514';
    END IF;
    IF NEW."production_revision" NOT IN (OLD."production_revision", OLD."production_revision" + 1) THEN
      RAISE EXCEPTION 'StoryFilmSpec productionRevision may increment only by one' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "story_film_specs_version_guard_trg"
BEFORE UPDATE ON "story_film_specs"
FOR EACH ROW EXECUTE FUNCTION "story_film_spec_version_guard"();

CREATE TRIGGER "story_film_clips_bump_production_trg"
AFTER INSERT OR UPDATE OR DELETE ON "story_film_clips"
FOR EACH ROW EXECUTE FUNCTION "story_film_bump_production_revision"();

-- A changed approved reference invalidates the authored production manifest
-- and request token. The currently playable video remains attached and is
-- visibly stale because its frozen input hash no longer matches the node.
CREATE FUNCTION "story_reference_approval_invalidate_production"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."approved_version_id" IS NOT DISTINCT FROM OLD."approved_version_id" THEN
    RETURN NULL;
  END IF;
  UPDATE "story_film_clips" AS clip
  SET "production_input_manifest" = NULL,
      "production_input_hash" = NULL,
      "latest_generation_attempt_id" = NULL,
      "version" = clip."version" + 1,
      "updated_at" = CURRENT_TIMESTAMP
  WHERE clip."archived_at" IS NULL
    AND (clip."production_input_manifest" IS NOT NULL OR clip."production_input_hash" IS NOT NULL)
    AND EXISTS (
      SELECT 1 FROM "story_film_clip_references" AS reference
      WHERE reference."clip_id" = clip."id" AND reference."reference_slot_id" = NEW."id"
    );
  UPDATE "story_film_trailers" AS trailer
  SET "production_input_manifest" = NULL,
      "production_input_hash" = NULL,
      "latest_generation_attempt_id" = NULL,
      "version" = trailer."version" + 1,
      "updated_at" = CURRENT_TIMESTAMP
  WHERE (trailer."production_input_manifest" IS NOT NULL OR trailer."production_input_hash" IS NOT NULL)
    AND EXISTS (
      SELECT 1 FROM "story_film_trailer_references" AS reference
      WHERE reference."trailer_id" = trailer."id" AND reference."reference_slot_id" = NEW."id"
    );
  RETURN NULL;
END;
$$;
CREATE TRIGGER "story_film_reference_slots_approval_invalidate_production_trg"
AFTER UPDATE OF "approved_version_id" ON "story_film_reference_slots"
FOR EACH ROW EXECUTE FUNCTION "story_reference_approval_invalidate_production"();

-- Moderation/lifecycle changes detach an unusable current video immediately,
-- but do not delete its MediaAsset or immutable generation provenance.
CREATE FUNCTION "story_media_asset_invalidate_current_video"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NOT (
    (NEW."moderation_status" = 'blocked' AND OLD."moderation_status" <> 'blocked')
    OR (NEW."status" <> 'ready' AND OLD."status" = 'ready')
    OR (NEW."deleted_at" IS NOT NULL AND OLD."deleted_at" IS NULL)
  ) THEN
    RETURN NULL;
  END IF;
  UPDATE "story_film_reference_slots" AS slot
  SET "approved_version_id" = NULL,
      "version" = slot."version" + 1,
      "updated_at" = CURRENT_TIMESTAMP
  WHERE EXISTS (
    SELECT 1 FROM "story_film_reference_versions" AS version
    WHERE version."id" = slot."approved_version_id" AND version."asset_id" = NEW."id"
  );
  UPDATE "story_film_clips" AS clip
  SET "current_video_asset_id" = NULL,
      "current_video_variant_id" = NULL,
      "current_video_source_attempt_id" = NULL,
      "current_video_spec_hash" = NULL,
      "current_video_input_hash" = NULL,
      "current_video_checksum_sha256" = NULL,
      "current_video_technical_checks" = NULL,
      "current_video_set_by_user_id" = NULL,
      "current_video_set_at" = NULL,
      "latest_generation_attempt_id" = NULL,
      "current_video_revision" = clip."current_video_revision" + 1,
      "updated_at" = CURRENT_TIMESTAMP
  WHERE clip."current_video_asset_id" = NEW."id";
  UPDATE "story_film_clips" AS clip
  SET "latest_generation_attempt_id" = NULL,
      "updated_at" = CURRENT_TIMESTAMP
  WHERE clip."latest_generation_attempt_id" IN (
    SELECT attempt."id" FROM "story_film_generation_attempts" AS attempt
    WHERE attempt."output_asset_id" = NEW."id"
  );
  UPDATE "story_film_trailers" AS trailer
  SET "current_video_asset_id" = NULL,
      "current_video_variant_id" = NULL,
      "current_video_source_attempt_id" = NULL,
      "current_video_spec_hash" = NULL,
      "current_video_input_hash" = NULL,
      "current_video_checksum_sha256" = NULL,
      "current_video_technical_checks" = NULL,
      "current_video_set_by_user_id" = NULL,
      "current_video_set_at" = NULL,
      "latest_generation_attempt_id" = NULL,
      "current_video_revision" = trailer."current_video_revision" + 1,
      "updated_at" = CURRENT_TIMESTAMP
  WHERE trailer."current_video_asset_id" = NEW."id";
  UPDATE "story_film_trailers" AS trailer
  SET "latest_generation_attempt_id" = NULL,
      "updated_at" = CURRENT_TIMESTAMP
  WHERE trailer."latest_generation_attempt_id" IN (
    SELECT attempt."id" FROM "story_film_trailer_generation_attempts" AS attempt
    WHERE attempt."output_asset_id" = NEW."id"
  );
  RETURN NULL;
END;
$$;
CREATE TRIGGER "media_assets_story_current_video_invalidation_trg"
AFTER UPDATE OF "moderation_status", "status", "deleted_at" ON "media_assets"
FOR EACH ROW EXECUTE FUNCTION "story_media_asset_invalidate_current_video"();

CREATE FUNCTION "story_media_variant_invalidate_current_video"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NOT (
    (NEW."status" <> 'ready' AND OLD."status" = 'ready')
    OR (NEW."deleted_at" IS NOT NULL AND OLD."deleted_at" IS NULL)
  ) THEN
    RETURN NULL;
  END IF;
  UPDATE "story_film_clips" AS clip
  SET "current_video_asset_id" = NULL,
      "current_video_variant_id" = NULL,
      "current_video_source_attempt_id" = NULL,
      "current_video_spec_hash" = NULL,
      "current_video_input_hash" = NULL,
      "current_video_checksum_sha256" = NULL,
      "current_video_technical_checks" = NULL,
      "current_video_set_by_user_id" = NULL,
      "current_video_set_at" = NULL,
      "latest_generation_attempt_id" = NULL,
      "current_video_revision" = clip."current_video_revision" + 1,
      "updated_at" = CURRENT_TIMESTAMP
  WHERE clip."current_video_variant_id" = NEW."id";
  UPDATE "story_film_clips" AS clip
  SET "latest_generation_attempt_id" = NULL,
      "updated_at" = CURRENT_TIMESTAMP
  WHERE clip."latest_generation_attempt_id" IN (
    SELECT attempt."id" FROM "story_film_generation_attempts" AS attempt
    WHERE attempt."output_variant_id" = NEW."id"
  );
  UPDATE "story_film_trailers" AS trailer
  SET "current_video_asset_id" = NULL,
      "current_video_variant_id" = NULL,
      "current_video_source_attempt_id" = NULL,
      "current_video_spec_hash" = NULL,
      "current_video_input_hash" = NULL,
      "current_video_checksum_sha256" = NULL,
      "current_video_technical_checks" = NULL,
      "current_video_set_by_user_id" = NULL,
      "current_video_set_at" = NULL,
      "latest_generation_attempt_id" = NULL,
      "current_video_revision" = trailer."current_video_revision" + 1,
      "updated_at" = CURRENT_TIMESTAMP
  WHERE trailer."current_video_variant_id" = NEW."id";
  UPDATE "story_film_trailers" AS trailer
  SET "latest_generation_attempt_id" = NULL,
      "updated_at" = CURRENT_TIMESTAMP
  WHERE trailer."latest_generation_attempt_id" IN (
    SELECT attempt."id" FROM "story_film_trailer_generation_attempts" AS attempt
    WHERE attempt."output_variant_id" = NEW."id"
  );
  RETURN NULL;
END;
$$;
CREATE TRIGGER "media_asset_variants_story_current_video_invalidation_trg"
AFTER UPDATE OF "status", "deleted_at" ON "media_asset_variants"
FOR EACH ROW EXECUTE FUNCTION "story_media_variant_invalidate_current_video"();

-- Reference-derived frames require immutable, ready generation provenance;
-- there is deliberately no clip/trailer approval dependency.
CREATE FUNCTION "story_generation_frame_reference_provenance_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  attempt_project UUID;
  attempt_revision UUID;
  attempt_status TEXT;
  attempt_checksum TEXT;
BEGIN
  IF NEW."source" <> 'generation_frame' THEN
    RETURN NEW;
  END IF;
  SELECT "story_project_id", "revision_id", "status"::text, "output_checksum_sha256"
  INTO attempt_project, attempt_revision, attempt_status, attempt_checksum
  FROM "story_film_generation_attempts" WHERE "id" = NEW."source_generation_attempt_id";
  IF attempt_project IS DISTINCT FROM NEW."story_project_id"
     OR attempt_revision IS DISTINCT FROM NEW."revision_id"
     OR attempt_status <> 'ready'
     OR attempt_checksum IS DISTINCT FROM NEW."source_output_checksum_sha256" THEN
    RAISE EXCEPTION 'Generation-frame reference requires matching ready attempt provenance' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "story_film_reference_versions_generation_frame_provenance_trg"
BEFORE INSERT OR UPDATE ON "story_film_reference_versions"
FOR EACH ROW EXECUTE FUNCTION "story_generation_frame_reference_provenance_guard"();

-- Asset-based continuity validates exact variants and checksums.
CREATE FUNCTION "story_continuity_asset_inputs_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  upstream_variant_asset UUID;
  downstream_variant_asset UUID;
  upstream_checksum TEXT;
  downstream_checksum TEXT;
  upstream_variant_usable BOOLEAN;
  downstream_variant_usable BOOLEAN;
  project_workspace UUID;
  upstream_workspace UUID;
  downstream_workspace UUID;
  upstream_usable BOOLEAN;
  downstream_usable BOOLEAN;
BEGIN
  SELECT "workspace_id" INTO project_workspace FROM "story_projects" WHERE "id" = NEW."story_project_id";
  SELECT "asset_id", "checksum_sha256", ("status" = 'ready' AND "deleted_at" IS NULL)
  INTO upstream_variant_asset, upstream_checksum, upstream_variant_usable
  FROM "media_asset_variants" WHERE "id" = NEW."upstream_variant_id";
  SELECT "asset_id", "checksum_sha256", ("status" = 'ready' AND "deleted_at" IS NULL)
  INTO downstream_variant_asset, downstream_checksum, downstream_variant_usable
  FROM "media_asset_variants" WHERE "id" = NEW."downstream_variant_id";
  SELECT "workspace_id", ("status" = 'ready' AND "moderation_status" <> 'blocked' AND "deleted_at" IS NULL)
  INTO upstream_workspace, upstream_usable FROM "media_assets" WHERE "id" = NEW."upstream_asset_id";
  SELECT "workspace_id", ("status" = 'ready' AND "moderation_status" <> 'blocked' AND "deleted_at" IS NULL)
  INTO downstream_workspace, downstream_usable FROM "media_assets" WHERE "id" = NEW."downstream_asset_id";
  IF upstream_variant_asset IS DISTINCT FROM NEW."upstream_asset_id"
     OR downstream_variant_asset IS DISTINCT FROM NEW."downstream_asset_id"
     OR upstream_checksum IS DISTINCT FROM NEW."upstream_checksum_sha256"
     OR downstream_checksum IS DISTINCT FROM NEW."downstream_checksum_sha256"
     OR upstream_workspace IS DISTINCT FROM project_workspace
     OR downstream_workspace IS DISTINCT FROM project_workspace
     OR upstream_variant_usable IS DISTINCT FROM TRUE
     OR downstream_variant_usable IS DISTINCT FROM TRUE
     OR upstream_usable IS DISTINCT FROM TRUE OR downstream_usable IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Continuity inputs must match exact media variants and checksums' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "story_film_continuity_checks_asset_inputs_guard_trg"
BEFORE INSERT OR UPDATE ON "story_film_continuity_checks"
FOR EACH ROW EXECUTE FUNCTION "story_continuity_asset_inputs_guard"();

CREATE FUNCTION "story_continuity_check_version_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."story_project_id" IS DISTINCT FROM OLD."story_project_id"
     OR NEW."revision_id" IS DISTINCT FROM OLD."revision_id"
     OR NEW."dependency_id" IS DISTINCT FROM OLD."dependency_id"
     OR NEW."upstream_asset_id" IS DISTINCT FROM OLD."upstream_asset_id"
     OR NEW."upstream_variant_id" IS DISTINCT FROM OLD."upstream_variant_id"
     OR NEW."upstream_checksum_sha256" IS DISTINCT FROM OLD."upstream_checksum_sha256"
     OR NEW."downstream_asset_id" IS DISTINCT FROM OLD."downstream_asset_id"
     OR NEW."downstream_variant_id" IS DISTINCT FROM OLD."downstream_variant_id"
     OR NEW."downstream_checksum_sha256" IS DISTINCT FROM OLD."downstream_checksum_sha256"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'StoryFilmContinuityCheck identity and media inputs are immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'StoryFilmContinuityCheck update must increment version by exactly one' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "story_film_continuity_checks_version_guard_trg"
BEFORE UPDATE ON "story_film_continuity_checks"
FOR EACH ROW EXECUTE FUNCTION "story_continuity_check_version_guard"();

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
  SELECT "format" INTO project_format FROM "story_projects" WHERE "id" = NEW."story_project_id";
  IF project_format <> 'interactive_film' THEN
    RETURN NEW;
  END IF;
  SELECT "production_revision", "target_clip_count"
  INTO current_production_revision, expected_clips
  FROM "story_film_specs" WHERE "revision_id" = NEW."source_revision_id";
  IF current_production_revision IS NULL OR current_production_revision <> NEW."source_production_revision" THEN
    RAISE EXCEPTION 'Film Build source production revision is stale' USING ERRCODE = '23514';
  END IF;
  SELECT count(*) INTO actual_clips FROM "story_film_build_clips" WHERE "build_id" = NEW."id";
  IF (NEW."kind" = 'production' AND actual_clips <> expected_clips)
     OR (NEW."kind" = 'preview' AND actual_clips < 1) THEN
    RAISE EXCEPTION 'Film Build clip manifest is incomplete' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "story_film_build_clips" AS build_clip
    JOIN "story_film_clips" AS clip ON clip."id" = build_clip."clip_id"
    JOIN "story_build_assets" AS build_asset ON build_asset."id" = build_clip."build_asset_id"
    JOIN "media_assets" AS media_asset ON media_asset."id" = build_asset."asset_id"
    JOIN "media_asset_variants" AS media_variant ON media_variant."id" = build_asset."variant_id"
    WHERE build_clip."build_id" = NEW."id"
      AND (
        build_clip."story_project_id" <> NEW."story_project_id"
        OR build_clip."revision_id" <> NEW."source_revision_id"
        OR clip."archived_at" IS NOT NULL
        OR clip."current_video_asset_id" IS NULL
        OR clip."current_video_variant_id" IS NULL
        OR clip."current_video_spec_hash" IS DISTINCT FROM clip."spec_hash"
        OR clip."current_video_input_hash" IS DISTINCT FROM clip."production_input_hash"
        OR build_clip."source_generation_attempt_id" IS DISTINCT FROM clip."current_video_source_attempt_id"
        OR build_clip."clip_spec_hash" IS DISTINCT FROM clip."current_video_spec_hash"
        OR build_clip."production_input_hash" IS DISTINCT FROM clip."current_video_input_hash"
        OR build_clip."checksum_sha256" IS DISTINCT FROM clip."current_video_checksum_sha256"
        OR jsonb_typeof(clip."current_video_technical_checks") <> 'array'
        OR jsonb_array_length(clip."current_video_technical_checks") = 0
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(clip."current_video_technical_checks") AS check_row
          WHERE check_row->>'status' IS DISTINCT FROM 'passed'
        )
        OR build_asset."role" <> 'video'
        OR build_asset."asset_id" IS DISTINCT FROM clip."current_video_asset_id"
        OR build_asset."variant_id" IS DISTINCT FROM clip."current_video_variant_id"
        OR build_asset."checksum_sha256" IS DISTINCT FROM clip."current_video_checksum_sha256"
        OR build_asset."duration_ms" IS DISTINCT FROM build_clip."duration_ms"
        OR media_asset."kind" <> 'video' OR media_asset."status" <> 'ready'
        OR media_asset."moderation_status" = 'blocked' OR media_asset."deleted_at" IS NOT NULL
        OR media_variant."asset_id" IS DISTINCT FROM media_asset."id"
        OR media_variant."status" <> 'ready' OR media_variant."deleted_at" IS NOT NULL
        OR media_variant."checksum_sha256" IS DISTINCT FROM build_clip."checksum_sha256"
        OR (clip."spec_json" #>> '{outputContract,durationMs}') IS NULL
        OR (clip."spec_json" #>> '{outputContract,durationToleranceMs}') IS NULL
        OR build_clip."duration_ms" <
          (clip."spec_json" #>> '{outputContract,durationMs}')::INTEGER -
          (clip."spec_json" #>> '{outputContract,durationToleranceMs}')::INTEGER
        OR build_clip."duration_ms" >
          (clip."spec_json" #>> '{outputContract,durationMs}')::INTEGER +
          (clip."spec_json" #>> '{outputContract,durationToleranceMs}')::INTEGER
      )
  ) THEN
    RAISE EXCEPTION 'Film Build contains a stale, unusable, or mismatched current video' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "story_film_clip_dependencies" AS dependency
    JOIN "story_film_build_clips" AS upstream_clip
      ON upstream_clip."build_id" = NEW."id" AND upstream_clip."clip_id" = dependency."predecessor_clip_id"
    JOIN "story_build_assets" AS upstream_asset ON upstream_asset."id" = upstream_clip."build_asset_id"
    JOIN "story_film_build_clips" AS downstream_clip
      ON downstream_clip."build_id" = NEW."id" AND downstream_clip."clip_id" = dependency."successor_clip_id"
    JOIN "story_build_assets" AS downstream_asset ON downstream_asset."id" = downstream_clip."build_asset_id"
    LEFT JOIN "story_film_continuity_checks" AS continuity
      ON continuity."dependency_id" = dependency."id"
     AND continuity."upstream_asset_id" = upstream_asset."asset_id"
     AND continuity."upstream_variant_id" = upstream_asset."variant_id"
     AND continuity."upstream_checksum_sha256" = upstream_asset."checksum_sha256"
     AND continuity."downstream_asset_id" = downstream_asset."asset_id"
     AND continuity."downstream_variant_id" = downstream_asset."variant_id"
     AND continuity."downstream_checksum_sha256" = downstream_asset."checksum_sha256"
     AND continuity."decision" IN ('pass', 'waived')
    WHERE dependency."revision_id" = NEW."source_revision_id"
      AND dependency."kind" IN ('continuity', 'convergence')
      AND continuity."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'Film Build is missing a passing continuity check for its exact media variants' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "story_builds_ready_guard_trg"
BEFORE UPDATE OF "status" ON "story_builds"
FOR EACH ROW EXECUTE FUNCTION "story_build_ready_guard"();

COMMIT;
