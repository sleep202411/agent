-- Story-world is canonical project data, while its canvas card is an optional
-- authoring projection. Persist that projection's presence beside coordinates
-- without changing the interactive-film draft or runtime entry semantics.

ALTER TABLE "story_canvas_layouts"
  ADD COLUMN "story_world_node_present" BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE "story_canvas_layouts"
  ALTER COLUMN "schema_version" SET DEFAULT 'story-canvas-layout-v2';

UPDATE "story_canvas_layouts"
SET "schema_version" = 'story-canvas-layout-v2'
WHERE "schema_version" = 'story-canvas-layout-v1';
