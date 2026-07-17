-- Story Studio project-wide frame contract.
--
-- Interactive-film output orientation is selected once, at project creation,
-- then owned by StoryProject for the entire production lifecycle. Existing
-- Story Studio projects were authored at 16:9 and
-- are therefore backfilled to the landscape contract.

CREATE TYPE "StoryFrameProfile" AS ENUM (
  'landscape_16_9',
  'portrait_9_16'
);

ALTER TABLE "story_projects"
  ADD COLUMN "frame_profile" "StoryFrameProfile";

UPDATE "story_projects"
SET "frame_profile" = 'landscape_16_9'
WHERE "frame_profile" IS NULL;

ALTER TABLE "story_projects"
  ALTER COLUMN "frame_profile" SET NOT NULL;

-- Extend the existing product-plane identity guard. The profile is part of
-- project identity, not mutable project metadata.
CREATE OR REPLACE FUNCTION "story_project_identity_guard"()
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
  IF NEW."frame_profile" IS DISTINCT FROM OLD."frame_profile" THEN
    RAISE EXCEPTION 'StoryProject.frameProfile is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

-- Guard normalized FilmSpec dimensions and the canonical JSON snapshot at the
-- database boundary. This prevents direct/import writes from bypassing the
-- project-level profile contract.
CREATE FUNCTION "story_film_spec_frame_profile_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  expected_profile "StoryFrameProfile";
  expected_ratio TEXT;
  expected_width INTEGER;
  expected_height INTEGER;
BEGIN
  SELECT "frame_profile" INTO expected_profile
  FROM "story_projects" WHERE "id" = NEW."story_project_id";

  IF expected_profile = 'landscape_16_9'::"StoryFrameProfile" THEN
    expected_ratio := '16:9';
    expected_width := 1920;
    expected_height := 1080;
  ELSE
    expected_ratio := '9:16';
    expected_width := 1080;
    expected_height := 1920;
  END IF;

  IF NEW."frame_width" <> expected_width
     OR NEW."frame_height" <> expected_height
     OR NEW."spec_json" #>> '{frame,aspectRatio}' IS DISTINCT FROM expected_ratio
     OR (NEW."spec_json" #>> '{frame,width}')::INTEGER IS DISTINCT FROM expected_width
     OR (NEW."spec_json" #>> '{frame,height}')::INTEGER IS DISTINCT FROM expected_height THEN
    RAISE EXCEPTION 'StoryFilmSpec frame must match StoryProject.frameProfile (%)', expected_profile
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_film_specs_frame_profile_guard_trg"
BEFORE INSERT OR UPDATE OF
  "story_project_id", "frame_width", "frame_height", "spec_json"
ON "story_film_specs"
FOR EACH ROW EXECUTE FUNCTION "story_film_spec_frame_profile_guard"();

-- FilmClip stores its full output contract in spec_json. Validate it against
-- the same immutable project profile so mixed-orientation clip sets cannot be
-- introduced by imports or future write paths.
CREATE FUNCTION "story_film_clip_frame_profile_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  expected_profile "StoryFrameProfile";
  expected_ratio TEXT;
  expected_width INTEGER;
  expected_height INTEGER;
BEGIN
  SELECT "frame_profile" INTO expected_profile
  FROM "story_projects" WHERE "id" = NEW."story_project_id";

  IF expected_profile = 'landscape_16_9'::"StoryFrameProfile" THEN
    expected_ratio := '16:9';
    expected_width := 1920;
    expected_height := 1080;
  ELSE
    expected_ratio := '9:16';
    expected_width := 1080;
    expected_height := 1920;
  END IF;

  IF NEW."spec_json" #>> '{outputContract,aspectRatio}' IS DISTINCT FROM expected_ratio
     OR (NEW."spec_json" #>> '{outputContract,width}')::INTEGER IS DISTINCT FROM expected_width
     OR (NEW."spec_json" #>> '{outputContract,height}')::INTEGER IS DISTINCT FROM expected_height THEN
    RAISE EXCEPTION 'StoryFilmClip outputContract must match StoryProject.frameProfile (%)', expected_profile
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_film_clips_frame_profile_guard_trg"
BEFORE INSERT OR UPDATE OF "story_project_id", "spec_json"
ON "story_film_clips"
FOR EACH ROW EXECUTE FUNCTION "story_film_clip_frame_profile_guard"();
