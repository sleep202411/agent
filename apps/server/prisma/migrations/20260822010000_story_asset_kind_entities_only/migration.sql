-- Asset Specs are the three ENTITY anchors: character / location / prop.
-- The overall visual style is the project's creative-profile field and is
-- written into every generation prompt by the planner — provider reference
-- inputs are subject-consistency channels, so a bindable "style" spec bought
-- nothing the single-pass planner does not already guarantee. Recurring
-- non-physical visual motifs (visions, projections, on-screen documents) are
-- prop specs, which is why `graphic` folds into `prop` instead of being
-- deleted. The production plane is pre-release everywhere, so the remap and
-- the style deletions only ever touch development data.

-- 1. Drop the kind-bound guards first: the character CHECK binds to the enum
--    type OID, Postgres refuses to alter a column type referenced by a
--    trigger definition, and the source-guard trigger must not re-validate
--    legacy rows against drafts that may have drifted since those rows were
--    planned. The plpgsql guard FUNCTION resolves the type by name at
--    runtime and needs no change.
ALTER TABLE "story_asset_specs"
  DROP CONSTRAINT "story_asset_specs_character_source_chk";
DROP TRIGGER "story_asset_spec_source_guard_trigger" ON "story_asset_specs";

-- 2. Data: fold graphics into props, remove style specs and their dependents.
UPDATE "story_asset_specs" SET "kind" = 'prop' WHERE "kind" = 'graphic';

UPDATE "story_asset_specs"
SET "selected_media_version_id" = NULL
WHERE "kind" = 'style';

DELETE FROM "story_storyboard_clip_asset_bindings" b
USING "story_asset_specs" s
WHERE b."asset_spec_id" = s."id" AND s."kind" = 'style';

DELETE FROM "story_asset_media_versions" v
USING "story_asset_specs" s
WHERE v."asset_spec_id" = s."id" AND s."kind" = 'style';

DELETE FROM "story_asset_specs" WHERE "kind" = 'style';

-- 3. Enum: recreate with only the three entity kinds, then restore the
--    guards.
ALTER TYPE "StoryAssetSpecKind" RENAME TO "StoryAssetSpecKind_old";
CREATE TYPE "StoryAssetSpecKind" AS ENUM ('character', 'location', 'prop');
ALTER TABLE "story_asset_specs"
  ALTER COLUMN "kind" TYPE "StoryAssetSpecKind"
  USING "kind"::text::"StoryAssetSpecKind";
DROP TYPE "StoryAssetSpecKind_old";

ALTER TABLE "story_asset_specs"
  ADD CONSTRAINT "story_asset_specs_character_source_chk" CHECK (
    ("kind" = 'character'::"StoryAssetSpecKind" AND "source_character_id" IS NOT NULL)
    OR ("kind" <> 'character'::"StoryAssetSpecKind" AND "source_character_id" IS NULL)
  );
CREATE TRIGGER "story_asset_spec_source_guard_trigger"
  BEFORE INSERT OR UPDATE OF "story_project_id", "story_chapter_id", "kind", "source_character_id", "source_node_ids"
  ON "story_asset_specs"
  FOR EACH ROW EXECUTE FUNCTION story_asset_spec_source_guard();
