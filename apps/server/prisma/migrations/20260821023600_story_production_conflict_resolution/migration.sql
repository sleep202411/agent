-- Durable Story production conflict resolution.
--
-- A planner retry must never overwrite creator-authored Asset Specs or
-- Storyboard subtrees. One immutable, chapter-scoped snapshot records the
-- exact approved plan that produced a pending fingerprint; targets merely
-- reference it until the creator explicitly keeps their value or accepts the
-- latest plan.

CREATE TYPE "StoryProductionPlanDisposition" AS ENUM ('planned', 'user_override');

CREATE TABLE "story_production_plan_snapshots" (
  "id" UUID NOT NULL,
  "story_project_id" UUID NOT NULL,
  "story_chapter_id" UUID NOT NULL,
  "source_fingerprint" VARCHAR(64) NOT NULL,
  "plan_fingerprint" VARCHAR(64) NOT NULL,
  "production_plan" JSONB NOT NULL,
  "created_by_user_id" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "story_production_plan_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_production_plan_snapshots_fingerprints_chk" CHECK (
    "source_fingerprint" ~ '^[0-9a-f]{64}$'
    AND "plan_fingerprint" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "story_production_plan_snapshots_plan_chk"
    CHECK (jsonb_typeof("production_plan") = 'object'),
  CONSTRAINT "story_production_plan_snapshots_actor_chk"
    CHECK (btrim("created_by_user_id") <> '')
);

CREATE UNIQUE INDEX "story_production_plan_snapshots_chapter_fingerprint_unique"
  ON "story_production_plan_snapshots" ("story_chapter_id", "plan_fingerprint");
CREATE UNIQUE INDEX "story_production_plan_snapshots_scope_unique"
  ON "story_production_plan_snapshots" ("id", "story_chapter_id", "story_project_id");
CREATE INDEX "story_production_plan_snapshots_chapter_recent_idx"
  ON "story_production_plan_snapshots" ("story_project_id", "story_chapter_id", "created_at" DESC);

ALTER TABLE "story_production_plan_snapshots"
  ADD CONSTRAINT "story_production_plan_snapshots_project_fkey"
    FOREIGN KEY ("story_project_id") REFERENCES "story_projects" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "story_production_plan_snapshots_chapter_scope_fkey"
    FOREIGN KEY ("story_chapter_id", "story_project_id")
    REFERENCES "story_chapters" ("id", "story_project_id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "story_asset_specs"
  ADD COLUMN "pending_plan_snapshot_id" UUID,
  ADD COLUMN "plan_disposition" "StoryProductionPlanDisposition" NOT NULL DEFAULT 'planned';

ALTER TABLE "story_storyboard_sequences"
  ADD COLUMN "pending_plan_snapshot_id" UUID,
  ADD COLUMN "plan_disposition" "StoryProductionPlanDisposition" NOT NULL DEFAULT 'planned';

CREATE INDEX "story_asset_specs_pending_plan_idx"
  ON "story_asset_specs" ("pending_plan_snapshot_id")
  WHERE "pending_plan_snapshot_id" IS NOT NULL;
CREATE INDEX "story_storyboard_sequences_pending_plan_idx"
  ON "story_storyboard_sequences" ("pending_plan_snapshot_id")
  WHERE "pending_plan_snapshot_id" IS NOT NULL;

ALTER TABLE "story_asset_specs"
  ADD CONSTRAINT "story_asset_specs_pending_plan_scope_fkey"
    FOREIGN KEY ("pending_plan_snapshot_id", "story_chapter_id", "story_project_id")
    REFERENCES "story_production_plan_snapshots" ("id", "story_chapter_id", "story_project_id")
    ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "story_storyboard_sequences"
  ADD CONSTRAINT "story_storyboard_sequences_pending_plan_scope_fkey"
    FOREIGN KEY ("pending_plan_snapshot_id", "story_chapter_id", "story_project_id")
    REFERENCES "story_production_plan_snapshots" ("id", "story_chapter_id", "story_project_id")
    ON DELETE NO ACTION ON UPDATE CASCADE;

-- Legacy stale rows can have no exact snapshot; the next planner reconcile
-- attaches one. New current/archived rows may never retain pending authority.
ALTER TABLE "story_asset_specs"
  DROP CONSTRAINT "story_asset_specs_stale_shape_chk",
  ADD CONSTRAINT "story_asset_specs_stale_shape_chk" CHECK (
    ("status" = 'stale' AND "pending_source_fingerprint" IS NOT NULL)
    OR (
      "status" <> 'stale'
      AND "pending_source_fingerprint" IS NULL
      AND "pending_plan_snapshot_id" IS NULL
    )
  );

ALTER TABLE "story_storyboard_sequences"
  DROP CONSTRAINT "story_storyboard_sequences_stale_shape_chk",
  ADD CONSTRAINT "story_storyboard_sequences_stale_shape_chk" CHECK (
    ("status" = 'stale' AND "pending_source_fingerprint" IS NOT NULL)
    OR (
      "status" <> 'stale'
      AND "pending_source_fingerprint" IS NULL
      AND "pending_plan_snapshot_id" IS NULL
    )
  );
