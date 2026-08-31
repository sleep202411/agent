-- A chapter is a shared production document. Allowing two confirmed batches
-- to generate against it concurrently makes selected media depend on provider
-- completion order, so enforce one active batch for the entire chapter.
CREATE UNIQUE INDEX "story_generation_batches_chapter_active_unique"
  ON "story_generation_batches"("story_chapter_id")
  WHERE "status" IN ('queued', 'running', 'cancelling');
