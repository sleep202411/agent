CREATE TYPE "CrewProductionStatus" AS ENUM (
  'backlog',
  'planned',
  'in_progress',
  'completed',
  'cancelled'
);

CREATE TYPE "CrewProductionResourceKind" AS ENUM ('link', 'asset');
CREATE TYPE "CrewProductionUpdateHealth" AS ENUM ('on_track', 'at_risk', 'off_track');

ALTER TABLE "crew_production_pages"
  ADD COLUMN "status" "CrewProductionStatus" NOT NULL DEFAULT 'backlog',
  ADD COLUMN "priority" "CrewTaskPriority",
  ADD COLUMN "lead_member_id" TEXT,
  ADD COLUMN "target_date" DATE,
  ADD COLUMN "metadata_version" INTEGER NOT NULL DEFAULT 1,
  ADD CONSTRAINT "crew_production_pages_metadata_version_positive"
    CHECK ("metadata_version" > 0),
  ADD CONSTRAINT "crew_production_pages_lead_member_id_fkey"
    FOREIGN KEY ("lead_member_id") REFERENCES "crew_members"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "crew_production_resources" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "crew_id" TEXT NOT NULL,
  "kind" "CrewProductionResourceKind" NOT NULL,
  "title" VARCHAR(180) NOT NULL,
  "url" VARCHAR(2048),
  "asset_node_id" UUID,
  "created_by_user_id" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crew_production_resources_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crew_production_resources_title_nonempty" CHECK (btrim("title") <> ''),
  CONSTRAINT "crew_production_resources_shape" CHECK (
    ("kind" = 'link' AND "url" IS NOT NULL AND "asset_node_id" IS NULL) OR
    ("kind" = 'asset' AND "url" IS NULL AND "asset_node_id" IS NOT NULL)
  ),
  CONSTRAINT "crew_production_resources_crew_id_fkey"
    FOREIGN KEY ("crew_id") REFERENCES "crews"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "crew_production_resources_asset_node_id_fkey"
    FOREIGN KEY ("asset_node_id") REFERENCES "crew_asset_nodes"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "crew_production_resources_crew_idx"
  ON "crew_production_resources"("crew_id", "created_at", "id");
CREATE INDEX "crew_production_resources_asset_idx"
  ON "crew_production_resources"("asset_node_id");

CREATE TABLE "crew_production_updates" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "crew_id" TEXT NOT NULL,
  "health" "CrewProductionUpdateHealth" NOT NULL DEFAULT 'on_track',
  "body" TEXT NOT NULL,
  "progress" INTEGER,
  "created_by_user_id" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crew_production_updates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crew_production_updates_body_nonempty" CHECK (btrim("body") <> ''),
  CONSTRAINT "crew_production_updates_progress_range" CHECK (
    "progress" IS NULL OR ("progress" >= 0 AND "progress" <= 100)
  ),
  CONSTRAINT "crew_production_updates_crew_id_fkey"
    FOREIGN KEY ("crew_id") REFERENCES "crews"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "crew_production_updates_recent_idx"
  ON "crew_production_updates"("crew_id", "created_at" DESC, "id" DESC);
