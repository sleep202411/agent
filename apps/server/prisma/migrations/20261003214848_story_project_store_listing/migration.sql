-- Promotional material drafts for story projects. Publication candidates
-- freeze these fields before moderation; public reads use the release snapshot.
-- Nullable JSONB; absent means the project has no promotional materials yet.
ALTER TABLE "story_projects" ADD COLUMN "store_listing" JSONB;
