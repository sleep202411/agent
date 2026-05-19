-- User-controlled Crew Hall visibility.
--
-- New crews start unlisted. Owners explicitly make a crew visible in
-- the hall when the profile is ready; they can hide it again without
-- deleting the workspace or collaboration history.

CREATE TYPE "CrewListingStatus" AS ENUM ('unlisted', 'listed');

ALTER TABLE "crews"
  ADD COLUMN "listing_status" "CrewListingStatus" NOT NULL DEFAULT 'unlisted',
  ADD COLUMN "listed_at" TIMESTAMPTZ(6);

DROP INDEX IF EXISTS "crews_feed_idx";

CREATE INDEX "crews_feed_idx"
  ON "crews"("listing_status", "deleted_at", "listed_at" DESC, "created_at" DESC);
