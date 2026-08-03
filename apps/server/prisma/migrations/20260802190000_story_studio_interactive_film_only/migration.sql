-- Story Studio is now the interactive-film product only. Existing projects
-- were authored against the removed mixed text/film graph contract and cannot
-- be interpreted without compatibility code, so deliberately wash this small
-- pre-launch dataset instead of preserving ambiguous data.
TRUNCATE TABLE "story_projects" CASCADE;

DROP INDEX IF EXISTS "story_projects_workspace_format_recent_idx";

ALTER TABLE "story_projects"
  DROP COLUMN "format",
  ALTER COLUMN "frame_profile" SET NOT NULL;

-- The identity trigger predates the product cutover and still dereferenced
-- StoryProject.format at execution time. PostgreSQL does not validate NEW/OLD
-- record fields when a PL/pgSQL function is created, so dropping the column
-- alone leaves a latent runtime failure on every project update.
CREATE OR REPLACE FUNCTION "story_project_identity_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."workspace_id" IS DISTINCT FROM OLD."workspace_id" THEN
    RAISE EXCEPTION 'StoryProject.workspaceId is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."frame_profile" IS DISTINCT FROM OLD."frame_profile" THEN
    RAISE EXCEPTION 'StoryProject.frameProfile is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

-- Local publication tables were removed before this cutover, but their
-- standalone function survived DROP TABLE and retained dependencies on the
-- retired StoryFormat type and StoryProject.format column.
DROP FUNCTION IF EXISTS "story_release_insert_guard"();

CREATE INDEX "story_projects_workspace_recent_idx"
  ON "story_projects"("workspace_id", "status", "updated_at" DESC);

DROP TYPE "StoryFormat";
