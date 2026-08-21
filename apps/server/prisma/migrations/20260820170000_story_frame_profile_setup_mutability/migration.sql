-- Aspect ratio is a setup decision, not immutable project identity.
-- Creators may change it while the project has no selected video and no
-- build. Once either production artifact exists, both the service and the
-- database keep the frame contract stable so existing media cannot become
-- incompatible with the project.

CREATE OR REPLACE FUNCTION "story_project_identity_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
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
         FROM "story_video_selections"
         WHERE "story_project_id" = OLD."id"
           AND "current_asset_id" IS NOT NULL
       )
     )
  THEN
    RAISE EXCEPTION 'StoryProject.frameProfile is locked after production begins'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
