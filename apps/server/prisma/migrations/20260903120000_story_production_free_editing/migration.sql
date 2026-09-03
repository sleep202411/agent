-- Story production is a live creator workspace. Upstream edits no longer
-- invalidate downstream work or create a conflict-resolution workflow.

BEGIN;

-- Script identities are planning hints after creation, not foreign-key-like
-- gates on later creator edits.
DROP TRIGGER "story_asset_spec_source_guard_trigger" ON "story_asset_specs";
DROP FUNCTION "story_asset_spec_source_guard"();

-- These objects compare status values and therefore retain a dependency on
-- the old enum while PostgreSQL rewrites the columns below. Recreate them
-- after every status column uses the replacement enum.
DROP TRIGGER "story_storyboard_clip_timeline_guard_trigger"
  ON "story_storyboard_clips";
DROP TRIGGER "story_storyboard_sequence_timeline_guard_trigger"
  ON "story_storyboard_sequences";
DROP FUNCTION "story_storyboard_timeline_guard"();
DROP INDEX "story_storyboard_sequences_project_plot_active_unique_idx";

ALTER TABLE "story_asset_specs"
  DROP CONSTRAINT "story_asset_specs_pending_plan_scope_fkey",
  DROP CONSTRAINT "story_asset_specs_stale_shape_chk",
  DROP CONSTRAINT "story_asset_specs_fingerprints_chk",
  DROP CONSTRAINT "story_asset_specs_character_source_chk",
  DROP CONSTRAINT "story_asset_specs_source_nodes_chk";

ALTER TABLE "story_storyboard_sequences"
  DROP CONSTRAINT "story_storyboard_sequences_pending_plan_scope_fkey",
  DROP CONSTRAINT "story_storyboard_sequences_stale_shape_chk",
  DROP CONSTRAINT "story_storyboard_sequences_fingerprints_chk";

ALTER TABLE "story_storyboard_clips"
  DROP CONSTRAINT "story_storyboard_clips_stale_shape_chk",
  DROP CONSTRAINT "story_storyboard_clips_fingerprints_chk";

ALTER TABLE "story_storyboard_clip_asset_bindings"
  DROP CONSTRAINT "story_storyboard_bindings_stale_shape_chk",
  DROP CONSTRAINT "story_storyboard_bindings_fingerprints_chk";

ALTER TABLE "story_storyboard_cues"
  DROP CONSTRAINT "story_storyboard_cues_stale_shape_chk",
  DROP CONSTRAINT "story_storyboard_cues_fingerprints_chk";

DROP INDEX "story_asset_specs_pending_plan_idx";
DROP INDEX "story_storyboard_sequences_pending_plan_idx";

UPDATE "story_asset_specs" SET "status" = 'current' WHERE "status" = 'stale';
UPDATE "story_storyboard_sequences" SET "status" = 'current' WHERE "status" = 'stale';
UPDATE "story_storyboard_clips" SET "status" = 'current' WHERE "status" = 'stale';
UPDATE "story_storyboard_clip_asset_bindings" SET "status" = 'current' WHERE "status" = 'stale';
UPDATE "story_storyboard_cues" SET "status" = 'current' WHERE "status" = 'stale';

ALTER TABLE "story_asset_specs"
  DROP COLUMN "pending_source_fingerprint",
  DROP COLUMN "pending_plan_snapshot_id",
  DROP COLUMN "plan_disposition";
ALTER TABLE "story_storyboard_sequences"
  DROP COLUMN "pending_source_fingerprint",
  DROP COLUMN "pending_plan_snapshot_id",
  DROP COLUMN "plan_disposition";
ALTER TABLE "story_storyboard_clips" DROP COLUMN "pending_source_fingerprint";
ALTER TABLE "story_storyboard_clip_asset_bindings" DROP COLUMN "pending_source_fingerprint";
ALTER TABLE "story_storyboard_cues" DROP COLUMN "pending_source_fingerprint";

