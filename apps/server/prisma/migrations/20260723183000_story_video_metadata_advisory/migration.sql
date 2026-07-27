-- Video identity and delivery availability are release requirements.
-- Probe-derived checksum, dimensions, duration, and browser-safety flags are
-- advisory metadata: older/imported originals may legitimately lack them.

ALTER TABLE "story_build_assets"
  ALTER COLUMN "checksum_sha256" DROP NOT NULL;

ALTER TABLE "story_video_build_clips"
  ALTER COLUMN "checksum_sha256" DROP NOT NULL,
  ALTER COLUMN "duration_ms" DROP NOT NULL,
  ALTER COLUMN "browser_safe_mp4" DROP NOT NULL;

ALTER TABLE "story_video_selections"
  DROP CONSTRAINT "story_video_selections_media_shape_chk";
ALTER TABLE "story_video_selections"
  ADD CONSTRAINT "story_video_selections_media_shape_chk" CHECK (
    (
      "current_asset_id" IS NULL AND
      "current_variant_id" IS NULL AND
      "current_source_generation_attempt_id" IS NULL AND
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

ALTER TABLE "story_build_assets"
  DROP CONSTRAINT "story_build_assets_video_metadata_chk";
ALTER TABLE "story_build_assets"
  ADD CONSTRAINT "story_build_assets_video_metadata_chk" CHECK (
    "role" <> 'video' OR (
      "content_type" ~* '^video/' AND
      ("checksum_sha256" IS NULL OR
        "checksum_sha256" ~ '^[0-9a-f]{64}$') AND
      ("duration_ms" IS NULL OR "duration_ms" > 0) AND
      ("width" IS NULL OR "width" > 0) AND
      ("height" IS NULL OR "height" > 0)
    )
  );

ALTER TABLE "story_video_build_clips"
  DROP CONSTRAINT "story_video_build_clips_media_chk";
ALTER TABLE "story_video_build_clips"
  ADD CONSTRAINT "story_video_build_clips_media_chk" CHECK (
    btrim("graph_node_id") <> '' AND
    btrim("logical_key") <> '' AND
    "content_type" ~* '^video/' AND
    ("checksum_sha256" IS NULL OR
      "checksum_sha256" ~ '^[0-9a-f]{64}$') AND
    ("duration_ms" IS NULL OR "duration_ms" > 0) AND
    ("width" IS NULL OR "width" > 0) AND
    ("height" IS NULL OR "height" > 0) AND
    "rank" >= 0
  );

CREATE OR REPLACE FUNCTION "story_video_selection_media_guard"()
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
      AND variant."content_type" ~* '^video/'
      AND variant."checksum_sha256"
        IS NOT DISTINCT FROM NEW."current_checksum_sha256"
      AND variant."content_type" = NEW."current_content_type"
      AND variant."duration_ms"
        IS NOT DISTINCT FROM NEW."current_duration_ms"
      AND variant."width" IS NOT DISTINCT FROM NEW."current_width"
      AND variant."height" IS NOT DISTINCT FROM NEW."current_height"
      AND EXISTS (
        SELECT 1
        FROM "media_object_placements" AS placement
        WHERE placement."asset_id" = NEW."current_asset_id"
          AND placement."variant_id" = NEW."current_variant_id"
          AND placement."status" = 'active'
          AND placement."deleted_at" IS NULL
      )
  ) THEN
    RAISE EXCEPTION 'STORY_VIDEO_SELECTION_MEDIA_INVALID: current video must be one active ready video variant'
      USING ERRCODE = '23514';
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
        "current_source_generation_attempt_id" = NULL,
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

DROP TRIGGER "media_asset_variants_story_video_invalidation_trg"
  ON "media_asset_variants";
CREATE TRIGGER "media_asset_variants_story_video_invalidation_trg"
AFTER UPDATE OF "status", "deleted_at", "content_type"
ON "media_asset_variants"
FOR EACH ROW EXECUTE FUNCTION "story_video_media_variant_invalidation"();

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
        ) OR
        (clip."source_generation_attempt_id" IS NOT NULL AND (
          generation."id" IS NULL OR
          generation."status" IS DISTINCT FROM 'ready' OR
          generation."output_asset_id" IS DISTINCT FROM build_asset."asset_id" OR
          generation."output_variant_id" IS DISTINCT FROM build_asset."variant_id" OR
          generation."output_checksum_sha256"
            IS DISTINCT FROM clip."checksum_sha256"
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
    RAISE EXCEPTION 'StoryBuild contains unavailable or mismatched video media'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
