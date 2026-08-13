-- Story Studio is now the interactive-film product only. Retire only projects
-- authored with a removed format; interactive-film projects and their complete
-- production graphs remain valid and must survive the cutover.
BEGIN;

CREATE TEMP TABLE "retired_story_projects" (
  "id" UUID PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO "retired_story_projects" ("id")
SELECT "id"
FROM "story_projects"
WHERE "format" <> 'interactive_film';

-- Several Story Studio tables are append-only or immutable by design. Their
-- user triggers protect normal product traffic, but this one-time product
-- retirement must remove the complete graph owned by retired formats. Keep
-- foreign-key triggers active throughout; only user-defined guards are paused
-- inside this transaction and are restored before the cutover commits.
DO $$
DECLARE
  "table_name" TEXT;
BEGIN
  FOR "table_name" IN
    SELECT "tablename"
    FROM "pg_tables"
    WHERE "schemaname" = current_schema()
      AND "tablename" LIKE 'story\_%' ESCAPE '\'
  LOOP
    EXECUTE format('ALTER TABLE %I DISABLE TRIGGER USER', "table_name");
  END LOOP;
END;
$$;

-- Reviews and approvals do not carry story_project_id directly, so remove
-- them through their reference version before the owning project is deleted.
DELETE FROM "story_reference_approvals" AS "approval"
USING "story_reference_versions" AS "version", "retired_story_projects" AS "retired"
WHERE "approval"."reference_version_id" = "version"."id"
  AND "version"."story_project_id" = "retired"."id";

DELETE FROM "story_reference_reviews" AS "review"
USING "story_reference_versions" AS "version", "retired_story_projects" AS "retired"
WHERE "review"."reference_version_id" = "version"."id"
  AND "version"."story_project_id" = "retired"."id";

-- Break the reference-slot/version cycle for retired projects. The project
-- delete below cascades through both tables after the approved pointer is null.
UPDATE "story_reference_slots" AS "slot"
SET "approved_version_id" = NULL
WHERE "slot"."story_project_id" IN (
  SELECT "id" FROM "retired_story_projects"
);

-- Agent runs deliberately use RESTRICT semantics and may self-reference an
-- earlier run. Remove the project write head first, then temporarily remove
-- only the self-reference while deleting all retired-project runs.
DELETE FROM "story_project_write_states" AS "write_state"
WHERE "write_state"."story_project_id" IN (
  SELECT "id" FROM "retired_story_projects"
);

ALTER TABLE "story_agent_runs"
  DROP CONSTRAINT "story_agent_runs_reverts_run_id_fkey";

DELETE FROM "story_agent_runs" AS "run"
WHERE "run"."story_project_id" IN (
  SELECT "id" FROM "retired_story_projects"
);

ALTER TABLE "story_agent_runs"
  ADD CONSTRAINT "story_agent_runs_reverts_run_id_fkey"
  FOREIGN KEY ("reverts_run_id")
  REFERENCES "story_agent_runs"("id")
  ON DELETE RESTRICT;

-- Production builds intentionally use RESTRICT so that an accidental project
-- delete cannot erase released media. This migration is the explicit product
-- retirement boundary, so delete only the retired projects' release/build
-- graph in dependency order. Interactive-film rows never match this scope.
DELETE FROM "story_video_build_clips" AS "clip"
WHERE "clip"."story_project_id" IN (
  SELECT "id" FROM "retired_story_projects"
);

DELETE FROM "story_experience_draft_releases" AS "release"
WHERE "release"."story_project_id" IN (
  SELECT "id" FROM "retired_story_projects"
);

DELETE FROM "story_experience_publications" AS "publication"
WHERE "publication"."story_project_id" IN (
  SELECT "id" FROM "retired_story_projects"
);

-- Deleting a game release cascades through its chapter snapshot rows, which
-- must happen before their RESTRICT reference to story_builds is removed.
DELETE FROM "story_experience_game_releases" AS "release"
WHERE "release"."story_project_id" IN (
  SELECT "id" FROM "retired_story_projects"
);

DELETE FROM "story_build_assets" AS "asset"
WHERE "asset"."story_project_id" IN (
  SELECT "id" FROM "retired_story_projects"
);

DELETE FROM "story_builds" AS "build"
WHERE "build"."story_project_id" IN (
  SELECT "id" FROM "retired_story_projects"
);

DELETE FROM "story_revisions" AS "revision"
WHERE "revision"."story_project_id" IN (
  SELECT "id" FROM "retired_story_projects"
);

DELETE FROM "story_video_upload_sessions" AS "upload_session"
WHERE "upload_session"."story_project_id" IN (
  SELECT "id" FROM "retired_story_projects"
);

DELETE FROM "story_projects" AS "project"
WHERE "project"."id" IN (
  SELECT "id" FROM "retired_story_projects"
);

DO $$
DECLARE
  "table_name" TEXT;
BEGIN
  FOR "table_name" IN
    SELECT "tablename"
    FROM "pg_tables"
    WHERE "schemaname" = current_schema()
      AND "tablename" LIKE 'story\_%' ESCAPE '\'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE TRIGGER USER', "table_name");
  END LOOP;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "story_projects"
    WHERE "format" <> 'interactive_film'
       OR "frame_profile" IS NULL
  ) THEN
    RAISE EXCEPTION 'Interactive-film cutover left an invalid StoryProject';
  END IF;
END;
$$;

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

COMMIT;