ALTER TABLE "story_asset_specs"
  ADD CONSTRAINT "story_asset_specs_fingerprints_chk"
    CHECK ("source_fingerprint" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "story_asset_specs_character_source_chk" CHECK (
    (
      "kind" = 'character'::"StoryAssetSpecKind"
      AND ("source_character_id" IS NOT NULL OR "user_modified_at" IS NOT NULL)
    )
    OR (
      "kind" <> 'character'::"StoryAssetSpecKind"
      AND "source_character_id" IS NULL
    )
  ),
  ADD CONSTRAINT "story_asset_specs_source_nodes_chk" CHECK (
    jsonb_typeof("source_node_ids") = 'array'
  );

ALTER TABLE "story_storyboard_sequences"
  ADD CONSTRAINT "story_storyboard_sequences_fingerprints_chk"
    CHECK ("source_fingerprint" ~ '^[0-9a-f]{64}$');
ALTER TABLE "story_storyboard_clips"
  ADD CONSTRAINT "story_storyboard_clips_fingerprints_chk"
    CHECK ("source_fingerprint" ~ '^[0-9a-f]{64}$');
ALTER TABLE "story_storyboard_clip_asset_bindings"
  ADD CONSTRAINT "story_storyboard_bindings_fingerprints_chk"
    CHECK ("source_fingerprint" ~ '^[0-9a-f]{64}$');
ALTER TABLE "story_storyboard_cues"
  ADD CONSTRAINT "story_storyboard_cues_fingerprints_chk"
    CHECK ("source_fingerprint" ~ '^[0-9a-f]{64}$');

ALTER TYPE "StoryProductionSpecStatus" RENAME TO "StoryProductionSpecStatus_old";
CREATE TYPE "StoryProductionSpecStatus" AS ENUM ('current', 'archived');

ALTER TABLE "story_asset_specs" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "story_storyboard_sequences" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "story_storyboard_clips" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "story_storyboard_clip_asset_bindings" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "story_storyboard_cues" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "story_asset_specs" ALTER COLUMN "status" TYPE "StoryProductionSpecStatus" USING "status"::text::"StoryProductionSpecStatus";
ALTER TABLE "story_storyboard_sequences" ALTER COLUMN "status" TYPE "StoryProductionSpecStatus" USING "status"::text::"StoryProductionSpecStatus";
ALTER TABLE "story_storyboard_clips" ALTER COLUMN "status" TYPE "StoryProductionSpecStatus" USING "status"::text::"StoryProductionSpecStatus";
ALTER TABLE "story_storyboard_clip_asset_bindings" ALTER COLUMN "status" TYPE "StoryProductionSpecStatus" USING "status"::text::"StoryProductionSpecStatus";
ALTER TABLE "story_storyboard_cues" ALTER COLUMN "status" TYPE "StoryProductionSpecStatus" USING "status"::text::"StoryProductionSpecStatus";

ALTER TABLE "story_asset_specs" ALTER COLUMN "status" SET DEFAULT 'current';
ALTER TABLE "story_storyboard_sequences" ALTER COLUMN "status" SET DEFAULT 'current';
ALTER TABLE "story_storyboard_clips" ALTER COLUMN "status" SET DEFAULT 'current';
ALTER TABLE "story_storyboard_clip_asset_bindings" ALTER COLUMN "status" SET DEFAULT 'current';
ALTER TABLE "story_storyboard_cues" ALTER COLUMN "status" SET DEFAULT 'current';

DROP TYPE "StoryProductionSpecStatus_old";
DROP TYPE "StoryProductionPlanDisposition";

CREATE UNIQUE INDEX "story_storyboard_sequences_project_plot_active_unique_idx"
  ON "story_storyboard_sequences" ("story_project_id", "plot_node_id")
  WHERE "status" <> 'archived';

CREATE FUNCTION "story_storyboard_timeline_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_sequence_id UUID;
  sequence_duration INTEGER;
  previous_end INTEGER := 0;
  visual_clip RECORD;
BEGIN
  IF TG_TABLE_NAME = 'story_storyboard_sequences' THEN
    target_sequence_id := COALESCE(NEW."id", OLD."id");
  ELSE
    target_sequence_id := COALESCE(NEW."sequence_id", OLD."sequence_id");
  END IF;
  SELECT sequence."duration_ms"
    INTO sequence_duration
  FROM "story_storyboard_sequences" sequence
  WHERE sequence."id" = target_sequence_id;

  IF sequence_duration IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  FOR visual_clip IN
    SELECT clip."start_ms", clip."duration_ms"
    FROM "story_storyboard_clips" clip
    WHERE clip."sequence_id" = target_sequence_id
      AND clip."status" <> 'archived'
    ORDER BY clip."start_ms", clip."rank", clip."id"
  LOOP
    IF visual_clip."start_ms" <> previous_end THEN
      RAISE EXCEPTION 'Storyboard visual clips must be continuous and non-overlapping';
    END IF;
    previous_end := visual_clip."start_ms" + visual_clip."duration_ms";
  END LOOP;

  IF previous_end <> sequence_duration THEN
    RAISE EXCEPTION 'Storyboard visual clips must cover the complete sequence duration';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "story_storyboard_cues" cue
    WHERE cue."sequence_id" = target_sequence_id
      AND cue."status" <> 'archived'
      AND cue."at_ms" > sequence_duration
  ) THEN
    RAISE EXCEPTION 'Storyboard cue must occur within its sequence duration';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE CONSTRAINT TRIGGER "story_storyboard_clip_timeline_guard_trigger"
AFTER INSERT OR UPDATE OR DELETE ON "story_storyboard_clips"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "story_storyboard_timeline_guard"();

CREATE CONSTRAINT TRIGGER "story_storyboard_sequence_timeline_guard_trigger"
AFTER INSERT OR UPDATE OF "duration_ms" ON "story_storyboard_sequences"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "story_storyboard_timeline_guard"();

COMMIT;
