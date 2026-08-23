-- Companion to 20260822150000: the dropped selection table was still
-- referenced by three trigger functions. The frame-profile lock now reads the
-- storyboard (selected clip media = production has begun), and the selection
-- invalidation triggers go away with the layer they served.

DROP TRIGGER IF EXISTS "media_assets_story_video_invalidation_trg" ON "media_assets";
DROP TRIGGER IF EXISTS "media_asset_variants_story_video_invalidation_trg" ON "media_asset_variants";
DROP FUNCTION IF EXISTS "story_video_media_asset_invalidation"();
DROP FUNCTION IF EXISTS "story_video_media_variant_invalidation"();

CREATE OR REPLACE FUNCTION public.story_project_identity_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW."workspace_id" IS DISTINCT FROM OLD."workspace_id" THEN
    RAISE EXCEPTION 'StoryProject.workspaceId is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."frame_profile" IS DISTINCT FROM OLD."frame_profile"
     AND (
       EXISTS (
         SELECT 1
         FROM "story_builds"
         WHERE "story_project_id" = OLD."id"
       )
       OR EXISTS (
         SELECT 1
         FROM "story_storyboard_clips"
         WHERE "story_project_id" = OLD."id"
           AND "selected_media_version_id" IS NOT NULL
       )
     )
  THEN
    RAISE EXCEPTION 'StoryProject.frameProfile is locked after production begins'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;
