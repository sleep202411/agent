-- Story Studio no longer owns a direct video-generation plane.
--
-- Preserve creator media and clip bindings, but remove the orchestration
-- records, trailer selection, and generation-specific provenance. Reference
-- images extracted from an old generation remain usable as ordinary imports.

BEGIN;

-- Drop guards whose function bodies name generation tables or provenance
-- columns. They are rebuilt below against the target schema.
DROP FUNCTION IF EXISTS "story_video_generation_attempt_lifecycle_guard"() CASCADE;
DROP FUNCTION IF EXISTS "story_video_generation_attempt_integrity_guard"() CASCADE;
DROP FUNCTION IF EXISTS "story_video_selection_provenance_consistency_guard"() CASCADE;
DROP FUNCTION IF EXISTS "story_video_ready_attempt_selection_guard"() CASCADE;
DROP FUNCTION IF EXISTS "story_video_attempt_reference_guard"() CASCADE;
DROP FUNCTION IF EXISTS "story_video_attempt_reference_append_only_guard"() CASCADE;
DROP FUNCTION IF EXISTS "story_generation_frame_reference_provenance_guard"() CASCADE;
DROP FUNCTION IF EXISTS "story_reference_version_lifecycle_guard"() CASCADE;
DROP FUNCTION IF EXISTS "story_reference_version_integrity_guard"() CASCADE;
DROP FUNCTION IF EXISTS "story_build_ready_guard"() CASCADE;
DROP FUNCTION IF EXISTS "story_project_archive_guard"() CASCADE;

-- A generated frame is still a valid image. Only its retired Story generation
-- provenance disappears.
UPDATE "story_reference_versions"
SET "source" = 'import'
WHERE "source" = 'generation_frame';

DROP TABLE "story_video_generation_attempt_references";
DROP TABLE "story_video_generation_attempts" CASCADE;

ALTER TABLE "story_reference_versions"
  DROP CONSTRAINT IF EXISTS "story_reference_versions_frame_source_chk",
  DROP CONSTRAINT IF EXISTS "story_reference_versions_ai_source_chk",
  DROP COLUMN "source_generation_attempt_id",
  DROP COLUMN "source_frame_index",
  DROP COLUMN "source_output_checksum_sha256";

ALTER TYPE "StoryReferenceSource" RENAME TO "StoryReferenceSource_retired";
CREATE TYPE "StoryReferenceSource" AS ENUM ('upload', 'ai_job', 'import');
ALTER TABLE "story_reference_versions"
  ALTER COLUMN "source" TYPE "StoryReferenceSource"
  USING ("source"::text::"StoryReferenceSource");
DROP TYPE "StoryReferenceSource_retired";
ALTER TABLE "story_reference_versions"
  ADD CONSTRAINT "story_reference_versions_ai_source_chk" CHECK (
    (
      "source" = 'ai_job' AND
      "ai_job_id" IS NOT NULL AND
      "ai_job_output_id" IS NOT NULL
    ) OR (
      "source" <> 'ai_job' AND
      "ai_job_id" IS NULL AND
      "ai_job_output_id" IS NULL
    )
  );

-- Only graph clips own current-video selections. Trailer rows have no target in
-- the product after this cut-over.
DELETE FROM "story_video_selections"
WHERE "target_kind" = 'trailer';

ALTER TABLE "story_video_selections"
  DROP CONSTRAINT IF EXISTS "story_video_selections_target_chk",
  DROP CONSTRAINT IF EXISTS "story_video_selections_media_shape_chk";

DROP INDEX IF EXISTS "story_video_selections_target_unique";
DROP INDEX IF EXISTS "story_video_selections_current_attempt_unique";
DROP INDEX IF EXISTS "story_video_selections_project_kind_idx";

ALTER TABLE "story_video_selections"
  DROP COLUMN "current_source_generation_attempt_id",
  DROP COLUMN "target_kind";
ALTER TABLE "story_video_selections"
  RENAME COLUMN "target_key" TO "graph_node_id";

ALTER TABLE "story_video_selections"
  ADD CONSTRAINT "story_video_selections_graph_node_chk"
    CHECK (btrim("graph_node_id") <> ''),
  ADD CONSTRAINT "story_video_selections_media_shape_chk" CHECK (
    (
      "current_asset_id" IS NULL AND
      "current_variant_id" IS NULL AND
      "current_checksum_sha256" IS NULL AND
      "current_content_type" IS NULL AND
      "current_duration_ms" IS NULL AND
      "current_width" IS NULL AND
      "current_height" IS NULL AND
      "current_browser_safe_mp4" IS NULL
    ) OR (
      "current_asset_id" IS NOT NULL AND
      "current_variant_id" IS NOT NULL AND
      "current_content_type" ~* '^video/' AND
      ("current_checksum_sha256" IS NULL OR
        "current_checksum_sha256" ~ '^[0-9a-f]{64}$') AND
      ("current_duration_ms" IS NULL OR "current_duration_ms" > 0) AND
      ("current_width" IS NULL OR "current_width" > 0) AND
      ("current_height" IS NULL OR "current_height" > 0) AND
      "set_at" IS NOT NULL
    )
  );

