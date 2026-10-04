-- Keep existing projects as editable drafts. Historical receipts cannot be
-- backfilled from mutable project metadata without inventing review evidence.
ALTER TABLE "story_experience_draft_releases" ADD COLUMN "listing_snapshot" JSONB;
ALTER TABLE "story_experience_game_releases" ADD COLUMN "listing_snapshot" JSONB;
