-- Make the generation purpose queryable so repeated primary and three-view
-- runs cannot hide one another behind an arbitrary recent-history limit.
CREATE TYPE "StoryAssetGenerationPurpose" AS ENUM ('primary', 'turnaround');

ALTER TABLE "story_production_generations"
  ADD COLUMN "purpose" "StoryAssetGenerationPurpose" NOT NULL DEFAULT 'primary';

UPDATE "story_production_generations"
SET "purpose" = 'turnaround'
WHERE "target_kind" = 'asset_spec'
  AND "submission_snapshot" ->> 'purpose' = 'turnaround';

ALTER TABLE "story_production_generations"
  ADD CONSTRAINT "story_production_generations_purpose_target_chk" CHECK (
    "target_kind" = 'asset_spec'
    OR "purpose" = 'primary'
  );

CREATE INDEX "story_production_generations_asset_purpose_recent_idx"
  ON "story_production_generations" (
    "asset_spec_id",
    "purpose",
    "created_at" DESC
  );