CREATE UNIQUE INDEX "story_video_selections_graph_node_unique"
  ON "story_video_selections"("story_project_id", "graph_node_id");
CREATE INDEX "story_video_selections_project_updated_idx"
  ON "story_video_selections"("story_project_id", "updated_at" DESC);

ALTER TABLE "story_video_build_clips"
  DROP COLUMN "source_generation_attempt_id";

DROP TYPE "StoryVideoGenerationAttemptStatus";
DROP TYPE "StoryVideoReferenceRole";
DROP TYPE "StoryVideoTargetKind";

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

-- Keep media invalidation atomic without retaining a generation-provenance
-- column in the current-video tuple.
CREATE OR REPLACE FUNCTION "story_video_media_asset_invalidation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" <> 'ready'
     OR NEW."moderation_status" = 'blocked'
     OR NEW."deleted_at" IS NOT NULL THEN
    UPDATE "story_video_selections"
    SET "current_asset_id" = NULL,
        "current_variant_id" = NULL,
        "current_checksum_sha256" = NULL,
        "current_content_type" = NULL,
        "current_duration_ms" = NULL,
        "current_width" = NULL,
        "current_height" = NULL,
        "current_browser_safe_mp4" = NULL,
        "version" = "version" + 1,
        "set_by_user_id" = NULL,
        "set_at" = clock_timestamp(),
        "updated_at" = clock_timestamp()
    WHERE "current_asset_id" = NEW."id";
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "story_video_media_variant_invalidation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" <> 'ready'
     OR NEW."deleted_at" IS NOT NULL
     OR NEW."content_type" IS DISTINCT FROM OLD."content_type" THEN
    UPDATE "story_video_selections"
    SET "current_asset_id" = NULL,
        "current_variant_id" = NULL,
        "current_checksum_sha256" = NULL,
        "current_content_type" = NULL,
        "current_duration_ms" = NULL,
        "current_width" = NULL,
        "current_height" = NULL,
        "current_browser_safe_mp4" = NULL,
        "version" = "version" + 1,
        "set_by_user_id" = NULL,
        "set_at" = clock_timestamp(),
        "updated_at" = clock_timestamp()
    WHERE "current_variant_id" = NEW."id";
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "story_build_ready_guard"()
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
        build_asset."browser_safe_mp4"
          IS DISTINCT FROM clip."browser_safe_mp4" OR
        media_asset."kind" IS DISTINCT FROM 'video' OR
        media_asset."status" IS DISTINCT FROM 'ready' OR
        media_asset."moderation_status" = 'blocked' OR
        media_asset."deleted_at" IS NOT NULL OR
        media_variant."status" IS DISTINCT FROM 'ready' OR
        media_variant."deleted_at" IS NOT NULL OR
        media_variant."content_type" !~* '^video/' OR
        media_variant."checksum_sha256"
          IS DISTINCT FROM clip."checksum_sha256" OR
        media_variant."content_type" IS DISTINCT FROM clip."content_type" OR
        media_variant."duration_ms" IS DISTINCT FROM clip."duration_ms" OR
        media_variant."width" IS DISTINCT FROM clip."width" OR
        media_variant."height" IS DISTINCT FROM clip."height" OR
        NOT EXISTS (
          SELECT 1
          FROM "media_object_placements" AS placement
          WHERE placement."asset_id" = build_asset."asset_id"
            AND placement."variant_id" = build_asset."variant_id"
            AND placement."status" = 'active'
            AND placement."deleted_at" IS NULL
        )
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
    RAISE EXCEPTION 'StoryBuild contains unavailable or mismatched video media'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_builds_ready_guard_trg"
BEFORE UPDATE OF "status" ON "story_builds"
FOR EACH ROW EXECUTE FUNCTION "story_build_ready_guard"();

CREATE FUNCTION "story_project_archive_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" = 'archived' AND OLD."status" <> 'archived' AND (
    EXISTS (
      SELECT 1 FROM "story_builds"
      WHERE "story_project_id" = NEW."id"
        AND "status" IN ('queued', 'validating', 'compiling')
    ) OR EXISTS (
      SELECT 1 FROM "story_experience_publications"
      WHERE "story_project_id" = NEW."id"
        AND "status" IN ('pending', 'uncertain')
    )
  ) THEN
    RAISE EXCEPTION 'Finish active build and publication work before archiving StoryProject'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_projects_archive_guard_trg"
BEFORE UPDATE OF "status" ON "story_projects"
FOR EACH ROW EXECUTE FUNCTION "story_project_archive_guard"();

COMMIT;
