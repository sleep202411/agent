CREATE TYPE "StoryDurationPreset" AS ENUM (
  'short_5_15',
  'medium_15_30',
  'long_30_60'
);

CREATE TYPE "StoryVisualStyle" AS ENUM (
  'cinematic_realism',
  'stylized_3d',
  'graphic_novel',
  'anime_cinematic'
);

ALTER TABLE "story_projects"
  ADD COLUMN "duration_preset" "StoryDurationPreset",
  ADD COLUMN "visual_style" "StoryVisualStyle",
  ADD COLUMN "creative_profile_confirmed_at" TIMESTAMPTZ(6);

ALTER TABLE "story_projects"
  ADD CONSTRAINT "story_projects_creative_profile_complete_chk"
  CHECK (
    ("duration_preset" IS NULL AND "visual_style" IS NULL AND "creative_profile_confirmed_at" IS NULL)
    OR
    ("duration_preset" IS NOT NULL AND "visual_style" IS NOT NULL AND "creative_profile_confirmed_at" IS NOT NULL)
  );
