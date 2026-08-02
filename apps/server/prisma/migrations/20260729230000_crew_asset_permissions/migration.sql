CREATE TYPE "CrewAssetAccessMode" AS ENUM ('inherit', 'restricted');
CREATE TYPE "CrewAssetPermission" AS ENUM ('view', 'upload', 'edit', 'manage');

ALTER TABLE "crew_asset_nodes"
  ADD COLUMN "access_mode" "CrewAssetAccessMode" NOT NULL DEFAULT 'inherit',
  ADD COLUMN "permission_version" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "crew_asset_grants" (
  "id" UUID NOT NULL,
  "node_id" UUID NOT NULL,
  "user_id" VARCHAR(64) NOT NULL,
  "permission" "CrewAssetPermission" NOT NULL,
  "granted_by_user_id" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "crew_asset_grants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crew_asset_grants_node_fkey"
    FOREIGN KEY ("node_id")
    REFERENCES "crew_asset_nodes"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "crew_asset_grants_node_user_unique"
  ON "crew_asset_grants"("node_id", "user_id");
CREATE INDEX "crew_asset_grants_user_permission_idx"
  ON "crew_asset_grants"("user_id", "permission");
