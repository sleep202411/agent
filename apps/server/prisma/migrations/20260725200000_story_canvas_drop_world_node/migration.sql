-- The Story World card is gone from the canvas: the story bible is project-level
-- data reached from a drawer, and a chapter's entry is set on the scene itself.
-- Nothing on the canvas is per-chapter about the world any more, so the layout
-- stops carrying a presence flag or a position for the synthetic root node.
--
-- Layout reads reject an unknown schema version outright (there is no migration
-- path at read time), so the stored rows must be rewritten in the same step that
-- the code starts expecting v3.

-- 1. Drop the synthetic root node's position from every stored layout.
UPDATE "story_canvas_layouts"
SET "node_positions" = "node_positions" - '__story_root__'
WHERE "node_positions" ? '__story_root__';

-- 2. Move every row onto the version the code now reads.
UPDATE "story_canvas_layouts"
SET "schema_version" = 'story-canvas-layout-v3'
WHERE "schema_version" = 'story-canvas-layout-v2';

-- 3. Retire the presence flag.
ALTER TABLE "story_canvas_layouts" DROP COLUMN "story_world_node_present";

ALTER TABLE "story_canvas_layouts" ALTER COLUMN "schema_version" SET DEFAULT 'story-canvas-layout-v3';
