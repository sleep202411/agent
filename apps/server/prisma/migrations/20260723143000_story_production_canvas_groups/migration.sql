UPDATE "story_production_canvases"
SET
    "schema_version" = 'story-production-canvas-v2',
    "content" = jsonb_set("content", '{groups}', '[]'::jsonb, true)
WHERE "schema_version" = 'story-production-canvas-v1';

ALTER TABLE "story_production_canvases"
ALTER COLUMN "schema_version" SET DEFAULT 'story-production-canvas-v2';

ALTER TABLE "story_production_canvases"
ALTER COLUMN "content" SET DEFAULT '{"nodes":[],"edges":[],"assets":[],"groups":[]}';
