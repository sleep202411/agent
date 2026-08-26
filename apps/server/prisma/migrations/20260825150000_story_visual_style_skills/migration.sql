-- Replace the closed visual-style enum with a pinned Project Skill identity.
-- Existing confirmed profiles map to the equivalent first-party Skill.
ALTER TABLE "story_projects"
  ADD COLUMN "visual_style_skill_id" UUID,
  ADD COLUMN "visual_style_skill_version_id" UUID;

ALTER TABLE "story_projects"
  ALTER COLUMN "visual_style" TYPE VARCHAR(128)
  USING CASE "visual_style"::text
    WHEN 'cinematic_realism' THEN 'cinematic-realism'
    WHEN 'stylized_3d' THEN 'stylized-3d-cinema'
    WHEN 'graphic_novel' THEN 'graphic-novel-cinema'
    WHEN 'anime_cinematic' THEN 'anime-cinematic'
    ELSE NULL
  END;

UPDATE "story_projects"
SET
  "visual_style_skill_id" = CASE "visual_style"
    WHEN 'cinematic-realism' THEN '10000000-0000-7000-8000-000000000029'::uuid
    WHEN 'stylized-3d-cinema' THEN '10000000-0000-7000-8000-000000000030'::uuid
    WHEN 'anime-cinematic' THEN '10000000-0000-7000-8000-000000000031'::uuid
    WHEN 'graphic-novel-cinema' THEN '10000000-0000-7000-8000-000000000032'::uuid
  END,
  "visual_style_skill_version_id" = CASE "visual_style"
    WHEN 'cinematic-realism' THEN '20000000-0000-7000-8000-000000000029'::uuid
    WHEN 'stylized-3d-cinema' THEN '20000000-0000-7000-8000-000000000030'::uuid
    WHEN 'anime-cinematic' THEN '20000000-0000-7000-8000-000000000031'::uuid
    WHEN 'graphic-novel-cinema' THEN '20000000-0000-7000-8000-000000000032'::uuid
  END
WHERE "visual_style" IS NOT NULL;

ALTER TABLE "story_projects"
  ADD CONSTRAINT "story_projects_visual_style_skill_complete_check"
  CHECK (
    ("visual_style" IS NULL AND "visual_style_skill_id" IS NULL AND "visual_style_skill_version_id" IS NULL)
    OR
    ("visual_style" IS NOT NULL AND "visual_style_skill_id" IS NOT NULL AND "visual_style_skill_version_id" IS NOT NULL)
  );

DROP TYPE "StoryVisualStyle";
