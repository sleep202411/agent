-- Crew asset center: hierarchical file/folder metadata over the existing
-- MediaAsset binary ledger. Crew membership remains the authorization source;
-- object bytes keep using the region-selected direct-to-storage pipeline.

CREATE TYPE "CrewAssetNodeKind" AS ENUM ('folder', 'file');
CREATE TYPE "CrewAssetNodeStatus" AS ENUM ('active', 'trashed');

CREATE TABLE "crew_asset_nodes" (
    "id" UUID NOT NULL,
    "crew_id" TEXT NOT NULL,
    "parent_id" UUID,
    "kind" "CrewAssetNodeKind" NOT NULL,
    "status" "CrewAssetNodeStatus" NOT NULL DEFAULT 'active',
    "name" VARCHAR(256) NOT NULL,
    "media_asset_id" UUID,
    "created_by_user_id" VARCHAR(64) NOT NULL,
    "updated_by_user_id" VARCHAR(64) NOT NULL,
    "trashed_at" TIMESTAMPTZ(6),
    "trashed_by_user_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crew_asset_nodes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "crew_asset_nodes_kind_media_check" CHECK (
      ("kind" = 'folder' AND "media_asset_id" IS NULL)
      OR
      ("kind" = 'file' AND "media_asset_id" IS NOT NULL)
    ),
    CONSTRAINT "crew_asset_nodes_trash_state_check" CHECK (
      ("status" = 'active' AND "trashed_at" IS NULL AND "trashed_by_user_id" IS NULL)
      OR
      ("status" = 'trashed' AND "trashed_at" IS NOT NULL AND "trashed_by_user_id" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "crew_asset_nodes_id_crew_unique"
  ON "crew_asset_nodes"("id", "crew_id");
CREATE INDEX "crew_asset_nodes_folder_listing_idx"
  ON "crew_asset_nodes"("crew_id", "parent_id", "status", "updated_at" DESC);
CREATE INDEX "crew_asset_nodes_source_listing_idx"
  ON "crew_asset_nodes"("crew_id", "status", "updated_at" DESC);
CREATE INDEX "crew_asset_nodes_media_asset_idx"
  ON "crew_asset_nodes"("media_asset_id");
CREATE UNIQUE INDEX "crew_asset_nodes_active_name_unique"
  ON "crew_asset_nodes"(
    "crew_id",
    COALESCE("parent_id", '00000000-0000-0000-0000-000000000000'::uuid),
    LOWER("name")
  )
  WHERE "status" = 'active';

CREATE TABLE "crew_asset_favorites" (
    "id" UUID NOT NULL,
    "node_id" UUID NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crew_asset_favorites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "crew_asset_favorites_node_user_unique"
  ON "crew_asset_favorites"("node_id", "user_id");
CREATE INDEX "crew_asset_favorites_user_recent_idx"
  ON "crew_asset_favorites"("user_id", "created_at" DESC);

ALTER TABLE "crew_asset_nodes"
  ADD CONSTRAINT "crew_asset_nodes_crew_id_fkey"
  FOREIGN KEY ("crew_id") REFERENCES "crews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crew_asset_nodes"
  ADD CONSTRAINT "crew_asset_nodes_parent_id_crew_id_fkey"
  FOREIGN KEY ("parent_id", "crew_id") REFERENCES "crew_asset_nodes"("id", "crew_id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crew_asset_nodes"
  ADD CONSTRAINT "crew_asset_nodes_media_asset_id_fkey"
  FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crew_asset_favorites"
  ADD CONSTRAINT "crew_asset_favorites_node_id_fkey"
  FOREIGN KEY ("node_id") REFERENCES "crew_asset_nodes"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
