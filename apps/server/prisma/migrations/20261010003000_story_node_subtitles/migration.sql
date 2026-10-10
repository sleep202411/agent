ALTER TABLE "story_storyboard_sequences"
  ADD COLUMN "subtitle_tracks" JSONB NOT NULL DEFAULT '[]'::jsonb;
