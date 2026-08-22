-- Storyboard-timeline builds: a scene freezes one row PER SEGMENT (storyboard
-- clip), so the per-node primary key becomes per-logical-key, and the ready
-- guard accepts still-image segments alongside video ones. The storyboard
-- sequence is now the sole source of a node's playable content.

ALTER TABLE "story_video_build_clips"
  DROP CONSTRAINT "story_video_build_clips_pkey";
ALTER TABLE "story_video_build_clips"
  ADD CONSTRAINT "story_video_build_clips_pkey" PRIMARY KEY ("build_id", "logical_key");
-- The PK now covers what the standalone unique used to.
DROP INDEX "story_video_build_clips_build_logical_key_unique";
CREATE INDEX "story_video_build_clips_build_node_idx"
  ON "story_video_build_clips" ("build_id", "graph_node_id");

CREATE OR REPLACE FUNCTION public.story_build_ready_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
        media_asset."kind" NOT IN ('video', 'image') OR
        media_asset."status" IS DISTINCT FROM 'ready' OR
        media_asset."moderation_status" = 'blocked' OR
        media_asset."deleted_at" IS NOT NULL OR
        media_variant."status" IS DISTINCT FROM 'ready' OR
        media_variant."deleted_at" IS NOT NULL OR
        NOT (
          (media_asset."kind" = 'video' AND media_variant."content_type" ~* '^video/') OR
          (media_asset."kind" = 'image' AND media_variant."content_type" ~* '^image/')
        ) OR
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
$function$;
