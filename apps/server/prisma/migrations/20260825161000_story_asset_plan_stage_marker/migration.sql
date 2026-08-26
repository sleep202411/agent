-- An approved Asset stage can intentionally contain zero specs. Row counts
-- cannot distinguish that from "Assets never approved", so the chapter pins
-- the exact immutable plan snapshot that owns its current Asset stage.

ALTER TABLE "story_chapters"
  ADD COLUMN "approved_asset_plan_snapshot_id" UUID;

CREATE INDEX "story_chapters_approved_asset_plan_snapshot_idx"
  ON "story_chapters" ("approved_asset_plan_snapshot_id")
  WHERE "approved_asset_plan_snapshot_id" IS NOT NULL;

ALTER TABLE "story_chapters"
  ADD CONSTRAINT "story_chapters_approved_asset_plan_snapshot_scope_fkey"
  FOREIGN KEY (
    "approved_asset_plan_snapshot_id",
    "id",
    "story_project_id"
  )
  REFERENCES "story_production_plan_snapshots" (
    "id",
    "story_chapter_id",
    "story_project_id"
  )
  ON DELETE NO ACTION
  ON UPDATE CASCADE;
